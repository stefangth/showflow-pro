-- blocked_dates: artist-declared conflict/vacation windows.
-- Replaces the narrow "I'm unavailable on date X" use-case from the old
-- availability table. No recurrence — artists enter dates individually.
CREATE TABLE public.blocked_dates (
  id         UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  artist_id  UUID NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT blocked_dates_artist_date_unique UNIQUE (artist_id, date)
);

ALTER TABLE public.blocked_dates ENABLE ROW LEVEL SECURITY;

-- Artists manage their own blocks
CREATE POLICY "Artists can manage their own blocked_dates"
ON public.blocked_dates FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.artists a
    WHERE a.id = artist_id
      AND a.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.artists a
    WHERE a.id = artist_id
      AND a.user_id = auth.uid()
  )
);

-- Admins and producers can read (but not write) blocked_dates
CREATE POLICY "Admins and producers can view blocked_dates"
ON public.blocked_dates FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'producer')
);
