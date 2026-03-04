
-- Allow admin to insert movie picks for any user in their group (needed for importing past seasons)
CREATE POLICY "Admin can insert picks for group"
ON public.movie_picks
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM seasons s
    WHERE s.id = movie_picks.season_id
    AND is_group_admin(auth.uid(), s.group_id)
  )
);

-- Allow admin to add members to their group (for placeholder members)
CREATE POLICY "Admin can add members to group"
ON public.group_members
FOR INSERT
TO authenticated
WITH CHECK (is_group_admin(auth.uid(), group_id));
