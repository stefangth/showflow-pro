-- Active-org scoping: narrow org_isolation to the org the caller is currently viewing.
--
-- Problem
-- -------
-- RLS scopes rows to the orgs a caller MAY read, never to the org they are VIEWING.
-- `is_org_member(uid, org)` is `is_super_admin(uid) OR exists(membership)`, so it is
-- unconditionally true for a platform admin and true for every org a multi-org member
-- belongs to. The RESTRICTIVE org_isolation policy therefore does not narrow anything
-- for those callers, and tables like casts / cast_members / shows / show_dates also
-- carry a PERMISSIVE `SELECT ... USING (true)`, leaving org_isolation as their only
-- row filter. Result: a super-admin who entered org A still saw org B's bookings and
-- casts wherever a client query forgot its own `.eq('org_id', …)`.
--
-- ADR-0003 made that the client's job on purpose ("Isolation never depends on the
-- active-org UI filter"). The client now does it (src/data/**, guarded in CI by
-- src/test/orgScoping.test.ts). This migration is the backstop underneath, so a single
-- forgotten filter cannot leak again.
--
-- Mechanism
-- ---------
-- The SPA sends the active org as an `x-active-org` request header (see
-- src/integrations/supabase/activeOrg.ts). `active_org_id()` reads it from PostgREST's
-- `request.headers` GUC, and org_isolation ANDs it in.
--
-- Safety
-- ------
--  * It can ONLY narrow. The predicate is `is_org_member(...) AND (active IS NULL OR
--    org_id = active)`, so forging the header grants a caller nothing new — the
--    membership test still has to pass.
--  * No header = previous behavior, by design. Service-role callers bypass RLS
--    entirely; edge functions and cron using a user JWT simply never send it. Failing
--    open keeps this a second line of defense rather than a new outage surface.
--  * The header is validated as a UUID before casting, so a malformed value degrades
--    to "no narrowing" instead of erroring every query on the table. The GUC is read
--    with a regex rather than a ::json cast for the same reason: a policy that can
--    raise on a malformed input would take down every row of every table with it.
--
-- Deliberately NOT narrowed (the platform console reads these across orgs directly,
-- while everything else it does goes through SECURITY DEFINER RPCs that bypass RLS):
--   app_settings              - also holds org_id IS NULL platform defaults, and
--                               resolveOrgSetting relies on the NULL fallback row
--   org_entitlements          - read for every org by the platform modules matrix
--   org_capabilities          - read for every org by the platform rights matrix
--   org_capability_policies   - ditto
--   notifications             - per-user, not per-org; super-admins receive
--                               org_id IS NULL platform notices

-- 1. The active org for this request, or NULL when absent/unparseable.
--    Pure SQL (inlinable) with no EXCEPTION block and no ::json cast, so it cannot
--    raise: it stays cheap and total enough to sit in a policy evaluated per row.
--    Verified against a valid header, a header among others, a malformed value, an
--    empty value, an absent key, a non-JSON GUC, and a quote-injection attempt.
create or replace function public.active_org_id()
returns uuid
language sql
stable
parallel safe
set search_path = public
as $$
  select case
    when v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v::uuid
    else null
  end
  from (
    select substring(
      coalesce(current_setting('request.headers', true), '')
      from '"x-active-org"\s*:\s*"([^"]*)"'
    ) as v
  ) s
$$;

comment on function public.active_org_id() is
  'The org named by the x-active-org request header, or NULL. Used by org_isolation to '
  'narrow rows to the org being viewed. Can only narrow: it is ANDed with is_org_member.';

grant execute on function public.active_org_id() to authenticated;

-- 2. Re-create org_isolation on every content table with the active-org conjunct.
do $$
declare
  t text;
  content_tables text[] := array[
    'shows', 'show_dates', 'show_date_offer_tiers', 'show_cast_eligibility',
    'show_date_cast_eligibility', 'show_required_skills', 'show_date_required_skills',
    'show_assignments', 'show_date_change_log',
    'bookings', 'booking_audit_log',
    'casts', 'cast_members', 'cast_city_priority',
    'cities', 'skills', 'artists', 'artist_skills', 'blocked_dates',
    'chats', 'chat_messages',
    'hire_orders', 'hire_order_dates', 'hire_order_imports', 'hire_order_signatures',
    'custom_field_definitions', 'settings_audit_log',
    'airtable_sync_log', 'airtable_sync_record_log'
  ];
begin
  foreach t in array content_tables loop
    execute format('drop policy if exists org_isolation on public.%I', t);
    execute format(
      'create policy org_isolation on public.%I as restrictive for all to authenticated '
      || 'using (public.is_org_member(auth.uid(), org_id) '
      || '      and (public.active_org_id() is null or org_id = public.active_org_id())) '
      || 'with check (public.is_org_member(auth.uid(), org_id) '
      || '      and (public.active_org_id() is null or org_id = public.active_org_id()))',
      t);
  end loop;
end $$;
