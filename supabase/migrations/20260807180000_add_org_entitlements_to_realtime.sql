-- Add org_entitlements to the supabase_realtime publication so that platform
-- module toggles (enabling/disabling a feature for an org) propagate to open
-- clients in real time. The client maps org_entitlements changes to the
-- ['entitlements'] React Query key via REALTIME_INVALIDATIONS, which recomposes
-- the dashboard first-run experience (welcome panel, setup rail, sample/live
-- preview) without a page reload.
--
-- Guarded so a double-apply (or a table already added out of band) is a no-op.
-- RLS on org_entitlements still gates delivery: a member only receives changes
-- to their own org's rows.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'org_entitlements'
  ) then
    alter publication supabase_realtime add table public.org_entitlements;
  end if;
end $$;
