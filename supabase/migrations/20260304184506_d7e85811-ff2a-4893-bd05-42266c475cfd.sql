
CREATE OR REPLACE FUNCTION public.claim_placeholder(
  _placeholder_user_id uuid,
  _real_user_id uuid,
  _group_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify placeholder exists and is in the group
  IF NOT EXISTS (
    SELECT 1 FROM profiles p
    JOIN group_members gm ON gm.user_id = p.user_id AND gm.group_id = _group_id
    WHERE p.user_id = _placeholder_user_id AND p.is_placeholder = true
  ) THEN
    RAISE EXCEPTION 'Placeholder not found in this group';
  END IF;

  -- Verify real user is not already in the group
  IF EXISTS (
    SELECT 1 FROM group_members WHERE user_id = _real_user_id AND group_id = _group_id
  ) THEN
    RAISE EXCEPTION 'You are already a member of this group';
  END IF;

  -- Delete the auto-created profile for the real user
  DELETE FROM profiles WHERE user_id = _real_user_id;

  -- Update all movie_picks referencing the placeholder
  UPDATE movie_picks SET user_id = _real_user_id WHERE user_id = _placeholder_user_id;

  -- Update all guesses referencing the placeholder
  UPDATE guesses SET guesser_id = _real_user_id WHERE guesser_id = _placeholder_user_id;
  UPDATE guesses SET guessed_user_id = _real_user_id WHERE guessed_user_id = _placeholder_user_id;

  -- Update group_members
  UPDATE group_members SET user_id = _real_user_id WHERE user_id = _placeholder_user_id AND group_id = _group_id;

  -- Update the placeholder profile to become the real user's profile
  UPDATE profiles SET user_id = _real_user_id, is_placeholder = false WHERE user_id = _placeholder_user_id;
END;
$$;
