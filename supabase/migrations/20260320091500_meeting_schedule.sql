-- Meeting schedule settings and instances
CREATE TABLE public.meeting_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  interval_value INT NOT NULL,
  interval_unit TEXT NOT NULL CHECK (interval_unit IN ('days', 'weeks', 'months')),
  same_location BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (season_id)
);

CREATE TABLE public.club_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  meeting_index INT NOT NULL,
  meeting_at TIMESTAMPTZ NOT NULL,
  location_text TEXT,
  location_lat NUMERIC,
  location_lon NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (season_id, meeting_index)
);

CREATE INDEX club_meetings_season_index_idx
  ON public.club_meetings (season_id, meeting_index);

ALTER TABLE public.meeting_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view meeting settings" ON public.meeting_settings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_member(auth.uid(), s.group_id)
    )
  );

CREATE POLICY "Admin can insert meeting settings" ON public.meeting_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );

CREATE POLICY "Admin can update meeting settings" ON public.meeting_settings
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );

CREATE POLICY "Members can view meetings" ON public.club_meetings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_member(auth.uid(), s.group_id)
    )
  );

CREATE POLICY "Admin can insert meetings" ON public.club_meetings
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );

CREATE POLICY "Admin can update meetings" ON public.club_meetings
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );

CREATE POLICY "Admin can delete meetings" ON public.club_meetings
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );
