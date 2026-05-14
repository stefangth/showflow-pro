-- The gap12 migration created trg_recompute_show_date_status (calling recompute_show_date_status()),
-- which was never dropped when slots_from_settings removed the slots_per_date columns.
-- This left two competing triggers on bookings:
--   1. sync_show_date_status_trigger -> compute_show_date_status() [correct, settings-based]
--   2. trg_recompute_show_date_status -> recompute_show_date_status() [stale, references dropped columns]
-- Because trigger names are ordered alphabetically, (2) fires after (1) and either
-- overwrites the correct result (if slots_per_date was 0 during seeding) or throws a
-- column-not-found error that rolls back the entire booking write (including the status update).
DROP TRIGGER IF EXISTS trg_recompute_show_date_status ON bookings;

-- Recompute all non-cancelled show_dates with the correct function to fix any stuck statuses.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM show_dates WHERE status != 'cancelled' LOOP
    PERFORM public.compute_show_date_status(r.id);
  END LOOP;
END $$;
