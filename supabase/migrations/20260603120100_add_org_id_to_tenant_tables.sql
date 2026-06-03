-- Phase 0 (2/3): org_id on every tenant table + bootstrap org + membership backfill.
-- The bootstrap org keeps the (still org-unaware) frontend working: a temporary
-- column DEFAULT routes any insert that omits org_id into this org, and existing
-- role-holders are enrolled here. Phase 1 removes the DEFAULTs once the client sets
-- org_id explicitly. Greenfield: on a fresh DB the backfill selects zero rows.
--
-- PURELY ADDITIVE: this migration only ADDS columns. The uniqueness swaps
-- (artists → UNIQUE(org_id,user_id); app_settings → per-(org,key) + platform-NULL)
-- are intentionally DEFERRED to the phase that also updates every `ON CONFLICT (key)`
-- / upsert call site. Dropping app_settings' UNIQUE(key) here breaks existing
-- `INSERT ... ON CONFLICT (key)` upserts (caught by the trigger pgTAP suite in CI).

insert into public.organizations (id, name, slug)
values ('00000000-0000-0000-0000-00000000b007','Bootstrap Org','bootstrap');

-- Enroll all existing role-holders into the bootstrap org with the same role.
insert into public.org_memberships (org_id, user_id, role)
select '00000000-0000-0000-0000-00000000b007', user_id, role
from public.user_roles
on conflict (org_id, user_id, role) do nothing;

-- Add org_id NOT NULL DEFAULT bootstrap + FK + index to EVERY tenant table
-- (including app_settings and artists — uniqueness unchanged).
do $$
declare
  t text;
  bootstrap constant uuid := '00000000-0000-0000-0000-00000000b007';
  tbls text[] := array[
    'shows','show_dates','show_date_offer_tiers','show_cast_eligibility',
    'show_date_cast_eligibility','bookings','booking_audit_log','casts',
    'cast_members','cast_city_priority','cities','skills','artist_skills',
    'blocked_dates','show_assignments','chats','chat_messages',
    'notifications','airtable_sync_log','artists','app_settings'
  ];
begin
  foreach t in array tbls loop
    execute format(
      'alter table public.%I add column if not exists org_id uuid not null default %L references public.organizations(id)',
      t, bootstrap);
    execute format(
      'create index if not exists %I on public.%I(org_id)',
      'idx_'||t||'_org', t);
  end loop;
end $$;
