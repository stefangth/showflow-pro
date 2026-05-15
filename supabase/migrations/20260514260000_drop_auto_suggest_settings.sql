-- Remove auto-suggest settings keys. The offer engine creates `suggested`
-- bookings for every active artist in the active tier; there's no top-N
-- ranking step anymore.
DELETE FROM public.app_settings
WHERE key IN ('max_suggestions', 'auto_suggest_enabled');
