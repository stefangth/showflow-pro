-- M6 — resolve_show_assignments must verify the caller is a member of p_org.
--
-- resolve_show_assignments (20260604133000_org_scope_assignments_and_autocancel.sql) is
-- SECURITY DEFINER with GRANT EXECUTE to authenticated. It takes a caller-supplied p_org
-- and filters by it, but never checks the caller belongs to p_org. DEFINER bypasses
-- show_assignments RLS, so any authenticated user could pass an arbitrary p_org (plus a
-- guessed program/city) and harvest that org's producer_user_ids.
--
-- Fix: add a membership guard. The function has two legitimate caller classes:
--   * AUTHENTICATED end users (via the client / RPC) — these must be a member of p_org
--     (super-admins pass is_org_member automatically), else RAISE.
--   * TRUSTED backend paths where auth.uid() IS NULL: the service-role edge functions
--     (expire-offers, tier-at-risk-watcher call admin.rpc('resolve_show_assignments', …))
--     and the SECURITY DEFINER booking triggers (notify_booking_transition,
--     promote_understudy_on_cancellation), which pass a server-derived NEW.org_id — never
--     an attacker-controlled value. For these, auth.uid() is NULL, so we skip the guard;
--     tightening them would break cron-driven digests/notifications.
--
-- So: enforce membership only when auth.uid() IS NOT NULL. The p_org value passed by the
-- trusted paths is not attacker-controlled, so a NULL-uid call is safe.
--
-- The 3-arg org-blind version was already dropped in 20260604133000; only the 4-arg
-- version exists. It was `language sql`; this reimplements it as `language plpgsql` (with
-- an early guard) so the WHERE-clause logic and result shape are byte-for-byte identical.
-- SET search_path = public is preserved.

CREATE OR REPLACE FUNCTION public.resolve_show_assignments(
  p_program text, p_sub_program text, p_city_id uuid, p_org uuid
) RETURNS TABLE(producer_user_id uuid, specificity int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Membership guard: an authenticated caller may only resolve their own org's
  -- assignments (is_org_member already returns true for super-admins). Trusted backend
  -- paths run with auth.uid() = NULL (service role / SECURITY DEFINER triggers) and pass
  -- a server-derived p_org, so they are exempt.
  IF auth.uid() IS NOT NULL
     AND NOT public.is_org_member(auth.uid(), p_org)
     AND NOT public.is_super_admin(auth.uid())
  THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  select sa.producer_user_id,
         case
           when sa.sub_program = p_sub_program and sa.city_id = p_city_id then 4
           when sa.city_id = p_city_id and sa.sub_program is null then 3
           when sa.sub_program = p_sub_program and sa.city_id is null then 2
           when sa.city_id is null and sa.sub_program is null then 1
           else 0
         end as specificity
  from show_assignments sa
  where sa.org_id = p_org
    and sa.program = p_program
    and (sa.sub_program = p_sub_program or sa.sub_program is null)
    and (sa.city_id = p_city_id or sa.city_id is null)
    and case
          when sa.sub_program = p_sub_program and sa.city_id = p_city_id then 4
          when sa.city_id = p_city_id and sa.sub_program is null then 3
          when sa.sub_program = p_sub_program and sa.city_id is null then 2
          when sa.city_id is null and sa.sub_program is null then 1
          else 0
        end > 0
  order by specificity desc;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_show_assignments(text, text, uuid, uuid) TO authenticated;
