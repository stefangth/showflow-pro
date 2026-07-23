-- Plan 3, Phase 1.7 (follow-up): producers must SELECT the artist invitations
-- they may revoke, otherwise the RLS UPDATE (revokeInvitation) has no visible row
-- to match and silently no-ops (Postgres UPDATE ... WHERE requires SELECT
-- visibility). Read is NOT capability-gated (read-only floor); the revoke UPDATE
-- policy is. Scoped to role='artist' so producer invitations stay admin-only.
create policy "Producers view artist invitations" on public.org_invitations for select to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'producer')
    and role = 'artist'::app_role
  );
