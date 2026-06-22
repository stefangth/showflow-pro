-- Remove the orphaned `sub_program_slots_defaults` app_settings rows.
--
-- Slot capacity moved to shows.main_cast_slots / shows.understudy_slots (20260616172104).
-- 20260617120000 stopped *seeding* this key into new orgs but never deleted rows already
-- written into existing orgs by seed_org_starter_catalog — dead data that nothing reads
-- (no edge function, trigger, RPC, or cron). This deletes the platform-default row and any
-- per-org rows. Idempotent and safe (no-op if absent).

DELETE FROM public.app_settings WHERE key = 'sub_program_slots_defaults';
