-- ============================================================
-- Movie Club Hub – Full Schema
-- Run this in your Supabase SQL Editor (new project)
-- ============================================================

-- ─── Enums ───────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE public.club_type AS ENUM ('movie', 'book'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.meeting_type AS ENUM ('remote', 'in_person'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.season_status AS ENUM ('picking', 'guessing', 'watching', 'reviewing', 'completed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Utility trigger function ────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ─── Profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL UNIQUE,
  display_name   TEXT NOT NULL,
  avatar_url     TEXT,
  is_placeholder BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles viewable by authenticated users" ON public.profiles;
CREATE POLICY "Profiles viewable by authenticated users" ON public.profiles
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── Groups ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.groups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  join_code        TEXT NOT NULL UNIQUE DEFAULT substr(md5(random()::text), 1, 8),
  admin_user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  club_type        public.club_type NOT NULL DEFAULT 'movie',
  meeting_type     public.meeting_type NOT NULL DEFAULT 'remote',
  meeting_location TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

-- ─── Group Members ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.group_members (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id  UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- ─── Helper functions ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_group_member(_user_id UUID, _group_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE user_id = _user_id AND group_id = _group_id
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_group_admin(_user_id UUID, _group_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.groups
    WHERE id = _group_id AND admin_user_id = _user_id
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.find_group_by_code(_code TEXT)
RETURNS TABLE(id UUID) AS $$
  SELECT id FROM public.groups WHERE join_code = _code LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Group policies
DROP POLICY IF EXISTS "Members can view their groups" ON public.groups;
CREATE POLICY "Members can view their groups" ON public.groups
  FOR SELECT TO authenticated
  USING (public.is_group_member(auth.uid(), id) OR admin_user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can create groups" ON public.groups;
CREATE POLICY "Authenticated users can create groups" ON public.groups
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = admin_user_id);

DROP POLICY IF EXISTS "Admin can update group" ON public.groups;
CREATE POLICY "Admin can update group" ON public.groups
  FOR UPDATE TO authenticated USING (auth.uid() = admin_user_id);

-- Group members policies
DROP POLICY IF EXISTS "Members can view group members" ON public.group_members;
CREATE POLICY "Members can view group members" ON public.group_members
  FOR SELECT TO authenticated
  USING (public.is_group_member(auth.uid(), group_id));

DROP POLICY IF EXISTS "Users can join groups" ON public.group_members;
CREATE POLICY "Users can join groups" ON public.group_members
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admin can remove members" ON public.group_members;
CREATE POLICY "Admin can remove members" ON public.group_members
  FOR DELETE TO authenticated
  USING (public.is_group_admin(auth.uid(), group_id));

-- ─── Seasons ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seasons (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id            UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  season_number       INT NOT NULL,
  title               TEXT,
  status              public.season_status NOT NULL DEFAULT 'picking',
  current_movie_index INT NOT NULL DEFAULT 0,
  movies_per_member   INT NOT NULL DEFAULT 1,
  watch_interval_days INT NOT NULL DEFAULT 7,
  watch_start_date    TIMESTAMPTZ,
  next_call_date      TIMESTAMPTZ,
  call_link           TEXT,
  guessing_enabled    BOOLEAN NOT NULL DEFAULT true,
  constraints_visible BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, season_number)
);

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view seasons" ON public.seasons;
CREATE POLICY "Members can view seasons" ON public.seasons
  FOR SELECT TO authenticated
  USING (public.is_group_member(auth.uid(), group_id));

DROP POLICY IF EXISTS "Admin can create seasons" ON public.seasons;
CREATE POLICY "Admin can create seasons" ON public.seasons
  FOR INSERT TO authenticated
  WITH CHECK (public.is_group_admin(auth.uid(), group_id));

DROP POLICY IF EXISTS "Admin can update seasons" ON public.seasons;
CREATE POLICY "Admin can update seasons" ON public.seasons
  FOR UPDATE TO authenticated
  USING (public.is_group_admin(auth.uid(), group_id));

DROP TRIGGER IF EXISTS update_seasons_updated_at ON public.seasons;
CREATE TRIGGER update_seasons_updated_at
  BEFORE UPDATE ON public.seasons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── Season Participants ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.season_participants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id       UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pick_constraint TEXT,
  pick_group      INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(season_id, user_id)
);

ALTER TABLE public.season_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view season participants" ON public.season_participants;
CREATE POLICY "Members can view season participants" ON public.season_participants
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_member(auth.uid(), s.group_id)
    )
  );

DROP POLICY IF EXISTS "Admin can manage season participants" ON public.season_participants;
CREATE POLICY "Admin can manage season participants" ON public.season_participants
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );

-- ─── Movie Picks ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.movie_picks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tmdb_id     INT,
  title       TEXT NOT NULL,
  poster_url  TEXT,
  year        TEXT,
  overview    TEXT,
  watch_order INT,
  revealed    BOOLEAN NOT NULL DEFAULT false,
  pick_group  INT,               -- co-pick group (shared pick), see season_participants.pick_group
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(season_id, user_id)
);

ALTER TABLE public.movie_picks ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS "Members can insert own picks" ON public.movie_picks;
CREATE POLICY "Members can insert own picks" ON public.movie_picks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admin can update picks" ON public.movie_picks;
CREATE POLICY "Admin can update picks" ON public.movie_picks
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );

-- ─── Guesses ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guesses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id       UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  guesser_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  movie_pick_id   UUID NOT NULL REFERENCES public.movie_picks(id) ON DELETE CASCADE,
  guessed_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(season_id, guesser_id, movie_pick_id)
);

ALTER TABLE public.guesses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view guesses after guessing ends" ON public.guesses;
CREATE POLICY "Members can view guesses after guessing ends" ON public.guesses
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id
        AND public.is_group_member(auth.uid(), s.group_id)
        AND s.status IN ('watching', 'reviewing', 'completed')
    )
    OR guesser_id = auth.uid()
  );

DROP POLICY IF EXISTS "Members can insert own guesses" ON public.guesses;
CREATE POLICY "Members can insert own guesses" ON public.guesses
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = guesser_id);

DROP POLICY IF EXISTS "Members can update own guesses" ON public.guesses;
CREATE POLICY "Members can update own guesses" ON public.guesses
  FOR UPDATE TO authenticated USING (auth.uid() = guesser_id);

DROP POLICY IF EXISTS "Members can delete own guesses" ON public.guesses;
CREATE POLICY "Members can delete own guesses" ON public.guesses
  FOR DELETE TO authenticated USING (auth.uid() = guesser_id);

-- ─── Guess Edits ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guess_edits (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.guess_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view guess edits" ON public.guess_edits;
CREATE POLICY "Members can view guess edits" ON public.guess_edits
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_member(auth.uid(), s.group_id)
    )
  );

DROP POLICY IF EXISTS "Users can insert own guess edits" ON public.guess_edits;
CREATE POLICY "Users can insert own guess edits" ON public.guess_edits
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- ─── Movie Rankings ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.movie_rankings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  movie_pick_id UUID NOT NULL REFERENCES public.movie_picks(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank          INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(season_id, user_id, movie_pick_id)
);

ALTER TABLE public.movie_rankings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view movie rankings" ON public.movie_rankings;
CREATE POLICY "Members can view movie rankings" ON public.movie_rankings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_member(auth.uid(), s.group_id)
    )
  );

DROP POLICY IF EXISTS "Members can manage own rankings" ON public.movie_rankings;
CREATE POLICY "Members can manage own rankings" ON public.movie_rankings
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- ─── Club Meetings ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.club_meetings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  meeting_index INT NOT NULL,
  meeting_at    TIMESTAMPTZ NOT NULL,
  location_text TEXT,
  location_lat  FLOAT,
  location_lon  FLOAT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.club_meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view club meetings" ON public.club_meetings;
CREATE POLICY "Members can view club meetings" ON public.club_meetings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_member(auth.uid(), s.group_id)
    )
  );

DROP POLICY IF EXISTS "Admin can manage club meetings" ON public.club_meetings;
CREATE POLICY "Admin can manage club meetings" ON public.club_meetings
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );

-- ─── Meeting Settings ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meeting_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id      UUID NOT NULL UNIQUE REFERENCES public.seasons(id) ON DELETE CASCADE,
  interval_value INT NOT NULL,
  interval_unit  TEXT NOT NULL,
  same_location  BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.meeting_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view meeting settings" ON public.meeting_settings;
CREATE POLICY "Members can view meeting settings" ON public.meeting_settings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_member(auth.uid(), s.group_id)
    )
  );

DROP POLICY IF EXISTS "Admin can manage meeting settings" ON public.meeting_settings;
CREATE POLICY "Admin can manage meeting settings" ON public.meeting_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );

-- ─── Reading Assignments ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reading_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  order_index   INT NOT NULL DEFAULT 0,
  title         TEXT,
  start_page    INT,
  end_page      INT,
  chapter_range TEXT,
  due_date      TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.reading_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view reading assignments" ON public.reading_assignments;
CREATE POLICY "Members can view reading assignments" ON public.reading_assignments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_member(auth.uid(), s.group_id)
    )
  );

DROP POLICY IF EXISTS "Admin can manage reading assignments" ON public.reading_assignments;
CREATE POLICY "Admin can manage reading assignments" ON public.reading_assignments
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );

-- ─── Additional functions ────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_season_guess_submitters(UUID);
DROP FUNCTION IF EXISTS public.list_available_placeholders(UUID);
DROP FUNCTION IF EXISTS public.claim_placeholder(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.get_season_guess_submitters(_season_id UUID)
RETURNS TABLE(guesser_id UUID) AS $$
  SELECT DISTINCT guesser_id FROM public.guesses WHERE season_id = _season_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.list_available_placeholders(_group_id UUID)
RETURNS TABLE(display_name TEXT, user_id UUID) AS $$
  SELECT p.display_name, p.user_id
  FROM public.profiles p
  JOIN public.group_members gm ON gm.user_id = p.user_id
  WHERE gm.group_id = _group_id AND p.is_placeholder = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.claim_placeholder(
  _group_id UUID,
  _placeholder_user_id UUID,
  _real_user_id UUID
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.group_members
    SET user_id = _real_user_id
    WHERE group_id = _group_id AND user_id = _placeholder_user_id;
  UPDATE public.movie_picks SET user_id = _real_user_id WHERE user_id = _placeholder_user_id;
  UPDATE public.guesses SET guesser_id = _real_user_id WHERE guesser_id = _placeholder_user_id;
  UPDATE public.guesses SET guessed_user_id = _real_user_id WHERE guessed_user_id = _placeholder_user_id;
  DELETE FROM public.profiles WHERE user_id = _placeholder_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- Secret picks, shared picks, one film per season (20260914)
-- ---------------------------------------------------------------------------
-- 2) Hard guarantee for solo picks while unordered. Shared-pick rows are exempt
--    (they are by definition the same film several times); submit_pick() below
--    enforces "one film per unit" for them.
CREATE UNIQUE INDEX IF NOT EXISTS movie_picks_one_film_per_season
  ON public.movie_picks (season_id, tmdb_id)
  WHERE tmdb_id IS NOT NULL AND watch_order IS NULL AND pick_group IS NULL;

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

  INSERT INTO public.movie_picks (season_id, user_id, tmdb_id, title, poster_url, year, overview, pick_group)
  SELECT _season_id, u, _tmdb_id, _title, _poster_url, _year, _overview, _grp
  FROM unnest(_targets) AS u
  ON CONFLICT (season_id, user_id) DO UPDATE SET
    tmdb_id    = EXCLUDED.tmdb_id,
    title      = EXCLUDED.title,
    poster_url = EXCLUDED.poster_url,
    year       = EXCLUDED.year,
    overview   = EXCLUDED.overview,
    pick_group = EXCLUDED.pick_group;
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
