CREATE OR REPLACE FUNCTION public.get_season_guess_submitters(_season_id uuid)
RETURNS TABLE(guesser_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT g.guesser_id
  FROM guesses g
  JOIN seasons s ON s.id = g.season_id
  WHERE g.season_id = _season_id
    AND is_group_member(auth.uid(), s.group_id);
$$;