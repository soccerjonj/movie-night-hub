CREATE TABLE public.guess_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (season_id, user_id)
);

ALTER TABLE public.guess_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own edits" ON public.guess_edits
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own edits" ON public.guess_edits
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);