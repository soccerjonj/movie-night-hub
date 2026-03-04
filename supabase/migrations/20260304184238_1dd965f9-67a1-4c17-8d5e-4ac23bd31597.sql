
-- Add is_placeholder flag to profiles
ALTER TABLE public.profiles ADD COLUMN is_placeholder boolean NOT NULL DEFAULT false;

-- Allow group admins to insert placeholder profiles (no real user_id)
CREATE POLICY "Admins can insert placeholder profiles"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (is_placeholder = true);

-- Allow admins to update placeholder profiles (for linking later)
CREATE POLICY "Admins can update placeholder profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (is_placeholder = true);
