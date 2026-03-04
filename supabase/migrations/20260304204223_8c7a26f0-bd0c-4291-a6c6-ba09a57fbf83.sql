
-- Allow admins to delete seasons
CREATE POLICY "Admin can delete seasons"
ON public.seasons FOR DELETE TO authenticated
USING (is_group_admin(auth.uid(), group_id));

-- Allow admins to delete movie picks for their group's seasons
CREATE POLICY "Admin can delete picks"
ON public.movie_picks FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM seasons s
  WHERE s.id = movie_picks.season_id AND is_group_admin(auth.uid(), s.group_id)
));

-- Allow admins to delete guesses for their group's seasons
CREATE POLICY "Admin can delete guesses"
ON public.guesses FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM seasons s
  WHERE s.id = guesses.season_id AND is_group_admin(auth.uid(), s.group_id)
));
