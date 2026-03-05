-- Let authenticated non-members fetch claimable names for a known group.
CREATE OR REPLACE FUNCTION public.list_available_placeholders(_group_id uuid)
RETURNS TABLE(user_id uuid, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.display_name
  FROM public.group_members gm
  JOIN public.profiles p ON p.user_id = gm.user_id
  WHERE gm.group_id = _group_id
    AND p.is_placeholder = true
  ORDER BY p.display_name;
$$;
