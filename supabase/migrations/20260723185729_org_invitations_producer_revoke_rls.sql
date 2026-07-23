-- Plan 3, Phase 1.7: producer revoke arm on org_invitations.
-- Keeps org_invitations_rw (admin FOR ALL) intact; ADDS a narrow producer UPDATE
-- policy for revoking ARTIST invitations only, gated on producer_can_manage_invitations.
-- (Producers read pending invites via list_pending_invited_artists RPC, not a
-- direct SELECT, so no read policy is added.)
create policy "Producers revoke artist invitations" on public.org_invitations for update to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'producer')
    and role = 'artist'::app_role
    and public.is_capability_enabled(org_id, 'producer_can_manage_invitations')
  )
  with check (
    public.has_org_role(auth.uid(), org_id, 'producer')
    and role = 'artist'::app_role
    and public.is_capability_enabled(org_id, 'producer_can_manage_invitations')
  );
