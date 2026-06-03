-- Final stage of the user_roles → org_memberships migration: drop the legacy global
-- role table, the has_role() function, and the is_org_member bootstrap fallback.
--
-- Every role check now resolves through org_memberships (has_org_role / is_org_member).
-- All pre-existing users were backfilled into the bootstrap org's memberships
-- (migration 20260603120100), so removing the fallback changes no one's access — it
-- only stops treating a bare user_roles row as implicit bootstrap-org membership.
--
-- The bootstrap org_id column DEFAULTs on tenant tables are intentionally KEPT
-- (removed later, with the Phase 2/3 insert-path work).

-- 1. Redefine is_org_member WITHOUT the user_roles bootstrap fallback. Must run
--    before the table drop — the old body reads user_roles, and this function backs
--    the org_isolation RESTRICTIVE policy on every tenant table.
create or replace function public.is_org_member(_uid uuid, _org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin(_uid)
      or exists (select 1 from public.org_memberships where user_id = _uid and org_id = _org)
$$;

-- 2. Drop the legacy global role table. Its own RLS policies (the last has_role()
--    callers) drop with it. No FKs reference it; it is not in any publication.
drop table if exists public.user_roles;

-- 3. Drop the now-unreferenced has_role() function.
drop function if exists public.has_role(uuid, app_role);
