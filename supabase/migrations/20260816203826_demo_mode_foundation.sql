-- Demo mode foundation: org flag + demo-only support tables.
--
-- RLS template note: org_isolation below follows the CURRENT (post-#216) simple
-- pattern used by the most recent tenant table (show_date_skill_drops,
-- 20260812190000_show_date_skill_drops.sql): plain `is_org_member(auth.uid(), org_id)`
-- on both USING and WITH CHECK, with NO active-org (`active_org_id()`) conjunct.
-- Per ADR-0003 and the #216 postmortem, the active-org header is a READ-narrowing
-- convenience only and must never gate writes; several older tables still carry it
-- on USING from an earlier migration, but new tables are not opted into it.

-- 1. The org type flag. A plain boolean is deliberate (not an entitlement):
--    it is read directly everywhere the org loads and it guards the wipe RPC.
alter table public.organizations
  add column if not exists is_demo boolean not null default false;

-- 2. Per-demo-org presenter state (Phase 1 uses volume + prospect_label;
--    scene columns arrive in Phase 2).
create table if not exists public.demo_state (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  volume text not null default 'full' check (volume in ('small','full')),
  prospect_label text,
  updated_at timestamptz not null default now()
);
alter table public.demo_state enable row level security;

create trigger demo_state_set_updated_at
  before update on public.demo_state
  for each row execute function public.update_updated_at_column();

-- Members of the (demo) org may READ their presenter state; only org admins may
-- write it. Split into a read policy + an admin FOR-ALL write policy (not a single
-- FOR ALL with WITH CHECK): WITH CHECK is not evaluated for DELETE, so a lone
-- member-scoped USING would let a non-admin member DELETE the row. Mirrors the
-- broad-read/narrow-write split in 20260723185429_show_assignments_capability_rls.sql.
create policy demo_state_read on public.demo_state
  for select to authenticated
  using (public.is_org_member(auth.uid(), org_id));

create policy demo_state_write on public.demo_state
  for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin'::app_role))
  with check (public.has_org_role(auth.uid(), org_id, 'admin'::app_role));

-- Pooled-tenancy isolation floor (ADR-0003).
create policy org_isolation on public.demo_state
  as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));

-- 3. Captured outbound artifacts (email/PDF) for demo orgs -- the "demo outbox".
create table if not exists public.demo_captured_sends (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('email','pdf')),
  to_label text,
  subject text,
  preview_html text,
  storage_path text,
  created_at timestamptz not null default now()
);
alter table public.demo_captured_sends enable row level security;

-- Org members read their own outbox; only the service role writes (the divert
-- runs inside send-transactional-email with the service client).
create policy demo_captured_sends_read on public.demo_captured_sends
  for select to authenticated
  using (public.is_org_member(auth.uid(), org_id));

create policy org_isolation on public.demo_captured_sends
  as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));

-- 4. Re-create platform_org_stats adding is_demo. Identical body to
--    20260604140000_phase4_platform_console.sql, with `is_demo boolean` appended
--    to the RETURNS TABLE signature and `o.is_demo` appended to the SELECT list.
--    Postgres cannot CREATE OR REPLACE across an OUT-parameter (RETURNS TABLE)
--    signature change, so the old function is dropped first.
drop function if exists public.platform_org_stats();

create or replace function public.platform_org_stats()
returns table (
  org_id uuid, name text, slug text, status text,
  member_count int, active_artist_count int, bookings_30d int, last_activity_at timestamptz,
  is_demo boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Forbidden: platform admin only' using errcode = '42501';
  end if;
  return query
    select
      o.id, o.name, o.slug, o.status,
      (select count(distinct m.user_id)::int from public.org_memberships m where m.org_id = o.id),
      (select count(*)::int from public.artists a where a.org_id = o.id and a.status = 'active'),
      (select count(*)::int from public.bookings b where b.org_id = o.id and b.created_at >= now() - interval '30 days'),
      greatest(
        (select max(b.created_at)  from public.bookings b      where b.org_id  = o.id),
        (select max(sd.created_at) from public.show_dates sd    where sd.org_id = o.id),
        (select max(cm.created_at) from public.chat_messages cm where cm.org_id = o.id)
      ),
      o.is_demo
    from public.organizations o
    order by o.created_at desc;
end;
$$;
revoke all on function public.platform_org_stats() from public, anon;
grant execute on function public.platform_org_stats() to authenticated;
