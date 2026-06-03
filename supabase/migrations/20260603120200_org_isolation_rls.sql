-- Phase 0 (3/3): cross-org ISOLATION via a RESTRICTIVE policy per tenant table.
--
-- Design: instead of rewriting all ~89 existing permissive policies (high-risk,
-- and it would regress intra-org guards like blocked_dates self-isolation), we add
-- ONE restrictive policy per table that ANDs `is_org_member(org_id)` onto every
-- existing policy. Restrictive policies only FILTER — they never grant — so all
-- existing intra-org semantics (admin/producer/self/participant) are preserved,
-- and no row outside the caller's orgs is ever reachable.
--
-- The per-org role-gating swap (has_role → has_org_role inside the permissive
-- policies) is deferred to Phase 1, together with retiring user_roles.

-- Bootstrap-org coexistence fallback: the bootstrap org is the legacy "global"
-- space. While role-gating still runs through has_role/user_roles (Phase 0), any
-- user holding a global role is treated as a member of the bootstrap org so the
-- existing app + test suite keep working. Removed in Phase 1.
create or replace function public.is_org_member(_uid uuid, _org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin(_uid)
      or exists (select 1 from public.org_memberships where user_id = _uid and org_id = _org)
      or ( _org = '00000000-0000-0000-0000-00000000b007'
           and exists (select 1 from public.user_roles where user_id = _uid) )
$$;

-- Add the restrictive isolation policy to every tenant table.
do $$
declare
  t text;
  tbls text[] := array[
    'shows','show_dates','show_date_offer_tiers','show_cast_eligibility',
    'show_date_cast_eligibility','bookings','booking_audit_log','casts',
    'cast_members','cast_city_priority','cities','skills','artist_skills',
    'blocked_dates','show_assignments','chats','chat_messages',
    'notifications','airtable_sync_log','artists','app_settings'
  ];
begin
  foreach t in array tbls loop
    execute format('drop policy if exists org_isolation on public.%I', t);
    execute format(
      'create policy org_isolation on public.%I as restrictive for all to authenticated '
      || 'using (public.is_org_member(auth.uid(), org_id)) '
      || 'with check (public.is_org_member(auth.uid(), org_id))',
      t);
  end loop;
end $$;
