create table public.org_capability_policies (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  capability text not null,
  enabled    boolean,
  locked     boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, capability)
);

alter table public.org_capability_policies enable row level security;

create policy "Members can view org capability policies"
  on public.org_capability_policies for select to authenticated
  using (public.is_org_member(auth.uid(), org_id));

create policy "Super admins manage capability policies"
  on public.org_capability_policies for all to authenticated
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

create policy org_isolation on public.org_capability_policies
  as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));

create or replace function public.stamp_org_capability_policy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger stamp_org_capability_policy before insert or update on public.org_capability_policies
  for each row execute function public.stamp_org_capability_policy();

create or replace function public.log_org_capability_policy_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.enabled is not distinct from old.enabled
     and new.locked is not distinct from old.locked then
    return null;
  end if;
  insert into public.settings_audit_log (org_id, key, actor, old_value, new_value)
  values (
    new.org_id,
    'capability_policy:' || new.capability,
    auth.uid(),
    case when tg_op = 'UPDATE' then jsonb_build_object('enabled', old.enabled, 'locked', old.locked) else null end,
    jsonb_build_object('enabled', new.enabled, 'locked', new.locked)
  );
  return null;
end $$;

create trigger log_org_capability_policy_change after insert or update on public.org_capability_policies
  for each row execute function public.log_org_capability_policy_change();
