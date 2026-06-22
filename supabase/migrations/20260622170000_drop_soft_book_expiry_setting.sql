-- Remove the inert `soft_book_expiry_hours` setting.
--
-- Seeded 2026-04-17 (20260417102257) as the intended soft-book auto-expiry window,
-- but it was superseded by `offer_response_window_hours` (20260514180000) before a
-- consumer was ever built. No edge function, trigger, RPC, or cron reads it, and the
-- Settings UI control that wrote it has been removed. This deletes the orphaned
-- platform-default row plus any per-org overrides. Idempotent and safe (no-op if absent).

DELETE FROM public.app_settings WHERE key = 'soft_book_expiry_hours';
