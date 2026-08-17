-- Demo mode Phase 3: read-only public sandbox links (leave-behind).
--
-- A token here grants a public, read-only, expiring VIEW of a demo org, served
-- exclusively by the `sandbox-view` edge function (verify_jwt=false) reading via
-- the service role. There is deliberately NO anon RLS policy: the public read
-- path never touches this table (or any tenant table) through anon RLS. Minting
-- and revoking happen through demo-ops (service-role writes); org members may
-- READ their own org's links to manage them.
--
-- NOTE (deliberate): wipe_demo_org does NOT delete rows here, so a leave-behind
-- link keeps working across a rep's mid-demo Reset until it expires or is
-- revoked. The snapshot is assembled live at view time, so a surviving link just
-- reflects the reseeded data. Org deletion still cascades via the FK below.

create table if not exists public.demo_sandbox_links (
  id uuid primary key default gen_random_uuid(),
  -- pgcrypto-free 64-char token, same idiom as org_invitations.token.
  token text not null unique
    default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  org_id uuid not null references public.organizations(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '14 days',
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists demo_sandbox_links_org_idx on public.demo_sandbox_links(org_id);
create index if not exists demo_sandbox_links_token_idx on public.demo_sandbox_links(token);

alter table public.demo_sandbox_links enable row level security;

-- Org members read their own org's links (to manage/copy/revoke in the UI).
create policy demo_sandbox_links_read on public.demo_sandbox_links
  for select to authenticated
  using (public.is_org_member(auth.uid(), org_id));

-- No authenticated write policy: inserts/updates come only from the service
-- role inside demo-ops. Pooled-tenancy isolation floor (ADR-0003).
create policy org_isolation on public.demo_sandbox_links
  as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));
