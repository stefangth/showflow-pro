-- Backfill the Wireflow v3 `getrunning_dates_source` app_settings override for orgs that
-- set up their dates source under the v1 /get-running board (PR #349 made v3 the default
-- board but shipped no data migration, so orgs already syncing Airtable/Sheet or entering
-- dates by hand read back an unset "pick a source" step and the source/connect/map steps
-- of the get_dates phase show as not-done despite a working setup).
--
-- Inference precedence, applied only to orgs that have no getrunning_dates_source override
-- yet (an org that already chose a source in the v3 wizard is never touched):
--   airtable  -- airtable_sync_enabled=true OR a non-empty airtable_base_id
--   sheet     -- a non-empty sheet_import_settings.url
--   manual    -- otherwise, if the org has any show_dates row (dates exist, no sync config)
--   (skip)    -- a brand-new org with none of the above keeps no override; the wizard decides
--
-- Idempotent: the not-exists guard (and the ON CONFLICT) mean a re-run inserts nothing.
-- Kept as a callable function (not inline DML) so supabase/tests exercises the same code
-- that runs in production. Not invoked by any client/edge caller -> execute revoked from
-- public/anon/authenticated.
create or replace function public.backfill_getrunning_dates_source()
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into public.app_settings (org_id, key, value)
  select o.id, 'getrunning_dates_source', to_jsonb(src.source)
  from public.organizations o
  cross join lateral (
    select case
      when exists (
        select 1 from public.app_settings s
        where s.org_id = o.id and s.key = 'airtable_sync_enabled' and s.value = to_jsonb(true)
      ) or exists (
        select 1 from public.app_settings s
        where s.org_id = o.id and s.key = 'airtable_base_id'
          and coalesce(s.value #>> '{}', '') <> ''
      ) then 'airtable'
      when exists (
        select 1 from public.app_settings s
        where s.org_id = o.id and s.key = 'sheet_import_settings'
          and coalesce(s.value ->> 'url', '') <> ''
      ) then 'sheet'
      when exists (
        select 1 from public.show_dates d where d.org_id = o.id
      ) then 'manual'
      else null
    end as source
  ) src
  where src.source is not null
    and not exists (
      select 1 from public.app_settings s
      where s.org_id = o.id and s.key = 'getrunning_dates_source'
    )
  on conflict (org_id, key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.backfill_getrunning_dates_source() from public, anon, authenticated;

select public.backfill_getrunning_dates_source();
