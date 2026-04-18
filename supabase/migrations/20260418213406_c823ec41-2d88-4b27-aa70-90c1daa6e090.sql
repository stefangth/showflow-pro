-- Add program column to shows (mock IP field)
ALTER TABLE public.shows ADD COLUMN IF NOT EXISTS program text;

-- Seed mock programs onto existing shows
UPDATE public.shows SET program = 'Candlelight' WHERE program IS NULL AND (random() < 0.34);
UPDATE public.shows SET program = 'Ballet of Lights' WHERE program IS NULL AND (random() < 0.5);
UPDATE public.shows SET program = 'Immersive Van Gogh' WHERE program IS NULL AND (random() < 0.5);
UPDATE public.shows SET program = 'Jury Experience' WHERE program IS NULL;

-- Default app_settings for filter visibility & mappings
INSERT INTO public.app_settings (key, value, description) VALUES
  ('filters_visibility', '{
    "shows":    { "producer": { "program": true, "timeframe": true, "sort": true, "status": true }, "artist": { "program": true, "timeframe": true, "sort": true, "status": false } },
    "artists":  { "producer": { "program": true, "timeframe": true, "sort": true, "status": true }, "artist": { "program": false, "timeframe": false, "sort": true, "status": false } },
    "bookings": { "producer": { "program": true, "timeframe": true, "sort": true, "status": true }, "artist": { "program": true, "timeframe": true, "sort": true, "status": true } }
  }'::jsonb, 'Per-page x per-role visibility flags for extra filters')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value, description) VALUES
  ('filter_mappings', '{
    "program": "IP",
    "timeframe": "Show Date",
    "sort_field": "Show Date",
    "status": "Status"
  }'::jsonb, 'Maps Showflow filter fields to Airtable column names (mock until sync wired)')
ON CONFLICT (key) DO NOTHING;
