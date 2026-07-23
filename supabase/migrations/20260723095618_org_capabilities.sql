create table public.org_capabilities (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  capability text not null,
  enabled    boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, capability)
);

alter table public.org_capabilities enable row level security;

create policy "Members can view org capabilities"
  on public.org_capabilities for select to authenticated
  using (public.is_org_member(auth.uid(), org_id));

create policy "Super admins manage capabilities"
  on public.org_capabilities for all to authenticated
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

create policy org_isolation on public.org_capabilities
  as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));

-- Registry twin. Defaults MUST mirror CAPABILITY_REGISTRY in
-- src/lib/capabilities.ts + _shared/capabilities.ts (same-PR rule).
create or replace function public.is_capability_enabled(_org uuid, _capability text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select enabled from public.org_capabilities where org_id = _org and capability = _capability),
    case _capability
      when 'producer_can_invite' then false
      else false
    end
  );
$$;

-- Stamp updated_at + updated_by on every write.
create or replace function public.stamp_org_capability()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger stamp_org_capability before insert or update on public.org_capabilities
  for each row execute function public.stamp_org_capability();

-- Audit into the existing generic settings_audit_log.
create or replace function public.log_org_capability_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.enabled is not distinct from old.enabled then
    return null;
  end if;
  insert into public.settings_audit_log (org_id, key, actor, old_value, new_value)
  values (
    new.org_id,
    'capability:' || new.capability,
    auth.uid(),
    case when tg_op = 'UPDATE' then to_jsonb(old.enabled) else null end,
    to_jsonb(new.enabled)
  );
  return null;
end $$;

create trigger log_org_capability_change after insert or update on public.org_capabilities
  for each row execute function public.log_org_capability_change();
