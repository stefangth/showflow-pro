-- Phase 0 (2/3): org_id on every tenant table + bootstrap org + membership backfill.
-- The bootstrap org keeps the (still org-unaware) frontend working: a temporary
-- column DEFAULT routes any insert that omits org_id into this org, and existing
-- role-holders are enrolled here. Phase 1 removes the DEFAULTs once the client sets
-- org_id explicitly. Greenfield: on a fresh DB the backfill selects zero rows.

insert into public.organizations (id, name, slug)
values ('00000000-0000-0000-0000-00000000b007','Bootstrap Org','bootstrap');

-- Enroll all existing role-holders into the bootstrap org with the same role.
insert into public.org_memberships (org_id, user_id, role)
select '00000000-0000-0000-0000-00000000b007', user_id, role
from public.user_roles
on conflict (org_id, user_id, role) do nothing;

-- Add org_id NOT NULL DEFAULT bootstrap + FK + index to each tenant table.
-- app_settings is handled separately below (nullable org_id = platform default).
do $$
declare
  t text;
  bootstrap constant uuid := '00000000-0000-0000-0000-00000000b007';
  tbls text[] := array[
    'shows','show_dates','show_date_offer_tiers','show_cast_eligibility',
    'show_date_cast_eligibility','bookings','booking_audit_log','casts',
    'cast_members','cast_city_priority','cities','skills','artist_skills',
    'blocked_dates','show_assignments','chats','chat_messages',
    'notifications','airtable_sync_log','artists'
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

-- artists: replace global UNIQUE(user_id) with per-org uniqueness.
alter table public.artists drop constraint if exists artists_user_id_key;
drop index if exists public.artists_user_id_key;
create unique index artists_org_user_uniq
  on public.artists(org_id, user_id) where user_id is not null;

-- app_settings: nullable org_id (NULL = platform default); per-(org,key) uniqueness.
alter table public.app_settings add column if not exists org_id uuid references public.organizations(id);
create index if not exists idx_app_settings_org on public.app_settings(org_id);
alter table public.app_settings drop constraint if exists app_settings_key_key;
drop index if exists public.app_settings_key_key;
create unique index app_settings_platform_key on public.app_settings(key) where org_id is null;
create unique index app_settings_org_key       on public.app_settings(org_id, key) where org_id is not null;
-- Existing global settings rows keep org_id = NULL → they become the platform defaults.
