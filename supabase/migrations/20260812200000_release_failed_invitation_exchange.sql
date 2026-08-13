-- Return the exact cooldown stamp with a successful invitation exchange claim. The
-- Edge Function uses it for a compare-and-clear rollback when the downstream Auth
-- action-link mint fails, so a transient external failure does not lock the invitee
-- out while a newer claim can never be accidentally cleared.
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
  v_claimed_at timestamptz := now();
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
  set last_auth_exchange_at = v_claimed_at
  where token = p_token;

  return jsonb_build_object(
    'status', 'ok',
    'email', v_inv.email,
    'claimed_at', v_claimed_at
  );
end;
$$;
