# Platform user management console — design

**Date:** 2026-07-23
**Status:** Approved (brainstorm), pending implementation plan
**Scope owner:** super-admin (platform) surface only
**Sub-project of:** Platform IAM. Sibling sub-project (deferred): per-org user-rights capability flags.

---

## 1. Problem & context

### 1.1 The reported bug (root cause, verified against prod)

A super-admin changed "the email associated to an artist account" after issuing a hire order, then
signing in with the new email showed no hire order.

Artist-facing hire-order visibility is enforced by one RLS policy on `hire_orders`:

```
status IN ('issued','countersigned')
AND artist_id IN (SELECT id FROM artists WHERE user_id = auth.uid())
```

Visibility is bound to **`artists.user_id`** (the linked auth account). The email edited in the UI is
`artists.email`, the **booking/contact** field (snapshotted into the order as `recipient_email` at issue
time). Editing it never re-points `user_id`, so it cannot move which login owns the artist.

Confirmed on prod (`epweartpzwvcasrzyueh`): order `HO-2026-0731-1` is correctly attached to artist
"Artist 1", whose linked login is `showflowpro@gmail.com` (the sole `platform_admins` entry) — that
account sees it. The new address `stefanschaal@hotmail.de` is a separate auth user linked to no artist,
so it sees nothing. **No data corruption** — the order is intact; the linkage model has no editing surface.

### 1.2 Capability gaps this exposes

1. No super-admin surface to **re-link an artist to a different auth account** (the durable fix).
2. No cross-org **user roster** or way to **edit user properties** (login email, roles, memberships).
3. The platform console can only **resend/revoke** invites, never **create** one (found while investigating).

### 1.3 Goal

A super-admin **Users** console in the Platform area: list every user across all orgs and manage their
full lifecycle and properties, with server-side guardrails and an audit trail.

---

## 2. Scope

### In scope (v1)
- **Read:** cross-org roster with per-org memberships, roles, artist link, auth metadata (email, created, last sign-in, suspended).
- **Org roles & membership:** change role (admin/producer/artist), add to an org, remove from an org.
- **Artist link:** link / re-point / unlink which `artists` row an account owns, per org (the bug fix).
- **Auth:** change login email (immediate override + notify), send password reset.
- **Lifecycle:** invite a new user into any org; suspend/unsuspend (reversible sign-in block); delete + anonymize (irreversible).

### Non-goals (v1)
- Per-org capability flags (e.g. "producers may invite") — separate sibling sub-project.
- Bulk actions, saved views, CSV export.
- Server-side pagination/search (client-side over a single ≤1000-row fetch is sufficient at current scale).
- Editing artist catalog fields (name/phone/bio) from here — that stays in `ArtistProfileSheet`.
- A public/customer changelog entry (platform-admin actions are not customer-facing, per repo convention).

---

## 3. Architecture

### 3.1 Placement
- New **`Users`** tab in `src/pages/PlatformPage.tsx`, beside Organizations / Platform Admins / Platform Defaults / System Health, gated by the existing `PlatformRoute` (super-admin only).
- New component `src/components/platform/UsersTab.tsx` (master table + filters).
- New component `src/components/platform/UserDetailSheet.tsx` (the right-hand drawer, shadcn `Sheet`).
- New data layer `src/data/platformUsers.ts` + thin hooks in `src/hooks/usePlatformUsers.ts`.

### 3.2 Backend, split by privilege

| Concern | Mechanism | Auth gate |
|---|---|---|
| Roster read (needs `auth.users` email/last-sign-in) | new edge fn `platform-list-users` | `requireSuperAdmin` |
| Role / membership / artist-link writes (DB-only) | new SECURITY DEFINER RPCs | `is_super_admin(auth.uid())` inside each |
| Email / password / suspend / delete (need `auth.admin.*`) | new edge fn `platform-manage-user` | `requireSuperAdmin` |
| Invite a new user into any org | **reuse** `create-invitation` | `requireOrgRole` (already accepts super-admins) |

Rationale: DB-only mutations are cleaner and cheaper as self-guarding RPCs (matching the existing
`list_org_members` / `set_org_member_role` data-layer pattern) and let the last-admin guard live in SQL
next to the data. Auth mutations must run service-role in an edge function. The existing membership RPCs
are **not reusable** — they hard-require `has_org_role(caller, org, 'admin')` and reject cross-org super-admins.

### 3.3 Why not one big edge function
Considered folding all writes into `platform-manage-user`. Rejected: membership/role/link logic is
pure DB work that belongs in guarded RPCs (testable with pgTAP, callable directly from the client), and
mixing it with the auth-admin calls bloats one handler and duplicates the last-admin guard in TS.

---

## 4. Detailed interfaces

### 4.1 `platform-list-users` (edge function, `requireSuperAdmin`)
- Request: `{}` (no params v1).
- Behavior: `auth.admin.listUsers({ perPage: 1000 })`; fetch all `org_memberships` + `organizations(name)`; fetch `artists(id, name, user_id, org_id)`; fetch `profiles(user_id, display_name)` for the display name; assemble per user.
- Response:
```ts
type PlatformUser = {
  id: string; email: string | null;
  created_at: string; last_sign_in_at: string | null;
  display_name: string | null;      // from profiles; falls back to email in the UI
  suspended: boolean;               // derived from the auth user's ban state (banned_until in the future)
  memberships: Array<{
    org_id: string; org_name: string;
    roles: string[];                // e.g. ['admin'] or ['producer','artist']
    artist: { id: string; name: string } | null;  // artist row in THIS org linked to this user
  }>;
};
// -> { users: PlatformUser[] }
```
- If total exceeds 1000, response includes `truncated: true` and the UI shows a banner (no silent cap).

### 4.2 Platform RPCs (SQL, SECURITY DEFINER, `is_super_admin` guarded)
All raise `42501 'Forbidden'` when `not is_super_admin(auth.uid())`.

- `platform_set_membership(p_org uuid, p_user uuid, p_role app_role, p_action text)` — `add`/`remove` a
  role. On `remove` of the last `admin` of the org → raise `'org must keep one admin'`. (Mirrors the
  guard in `set_org_member_role`, minus the org-admin gate, plus the super-admin gate.)
- `platform_remove_membership(p_org uuid, p_user uuid)` — remove all of a user's roles in an org; blocked
  if it would drop the org's last admin.
- `platform_link_artist(p_org uuid, p_user uuid, p_artist_id uuid | null)` — set `artists.user_id`:
  - `p_artist_id` given: verify the artist is in `p_org` and currently unlinked (or linked to `p_user`);
    set its `user_id = p_user`. Detach any other artist row in that org currently pointing at `p_user`
    (a user owns at most one artist per org).
  - `p_artist_id` null: unlink — clear `user_id` on the user's artist row in `p_org`.
  - Writes a `platform_audit_log` row.

### 4.3 `platform-manage-user` (edge function, `requireSuperAdmin`)
Action-dispatched body `{ action, target_user_id, ... }`:

- `change_email { new_email }` — reject if `new_email` already exists in `auth.users`; else
  `auth.admin.updateUserById(target, { email, email_confirm: true })`; send a security-notice email to
  **old and new** addresses via `sendEmail`; audit.
- `send_password_reset {}` — `auth.admin.generateLink({ type: 'recovery' })` (or `resetPasswordForEmail`); audit.
- `suspend {}` / `unsuspend {}` — set/clear a long `ban_duration` via `auth.admin.updateUserById`; block
  self-suspend and suspend-of-last-super-admin; audit.
- `delete {}` — block self-delete and delete-of-last-super-admin; call `anonymize_user(target)` (already
  super-admin-capable) then `auth.admin.deleteUser(target)`; audit.

### 4.4 Reuse: invite new user
Drawer/list "Invite user" action calls existing `createInvitation(client, { orgId, email, role })`
(super-admin picks the target org). Also surface the same create form in `OrgInvitePopover` to close the
resend/revoke-only gap.

### 4.5 New table: `platform_audit_log`
```
id uuid pk default gen_random_uuid()
actor_user_id uuid not null            -- the super-admin
action text not null                   -- 'change_email' | 'set_role' | 'link_artist' | 'delete' | ...
target_user_id uuid
org_id uuid
detail jsonb                           -- { before, after } snapshot
created_at timestamptz not null default now()
```
- RLS: enabled; SELECT/INSERT restricted to super-admins (`is_super_admin(auth.uid())`); no UPDATE/DELETE policy (append-only). No `WITH CHECK (true)`.
- RPCs insert directly (definer); the edge fn inserts via service role.

---

## 5. UX detail

### 5.1 Master table (`UsersTab`)
- Columns: avatar+name (display name from membership/profile fallback to email), email, orgs (chips, "+N" overflow), roles, artist-link indicator, last sign-in, status (Active/Suspended).
- Controls: text search (name/email), Org filter, Role filter, Status filter — all client-side.
- Row click opens `UserDetailSheet`. Suspended rows visually muted.

### 5.2 Detail drawer (`UserDetailSheet`) — validated mock
- **Header:** avatar, display name, login email, status pill, `user_id` (copyable), created + last sign-in.
- **Account:** login email with "Change email"; "Send reset link". (Section flagged as touching Supabase Auth.)
- **Organizations & roles:** one card per org membership — role `Select`, nested **Artist link** row
  (Link / Change / Unlink), Remove-from-org. Plus "Add to an organization".
- **Danger zone:** Suspend (reversible) / Delete & anonymize (irreversible), each behind an `AlertDialog`.
- Every mutating control uses a mutation → `sonner` toast → invalidate `['platform','users']`.

### 5.3 Email-change behavior (decided)
Immediate override (`email_confirm: true`) + security-notice email to **old and new** addresses + audit
entry. Chosen because the whole reason to intervene is a user who cannot self-serve (lock-out / wrong
account); a confirmation link to an inaccessible address would defeat it.

### 5.4 Small clarifying fix
Relabel the artist email input in `ArtistProfileSheet` to **"Booking / contact email"** so it reads
distinctly from the login account (`LinkedAccountPanel` already shows the login email separately). This
is the root of the reported confusion.

---

## 6. Guardrails (all server-side; UI mirrors with confirmations)
- Cannot remove/demote the **last admin of an org** (in `platform_set_membership` / `platform_remove_membership`).
- Cannot suspend, delete, or demote the **last super-admin**; cannot **self-suspend** or **self-delete** (lock-out prevention).
- `change_email` rejects an address already present in `auth.users`.
- Artist link enforces "one artist per (org, user)" and same-org membership of the artist row.
- All mutations append to `platform_audit_log`.

---

## 7. Testing
- **Vitest (`src/data/platformUsers.test.ts`, hooks):** roster assembly, each mutation call shape, via `supabaseFake` — no client mocking.
- **pgTAP (`supabase/tests/`):** RPC guards — non-super-admin rejected; last-admin removal blocked; artist-link one-per-org invariant; audit row written.
- **Deno (`supabase/functions/**`):** `platform-list-users` assembly + super-admin gate; `platform-manage-user` per-action branches (email uniqueness, last-super-admin block, self-action block, delete → anonymize+deleteUser order) via `makeFakeDeps`.
- Follow test-first: failing test before each unit; regression test reproducing §1.1 (artist re-link makes an issued order visible to the newly-linked user).

---

## 8. Data-model / migration checklist
- New migration: `platform_audit_log` table + RLS.
- New migration: `platform_set_membership`, `platform_remove_membership`, `platform_link_artist` RPCs.
- Regenerate `src/integrations/supabase/types.ts` + `supabase/functions/_shared/database.types.ts` mirror (byte-equality tested).
- New `config.toml` blocks: `[functions.platform-list-users]` and `[functions.platform-manage-user]` (both `verify_jwt = true`).
- No entitlement key, no `FEATURE_REGISTRY` change (not a per-org module).

---

## 9. Operational note — the currently stuck order
The reported order is not lost: signing in as `showflowpro@gmail.com` shows it today. If the intent is
for a *different* account to own that artist, the new console's "Link artist" (or, as a one-off before
the console ships, a manual `artists.user_id` re-point) resolves it. No destructive action taken during
diagnosis.

---

## 10. Future (explicitly deferred)
- Per-org capability flags (sibling sub-project) — the console is where any per-user overrides would later surface.
- Server-side search/pagination if the user count outgrows a single 1000-row fetch.
- Surfacing `platform_audit_log` as a viewable activity feed.
