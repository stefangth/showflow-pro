-- Phase 0 (1/3): platform layer for multi-tenancy + org-aware security-definer
-- helpers. has_role / user_roles are intentionally KEPT (vestigial) this phase so
-- the still-org-unaware AuthContext keeps working at runtime; they are dropped in
-- Phase 1 once the client reads org_memberships.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','suspended')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger update_organizations_updated_at before update on public.organizations
  for each row execute function public.update_updated_at_column();

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.org_memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (org_id, user_id, role)
);
create index idx_org_memberships_user on public.org_memberships(user_id);
create index idx_org_memberships_org  on public.org_memberships(org_id);

create table public.org_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role app_role not null,
  -- pgcrypto-free token: two uuids' hex, 64 chars.
  token text not null unique
    default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invited_by uuid references auth.users(id),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_org_invitations_org   on public.org_invitations(org_id);
create index idx_org_invitations_email on public.org_invitations(lower(email));

-- ── Helper functions. SECURITY DEFINER so they bypass RLS on their lookup tables,
--    avoiding recursion (same pattern as the existing has_role). ──
create or replace function public.is_super_admin(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = _uid)
$$;

create or replace function public.is_org_member(_uid uuid, _org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin(_uid)
      or exists (select 1 from public.org_memberships where user_id = _uid and org_id = _org)
$$;

create or replace function public.has_org_role(_uid uuid, _org uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin(_uid)
      or exists (select 1 from public.org_memberships
                 where user_id = _uid and org_id = _org and role = _role)
$$;

-- ── RLS on the platform tables ──
alter table public.organizations  enable row level security;
alter table public.platform_admins enable row level security;
alter table public.org_memberships enable row level security;
alter table public.org_invitations enable row level security;

create policy organizations_read on public.organizations for select to authenticated
  using ( public.is_org_member(auth.uid(), id) );
create policy organizations_write on public.organizations for all to authenticated
  using ( public.is_super_admin(auth.uid()) ) with check ( public.is_super_admin(auth.uid()) );

create policy platform_admins_super on public.platform_admins for all to authenticated
  using ( public.is_super_admin(auth.uid()) ) with check ( public.is_super_admin(auth.uid()) );

create policy org_memberships_read on public.org_memberships for select to authenticated
  using ( public.is_org_member(auth.uid(), org_id) );
create policy org_memberships_write on public.org_memberships for all to authenticated
  using ( public.has_org_role(auth.uid(), org_id, 'admin') )
  with check ( public.has_org_role(auth.uid(), org_id, 'admin') );

create policy org_invitations_rw on public.org_invitations for all to authenticated
  using ( public.has_org_role(auth.uid(), org_id, 'admin') )
  with check ( public.has_org_role(auth.uid(), org_id, 'admin') );
