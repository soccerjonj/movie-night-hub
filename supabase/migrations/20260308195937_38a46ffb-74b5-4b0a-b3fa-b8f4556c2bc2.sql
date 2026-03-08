
-- Add season configuration columns
ALTER TABLE public.seasons ADD COLUMN movies_per_member integer NOT NULL DEFAULT 1;
ALTER TABLE public.seasons ADD COLUMN watch_interval_days integer NOT NULL DEFAULT 7;
ALTER TABLE public.seasons ADD COLUMN guessing_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.seasons ADD COLUMN watch_start_date timestamp with time zone;

-- Create season participants table (who picks, and co-pick grouping)
CREATE TABLE public.season_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  pick_group integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(season_id, user_id)
);

ALTER TABLE public.season_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view season participants"
ON public.season_participants FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.seasons s WHERE s.id = season_participants.season_id
  AND is_group_member(auth.uid(), s.group_id)
));

CREATE POLICY "Admin can insert season participants"
ON public.season_participants FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.seasons s WHERE s.id = season_participants.season_id
  AND is_group_admin(auth.uid(), s.group_id)
));

CREATE POLICY "Admin can delete season participants"
ON public.season_participants FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.seasons s WHERE s.id = season_participants.season_id
  AND is_group_admin(auth.uid(), s.group_id)
));

CREATE POLICY "Admin can update season participants"
ON public.season_participants FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.seasons s WHERE s.id = season_participants.season_id
  AND is_group_admin(auth.uid(), s.group_id)
));
