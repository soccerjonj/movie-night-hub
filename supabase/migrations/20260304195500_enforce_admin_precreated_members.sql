-- Enforce invite-only membership: users must claim an admin-created placeholder.
DROP POLICY IF EXISTS "Users can join groups" ON public.group_members;
