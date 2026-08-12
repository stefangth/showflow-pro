alter table public.org_invitations
  alter column expires_at set default (now() + interval '30 days'),
  add column last_auth_exchange_at timestamptz;

update public.org_invitations
set expires_at = created_at + interval '30 days'
where status = 'pending'
  and expires_at > now()
  and expires_at < created_at + interval '30 days';

create or replace function public.renew_invitation_for_resend(p_id uuid)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare v_expires_at timestamptz := now() + interval '30 days';
begin
  update public.org_invitations
  set expires_at = v_expires_at, last_auth_exchange_at = null
  where id = p_id and status = 'pending';
  if not found then raise exception 'Invitation is not pending'; end if;
  return v_expires_at;
end;
$$;

create or replace function public.claim_invitation_auth_exchange(
  p_token text,
  p_cooldown_seconds integer default 60
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv record;
  v_cooldown_remaining interval;
  v_retry_after_seconds integer;
begin
  select email, status, expires_at, last_auth_exchange_at
  into v_inv
  from public.org_invitations
  where token = p_token
  for update;

  if not found or v_inv.status <> 'pending' or v_inv.expires_at <= now() then
    return jsonb_build_object('status', 'unavailable');
  end if;

  v_cooldown_remaining :=
    v_inv.last_auth_exchange_at
    + make_interval(secs => p_cooldown_seconds)
    - now();

  if v_cooldown_remaining > interval '0 seconds' then
    v_retry_after_seconds := ceil(extract(epoch from v_cooldown_remaining))::integer;
    return jsonb_build_object(
      'status', 'throttled',
      'retry_after_seconds', v_retry_after_seconds
    );
  end if;

  update public.org_invitations
  set last_auth_exchange_at = now()
  where token = p_token;

  return jsonb_build_object('status', 'ok', 'email', v_inv.email);
end;
$$;

create or replace function public.my_has_password()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(length(encrypted_password) > 0, false)
  from auth.users
  where id = auth.uid()
$$;

revoke execute on function public.renew_invitation_for_resend(uuid)
  from public, anon, authenticated;
grant execute on function public.renew_invitation_for_resend(uuid)
  to service_role;

revoke execute on function public.claim_invitation_auth_exchange(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_invitation_auth_exchange(text, integer)
  to service_role;

revoke execute on function public.my_has_password()
  from public, anon, service_role;
grant execute on function public.my_has_password()
  to authenticated;
