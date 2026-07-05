-- Narrow EXECUTE on two automation RPCs flagged by the system-map audit
-- (docs/system-map.md → Open questions #3 and #5, PR #149).
--
-- expire_soft_bookings(): SECURITY DEFINER cross-org sweep with no internal
-- guard; before this migration it was executable by authenticated AND anon
-- (the Supabase default-privileges grant was never revoked). Its only real
-- caller is the expire-offers edge fn via the service-role client
-- (supabase/functions/expire-offers/index.ts:30).
--
-- should_notify(uuid,text,text): SECURITY DEFINER with no self-scope check —
-- authenticated could probe another user's opt-out booleans by uuid. Real
-- callers: send-transactional-email (service-role client) and
-- gate_notification_pref() (SECURITY DEFINER trigger fn → executes as its
-- owner, unaffected by these grants).
--
-- service_role's grant is made explicit (it previously rode on Supabase's
-- default-privileges grant).

revoke execute on function public.expire_soft_bookings() from public, anon, authenticated;
grant execute on function public.expire_soft_bookings() to service_role;

revoke execute on function public.should_notify(uuid, text, text) from public, anon, authenticated;
grant execute on function public.should_notify(uuid, text, text) to service_role;
