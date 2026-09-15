-- Secret picks, shared picks, and one film per season
--
-- Before this, any group member could SELECT every column of every pick in a
-- season, so "secret until reveal" was only enforced by the UI. This moves it
-- into the database. It also makes shared picks (a co-pick group configured by
-- the admin in season setup) actually work — one member picks, every member of
-- the group is credited — and guarantees two *different* units can't pick the
-- same film in one season.
--
-- Terminology: a "unit" is a solo member, or a co-pick group (season_participants
-- .pick_group). movie_picks.pick_group is denormalised at submit time.

-- 0) pick_group on movie_picks, backfilled for legacy shared picks
ALTER TABLE public.movie_picks ADD COLUMN IF NOT EXISTS pick_group INT;

-- from admin-configured groups where they exist
UPDATE public.movie_picks p
SET pick_group = sp.pick_group
FROM public.season_participants sp
WHERE sp.season_id = p.season_id AND sp.user_id = p.user_id
  AND sp.pick_group IS NOT NULL AND p.pick_group IS NULL;

-- imported seasons: same film in the same watch slot = a shared pick.
-- Synthesised group numbers start at 1000 so they can't collide with admin ones.
UPDATE public.movie_picks p
SET pick_group = 1000 + p.watch_order
FROM (
  SELECT season_id, tmdb_id, watch_order
  FROM public.movie_picks
  WHERE tmdb_id IS NOT NULL AND watch_order IS NOT NULL
  GROUP BY season_id, tmdb_id, watch_order
  HAVING COUNT(*) > 1
) d
WHERE p.season_id = d.season_id AND p.tmdb_id = d.tmdb_id AND p.watch_order = d.watch_order
  AND p.pick_group IS NULL;

-- 1) Note on duplicates: if a season still contains the same film picked twice
--    by different units while unordered, step 2 fails with Postgres's own error,
--    which names the offending (season_id, tmdb_id). Find and fix them with:
--      SELECT season_id, tmdb_id, COUNT(*) FROM public.movie_picks
--      WHERE tmdb_id IS NOT NULL AND watch_order IS NULL AND pick_group IS NULL
--      GROUP BY 1, 2 HAVING COUNT(*) > 1;

-- 2) Hard guarantee for solo picks while unordered. Shared-pick rows are exempt
--    (they are by definition the same film several times); submit_pick() below
--    enforces "one film per unit" for them.
CREATE UNIQUE INDEX IF NOT EXISTS movie_picks_one_film_per_season
  ON public.movie_picks (season_id, tmdb_id)
  WHERE tmdb_id IS NOT NULL AND watch_order IS NULL AND pick_group IS NULL;

-- 3) Direct reads: own picks always; others' picks only once nothing about them
--    is secret (season over, guessing disabled, or the pick has been revealed).
--    Admins keep full access. Phase UI reads through get_season_picks() below.
DROP POLICY IF EXISTS "Members can view movie picks" ON public.movie_picks;
CREATE POLICY "Members can view movie picks" ON public.movie_picks
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = movie_picks.season_id
        AND (
          public.is_group_admin(auth.uid(), s.group_id)
          OR (
            public.is_group_member(auth.uid(), s.group_id)
            AND (
              s.status IN ('reviewing', 'completed')
              OR s.guessing_enabled = false
              OR movie_picks.revealed = true
            )
          )
        )
    )
  );

-- Helper: the caller's co-pick group in a season (NULL when solo)
CREATE OR REPLACE FUNCTION public.my_pick_group(_season_id UUID)
RETURNS INT AS $$
  SELECT sp.pick_group FROM public.season_participants sp
  WHERE sp.season_id = _season_id AND sp.user_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.my_pick_group(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_pick_group(UUID) TO authenticated;

-- 4) Masked season feed for the phase UI. Per row, the secret column is nulled:
--      picking            -> film hidden (title/tmdb_id/poster/year/overview), picker visible
--      guessing, watching -> picker hidden until revealed, film visible
--      reviewing/completed, guessing disabled, own pick / own group, admin -> everything
DROP FUNCTION IF EXISTS public.get_season_picks(UUID);
CREATE FUNCTION public.get_season_picks(_season_id UUID)
RETURNS TABLE (
  id UUID,
  season_id UUID,
  user_id UUID,
  tmdb_id INT,
  title TEXT,
  poster_url TEXT,
  year TEXT,
  overview TEXT,
  watch_order INT,
  revealed BOOLEAN,
  pick_group INT,
  created_at TIMESTAMPTZ
) AS $$
  SELECT
    p.id,
    p.season_id,
    CASE WHEN v.show_picker THEN p.user_id ELSE NULL END,
    CASE WHEN v.show_film   THEN p.tmdb_id ELSE NULL END,
    CASE WHEN v.show_film   THEN p.title ELSE 'Sealed pick' END,
    CASE WHEN v.show_film   THEN p.poster_url ELSE NULL END,
    CASE WHEN v.show_film   THEN p.year ELSE NULL END,
    CASE WHEN v.show_film   THEN p.overview ELSE NULL END,
    p.watch_order,
    p.revealed,
    p.pick_group,
    p.created_at
  FROM public.movie_picks p
  JOIN public.seasons s ON s.id = p.season_id
  CROSS JOIN LATERAL (
    SELECT (
      p.user_id = auth.uid()
      OR (p.pick_group IS NOT NULL AND p.pick_group = public.my_pick_group(_season_id))
      OR public.is_group_admin(auth.uid(), s.group_id)
      OR s.status IN ('reviewing', 'completed')
      OR s.guessing_enabled = false
    ) AS full_access
  ) f
  CROSS JOIN LATERAL (
    SELECT
      (f.full_access OR s.status <> 'picking')                       AS show_film,
      (f.full_access OR s.status = 'picking' OR p.revealed = true)   AS show_picker
  ) v
  WHERE p.season_id = _season_id
    AND public.is_group_member(auth.uid(), s.group_id)
  ORDER BY p.watch_order NULLS LAST, p.created_at;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.get_season_picks(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_season_picks(UUID) TO authenticated;

-- 5) Who has picked, and how many times — the guessing "answer bank". Reveals the
--    roster of pickers, never which film is whose.
CREATE OR REPLACE FUNCTION public.get_season_pick_counts(_season_id UUID)
RETURNS TABLE (user_id UUID, pick_count INT) AS $$
  SELECT p.user_id, COUNT(*)::INT
  FROM public.movie_picks p
  JOIN public.seasons s ON s.id = p.season_id
  WHERE p.season_id = _season_id
    AND public.is_group_member(auth.uid(), s.group_id)
  GROUP BY p.user_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.get_season_pick_counts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_season_pick_counts(UUID) TO authenticated;

-- 6) Duplicate check that works while films are secret: given candidate tmdb_ids,
--    return the subset another *unit* has already picked this season. Bounded to
--    the ids passed in, so it reveals nothing beyond what the caller searched for.
CREATE OR REPLACE FUNCTION public.check_taken_picks(_season_id UUID, _tmdb_ids INT[])
RETURNS INT[] AS $$
  SELECT COALESCE(array_agg(DISTINCT p.tmdb_id), '{}')
  FROM public.movie_picks p
  JOIN public.seasons s ON s.id = p.season_id
  WHERE p.season_id = _season_id
    AND p.tmdb_id = ANY (_tmdb_ids)
    AND p.user_id <> auth.uid()
    AND (p.pick_group IS NULL OR p.pick_group IS DISTINCT FROM public.my_pick_group(_season_id))
    AND public.is_group_member(auth.uid(), s.group_id);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.check_taken_picks(UUID, INT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_taken_picks(UUID, INT[]) TO authenticated;

-- 7) Submit (or change) a pick for the caller's whole unit. A shared pick writes a
--    row for every member of the co-pick group, so partners are credited and the
--    lineup shows them as done. Raises 23505 if another unit has the film.
CREATE OR REPLACE FUNCTION public.submit_pick(
  _season_id UUID, _tmdb_id INT, _title TEXT, _poster_url TEXT, _year TEXT, _overview TEXT
) RETURNS VOID AS $$
DECLARE
  _uid UUID := auth.uid();
  _gid UUID;
  _status TEXT;
  _grp INT;
  _targets UUID[];
BEGIN
  SELECT s.group_id, s.status INTO _gid, _status FROM public.seasons s WHERE s.id = _season_id;
  IF _gid IS NULL OR NOT public.is_group_member(_uid, _gid) THEN
    RAISE EXCEPTION 'Not a member of this club';
  END IF;
  IF _status <> 'picking' THEN
    RAISE EXCEPTION 'Picking is closed for this season';
  END IF;

  _grp := public.my_pick_group(_season_id);
  IF _grp IS NULL THEN
    _targets := ARRAY[_uid];
  ELSE
    SELECT array_agg(sp.user_id) INTO _targets
    FROM public.season_participants sp
    WHERE sp.season_id = _season_id AND sp.pick_group = _grp;
  END IF;

  IF _tmdb_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.movie_picks p
    WHERE p.season_id = _season_id AND p.tmdb_id = _tmdb_id
      AND NOT (p.user_id = ANY (_targets))
  ) THEN
    RAISE EXCEPTION 'Already picked by someone in the club' USING ERRCODE = '23505';
  END IF;

  -- No unique (season_id, user_id) constraint exists (multi-pick seasons rely on
  -- that), so update-or-insert explicitly. A member's in-progress pick is the
  -- one without a watch_order yet.
  UPDATE public.movie_picks p SET
    tmdb_id    = _tmdb_id,
    title      = _title,
    poster_url = _poster_url,
    year       = _year,
    overview   = _overview,
    pick_group = _grp
  WHERE p.season_id = _season_id
    AND p.user_id = ANY (_targets)
    AND p.watch_order IS NULL;

  INSERT INTO public.movie_picks (season_id, user_id, tmdb_id, title, poster_url, year, overview, pick_group)
  SELECT _season_id, u, _tmdb_id, _title, _poster_url, _year, _overview, _grp
  FROM unnest(_targets) AS u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.movie_picks p
    WHERE p.season_id = _season_id AND p.user_id = u AND p.watch_order IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.submit_pick(UUID, INT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_pick(UUID, INT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 8) Save the caller's guesses for a season (replaces any existing ones).
--    For a shared pick the guesser names N members for one film without knowing
--    which row belongs to whom, so guesses are aligned here: each correctly named
--    member is written against their own row; the rest fill the remaining rows.
--    Every existing per-row scorer (watch schedule, reveal, scoreboard, stats)
--    then stays correct without change.
CREATE OR REPLACE FUNCTION public.save_guesses(_season_id UUID, _guesses JSONB)
RETURNS VOID AS $$
DECLARE
  _uid UUID := auth.uid();
  _gid UUID;
  _my_grp INT;
  grp RECORD;
  row_ids UUID[];
  row_users UUID[];
  guessed UUID[];
  leftover_rows UUID[] := '{}';
  i INT;
BEGIN
  SELECT s.group_id INTO _gid FROM public.seasons s WHERE s.id = _season_id;
  IF _gid IS NULL OR NOT public.is_group_member(_uid, _gid) THEN
    RAISE EXCEPTION 'Not a member of this club';
  END IF;
  _my_grp := public.my_pick_group(_season_id);

  CREATE TEMP TABLE _sub ON COMMIT DROP AS
    SELECT (j->>'movie_pick_id')::UUID AS pick_id, (j->>'guessed_user_id')::UUID AS guessed
    FROM jsonb_array_elements(_guesses) j;

  IF EXISTS (
    SELECT 1 FROM _sub sb LEFT JOIN public.movie_picks p ON p.id = sb.pick_id
    WHERE p.id IS NULL OR p.season_id <> _season_id
  ) THEN
    RAISE EXCEPTION 'Invalid pick in guesses';
  END IF;

  DELETE FROM public.guesses WHERE season_id = _season_id AND guesser_id = _uid;

  -- solo picks: as submitted (never for the caller's own row)
  INSERT INTO public.guesses (season_id, guesser_id, movie_pick_id, guessed_user_id)
  SELECT _season_id, _uid, sb.pick_id, sb.guessed
  FROM _sub sb JOIN public.movie_picks p ON p.id = sb.pick_id
  WHERE p.pick_group IS NULL AND p.user_id <> _uid;

  -- shared picks: align guessed members to their own rows
  FOR grp IN
    SELECT DISTINCT p.pick_group FROM public.movie_picks p JOIN _sub sb ON sb.pick_id = p.id
    WHERE p.pick_group IS NOT NULL
      AND (_my_grp IS NULL OR p.pick_group <> _my_grp)
  LOOP
    SELECT array_agg(p.id ORDER BY p.id), array_agg(p.user_id ORDER BY p.id)
      INTO row_ids, row_users
    FROM public.movie_picks p
    WHERE p.season_id = _season_id AND p.pick_group = grp.pick_group;

    SELECT array_agg(sb.guessed) INTO guessed
    FROM _sub sb JOIN public.movie_picks p ON p.id = sb.pick_id
    WHERE p.pick_group = grp.pick_group;

    leftover_rows := '{}';
    FOR i IN 1 .. array_length(row_ids, 1) LOOP
      IF row_users[i] = ANY (guessed) THEN
        INSERT INTO public.guesses (season_id, guesser_id, movie_pick_id, guessed_user_id)
        VALUES (_season_id, _uid, row_ids[i], row_users[i]);
        guessed := array_remove(guessed, row_users[i]);
      ELSE
        leftover_rows := leftover_rows || row_ids[i];
      END IF;
    END LOOP;

    FOR i IN 1 .. COALESCE(array_length(leftover_rows, 1), 0) LOOP
      EXIT WHEN i > COALESCE(array_length(guessed, 1), 0);
      INSERT INTO public.guesses (season_id, guesser_id, movie_pick_id, guessed_user_id)
      VALUES (_season_id, _uid, leftover_rows[i], guessed[i]);
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.save_guesses(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_guesses(UUID, JSONB) TO authenticated;
