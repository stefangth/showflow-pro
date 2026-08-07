-- Platform user-management audit trail. Append-only; readable and insertable only by
-- super-admins. Every platform_* RPC and the platform-manage-user edge function writes
-- one row per mutation (see docs/superpowers/plans/2026-07-23-platform-user-management.md).
create table public.platform_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  action text not null,
  target_user_id uuid,
  org_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);

alter table public.platform_audit_log enable row level security;

create policy "super admins read platform audit"
  on public.platform_audit_log for select
  to authenticated
  using (public.is_super_admin(auth.uid()));

create policy "super admins write platform audit"
  on public.platform_audit_log for insert
  to authenticated
  with check (public.is_super_admin(auth.uid()));

create index platform_audit_log_target_idx
  on public.platform_audit_log (target_user_id, created_at desc);
