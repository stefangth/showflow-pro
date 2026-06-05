# Multi-Tenancy Phase 5 — Self-Service Polish · Design Spec

- **Date:** 2026-06-04
- **Status:** Approved design → ready for implementation planning (`writing-plans`)
- **Topic:** Round out the multi-tenant app with end-user self-service: profile editing, password reset + change, member removal, org-admin resend-invite — and unify the two divergent invite mechanisms left after Phase 4.
- **Relationship to master spec:** Expands §11 *Phase 5* and §8.1 of `docs/superpowers/specs/2026-06-03-multi-tenancy-design.md`. The master spec's locked decisions and isolation model are unchanged; this doc only details the Phase-5 surface and records the four scope decisions made in this brainstorming session.

---

## 1. Problem & goal

Phases 0–4 delivered the multi-tenant core (isolation, auth/switcher, catalogs, backend, platform console) and are merged to `main`. Two classes of everyday self-service are still missing, and one Phase-4 follow-up was explicitly deferred here:

1. **A person cannot manage their own account** — there is no `/profile` page (display name / phone are uneditable in-app) and **no password reset of any kind** (auth is email+password via `signInWithPassword`; there is zero reset/forgot/change code).
2. **An org-admin cannot manage membership** — there is no UI to **remove a member** from an org, and the Invites tab has no **resend** action (only copy-link / revoke).
3. **The invite mechanism is split and can strand users** — `provision-org` bootstraps a net-new first-admin's auth account (Supabase `inviteUserByEmail`), but `create-invitation` (org-admins inviting producers/artists) only sends the branded email and **never creates an account**, so a net-new invitee clicks the link → `/accept-invite` → `/login` → cannot log in. `resend-invitation` re-sends the same dead-end. Flagged in PR #92.

**Goal:** ship the four self-service surfaces and converge invites onto a single branded flow that always gives a net-new user a working password path. The riskiest, cross-cutting piece (invite unification) reuses the password-set page built for goal (1), so the two compose.

---

## 2. Locked decisions (this session, 2026-06-04)

| # | Question | Decision |
|---|----------|----------|
| 1 | Avatar editing on `/profile` | **Defer** — edit **display name + phone only**; avatars stay colored-initial fallbacks. No Supabase Storage in this phase. |
| 2 | Password scope | **Both** — logged-out forgot-password round-trip (`/reset-password`) **and** in-app change-password on the profile page. |
| 3 | Invite mechanisms | **Unify now** — one branded `org-invitation` flow; net-new accounts bootstrapped server-side; drop the parallel native-invite path. |
| 4 | Member removal reach | **Org-admin Members tab + platform-console parity** — both surfaces, one shared RPC. |

**Folded-in cleanups** (Phase-4 deferred nits): `window.confirm` → shadcn `AlertDialog`; `as never` → `as unknown as Json` in `PlatformDefaultsTab`; slug/email **format validation** on the invite/provision paths.

**Reset email branding:** the forgot-password email uses **Supabase's built-in recovery email** (configured via `redirectTo`); a branded recovery template is **optional, later** (out of scope).

---

## 3. Profile — `/profile`

A first-class data-access surface for the global `profiles` row (there is none today; profile reads are ad-hoc in `ChatPanel` / `data/orgs.ts`).

- **Data access** — new `src/data/profiles.ts`:
  - `fetchMyProfile(client, userId)` → the caller's `profiles` row (`display_name`, `phone`, `email`, `avatar_url` read-only).
  - `updateMyProfile(client, userId, { display_name, phone })` → updates only the two editable columns.
- **Hook** — thin `useMyProfile()` wrapper (passes the `supabase` singleton + `user.id`). Query key **`['profile', userId]`**; the update mutation invalidates **`['profile']`** (prefix).
- **Page** — `src/pages/ProfilePage.tsx`, default export. `react-hook-form` + `zod`, shadcn `Card` / `Input` / `Button`. One card = identity (display name, phone; email shown read-only). A second card = **change password** (§4).
- **Wiring** — register `ROUTES.PROFILE` in `App.tsx` inside `ProtectedRoute` (any authenticated member; no role gate); add a **user-menu link** in `AppLayout` (the existing avatar/sign-out cluster). On display-name save, refresh AuthContext's cached profile so the sidebar updates immediately.
- **RLS** — relies on the existing `"Users can update own profile"` policy (`USING (auth.uid() = user_id)`, verified present). No schema change.

---

## 4. Password — `/reset-password` (request + set) and in-app change

### 4.1 `/reset-password` — public, two modes, one page
`src/pages/ResetPasswordPage.tsx`, registered in `App.tsx` **outside** `ProtectedRoute` (logged-out users must reach it, like `/accept-invite`).

- **Request mode** — default when visited cold, and the target of a new **"Forgot password?"** link on `LoginPage`. Email field → `supabase.auth.resetPasswordForEmail(email, { redirectTo: <origin>/reset-password })`. Confirmation toast; no account-existence disclosure.
- **Set mode** — entered when the page loads inside an **auth redirect session**: either a `PASSWORD_RECOVERY` event (recovery flow) **or** an invite-link session (the §5 unified flow, link `type: 'invite'`). New-password + confirm form → `supabase.auth.updateUser({ password })`.
  - Honors a **`?redirect=`** query param: on success, navigate there instead of the default. This is the hook the unified invite flow chains through (`/reset-password?redirect=/accept-invite?token=…`).
  - Mode detection is driven by `onAuthStateChange` / `getSession()` (recovery or invite session present → set mode; otherwise request mode). Exact event handling is pinned in the plan.

### 4.2 In-app change-password (profile page)
- Fields: current password, new, confirm.
- **Verify the current password first** with a throwaway `supabase.auth.signInWithPassword({ email, password: current })` check (Supabase's `updateUser` does **not** validate the old password), then `updateUser({ password: new })`. Surface errors via `toast.error`.

---

## 5. Invite unification

### 5.1 Chosen approach — one branded email; net-new accounts bootstrapped via `generateLink`
- **Shared helper** `supabase/functions/_shared/invitations.ts` → `deliverOrgInvitation(deps, { email, orgName, role, token, inviterEmail, appOrigin, idempotencyKey })`:
  1. **Existence check** — paginated `admin.auth.admin.listUsers({ page, perPage: 200 })` loop (extracted from `provision-org`, which already does this correctly).
  2. **Net-new** → `admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: <appOrigin>/reset-password?redirect=<urlencoded /accept-invite?token=…> } })`. This **creates the auth account and returns an `action_link` without sending Supabase's own email**. The branded email's CTA uses that `action_link`.
  3. **Existing** → branded email with the plain `<appOrigin>/accept-invite?token=…` link (the user already has a password and can log in).
  4. Always send **one** `org-invitation` template via `deps.sendEmail`. The template gains an **optional `actionLink`** field: when present (net-new) the CTA uses it; when absent it falls back to building the accept URL from `token` — **backward-compatible** with existing sends.
- **Callers** — `provision-org`, `create-invitation`, and `resend-invitation` all call `deliverOrgInvitation`. **`inviteUserByEmail` is removed** from `provision-org`. `create-invitation` thereby gains the net-new bootstrap it lacked; `resend-invitation` re-mints a working link for a previously-stranded invitee.
- **End-to-end (net-new):** branded email → click `action_link` → Supabase establishes an invite session → lands on `/reset-password` (set mode) → user sets a password → auto-continues to `/accept-invite?token=…` → existing `accept_invitation` RPC writes the membership. The strand is structurally gone.

### 5.2 Rejected alternative
Copy `inviteUserByEmail` into `create-invitation` too (mirror `provision-org`'s branch). Least code, but it does **not** unify: Supabase's unbranded native invite email coexists with the branded one, and net-new users get Supabase's hosted set-password UX instead of ours. Fails the "unify" goal.

### 5.3 Notes
- `generateLink` is the project's first use of Supabase's "custom email with your own template" pattern; the action link carries the session in the URL hash, parsed by supabase-js (`detectSessionInUrl`).
- Existing-user magic-link login (nicer one-click) is **not** built — YAGNI; existing users log in normally.

---

## 6. Member removal

### 6.1 Two `SECURITY DEFINER` RPCs (mirror the proven Phase-4 `remove_platform_admin` pattern)
- **`list_org_members(p_org uuid)`** → rows `{ user_id, email, display_name, roles app_role[] }`. Guard: `has_org_role(auth.uid(), p_org, 'admin')` (admin-only; the helper already short-circuits on `is_super_admin`, so super-admins pass too — member management is an admin surface). An RPC (not a raw client `org_memberships ⨝ profiles` query) to (a) aggregate a user's multiple role rows into one `roles[]` and (b) expose a single guarded surface both org-admins and super-admins call. (`profiles` is authenticated-readable via `USING (true)`; the RPC reads `auth.users.email` under `SECURITY DEFINER`.)
- **`remove_org_member(p_org uuid, p_user uuid)`** → deletes the `(p_org, p_user)` membership row(s). Guard: `has_org_role(auth.uid(), p_org, 'admin') OR is_super_admin(auth.uid())`. Two safety guards:
  - **Last-admin guard** — `lock table org_memberships in share row exclusive mode`, then count remaining admins of `p_org` where `user_id <> p_user`; raise if removal would leave the org with zero admins (the documented race-safe pattern from Phase 4).
  - **Self-removal guard** — raise if `p_user = auth.uid()` (prevents accidental self-lockout; a dedicated "leave org" flow is out of scope).
- **Data semantics:** removal deletes **only** the membership. Org-scoped data (the person's `artists` row, bookings, availability) is **retained** as org data, and `artists.user_id` stays linked, so re-inviting the same person restores their access. No cascade deletes.

### 6.2 Surfaces (both reuse the same data layer)
- **Data access** — `src/data/members.ts`: `fetchOrgMembers(client, orgId)` / `removeOrgMember(client, orgId, userId)`. Hook `useOrgMembers(orgId)`; query key **`['members', orgId]`**; removal mutation invalidates `['members', orgId]`.
- **Org-admin** — a new **Members tab** in `AdminPage` (alongside Invites): lists members with role badges + a guarded **Remove** action (shadcn `AlertDialog` confirm).
- **Platform parity** — an `OrgMembersPopover` per org row in the `/platform` console (sibling to the existing `OrgInvitePopover`), reusing `fetchOrgMembers` / `removeOrgMember`. Super-admins act on any org (the RPC guards short-circuit on `is_super_admin`, but the last-admin guard still applies).

---

## 7. Org-admin resend-invite

Smallest piece. The `resend-invitation` edge function **already authorizes org-admins** (`requireOrgRole(deps, req, invite.org_id, ["admin"])`) — only the UI/data-layer entry point is missing for the org context.

- Add `resendInvitation(client, invitationId)` to `src/data/invitations.ts` (calls the existing `resend-invitation` edge fn — same one the platform console's `data/platform.ts` uses; consolidate to one definition).
- Add a **Resend** button to `InvitesTab` for `status === 'pending'` rows, beside copy-link / revoke. `toast.success` on send.
- With §5 in place, the resent email carries the unified link, so resending now actually unblocks a net-new invitee.

---

## 8. Folded-in cleanups

- **`window.confirm` → shadcn `AlertDialog`** — replace the one occurrence (`PlatformAdminsTab.tsx:45`) and use `AlertDialog` for every new destructive confirm (remove member, revoke invite; and the Phase-4 deferred suspend-org confirm).
- **`as never` → `as unknown as Json`** in `PlatformDefaultsTab`.
- **Slug/email format validation** — server-side in `provision-org` (slug shape) and `create-invitation` (email shape), with matching client `zod` on the forms. Reject early with a 400 + clear message.
- **Skipped (YAGNI):** `platform_org_stats` N+1 — negligible at target scale (50 orgs).

---

## 9. Testing strategy (test-first, per house rules)

| Layer | Tool | Targets |
|---|---|---|
| Unit / data | Vitest + `supabaseFake` | `profiles` fns; `members` fns; `resendInvitation`; change-password verify-then-update helper; form `zod` schemas |
| Edge function | Deno + `makeFakeDeps` | `deliverOrgInvitation` **net-new vs existing** branches (mock `generateLink`/`listUsers`); rewired `provision-org` / `create-invitation` / `resend-invitation`; slug/email validation 400s |
| Database | pgTAP | `remove_org_member` (authz, **last-admin**, **self-removal**); `list_org_members` (shape + membership/super-admin gating) |
| End-to-end | Playwright | profile edit; password-reset round-trip; member removal → access lost; **net-new invite → set password → accept → lands in org** (the unified flow) |

- Tests import the real module (no re-implementation). New edge tests go in `index.di.test.ts` files.
- `makeFakeDeps` is extended with a fake `auth.admin.generateLink` (and the existing `listUsers`) so the unified helper is unit-testable.

---

## 10. Task groups & sequencing (each ends CI-green)

- **A. Profile + in-app change-password** — independent.
- **B. `/reset-password` (request + set) + "Forgot password?" link** — independent; **prerequisite for C** (provides the set-password page the invite flow chains through).
- **C. Invite unification** — after B. `deliverOrgInvitation` helper, net-new `generateLink` + branded `actionLink`, rewire the three edge fns, `/reset-password?redirect=` chaining, drop `inviteUserByEmail`.
- **D. Member removal** — RPCs (`list_org_members`, `remove_org_member`) + `data/members.ts` + org-admin Members tab + platform `OrgMembersPopover`. Independent.
- **E. Org-admin resend-invite** — independent, small.
- **F. Folded cleanups** — `AlertDialog`, `Json` cast, slug/email validation. Independent (some overlap with D/E's confirms).

Build A, B, D, E, F in parallel-friendly order; C lands after B. Work is CI-driven (author → push → PR targeting `dev` → `gh pr checks` is the oracle), matching Phases 2–4.

---

## 11. Out of scope

- **Avatar upload / Supabase Storage** — deferred (decision #1).
- **Branded recovery email** — Supabase's built-in recovery email is used; a React-Email recovery template can layer on later.
- **"Leave org" self-service** (a member removing *their own* membership) — the self-removal guard blocks it here; a separate flow if wanted.
- **`NoOrgScreen` flash / AuthContext fetch parallelization** — **stretch, not committed** (touches the auth hot path); include only if cheap during F.
- **Producer show-date creation UI** — a domain feature, not multi-tenancy (master spec §13).

---

## 12. Risks & notes

- **`generateLink('invite')` session handling** — the invite link returns the session in the URL hash; `/reset-password` set-mode must detect both recovery (`PASSWORD_RECOVERY`) and invite (`SIGNED_IN` with an invite session) arrivals and chain via `?redirect=`. Covered by the e2e net-new-invite test.
- **Denormalized-`org_id` invariants and pooled RLS isolation** are unchanged by this phase; member removal only deletes membership rows and never crosses orgs (RPC is org-scoped + guarded).
- **Accepted-risk god-mode** (master spec §12) is unchanged; platform-console member removal is one more god-mode action, unlogged by the same explicit decision.
