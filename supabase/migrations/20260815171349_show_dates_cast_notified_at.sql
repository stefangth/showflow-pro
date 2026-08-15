-- "Needs you" queue: cancelled-date cast notification marker.
--
-- Producer-cancelled individual holds/confirms only get a notice via the delayed
-- 20:00 confirmation digest today. The notify-cast edge function (Phase 2) sends an
-- IMMEDIATE in-app notification instead; this column records that it happened so the
-- "Cancelled · needs a decision" queue item can be cleared/marked done.
alter table public.show_dates add column if not exists cast_notified_at timestamptz;
comment on column public.show_dates.cast_notified_at is
  'When a producer explicitly notified cast that this date was cancelled (Needs-you queue).';
