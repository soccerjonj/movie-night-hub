-- Secret picks + one film per season
--
-- Before this, any group member could SELECT every column of every pick in a
-- season, so "secret until reveal" was only enforced by the UI. This moves it
-- into the database, and adds a hard guarantee that two members can't pick the
-- same film in one season.

-- 1) Diagnostic: refuse to proceed if a season already contains duplicate films.
--    Each offender is printed as a NOTICE so it can be resolved, then re-run.
DO $$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    SELECT season_id, tmdb_id, COUNT(*) AS c, string_agg(title, ' / ') AS titles
    FROM public.movie_picks
    WHERE tmdb_id IS NOT NULL
    GROUP BY season_id, tmdb_id
    HAVING COUNT(*) > 1
  LOOP
    n := n + 1;
    RAISE NOTICE 'Duplicate film: season % tmdb_id % (% rows): %', r.season_id, r.tmdb_id, r.c, r.titles;
  END LOOP;
  IF n > 0 THEN
    RAISE EXCEPTION '% duplicate film(s) found within a season - resolve them (see NOTICEs) before adding the unique index', n;
  END IF;
END $$;

-- 2) One film per season. Partial so legacy picks without a tmdb_id are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS movie_picks_one_film_per_season
  ON public.movie_picks (season_id, tmdb_id)
  WHERE tmdb_id IS NOT NULL;

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

-- 4) Masked season feed for the phase UI. Per row, the secret column is nulled:
--      picking            -> film hidden (title/tmdb_id/poster/year/overview), picker visible
--      guessing, watching -> picker hidden until revealed, film visible
--      reviewing/completed, guessing disabled, own pick, admin -> everything visible
CREATE OR REPLACE FUNCTION public.get_season_picks(_season_id UUID)
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
    p.created_at
  FROM public.movie_picks p
  JOIN public.seasons s ON s.id = p.season_id
  CROSS JOIN LATERAL (
    SELECT (
      p.user_id = auth.uid()
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

-- 5) Duplicate check that works while films are secret: given candidate tmdb_ids,
--    return the subset another member has already picked this season. Bounded to
--    the ids passed in, so it reveals nothing beyond what the caller searched for.
CREATE OR REPLACE FUNCTION public.check_taken_picks(_season_id UUID, _tmdb_ids INT[])
RETURNS INT[] AS $$
  SELECT COALESCE(array_agg(DISTINCT p.tmdb_id), '{}')
  FROM public.movie_picks p
  JOIN public.seasons s ON s.id = p.season_id
  WHERE p.season_id = _season_id
    AND p.tmdb_id = ANY (_tmdb_ids)
    AND p.user_id <> auth.uid()
    AND public.is_group_member(auth.uid(), s.group_id);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.check_taken_picks(UUID, INT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_taken_picks(UUID, INT[]) TO authenticated;
