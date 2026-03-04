
-- Allow finding a group by join code (for joining)
CREATE OR REPLACE FUNCTION public.find_group_by_code(_code TEXT)
RETURNS TABLE(id UUID) AS $$
  SELECT id FROM public.groups WHERE join_code = _code LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
