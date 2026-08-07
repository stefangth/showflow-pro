-- Drop the active-org conjunct from org_isolation's WITH CHECK (keep it on USING).
--
-- Problem
-- -------
-- 20260806104215_active_org_scoping.sql added the active-org conjunct
-- `(active_org_id() is null or org_id = active_org_id())` to BOTH the USING and
-- the WITH CHECK of the RESTRICTIVE org_isolation policy on every tenant table.
-- On writes this breaks legitimate INSERT/UPDATE for multi-org members and
-- super-admins: several tenant tables derive org_id from an FK parent in a
-- BEFORE INSERT trigger (chats.derive_org_id_from_show_date_id() being the clear
-- case), so the row's final org_id is server-derived. When the caller's SPA
-- active-org header (x-active-org) names a DIFFERENT org than the derived org,
-- the WITH CHECK's header-equality test fails and the write is rejected with
-- `new row violates row-level security policy "org_isolation"`. The chats table
-- has never had a successful INSERT because of this.
--
-- Judgment (see ADR-0003: isolation never depends on the active-org UI filter)
-- ---------------------------------------------------------------------------
-- The active-org conjunct is a READ-narrowing / defense-in-depth convenience.
-- On writes it adds no real isolation: is_org_member(auth.uid(), org_id) already
-- restricts writes to orgs the caller belongs to, and the derive triggers stamp
-- org_id from the FK parent, so a client cannot forge a cross-org row. Enforcing
-- header-equality on a server-derived, client-timing-dependent value is inherently
-- racy and is exactly what breaks legitimate writes.
--
-- Fix
-- ---
-- Recreate org_isolation on EXACTLY the set of tables 20260806104215 rewrote,
-- with the USING expression preserved verbatim (read narrowing kept) and the
-- WITH CHECK reduced to `is_org_member(auth.uid(), org_id)` (active-org conjunct
-- removed). Write isolation across org boundaries is still fully enforced by the
-- membership test. No change to active_org_id() or the derive triggers.

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
      || 'with check (public.is_org_member(auth.uid(), org_id))',
      t);
  end loop;
end $$;
