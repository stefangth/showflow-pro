-- Phase 2 (2D): per-org catalogs.
--   • skills/cities name uniqueness becomes per-org so each org owns its own catalog.
--   • artists uniqueness becomes per (org, user) — the deferred Phase-0 swap — so one
--     person can be a separate artist per org (user_id stays nullable for unclaimed rows).
--   • A platform-default starter_catalog_template drives seeding.
--   • seed_org_starter_catalog(_org) copies the template into one org + seeds its slot
--     defaults. SECURITY DEFINER + idempotent. NOT called anywhere in Phase 2 (Phase-4
--     provisioning calls it) — see the edge-function safety invariant.

-- 1) Per-org catalog name uniqueness. (Confirmed live: skills_name_key, cities_name_key.)
alter table public.skills drop constraint if exists skills_name_key;
drop index if exists public.skills_name_key;
create unique index skills_org_name_uniq on public.skills(org_id, name);

alter table public.cities drop constraint if exists cities_name_key;
drop index if exists public.cities_name_key;
create unique index cities_org_name_uniq on public.cities(org_id, name);

-- 2) artists: per-(org,user) uniqueness (partial — unclaimed rows have NULL user_id).
alter table public.artists drop constraint if exists artists_user_id_key;
drop index if exists public.artists_user_id_key;
create unique index artists_org_user_uniq on public.artists(org_id, user_id) where user_id is not null;

-- 3) Platform starter template (product-agnostic; edit via the settings infra / SQL).
--    cities intentionally empty (venue cities are customer-specific).
insert into public.app_settings (org_id, key, value)
values (null, 'starter_catalog_template', '{
  "skills": ["Vocals","Dance","Acrobatics","Aerial","Juggling","Comedy","Magic","Live Music"],
  "cities": [],
  "casts": [{"name":"Main Cast","description":"Default cast"}]
}'::jsonb)
on conflict (org_id, key) do nothing;

-- 4) Seed function.
create or replace function public.seed_org_starter_catalog(_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tmpl jsonb; v_name text; v_cast jsonb; v_slots jsonb;
begin
  tmpl := public.get_org_setting(null, 'starter_catalog_template');
  if tmpl is null then return; end if;

  for v_name in select jsonb_array_elements_text(coalesce(tmpl->'skills','[]'::jsonb)) loop
    insert into public.skills (org_id, name) values (_org, v_name)
    on conflict (org_id, name) do nothing;
  end loop;

  for v_name in select jsonb_array_elements_text(coalesce(tmpl->'cities','[]'::jsonb)) loop
    insert into public.cities (org_id, name) values (_org, v_name)
    on conflict (org_id, name) do nothing;
  end loop;

  for v_cast in select * from jsonb_array_elements(coalesce(tmpl->'casts','[]'::jsonb)) loop
    insert into public.casts (org_id, name, description)
    select _org, v_cast->>'name', v_cast->>'description'
    where not exists (
      select 1 from public.casts c where c.org_id = _org and c.name = v_cast->>'name'
    );
  end loop;

  -- Give the org its own editable slot defaults (a copy of the platform default).
  v_slots := public.get_org_setting(null, 'sub_program_slots_defaults');
  if v_slots is not null then
    insert into public.app_settings (org_id, key, value)
    values (_org, 'sub_program_slots_defaults', v_slots)
    on conflict (org_id, key) do nothing;
  end if;
end;
$$;

-- Callable by service-role / definer flows (Phase-4 provision_org). Not granted to authenticated.
revoke all on function public.seed_org_starter_catalog(uuid) from public;
