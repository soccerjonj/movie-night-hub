-- Reading assignments for book clubs
CREATE TABLE public.reading_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  title TEXT,
  chapter_range TEXT,
  start_page INT,
  end_page INT,
  due_date DATE,
  notes TEXT,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reading_assignments_season_order_idx
  ON public.reading_assignments (season_id, order_index, due_date);

ALTER TABLE public.reading_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view reading assignments" ON public.reading_assignments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_member(auth.uid(), s.group_id)
    )
  );

CREATE POLICY "Admin can insert reading assignments" ON public.reading_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );

CREATE POLICY "Admin can update reading assignments" ON public.reading_assignments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );

CREATE POLICY "Admin can delete reading assignments" ON public.reading_assignments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seasons s
      WHERE s.id = season_id AND public.is_group_admin(auth.uid(), s.group_id)
    )
  );
