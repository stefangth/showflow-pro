-- Phase 1b cleanup: slot capacity now lives on shows.main_cast_slots /
-- shows.understudy_slots (migration 20260616172104). seed_org_starter_catalog still
-- copied the retired app_settings 'sub_program_slots_defaults' key into each new org —
-- dead data now that nothing reads that key. Drop the slot-seeding block (and its
-- now-unused v_slots local). Skills/cities/casts seeding from starter_catalog_template
-- is unchanged. CREATE OR REPLACE preserves the existing REVOKE from the 2D migration.
create or replace function public.seed_org_starter_catalog(_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tmpl jsonb; v_name text; v_cast jsonb;
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
end;
$$;
