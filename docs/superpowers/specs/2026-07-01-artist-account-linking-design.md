# Artist ↔ account linking & status — design

**Date:** 2026-07-01
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Initiative:** Artist onboarding — spec **A of 2** (companion: `2026-07-01-artist-bulk-import-design.md`, which builds on this)

## Context

Producers/admins asked for two things: a way to **give an artist a login from the artist
surface**, and a way to **see at a glance whether an artist has an account**. Today both are
possible only indirectly.

Onboarding is deliberately invite-only — no public signup (ADR-0005). User accounts are created
from `Admin → Invites` (`InvitesTab`), a surface **separate from the artist catalog**. An artist
becomes a registered user through a **passive email match**: at invite acceptance the
`accept_invitation` RPC runs `UPDATE artists SET user_id = … WHERE lower(email) = lower(invite.email)`.
So the operator's real path is: create the artist in `Artists` → go to `Admin → Invites` → invite
the same email → hope the emails match. There is no way to invite straight from an artist, no
explicit link, and the link silently fails if the person logs in under a different email or the
artist row has no email.

Whether an artist has an account is already knowable (`artists.user_id`), and `LinkedAccountPanel`
surfaces "Registered / Unregistered — external" — but only inside the profile sheet, never on the
cards, and it can't distinguish "invited but not yet accepted" from "never invited".

### Current state (verified)

- **Artist creation** is an admin-only "Add Artist" dialog on `src/pages/ArtistsPage.tsx`
  (gated `hasRole('admin')`). `createArtist` inserts `name` (required), `email`, `phone`, `bio`,
  `org_id`; `user_id` is left `null` → an unregistered/external artist.
- **Artist cards** render on `src/pages/ArtistsPage.tsx` (~lines 224–270): avatar, name, email,
  status badge, skills, cast tags. **No account info.**
- **`artists` schema** (`src/integrations/supabase/types.ts` ~212–261): `id`, `name`, `email`
  (booking contact, may differ from login), `phone`, `bio`, `cast_role`, `status`, `user_id`
  (nullable FK → `auth.users`), `org_id`. Partial unique index `artists(org_id, user_id) WHERE
  user_id IS NOT NULL` → one registered artist per user per org; many unregistered (all `user_id
  NULL`) allowed.
- **`accept_invitation(p_token)`** (`supabase/migrations/20260603130000_accept_invitation_rpc.sql`):
  validates token (pending, unexpired, email match), inserts `org_memberships (org_id,user_id,role)`
  `ON CONFLICT DO NOTHING`, then the passive artist claim (`user_id IS NULL AND lower(email)` match),
  then marks the invitation accepted.
- **`create-invitation`** (`supabase/functions/create-invitation/index.ts`): body `{ org_id, email,
  role, app_origin }`; `requireOrgRole(org_id, ['admin'])`; inserts `org_invitations (org_id, email,
  role, invited_by)` (token/status/`expires_at`=+14d default); best-effort email via
  `deliverOrgInvitation`. **No `artist_id`, no name field.**
- **`org_invitations` schema** (types.ts ~813–859): `id, org_id, email, role, token, status
  ('pending'|'accepted'|'revoked'), invited_by, expires_at, accepted_at, created_at`. **No
  `artist_id`.** Reads are admin-scoped.
- **`resend-invitation`** edge function already exists (re-sends an existing row's email).
- **`LinkedAccountPanel`** (`src/components/artists/LinkedAccountPanel.tsx`, used by
  `ArtistProfileSheet.tsx` ~242–248): binary "Registered / Unregistered — external"; admins see
  account name + login email (via `list_org_members`, admin-guarded `src/data/members.ts`);
  producers see the badge only (PII boundary, ADR-0011).
- **`app_role`** enum: `admin | producer | artist`.
- **Identity split (ADR-0011):** `profiles` owns account identity (login email, display name);
  `artists` owns the org-scoped talent record + booking contact. `_shared/identity.ts`
  (`resolveContactEmail`) prefers login email, falls back to booking email.

## Goals

1. **Invite an artist to an app login from the artist surface** — both at creation (a checkbox in
   the Add-Artist dialog) and later (an "Invite to app" action on existing unregistered artists).
2. **Deterministic artist↔account link** via an explicit FK stamped on the invitation, replacing
   reliance on fuzzy email matching (with an email fallback kept for legacy/Admin-tab invites).
3. **Three-state account status on artist cards** — Active · Invited · No account — with one
   unified vocabulary shared with `LinkedAccountPanel`, visible to producers as non-PII status.

## Non-goals (explicitly out of scope)

- A manual "link this artist to an arbitrary existing account" picker (only invite-time linking).
- Changing invite-only / no-signup onboarding.
- A role picker on the artist invite — inviting from an artist is **always** role `artist`.
- Bulk-inviting many artists at once — that synergy lives in spec B (which reuses this plumbing).
- Capturing a name on the invitation (`artists.name` already carries it).

## Decisions (made during brainstorm)

- **Add `org_invitations.artist_id uuid NULL`** → FK `artists(id) ON DELETE SET NULL`, indexed.
- **`accept_invitation` links by `artist_id` when present**, else keeps the existing email match.
- **`create-invitation` accepts optional `artist_id`**, validates it (same org, `user_id IS NULL`),
  and forces `role = 'artist'` when present.
- **New `list_pending_invited_artists(p_org)` RPC** — org-member-guarded (not admin-only) so
  producers can see status without seeing invitation PII; returns only artist ids with a live
  pending invite (id-stamped **or** legacy email-matched).
- **Unify the account-status vocabulary** to Active · Invited · No account across the card chip and
  `LinkedAccountPanel`; **optimistic** flip to "Invited" right after sending.

## Design

### A. Data model — one migration

- `alter table public.org_invitations add column artist_id uuid references public.artists(id) on delete set null;`
- `create index org_invitations_artist_id_idx on public.org_invitations(artist_id) where artist_id is not null;`
- No new RLS policies: `artist_id` is covered by the existing row-level org scoping /
  `org_isolation` on `org_invitations`. Add the column to any explicit insert/select column lists
  in code paths that enumerate columns.

Applied via the Supabase MCP `apply_migration` (records real-timestamp version names); name the
file to match. pgTAP runs in CI only.

### B. `accept_invitation` — amend (deterministic link + guard)

Replace the single passive claim with:

```
if v_inv.artist_id is not null then
    update public.artists a
       set user_id = v_uid
     where a.id = v_inv.artist_id
       and a.org_id = v_inv.org_id
       and a.user_id is null;          -- guard: never re-claim
else
    update public.artists a            -- legacy / Admin-tab invites (unchanged)
       set user_id = v_uid
     where a.org_id = v_inv.org_id
       and a.user_id is null
       and lower(a.email) = lower(v_inv.email);
end if;
```

**Guard rationale:** the `WHERE a.user_id IS NULL` clause keeps accept idempotent and avoids
tripping the `artists(org_id, user_id)` partial-unique index if the accepting user already owns an
artist in this org — in that case the claim simply no-ops and the membership still gets created.
Signature/return unchanged. Recreate with the same grants as the current function.

### C. `create-invitation` — amend (optional `artist_id`)

- Accept optional `artist_id` in the body.
- When present: fetch the artist with the **service client**; reject (`400`) if it doesn't exist,
  belongs to another `org_id`, or already has `user_id` set ("That artist already has an account").
  Force `role = 'artist'`.
- Insert `artist_id` onto the `org_invitations` row. Everything else — `requireOrgRole(org_id,
  ['admin'])`, token/expiry defaults, `deliverOrgInvitation` best-effort send — is unchanged.
- DI-testable via the existing `handle(req, deps)` + `makeFakeDeps` pattern.

### D. `list_pending_invited_artists(p_org uuid) returns setof uuid` — new RPC

- `SECURITY DEFINER`, guarded by `is_org_member(auth.uid(), p_org)` (super-admins pass via the
  usual short-circuit). `revoke all from public, anon; grant execute to authenticated`.
- Returns the **distinct artist ids** in `p_org` that have a **live** pending invite
  (`status = 'pending' AND expires_at > now()`), resolving both:
  - id-stamped invites: `i.artist_id`, and
  - legacy invites (`i.artist_id IS NULL`): map `lower(i.email) = lower(a.email)` to `a.id`.
- Exposes only ids (non-PII status) — never emails/login — so producers can consume it without
  crossing the ADR-0011 PII boundary. "Active" needs no RPC (it's `artists.user_id`); this RPC only
  resolves the *invited vs none* split.

### E. Frontend — three-state status chip (shared)

- **Pure helper** `src/lib/artistAccount.ts` → `artistAccountState(artist, pendingSet: Set<string>)`
  returning `'active' | 'invited' | 'none'`: `active` if `artist.user_id`, else `invited` if
  `pendingSet.has(artist.id)`, else `none`. Plus a small presentational map (label + dot token) so
  the chip renders identically wherever it's used.
- **Card chip** on `ArtistsPage.tsx`: a quiet dot + label (Active account / Invite pending / No
  account) using semantic tokens (`--text-success` / `--text-warning` / `--text-muted`). No loud
  badge. Detail (invited age / expiry) in a tooltip.
- **`LinkedAccountPanel`** adopts the same helper + vocabulary, replacing "Registered / Unregistered
  — external" so the language is identical app-wide. Admin-only account details are untouched.

### F. Frontend — "Also send an app-login invite" in Add Artist

- A checkbox in the existing Add-Artist dialog. **Progressive disclosure:** when checked, reveal a
  one-line helper ("They'll get an email to set a password and join as an artist") and make **email
  required** with inline zod validation.
- Flow: insert artist → take the returned `id` → call `create-invitation` with `{ artist_id, email,
  role: 'artist' }`. **Partial-success handling:** if the artist insert succeeds but the invite send
  fails, keep the artist and show a warning toast ("Artist created, but the invite couldn't be sent
  — retry from the artist"). Never roll back a valid artist.
- Admin-only (Add Artist already is).

### G. Frontend — "Invite to app" for existing artists

- **Primary home:** `LinkedAccountPanel` in the profile sheet — for `none` state show an **Invite to
  app** button; for `invited` show **Invited · Resend** (reusing the `resend-invitation` path) with
  relative age.
- **Card convenience:** an inline **Invite** affordance on `none`-state cards so the common case
  doesn't require opening the sheet. Both admin-only.
- **Email handling:** prefill from `artists.email`, editable (login email may legitimately differ —
  the `artist_id` FK makes that safe); if the artist has no email, require entry. **Do not**
  overwrite the artist's booking email.
- **Optimistic** transition to "Invited" on success; invalidate the pending-invites query + the
  invitations list so both the chip and `InvitesTab` reflect it.

### H. Data-access + hooks

- `src/data/invitations.ts`: extend the create-invitation caller to accept optional `artistId`; add
  a thin `inviteArtistToApp(client, { orgId, artistId, email })` that calls it with `role: 'artist'`.
- `src/data/artists.ts`: `fetchPendingInvitedArtistIds(client, orgId)` → `rpc(
  'list_pending_invited_artists', { p_org: orgId })` returning `string[]`.
- Hook `usePendingInvitedArtists(orgId)` (query key `['artists','pending-invites', orgId]`),
  consumed by `ArtistsPage` to build the `pendingSet`. Invitation mutations invalidate that key and
  the existing invitations query.

### I. Testing (test-first; the five layers)

- **Unit (vitest + `src/test/supabaseFake.ts`):** `artistAccountState` truth table (active/invited/
  none, and active wins even if a stale pending id is present); `inviteArtistToApp` /
  `fetchPendingInvitedArtistIds` emit the right RPC/function name + args; Add-Artist checkbox gates
  email; card renders the correct chip per state (via `renderWithProviders`).
- **pgTAP (CI):** `accept_invitation` links by `artist_id`; **skips** (no error) when the user
  already owns an artist; legacy email path still works; `list_pending_invited_artists` returns
  id-stamped + email-matched ids, excludes expired/accepted/revoked, and is rejected for
  non-members.
- **Edge (Deno DI, `--node-modules-dir=none`):** `create-invitation` stamps + validates `artist_id`
  (rejects cross-org / already-registered), forces role `artist`, and the legacy no-`artist_id`
  path is unchanged. Run the whole `supabase/functions/` suite after.
- **E2E (optional):** create artist with "send invite" → invitee accepts → artist shows Active.

## Files touched

**New**
- `supabase/migrations/<ts>_org_invitations_artist_id.sql`
- `supabase/migrations/<ts>_list_pending_invited_artists.sql`
- `supabase/migrations/<ts>_accept_invitation_artist_link.sql` (recreate `accept_invitation`)
- `src/lib/artistAccount.ts` (+ test)
- `supabase/tests/*` pgTAP for the RPC + `accept_invitation` changes

**Modified**
- `supabase/functions/create-invitation/index.ts` (+ Deno test)
- `src/data/invitations.ts`, `src/data/artists.ts` (+ tests)
- `src/pages/ArtistsPage.tsx` (chip + inline invite + Add-Artist checkbox)
- `src/components/artists/LinkedAccountPanel.tsx` (unified vocabulary + Invite/Resend)
- `src/hooks/` (new `usePendingInvitedArtists`)
- `CLAUDE.md` (note `create-invitation` optional `artist_id`; `org_invitations.artist_id`)
- `public/changelog.md` + version bump (see below)

## Edge cases & error handling

- **Already-registered artist:** invite blocked server-side (and the button hidden client-side).
- **Duplicate live invite:** chip shows Invited → **Resend**, never a second row.
- **Expired pending invite:** treated as `none` (RPC filters `expires_at`).
- **Legacy Admin-tab invites:** still surface as "Invited" on the matching artist via the email
  fallback in the RPC.
- **Artist deleted with an open invite:** FK `ON DELETE SET NULL`; the invite reverts to
  email-match behavior on accept.
- **User already owns an artist in the org:** claim no-ops (guard), membership still created.
- **Login email ≠ booking email:** `artist_id` link is authoritative; no email-overwrite.

## Risks & mitigations

- *Changing `accept_invitation` (load-bearing):* keep the email path byte-for-byte for the
  `artist_id IS NULL` branch; add pgTAP for both branches before shipping.
- *Producers seeing invite status:* expose only artist ids via the definer RPC — no emails cross the
  PII boundary; admin-only detail stays in `LinkedAccountPanel`.
- *Vocabulary change in `LinkedAccountPanel`:* drive both surfaces from one helper so they can't
  drift; update any snapshot/text assertions in the same change.

## Versioning

User-facing feature → **MINOR** bump. Update `version` in `package.json` and `APP_META.VERSION` in
`src/config/app.config.ts` to match a new `vX.Y.0` tag; add a newest-first block to
`public/changelog.md` (New/Improved bullets, end-user voice) and regenerate `public/changelog.json`
via `deno run --allow-read --allow-write scripts/changelog-to-json.ts`.
