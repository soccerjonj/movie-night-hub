
-- Create timestamp update function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles viewable by authenticated users" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Groups table
CREATE TABLE public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  join_code TEXT NOT NULL UNIQUE DEFAULT substr(md5(random()::text), 1, 8),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

-- Group members table
CREATE TABLE public.group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- Helper function to check group membership
CREATE OR REPLACE FUNCTION public.is_group_member(_user_id UUID, _group_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE user_id = _user_id AND group_id = _group_id
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Helper function to check if user is group admin
CREATE OR REPLACE FUNCTION public.is_group_admin(_user_id UUID, _group_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.groups
    WHERE id = _group_id AND admin_user_id = _user_id
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Group policies
CREATE POLICY "Members can view their groups" ON public.groups
  FOR SELECT TO authenticated
  USING (public.is_group_member(auth.uid(), id) OR admin_user_id = auth.uid());
CREATE POLICY "Authenticated users can create groups" ON public.groups
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = admin_user_id);
CREATE POLICY "Admin can update group" ON public.groups
  FOR UPDATE TO authenticated USING (auth.uid() = admin_user_id);

-- Group members policies
CREATE POLICY "Members can view group members" ON public.group_members
  FOR SELECT TO authenticated
  USING (public.is_group_member(auth.uid(), group_id));
CREATE POLICY "Users can join groups" ON public.group_members
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admin can remove members" ON public.group_members
  FOR DELETE TO authenticated
  USING (public.is_group_admin(auth.uid(), group_id));

-- Seasons table
CREATE TYPE public.season_status AS ENUM ('picking', 'guessing', 'watching', 'completed');

CREATE TABLE public.seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  season_number INT NOT NULL,
  status public.season_status NOT NULL DEFAULT 'picking',
  current_movie_index INT NOT NULL DEFAULT 0,
  next_call_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, season_number)
);

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view seasons" ON public.seasons
  FOR SELECT TO authenticated
  USING (public.is_group_member(auth.uid(), group_id));
CREATE POLICY "Admin can create seasons" ON public.seasons
  FOR INSERT TO authenticated
  WITH CHECK (public.is_group_admin(auth.uid(), group_id));
CREATE POLICY "Admin can update seasons" ON public.seasons
  FOR UPDATE TO authenticated
  USING (public.is_group_admin(auth.uid(), group_id));

CREATE TRIGGER update_seasons_updated_at BEFORE UPDATE ON public.seasons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Movie picks
CREATE TABLE public.movie_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tmdb_id INT,
  title TEXT NOT NULL,
  poster_url TEXT,
  year TEXT,
  overview TEXT,
  watch_order INT,
  revealed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(season_id, user_id)
);

ALTER TABLE public.movie_picks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view movie picks" ON public.movie_picks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_member(auth.uid(), s.group_id)
    )
  );
CREATE POLICY "Members can insert own picks" ON public.movie_picks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admin can update picks" ON public.movie_picks
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );

-- Guesses
CREATE TABLE public.guesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  guesser_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  movie_pick_id UUID NOT NULL REFERENCES public.movie_picks(id) ON DELETE CASCADE,
  guessed_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(season_id, guesser_id, movie_pick_id)
);

ALTER TABLE public.guesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view guesses after guessing ends" ON public.guesses
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id
      AND public.is_group_member(auth.uid(), s.group_id)
      AND s.status IN ('watching', 'completed')
    )
    OR guesser_id = auth.uid()
  );
CREATE POLICY "Members can insert own guesses" ON public.guesses
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = guesser_id);
