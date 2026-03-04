
-- Drop restrictive INSERT policies on profiles and recreate as permissive
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert placeholder profiles" ON public.profiles;

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can insert placeholder profiles"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (is_placeholder = true);
