
CREATE TYPE public.meeting_type AS ENUM ('remote', 'in_person');

ALTER TABLE public.groups 
  ADD COLUMN meeting_type public.meeting_type NOT NULL DEFAULT 'remote',
  ADD COLUMN meeting_location text;
