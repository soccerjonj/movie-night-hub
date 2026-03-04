CREATE POLICY "Admin can insert guesses for group members"
ON public.guesses
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM seasons s
    WHERE s.id = guesses.season_id
    AND is_group_admin(auth.uid(), s.group_id)
  )
);