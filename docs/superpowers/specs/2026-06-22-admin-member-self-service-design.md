# Admin & member self-service — design

**Date:** 2026-06-22
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Initiative:** Self-service — sub-project #3 of 4 (see memory `self-service-initiative.md`)

## Context

The self-service initiative's drivers are **(1) get the operator out of the loop** and
**(2) cut customer support**. Sub-project #1 (show/date CRUD) shipped (PR #118). Sub-project
#2 (onboarding) was resolved as docs-only (stay invite-only). This is **#3: admin & member
self-service** — let org admins manage their own org and members without a super-admin or a
support request.

### Current state (verified)

- **Personal account self-service already exists.** `src/pages/ProfilePage.tsx` edits display
  name + phone (`updateMyProfile`) and changes password in-app (`updateMyPassword`). Account
  *deletion* is a GDPR concern and belongs to sub-project #4 — **out of scope here.**
- **Member listing/removal is solid.** `list_org_members(p_org)` and `remove_org_member(p_org,
  p_user)` (migration `20260604160000_org_member_management.sql`) are admin-guarded
  SECURITY DEFINER RPCs with last-admin + self-removal guards. `MembersTab` uses them.
- **No RPC changes a member's role.** Role edits only happen through the `admin-set-role` edge
  function, called by a `RoleAssignPopover` in AdminPage's **Users** tab.
- **That role path has a multi-tenancy bug.** The Users tab invokes `admin-set-role` **without
  `org_id`** (`src/pages/AdminPage.tsx:237`), so the function defaults to `BOOTSTRAP_ORG_ID`
  (`supabase/functions/admin-set-role/index.ts:25`) even though the user *list* is correctly
  org-scoped. For a real org admin this fails closed (`requireOrgRole(bootstrap,…)` → 403) or,
  for a bootstrap/super-admin, mutates the wrong org. Either way it's broken, not exploitable.
- **Two overlapping member surfaces.** AdminPage has both a **Members** tab (org-scoped,
  remove-only) and a **Users** tab (IAM list via `admin-list-users` + the buggy role popover).
- **Org rename is super-admin-only.** `organizations_write` RLS is
  `using(is_super_admin) with check(is_super_admin)` — org admins cannot rename their own org,
  and no `rename_org` RPC exists. `EditOrgDialog` (platform console) is super-admin-only.
- **`admin-list-users` must stay.** It is used by the editor's "view as user" feature
  (`src/features/editor/EditorToolbar.tsx:30`), not only the Users tab.
- **`admin-set-role` is only called by the Users-tab popover** — retiring the Users-tab role
  UI makes it dead.
- **Settings is gated `['admin','producer']`** (`src/App.tsx:52`) — producers can open Settings,
  so a new Organization tab must be admin-gated *inside* the page.
- **`AuthContext` derives `orgs` from `memberships` via `useState`** (no React Query, no exposed
  refresh; `src/features/auth/AuthContext.tsx`), so a rename won't update the topbar switcher
  until reload unless we add a refresh.

## Goals

1. Org admins can **rename their own org** (name only) without a super-admin.
2. Org admins can **change a member's roles inline** in the org-scoped Members tab, via a
   correctly-scoped, guarded path (fixing the bootstrap-org bug).
3. **One coherent member surface** — fold the Users tab's unique info into Members and remove
   the duplicate.

## Non-goals (explicitly out of scope)

- **Slug rename by admins** — slug is the org's stable identifier; renaming it risks breaking
  external references. Stays super-admin-only (`EditOrgDialog` / `updateOrg`).
- **Account deletion, data export, notification preferences** — sub-project #4 (GDPR).
- **Inviting members** — already exists (`Admin → Invites`, `InvitesTab`).
- Changing how super-admins manage orgs (the platform console is untouched).

## Decisions (made during brainstorm)

- **Name-only org rename** for admins; slug stays super-admin-only.
- **New `set_org_member_role` RPC** (consistent with `list_org_members`/`remove_org_member`),
  replacing the `admin-set-role` edge function as the role-change path.
- **Retire `admin-set-role`** (edge function + its Deno tests) once unused.
- **Keep `admin-list-users`** (editor dependency).
- **Consolidate to one Members tab**: enrich `list_org_members` with `last_sign_in_at`, then
  remove the Users tab entirely.

## Design

### A. Backend — 3 RPCs (SECURITY DEFINER, `has_org_role(auth.uid(), p_org, 'admin')`-guarded)

`has_org_role` short-circuits on `is_super_admin`, so super-admins keep god-mode on all three.

**1. `rename_org(p_org uuid, p_name text) returns void`**
- Guard: org admin. Validate `btrim(p_name) <> ''` else `22023`.
- `update public.organizations set name = btrim(p_name) where id = p_org;` (never touches slug;
  the existing `update_organizations_updated_at` trigger bumps `updated_at`).
- `revoke all from public, anon; grant execute to authenticated`.

**2. `set_org_member_role(p_org uuid, p_user uuid, p_role app_role, p_action text) returns void`**
- Guard: org admin. Validate `p_action in ('add','remove')` else `22023`.
- `add`: `insert into org_memberships (org_id,user_id,role) values (...) on conflict
  (org_id,user_id,role) do nothing` (unique constraint confirmed in the bootstrap migration).
- `remove`: `lock table org_memberships in share row exclusive mode`, then mirror
  `remove_org_member`'s race-safe **last-admin guard** — if `p_role='admin'` and the delete
  would leave zero distinct admins (counting `user_id <> p_user`), raise `42501`. This also
  blocks self-demotion that would orphan the org. Then delete the matching `(org,user,role)` row.
- `revoke all from public, anon; grant execute to authenticated`.

**3. `list_org_members(p_org)` — drop + recreate adding `last_sign_in_at`**
- Postgres can't `create or replace` a function with a changed `returns table` signature, so
  `drop function if exists public.list_org_members(uuid);` then recreate returning
  `(user_id, email, display_name, roles, last_sign_in_at)`, selecting `u.last_sign_in_at` (auth.
  users already joined) and adding it to `group by`. Re-apply the revoke/grant.

Migrations are applied via the Supabase MCP `apply_migration` (records real-timestamp
versions); name the files to match. pgTAP tests run in CI only.

### B. Frontend surfaces

**New `src/components/settings/OrganizationTab.tsx` (admin-only):**
- `react-hook-form` + `zod` (name required). Prefilled from `currentOrg.name`.
- **Slug rendered read-only** with a "contact support to change" hint.
- Submit → `renameOrg(supabase, currentOrg.id, name)` → on success call `refreshOrgs()` +
  `toast.success`.
- Wired into `SettingsPage` as a new tab, with the trigger + content rendered only when
  `hasRole('admin')` (producers don't see it).

**`src/components/admin/MembersTab.tsx` — single member surface:**
- Keep the list (display name, email, role badges) and Remove (existing `useRemoveOrgMember`).
- Add an inline **role editor** per member: a popover of `admin/producer/artist` checkboxes
  (a user can hold multiple roles → multi-toggle, not single-select), each toggle calling
  `setOrgMemberRole(orgId, userId, role, has ? 'remove' : 'add')`. Reuse the existing
  `RoleAssignPopover` interaction pattern (moved out of AdminPage).
- Show **last sign-in** per member (from the enriched RPC).
- On mutation success, invalidate the `useOrgMembers` query; surface RPC errors (last-admin,
  forbidden) via `toast.error`. Disable editing your own roles where it would self-lock (UI
  hint; the DB guard is the source of truth).

### C. Consolidation
- Remove AdminPage's **Users** tab: its `TabsTrigger`/`TabsContent`, the `RoleAssignPopover`,
  the `iamUsers` query (`admin-list-users` call), and now-unused imports.
- Keep the `admin-list-users` edge function (editor still uses it).
- **Retire `admin-set-role`**: delete `supabase/functions/admin-set-role/` and its Deno tests;
  update the "Edge functions → Admin ops" bullet in `CLAUDE.md`.

### D. Data-access + state
- `src/data/orgs.ts`: `renameOrg(client, orgId, name)` → `rpc('rename_org', …)`.
- `src/data/members.ts`: `setOrgMemberRole(client, orgId, userId, role, action)` →
  `rpc('set_org_member_role', …)`; add `last_sign_in_at: string | null` to `OrgMember`.
- `src/features/auth/AuthContext.tsx`: extract the existing memberships loader into a stable
  callback and expose `refreshOrgs()` on the context value (behavior otherwise unchanged), so a
  rename updates the topbar switcher without a reload.

### E. Testing (test-first; the five layers)
- **Unit (vitest + `src/test/supabaseFake.ts`)**: `renameOrg` and `setOrgMemberRole` produce the
  right RPC name/args; `OrganizationTab` (render, validation, submit) and `MembersTab` role
  toggle via `renderWithProviders`. Bug regression: the role mutation passes the **current org
  id**, never the bootstrap id.
- **pgTAP (CI)**: `rename_org` rejects non-admins, enforces non-empty, leaves slug untouched;
  `set_org_member_role` add/remove works, rejects non-admins, and the last-admin guard blocks
  the final admin's removal/self-demotion; `list_org_members` returns `last_sign_in_at`.
- **Edge functions**: delete the `admin-set-role` Deno tests with the function. Run the full
  `supabase/functions/` Deno suite afterward to confirm no dangling references.
- **E2E (optional)**: an admin renames the org and flips a member's role.

## Files touched

**New**
- `supabase/migrations/<ts>_rename_org.sql`
- `supabase/migrations/<ts>_set_org_member_role.sql`
- `supabase/migrations/<ts>_list_org_members_last_sign_in.sql`
- `src/components/settings/OrganizationTab.tsx` (+ test)
- `supabase/tests/*` pgTAP for the new/changed RPCs

**Modified**
- `src/data/orgs.ts`, `src/data/members.ts` (+ tests)
- `src/features/auth/AuthContext.tsx` (expose `refreshOrgs`)
- `src/components/admin/MembersTab.tsx` (+ test)
- `src/pages/SettingsPage.tsx` (Organization tab, admin-gated)
- `src/pages/AdminPage.tsx` (remove Users tab + popover + iam query)
- `CLAUDE.md` (edge-fn list: drop `admin-set-role`)

**Deleted**
- `supabase/functions/admin-set-role/` (+ its tests)

## Edge cases & error handling
- **Last admin**: DB guard blocks removing/demoting the final admin (both for others and self);
  UI shows the raised message via toast.
- **Empty org name**: zod (client) + `22023` (RPC).
- **Non-admin / cross-org**: every RPC re-checks `has_org_role`; never trust the client gate.
- **Stale topbar after rename**: `refreshOrgs()` re-pulls memberships.
- **Role array semantics**: roles are additive membership rows; the editor toggles each role
  independently and `on conflict do nothing` makes re-adding idempotent.

## Risks & mitigations
- *Dropping `list_org_members`*: recreate with grants in the same migration; update `OrgMember`
  + callers in the same change so the shape never drifts.
- *Removing the Users tab*: confirm `admin-list-users` stays for the editor; only the tab goes.
- *AuthContext refactor*: pure extraction of the loader — keep `switchOrg`/`loading`/initial
  default behavior identical; covered by existing AuthContext/ProtectedRoute tests.
- *Retiring `admin-set-role`*: grep for all references (src, docs, tests) before deleting; run
  the full Deno suite after.
