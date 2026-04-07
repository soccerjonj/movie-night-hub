-- Drop the old permissive SELECT policy
DROP POLICY "Members can view guesses after guessing ends" ON public.guesses;

-- New policy: own guesses always visible; others' guesses only for watched movies or completed/reviewing seasons
CREATE POLICY "Members can view guesses for watched movies"
ON public.guesses
FOR SELECT
TO authenticated
USING (
  (guesser_id = auth.uid())
  OR
  (EXISTS (
    SELECT 1
    FROM seasons s
    JOIN movie_picks mp ON mp.id = guesses.movie_pick_id
    WHERE s.id = guesses.season_id
      AND is_group_member(auth.uid(), s.group_id)
      AND (
        s.status IN ('completed', 'reviewing')
        OR (
          s.status = 'watching'
          AND mp.watch_order IS NOT NULL
          AND mp.watch_order < s.current_movie_index
        )
      )
  ))
);