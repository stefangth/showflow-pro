-- Lock the show_required_skills derived cache to its recompute writer.
--
-- Since the slot model landed, show_required_skills is a trigger-maintained cache,
-- rebuilt wholesale (DELETE + INSERT) by recompute_show_slot_derivations whenever a
-- show's slots change; the app-layer writers (addShowRequiredSkill/removeShowRequiredSkill)
-- were removed. Its RLS ALL policy for admin/producer, plus the table's write GRANTs to
-- `authenticated`, still allowed a direct PostgREST INSERT/UPDATE/DELETE. Such a write
-- would silently appear to work and then vanish (or change) on the next unrelated slot
-- edit, because the recompute replaces the show's rows wholesale.
--
-- Revoke the client write privileges so a direct write is denied loudly instead of
-- silently lost. recompute_show_slot_derivations is SECURITY DEFINER and owner-privileged,
-- so it bypasses this GRANT and keeps maintaining the cache. SELECT is untouched, so every
-- reader (the eligibility waterfall, the tier ladder) is unaffected. Idempotent: REVOKE of
-- an already-absent privilege is a no-op.
REVOKE INSERT, UPDATE, DELETE ON public.show_required_skills FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.show_required_skills FROM anon;
