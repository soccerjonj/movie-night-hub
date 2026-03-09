
-- Fix placeholder profile RLS: require the inserter to be a group admin
-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Admins can insert placeholder profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update placeholder profiles" ON public.profiles;

-- New insert policy: only group admins can insert placeholder profiles
-- We check that the authenticated user is an admin of at least one group
CREATE POLICY "Admins can insert placeholder profiles"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  is_placeholder = true
  AND EXISTS (
    SELECT 1 FROM public.groups WHERE admin_user_id = auth.uid()
  )
);

-- New update policy: only group admins can update placeholder profiles  
CREATE POLICY "Admins can update placeholder profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  is_placeholder = true
  AND EXISTS (
    SELECT 1 FROM public.groups WHERE admin_user_id = auth.uid()
  )
);
