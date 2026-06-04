-- Phase 2 (2A): make app_settings per-org with a platform-default tier.
--   • org_id becomes NULLABLE; NULL = platform default. Drop the bootstrap DEFAULT so
--     the org-scoped UI must set org_id explicitly (writers updated in 2B/2C).
--   • Existing bootstrap-org rows BECOME platform defaults (org_id → NULL): the bootstrap
--     org then resolves to them, and every future org inherits them with zero config.
--   • UNIQUE(key) → UNIQUE NULLS NOT DISTINCT (org_id, key): one platform row per key,
--     one row per (org,key). NULLS NOT DISTINCT (PG15+; project is PG17) makes the
--     single NULL platform row enforceable AND lets supabase-js upsert infer it via
--     onConflict:'org_id,key'.
--   • RLS: members may READ platform rows (org_id IS NULL) but only super-admin may WRITE
--     them (asymmetric RESTRICTIVE policy — read allows NULL, write does not).
--   • get_org_setting(org,key): org override ?? platform default. Used by the triggers.
--   • compute_show_date_status / sync_show_dates_on_settings_update become org-aware.

-- 1) Nullability + default.
alter table public.app_settings alter column org_id drop default;
alter table public.app_settings alter column org_id drop not null;

-- 2) Existing global settings rows become platform defaults.
update public.app_settings
  set org_id = null
  where org_id = '00000000-0000-0000-0000-00000000b007';

-- 3) Uniqueness swap. (Confirmed live constraint name: app_settings_key_key.)
alter table public.app_settings drop constraint app_settings_key_key;
alter table public.app_settings
  add constraint app_settings_org_key_uniq unique nulls not distinct (org_id, key);

-- 4) RLS: replace app_settings' restrictive isolation so platform (NULL) rows are
--    READABLE by members but only WRITABLE by super-admin. Other tables' org_isolation
--    is untouched (only app_settings has nullable org_id / platform defaults).
drop policy if exists org_isolation on public.app_settings;
create policy org_isolation on public.app_settings as restrictive for all to authenticated
  using      ( org_id is null or public.is_org_member(auth.uid(), org_id) )
  with check ( public.is_org_member(auth.uid(), org_id) );  -- NULL org ⇒ super-admin only

-- 5) Resolver: org override ?? platform default. SECURITY DEFINER so callers (incl. the
--    status triggers) resolve correctly regardless of RLS. (org_id IS NULL) sorts last.
create or replace function public.get_org_setting(_org uuid, _key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.app_settings
  where key = _key and (org_id = _org or org_id is null)
  order by (org_id is null)
  limit 1
$$;

-- 6) compute_show_date_status: resolve slot defaults for the show_date's OWN org.
create or replace function public.compute_show_date_status(p_show_date_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_current      show_date_status;
  v_program      text;
  v_sub_program  text;
  v_org          uuid;
  v_settings     jsonb;
  v_main_cap     int;
  v_us_cap       int;
  v_conf_main    int;
  v_conf_us      int;
  v_active       int;
  v_new          show_date_status;
begin
  select sd.status, s.program, s.sub_program, sd.org_id
    into v_current, v_program, v_sub_program, v_org
  from show_dates sd join shows s on s.id = sd.show_id
  where sd.id = p_show_date_id;

  if not found or v_current = 'cancelled' then
    return;
  end if;

  v_settings := public.get_org_setting(v_org, 'sub_program_slots_defaults');

  if v_program is not null and v_sub_program is not null and v_settings is not null then
    v_main_cap := nullif(v_settings -> v_program -> v_sub_program ->> 'main_cast', '')::int;
    v_us_cap   := nullif(v_settings -> v_program -> v_sub_program ->> 'understudies', '')::int;
  end if;

  select
    count(*) filter (where status = 'confirmed' and not is_understudy),
    count(*) filter (where status = 'confirmed' and is_understudy),
    count(*) filter (where status != 'cancelled')
  into v_conf_main, v_conf_us, v_active
  from bookings where show_date_id = p_show_date_id;

  if v_main_cap is null or v_us_cap is null then
    v_new := case when v_active > 0 then 'partially_filled' else 'open' end;
  elsif v_conf_main >= v_main_cap and v_conf_us >= v_us_cap then
    v_new := 'fully_filled';
  elsif v_active > 0 then
    v_new := 'partially_filled';
  else
    v_new := 'open';
  end if;

  update show_dates set status = v_new where id = p_show_date_id;
end;
$$;

-- 7) Settings-cascade: recompute the AFFECTED org's show_dates (or all, when the platform
--    default changes — every date resolves its own effective value). Fire on I/U/D so
--    creating/removing a per-org override also recomputes.
create or replace function public.sync_show_dates_on_settings_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_key text; v_org uuid;
begin
  v_key := coalesce(NEW.key, OLD.key);
  v_org := coalesce(NEW.org_id, OLD.org_id);
  if v_key is distinct from 'sub_program_slots_defaults' then
    return null;
  end if;
  if v_org is not null then
    for r in select id from show_dates where org_id = v_org loop
      perform public.compute_show_date_status(r.id);
    end loop;
  else
    for r in select id from show_dates loop
      perform public.compute_show_date_status(r.id);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists sync_show_dates_on_settings_update_trigger on public.app_settings;
create trigger sync_show_dates_on_settings_update_trigger
  after insert or update or delete on public.app_settings
  for each row execute function public.sync_show_dates_on_settings_update();
