-- Idempotent realtime publication setup.
--
-- The original migration body was a flat list of `alter publication
-- supabase_realtime add table <t>;` statements. That fails on any fresh
-- database because chat_messages was already added by
-- 20260421170151_*.sql (and user_approvals by 20260423102746_*.sql, then
-- dropped by 20260425202310_*.sql). In production this never surfaced
-- because supabase tracks applied migrations by name and never re-ran
-- this one — but it blocks every new local dev / CI stack.
--
-- Wrapping each ADD TABLE in a guard makes the migration safe to run
-- against any DB state (already-published or not) without changing the
-- intended final state.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'bookings',
    'availability',
    'show_dates',
    'show_date_cast_eligibility',
    'show_cast_eligibility',
    'cast_members',
    'artists',
    'shows',
    'casts',
    'cities',
    'app_settings',
    'profiles',
    'user_approvals',
    'chat_messages',
    'chats',
    'booking_audit_log',
    'airtable_sync_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
