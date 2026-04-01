-- Security fixes for policies and storage access

-- 1) Admin update guesses policy should only apply to authenticated users
DROP POLICY IF EXISTS "Admin can update guesses" ON public.guesses;
CREATE POLICY "Admin can update guesses" ON public.guesses
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM seasons s
      WHERE s.id = guesses.season_id
      AND is_group_admin(auth.uid(), s.group_id)
    )
  );

-- 2) Require group membership when members insert their own movie picks
DROP POLICY IF EXISTS "Members or admin can insert picks" ON public.movie_picks;
CREATE POLICY "Members or admin can insert picks" ON public.movie_picks
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1 FROM public.seasons s
        WHERE s.id = season_id
        AND public.is_group_member(auth.uid(), s.group_id)
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id
      AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );

-- 3) Ensure non-admins cannot insert group members directly
DROP POLICY IF EXISTS "Users can join groups" ON public.group_members;
DROP POLICY IF EXISTS "Admin can add members to group" ON public.group_members;
CREATE POLICY "Admin can add members to group"
  ON public.group_members
  FOR INSERT TO authenticated
  WITH CHECK (is_group_admin(auth.uid(), group_id));

-- 4) Make avatars bucket private and require auth for reads
UPDATE storage.buckets SET public = false WHERE id = 'avatars';
DROP POLICY IF EXISTS "Public avatar read access" ON storage.objects;
CREATE POLICY "Authenticated avatar read access"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'avatars');
