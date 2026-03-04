-- Allow group admins to import historical picks for members.
DROP POLICY IF EXISTS "Members can insert own picks" ON public.movie_picks;

CREATE POLICY "Members or admin can insert picks" ON public.movie_picks
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id
      AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );
