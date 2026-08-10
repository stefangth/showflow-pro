-- Track invitation resends so multiple admins can see WHEN (and how often) an invite was last
-- resent, instead of the signal vanishing with the toast. resend-invitation stamps these via
-- mark_invitation_resent AFTER a successful send (service-role only; the edge function authorizes
-- the caller first). resent_count defaults to 0 for existing rows; last_resent_at stays null until
-- the first resend.
alter table public.org_invitations
  add column if not exists last_resent_at timestamptz,
  add column if not exists resent_count integer not null default 0;

-- Atomic bump (avoids a read-modify-write race when two admins resend the same invite at once).
create or replace function public.mark_invitation_resent(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.org_invitations
     set last_resent_at = now(),
         resent_count = resent_count + 1
   where id = p_id;
$$;
revoke all on function public.mark_invitation_resent(uuid) from public, anon, authenticated;
grant execute on function public.mark_invitation_resent(uuid) to service_role;
