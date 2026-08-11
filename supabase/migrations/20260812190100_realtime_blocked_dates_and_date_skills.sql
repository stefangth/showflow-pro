-- Add blocked_dates and show_date_required_skills to the supabase_realtime
-- publication so their changes propagate to open clients in real time.
--
-- Both tables already have REALTIME_INVALIDATIONS entries
-- (src/features/auth/realtimeInvalidations.ts) mapping their changes to the
-- ['blocked-dates'] / ['eligibility'] / ['tier-ladder'] React Query keys, but
-- neither table was ever in the publication, so those subscriptions were dormant
-- no-ops. Adding the tables here makes the cross-client refresh live (and also
-- benefits existing consumers of those keys).
--
-- Guarded so a double-apply (or a table already added out of band) is a no-op.
-- RLS on each table still gates delivery: a member only receives changes to
-- their own org's rows.
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'blocked_dates',
    'show_date_required_skills'
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
