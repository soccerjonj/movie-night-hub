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
DECLARE
  _placeholder_name text;
  _placeholder_avatar text;
BEGIN
  -- Verify placeholder exists and is in the group
  SELECT p.display_name, p.avatar_url
  INTO _placeholder_name, _placeholder_avatar
  FROM profiles p
  JOIN group_members gm ON gm.user_id = p.user_id AND gm.group_id = _group_id
  WHERE p.user_id = _placeholder_user_id
    AND p.is_placeholder = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Placeholder not found in this group';
  END IF;

  -- Verify real user is not already in the group
  IF EXISTS (
    SELECT 1 FROM group_members WHERE user_id = _real_user_id AND group_id = _group_id
  ) THEN
    RAISE EXCEPTION 'You are already a member of this group';
  END IF;

  -- Ensure real user profile exists, then apply placeholder identity details.
  INSERT INTO profiles (user_id, display_name, avatar_url, is_placeholder)
  VALUES (_real_user_id, COALESCE(_placeholder_name, 'Member'), _placeholder_avatar, false)
  ON CONFLICT (user_id)
  DO UPDATE SET
    display_name = EXCLUDED.display_name,
    avatar_url = EXCLUDED.avatar_url,
    is_placeholder = false;

  -- Move references from placeholder to real user.
  UPDATE movie_picks
  SET user_id = _real_user_id
  WHERE user_id = _placeholder_user_id;

  UPDATE guesses
  SET guesser_id = _real_user_id
  WHERE guesser_id = _placeholder_user_id;

  UPDATE guesses
  SET guessed_user_id = _real_user_id
  WHERE guessed_user_id = _placeholder_user_id;

  UPDATE group_members
  SET user_id = _real_user_id
  WHERE user_id = _placeholder_user_id
    AND group_id = _group_id;

  -- Placeholder identity is fully claimed.
  DELETE FROM profiles WHERE user_id = _placeholder_user_id;
END;
$$;
