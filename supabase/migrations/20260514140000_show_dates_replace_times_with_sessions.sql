-- Replace single start_time/end_time on show_dates with three session start times.
-- session_1 is required; session_2 and session_3 are optional.

ALTER TABLE public.show_dates
  ADD COLUMN session_1 TIME,
  ADD COLUMN session_2 TIME,
  ADD COLUMN session_3 TIME;

UPDATE public.show_dates
SET session_1 = COALESCE(start_time, '00:00'::time);

ALTER TABLE public.show_dates
  ALTER COLUMN session_1 SET NOT NULL;

ALTER TABLE public.show_dates
  DROP COLUMN start_time,
  DROP COLUMN end_time;
