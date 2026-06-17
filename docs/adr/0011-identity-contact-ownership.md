# ADR-0011: Identity vs. booking-contact ownership (profiles vs artists)

**Status:** Accepted
**Date:** 2026-06-17
**Deciders:** Stefan Schaal

## Context

A person's details live in two tables: the global `profiles` row (one per auth user:
`display_name`, `phone`, `avatar_url`) and the per-org `artists` row (`name`, `email`, `phone`,
`bio`, `cast_role`, `status`; `user_id` is **nullable**). The fields look duplicated, and Phase 5
was framed as "deduplication." Investigation showed: (a) production holds 1 profile and 0 artists —
no data to reconcile; (b) the two tables serve different populations; and (c) the contact fields on
`artists` are **load-bearing** — an unregistered/external artist has no profile, so their
name/email/phone can only live on the artist row. Linking is headless: `accept_invitation` claims an
unregistered artist row by email, setting `artists.user_id`, so at link time `artists.email` equals
`auth.users.email`.

## Decision

**`profiles` owns login-user identity; `artists` owns the org-scoped bookable talent record and its
booking contact. We do not merge the tables and do not drop columns.** The overlap is two different
real-world contacts (account vs. booking), not duplication to be collapsed.

- Account identity: `profiles.display_name`, personal `profiles.phone`, `profiles.avatar_url`
  (reserved), login email `auth.users.email`.
- Talent record: `artists.name` (talent label), `artists.email`/`artists.phone` (booking contact),
  `artists.bio`, `artists.status`, `artists.cast_role` (reserved).
- **Reserved columns** (`cast_role`, `avatar_url`) are intentionally retained, not removed.

**Resolution rule (registered artist, `user_id` set):** account identity wins for *the person* —
specifically, the offer/confirmation digests address them at their login email first
(`coalesce(auth.users.email, artists.email)`) and greet them by `display_name` (falling back to the
talent label). Unregistered artists are unaffected (`artists.*` only). The talent label
(`artists.name`) remains canonical on talent surfaces.

The rule lives in one pure module, `supabase/functions/_shared/identity.ts` (re-exported to
`src/lib/identity.ts`). The digests resolve login contacts via the service-role-only
`resolve_user_contacts(uuid[])` function; the frontend "Linked account" panel reuses the admin-only
`list_org_members`, keeping login-email PII at the existing admin boundary.

## Consequences

**Easier:** a documented model that won't be "fixed" by a merge; digests reach registered artists at
their verified login email and no longer silently drop an artist whose booking email is blank; the
admin can see the effective digest recipient on the artist sheet.

**Harder:** a registered artist's `artists.name` and `display_name` can differ (by design); the panel
is a best-effort mirror of the digest (it can't show the login email if the membership was removed
while the artist row stayed linked — see the Phase 5 spec §10).

**Revisit if:** unregistered artists need richer contact than `artists.*` provides, or a unified
cross-org person view is required.
