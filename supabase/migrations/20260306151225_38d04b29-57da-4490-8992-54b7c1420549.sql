
-- Create movie_rankings table
CREATE TABLE public.movie_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  movie_pick_id uuid NOT NULL REFERENCES public.movie_picks(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, user_id, movie_pick_id),
  UNIQUE (season_id, user_id, rank)
);

ALTER TABLE public.movie_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can insert own rankings"
ON public.movie_rankings FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Members can update own rankings"
ON public.movie_rankings FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Members can view rankings when season reviewing or completed"
ON public.movie_rankings FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM seasons s
    WHERE s.id = movie_rankings.season_id
    AND is_group_member(auth.uid(), s.group_id)
    AND s.status IN ('reviewing'::season_status, 'completed'::season_status)
  )
);

CREATE POLICY "Admin can delete rankings"
ON public.movie_rankings FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM seasons s
    WHERE s.id = movie_rankings.season_id
    AND is_group_admin(auth.uid(), s.group_id)
  )
);
