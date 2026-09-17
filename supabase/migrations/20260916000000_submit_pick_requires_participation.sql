-- submit_pick: when a season has a participant roster (season_participants rows),
-- only members on it may pick. Seasons without rows (legacy) are open to all members.
-- Lets the admin sit a member out of one season without removing them from the club.
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
  IF EXISTS (SELECT 1 FROM public.season_participants sp WHERE sp.season_id = _season_id)
     AND NOT EXISTS (SELECT 1 FROM public.season_participants sp WHERE sp.season_id = _season_id AND sp.user_id = _uid) THEN
    RAISE EXCEPTION 'You are not taking part in this season';
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

-- save_guesses: same roster rule for guessing.
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
  IF EXISTS (SELECT 1 FROM public.season_participants sp WHERE sp.season_id = _season_id)
     AND NOT EXISTS (SELECT 1 FROM public.season_participants sp WHERE sp.season_id = _season_id AND sp.user_id = _uid) THEN
    RAISE EXCEPTION 'You are not taking part in this season';
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

  INSERT INTO public.guesses (season_id, guesser_id, movie_pick_id, guessed_user_id)
  SELECT _season_id, _uid, sb.pick_id, sb.guessed
  FROM _sub sb JOIN public.movie_picks p ON p.id = sb.pick_id
  WHERE p.pick_group IS NULL AND p.user_id <> _uid;

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
