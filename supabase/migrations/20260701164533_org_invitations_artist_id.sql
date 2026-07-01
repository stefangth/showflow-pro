-- Spec A: deterministic artist<->account link. Stamp the target artist onto the
-- invitation so accept_invitation can claim the exact row (email match kept as a
-- legacy fallback). ON DELETE SET NULL -> a deleted artist reverts the invite to
-- the email-match path. No new RLS: artist_id is covered by the existing row-level
-- org scoping / org_isolation on org_invitations.
alter table public.org_invitations
  add column if not exists artist_id uuid
  references public.artists(id) on delete set null;

create index if not exists org_invitations_artist_id_idx
  on public.org_invitations(artist_id)
  where artist_id is not null;
