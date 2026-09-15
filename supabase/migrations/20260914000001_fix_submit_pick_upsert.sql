-- Fix: submit_pick relied on ON CONFLICT (season_id, user_id), but that unique
-- constraint was dropped in 20260304205814 (multi-pick seasons). Every pick failed.

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
