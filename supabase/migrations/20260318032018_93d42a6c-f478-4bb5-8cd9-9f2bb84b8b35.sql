
-- Create club type enum
CREATE TYPE public.club_type AS ENUM ('movie', 'book');

-- Add club_type column to groups table with default 'movie' for existing groups
ALTER TABLE public.groups ADD COLUMN club_type public.club_type NOT NULL DEFAULT 'movie';
