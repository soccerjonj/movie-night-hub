
-- Drop the foreign key on movie_picks.user_id referencing auth.users
ALTER TABLE public.movie_picks DROP CONSTRAINT IF EXISTS movie_picks_user_id_fkey;

-- Also drop on guesses tables
ALTER TABLE public.guesses DROP CONSTRAINT IF EXISTS guesses_guesser_id_fkey;
ALTER TABLE public.guesses DROP CONSTRAINT IF EXISTS guesses_guessed_user_id_fkey;

-- Clean up the orphaned season created by the failed import attempt
DELETE FROM public.seasons WHERE id = 'd65b9010-089e-4ea1-bfa5-1d9036ac6539';
