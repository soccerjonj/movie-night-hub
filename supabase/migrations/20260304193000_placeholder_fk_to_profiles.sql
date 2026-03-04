-- Allow placeholder user IDs (not present in auth.users) to participate in membership and picks.
-- Real and placeholder identities both live in public.profiles.user_id.

ALTER TABLE public.group_members DROP CONSTRAINT IF EXISTS group_members_user_id_fkey;
ALTER TABLE public.movie_picks DROP CONSTRAINT IF EXISTS movie_picks_user_id_fkey;
ALTER TABLE public.guesses DROP CONSTRAINT IF EXISTS guesses_guesser_id_fkey;
ALTER TABLE public.guesses DROP CONSTRAINT IF EXISTS guesses_guessed_user_id_fkey;

ALTER TABLE public.group_members
  ADD CONSTRAINT group_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

ALTER TABLE public.movie_picks
  ADD CONSTRAINT movie_picks_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

ALTER TABLE public.guesses
  ADD CONSTRAINT guesses_guesser_id_fkey
  FOREIGN KEY (guesser_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

ALTER TABLE public.guesses
  ADD CONSTRAINT guesses_guessed_user_id_fkey
  FOREIGN KEY (guessed_user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;
