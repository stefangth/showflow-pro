-- Per-email cooldown for server-minted auth links (magic-link login + re-invite).
-- Auth infrastructure, keyed by email, NOT org-scoped and NOT tenant data.
create table public.auth_link_throttle (
  email        text        primary key,
  last_sent_at timestamptz not null default now()
);

alter table public.auth_link_throttle enable row level security;
-- No policies for anon/authenticated: written/read ONLY by the service-role edge
-- function (bypasses RLS) via the RPC below. RLS-enabled + zero policies = deny-all.
-- No RESTRICTIVE org_isolation policy: there is no org_id; it is not tenant data.

-- Explicit grants: newer Supabase CLI strips implicit table grants on fresh local stacks.
revoke all on public.auth_link_throttle from anon, authenticated;
grant all on public.auth_link_throttle to service_role;

-- Atomic claim: returns true and stamps last_sent_at when the cooldown has elapsed
-- (or no row exists), false when still within the window. Also prunes stale rows.
create or replace function public.claim_login_link_slot(
  p_email text,
  p_cooldown_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now   timestamptz := now();
  -- Prune horizon = LARGER of one day or the cooldown, so raising the cooldown never
  -- prunes a row still inside its cooldown window.
  v_prune interval := greatest(interval '1 day', make_interval(secs => p_cooldown_seconds));
  v_claimed boolean;
begin
  delete from public.auth_link_throttle where last_sent_at < v_now - v_prune;

  insert into public.auth_link_throttle as t (email, last_sent_at)
  values (lower(p_email), v_now)
  on conflict (email) do update
    set last_sent_at = v_now
    where t.last_sent_at < v_now - make_interval(secs => p_cooldown_seconds)
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

-- Revoke from PUBLIC (functions grant EXECUTE to PUBLIC by default; revoking from
-- anon/authenticated alone would leave that inherited grant intact). Only the service
-- role may call it (the public send-login-link handler uses deps.admin).
revoke all on function public.claim_login_link_slot(text, int) from public, anon, authenticated;
grant execute on function public.claim_login_link_slot(text, int) to service_role;
