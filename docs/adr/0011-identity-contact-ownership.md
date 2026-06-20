# ADR-0011: Identity vs. booking-contact ownership (profiles vs artists)

**Status:** Accepted · Amended 2026-06-20 (see Amendment below)
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

- Account identity: `profiles.display_name`, personal `profiles.phone`, login email
  `auth.users.email`. (`profiles.avatar_url` was dropped — see Amendment 2026-06-20.)
- Talent record: `artists.name` (talent label), `artists.email`/`artists.phone` (booking contact),
  `artists.bio`, `artists.status`, `artists.cast_role` (reserved).
- **Reserved column** (`artists.cast_role`) is intentionally retained, not removed.
  (`profiles.avatar_url` was previously reserved here but has since been dropped — see Amendment 2026-06-20.)

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

## Amendment — 2026-06-20

`profiles.avatar_url` has been **dropped** (migration
`20260620120000_drop_avatar_url_and_required_skills.sql`). The avatar-upload feature it was
reserved for is **cancelled**; the column was never written or rendered (greenfield prod), so no
data was lost. Avatars remain deterministic initials/colour (`src/lib/avatar.ts`) with no image
source.

`artists.cast_role` **remains reserved** and is intentionally NOT dropped. The "do not drop
columns" language in the Decision above is narrowed accordingly: it was never an absolute bar, only
a statement that the *then-known* account/booking overlaps were not duplication to collapse.
Dropping a provably dead, **unreserved** column is consistent with that intent; a still-reserved
column (`cast_role`) is not a candidate.
