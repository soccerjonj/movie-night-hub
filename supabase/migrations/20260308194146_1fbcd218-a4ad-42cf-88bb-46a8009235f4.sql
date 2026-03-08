
-- Allow members to update their own picks
CREATE POLICY "Members can update own picks"
ON public.movie_picks
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- Allow members to delete their own picks
CREATE POLICY "Members can delete own picks"
ON public.movie_picks
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
