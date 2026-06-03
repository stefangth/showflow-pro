# Multi-Tenancy Phase 1 — Auth & Org Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Validated **CI-driven** (no local Supabase/Docker/Node): author → push → GitHub Actions (`gh pr checks 73`) is the oracle.

**Goal:** Make the frontend org-aware — `AuthContext` gains `memberships`/`currentOrg`/`switchOrg`, an org switcher in the sidebar, `ProtectedRoute` org-membership gating, invite→accept onboarding, and a "no org" empty state — and finally retire `user_roles`/`has_role` by swapping all role-gating to the per-org `has_org_role`.

**Architecture:** `AuthContext` reads `org_memberships` (not `user_roles`) and derives the active org's `roles`, so `hasRole(r)` keeps its signature and all 13 call sites are untouched. RLS permissive policies swap `has_role → has_org_role(org_id, …)`; the Phase-0 bootstrap fallback + `user_roles` are removed once nothing reads them. Onboarding becomes invite-only via an `accept_invitation` SECURITY DEFINER RPC.

**Tech Stack:** React 18 + Vite + TS, @tanstack/react-query, Supabase RLS + pgTAP, Vitest (`src/test/supabaseFake.ts` fake client + `fixtures.ts`), Deno edge tests.

**Spec:** `docs/superpowers/specs/2026-06-03-multi-tenancy-design.md` §6 (onboarding), §5 (security). **Builds on:** Phase 0 (`docs/superpowers/plans/2026-06-03-multi-tenancy-phase-0-foundation.md`) — merged/green on PR #73.

---

## Sub-iterations (each its own CI-green push on PR #73 → `dev`)

| # | Delivers | CI gate | Risk |
|---|----------|---------|------|
| **1A** | `types.ts` regen; `src/data/orgs.ts` + tests; `AuthContext` org context (`memberships`/`currentOrg`/`switchOrg`, `roles` derived from active org); `rolesForOrg` pure helper. **Additive — app still works on the bootstrap org.** | Vitest + Lint (tsc on new types) + pgTAP unchanged | Low |
| **1B** | Migration: permissive policies `has_role→has_org_role`; `accept_invitation` RPC; `is_chat_participant` org-aware; remove bootstrap fallback + column DEFAULTs; **drop `user_roles`/`has_role`**. Update edge `_shared/auth.ts` `requireRole` + `SettingsPage` read to `org_memberships`. Migrate the **9 pgTAP fixtures** (Phase-0 deferral) + edge Deno tests. | pgTAP (rewritten policies + isolation still green) + Deno + Vitest | **High** — the coupled retirement |
| **1C** | `OrgSwitcher` component + `AppLayout` slot; `ProtectedRoute` org-membership check; `NoOrgScreen` empty state; `InviteAcceptPage` + route; `LoginPage` org redirect. | Vitest + Lint | Medium |
| **1D** | Update Playwright e2e for invite-based onboarding. | **Not run on a `dev` PR** (e2e is `main`-only) — validated only when this targets `main`. Flagged, not silently skipped. | Medium |

**Order matters:** 1A makes `AuthContext` stop reading `user_roles` *before* 1B drops it. 1B must land all of its coupled changes together or the app/edge/tests break.

---

## Prerequisite: regenerate `types.ts` against the preview branch

The new tables exist on the PR's Supabase **preview branch** (ref `xqpehqtenhqyefimfpca`), not the main project. Regenerate from there (never hand-edit):

- [ ] **Step P1:** via the Supabase MCP, call `generate_typescript_types` with the **preview branch** project ref, write the result to `src/integrations/supabase/types.ts`. Confirm it now contains `organizations`, `org_memberships`, `org_invitations`, `platform_admins`, and `org_id` on the tenant tables.
- [ ] **Step P2:** `git diff --stat src/integrations/supabase/types.ts` shows additions only (no hand edits).

---

## Task 1A.1: `src/data/orgs.ts` — fetch the signed-in user's memberships

**Files:** Create `src/data/orgs.ts`; Create `src/data/orgs.test.ts`; Modify `src/test/fixtures.ts`.

- [ ] **Step 1: Add fixtures** (`src/test/fixtures.ts`) — append builders:

```typescript
type OrgRow = Database["public"]["Tables"]["organizations"]["Row"];
type MembershipRow = Database["public"]["Tables"]["org_memberships"]["Row"];

export function anOrganization(overrides: Partial<OrgRow> = {}): OrgRow {
  return { id: id("org"), name: "Test Org", slug: id("slug"), status: "active",
           created_by: null, created_at: ISO, updated_at: ISO, ...overrides };
}
export function aMembership(overrides: Partial<MembershipRow> = {}): MembershipRow {
  return { id: id("mem"), org_id: id("org"), user_id: id("user"),
           role: "producer", created_at: ISO, ...overrides };
}
```

- [ ] **Step 2: Write the failing test** (`src/data/orgs.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchMyMemberships } from "./orgs";

describe("fetchMyMemberships", () => {
  it("queries org_memberships by user_id and returns rows with the joined org", async () => {
    const rows = [{ org_id: "o1", role: "admin",
                    organizations: { id: "o1", name: "Cirque", slug: "cirque", status: "active" } }];
    const fake = createFakeSupabase({ org_memberships: { data: rows, error: null } });
    const result = await fetchMyMemberships(fake as never, "u1");
    expect(result).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "org_memberships", method: "eq", args: ["user_id", "u1"] });
  });

  it("returns [] when the user has no memberships", async () => {
    const fake = createFakeSupabase({ org_memberships: { data: [], error: null } });
    expect(await fetchMyMemberships(fake as never, "u1")).toEqual([]);
  });

  it("throws on query error", async () => {
    const fake = createFakeSupabase({ org_memberships: { data: null, error: { message: "boom" } } });
    await expect(fetchMyMemberships(fake as never, "u1")).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — `npm test -- src/data/orgs.test.ts` (or via CI). Expected: "Cannot find module './orgs'".

- [ ] **Step 4: Implement** (`src/data/orgs.ts`):

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface Membership {
  org_id: string;
  role: Database["public"]["Enums"]["app_role"];
  organizations: { id: string; name: string; slug: string; status: string } | null;
}

/** All org memberships for an auth user, with the joined organization. */
export async function fetchMyMemberships(
  client: SupabaseClient<Database>, userId: string,
): Promise<Membership[]> {
  const { data, error } = await client
    .from("org_memberships")
    .select("org_id, role, organizations ( id, name, slug, status )")
    .eq("user_id", userId);
  if (error) throw error;
  return (data as unknown as Membership[] | null) ?? [];
}
```

- [ ] **Step 5: Run, expect PASS.** Commit: `feat(p1): org memberships data-access`.

---

## Task 1A.2: `rolesForOrg` pure helper + tests

**Files:** Create `src/features/auth/orgRoles.ts`; Create `src/features/auth/orgRoles.test.ts`.

- [ ] **Step 1: Failing test** (`src/features/auth/orgRoles.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { rolesForOrg, type Membership } from "./orgRoles";

const M = (org_id: string, role: string): Membership => ({ org_id, role } as Membership);

describe("rolesForOrg", () => {
  it("returns the roles the user holds in the given org", () => {
    expect(rolesForOrg([M("o1","admin"), M("o1","producer"), M("o2","artist")], "o1"))
      .toEqual(["admin","producer"]);
  });
  it("returns [] for an org the user is not in", () => {
    expect(rolesForOrg([M("o1","admin")], "o2")).toEqual([]);
  });
  it("returns [] when org is null", () => {
    expect(rolesForOrg([M("o1","admin")], null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (`src/features/auth/orgRoles.ts`):

```typescript
import type { AppRole } from "@/config/app.config";
export interface Membership { org_id: string; role: AppRole; }

/** The roles a user holds within one org (empty if org is null/absent). */
export function rolesForOrg(memberships: Membership[], orgId: string | null): AppRole[] {
  if (!orgId) return [];
  return memberships.filter(m => m.org_id === orgId).map(m => m.role);
}
```

- [ ] **Step 4: Run, expect PASS.** Commit: `feat(p1): rolesForOrg helper`.

---

## Task 1A.3: wire org context into `AuthContext`

**Files:** Modify `src/features/auth/AuthContext.tsx`.

Replace the `fetchRoles` flow (line ~72-78) with a memberships flow; add `currentOrgId` state (persisted), derive `roles` via `rolesForOrg`, expose `memberships`/`currentOrg`/`orgs`/`switchOrg`. `hasRole` is unchanged (still reads `roles`, now the active org's).

- [ ] **Step 1:** Add to the context type + provider:
  - state: `const [memberships, setMemberships] = useState<Membership[]>([])`
  - state: `const [currentOrgId, setCurrentOrgId] = useState<string | null>(() => localStorage.getItem('showflow.currentOrg'))`
  - `const orgs = useMemo(() => dedupeOrgs(memberships), [memberships])`
  - `const currentOrg = orgs.find(o => o.id === currentOrgId) ?? orgs[0] ?? null`
  - derive: `const roles = rolesForOrg(memberships, currentOrg?.id ?? null)` (remove the old `roles` state/`fetchRoles`)
  - `switchOrg(id)`: `setCurrentOrgId(id); localStorage.setItem('showflow.currentOrg', id); queryClient.invalidateQueries()`
- [ ] **Step 2:** Replace `fetchRoles(userId)` with `fetchMemberships(userId)` calling `fetchMyMemberships(supabase, userId)` → `setMemberships(...)`; default `currentOrgId` to first membership's org if unset.
- [ ] **Step 3:** Export `memberships`, `currentOrg`, `orgs`, `switchOrg` on the context value and interface.
- [ ] **Step 4 (test):** the role-derivation is covered by 1A.2; `fetchMyMemberships` by 1A.1. Add a thin test only if a `dedupeOrgs` helper is introduced — extract & test it like `rolesForOrg`.
- [ ] **Step 5:** `npm run lint && npm test` green locally-equivalent via CI. Commit: `feat(p1): org context in AuthContext`.

**Push → confirm CI green (Vitest + Lint + pgTAP unchanged) before 1B.**

---

## Task 1B (outline — detail just-in-time when 1A is green)

Single migration `..._org_role_gating.sql` + coupled code:
1. **Rewrite permissive policies** `has_role(auth.uid(), R)` → `has_org_role(auth.uid(), org_id, R)` per tenant table (catalog-driven: drop the old permissive policies, recreate from a per-table config that mirrors today's semantics — bookings artist-own, blocked_dates self+staff, audit staff-read, chats participant via the now-org-aware `is_chat_participant`).
2. **`accept_invitation(token)`** SECURITY DEFINER RPC (model on `decide_user_approval`, but `GRANT EXECUTE TO authenticated`): validate token+expiry+pending, insert `org_memberships`, mark invite accepted, link the producer-created `artists` row for that org if present. Atomic.
3. **`is_chat_participant`** → org-aware (derive org from `chat → show_date.org_id`, use `has_org_role`).
4. Remove the bootstrap fallback from `is_org_member`; drop the tenant-table `org_id` DEFAULTs; `drop function has_role`; `drop table user_roles`.
5. **Edge:** `_shared/auth.ts` `requireRole` → `org_memberships` (becomes org-scoped — thread org from the request); update `admin-set-role`/`admin-list-users` accordingly; update their Deno tests.
6. **Frontend:** `SettingsPage` `from('user_roles')` → `org_memberships` scoped to current org.
7. **Tests:** migrate the 9 pgTAP fixtures (`user_roles` → `org_memberships`, bootstrap org) — the Phase-0 deferral; the restrictive isolation suite must stay green.

CI gate: pgTAP + Deno + Vitest + Lint.

## Task 1C (outline)
`OrgSwitcher` (shadcn `DropdownMenu`, in `AppLayout` sidebar header); `ProtectedRoute` adds "member of `currentOrg`" gate → else `NoOrgScreen`; `NoOrgScreen` (mirror `PendingApprovalScreen`); `InviteAcceptPage` (reads `?token=`, calls `accept_invitation`, routes in); `LoginPage` post-login org redirect; new `ROUTES.INVITE`/`ROUTES.NO_ORG` + `App.tsx` wiring. Vitest for the switcher + gate.

## Task 1D (outline)
Update `e2e/` specs from signup→approval to invite→accept. **Cannot be CI-validated on a `dev`-targeted PR (e2e is `main`-only).** Either temporarily open a `main`-targeted PR to exercise e2e, or validate at the dev→main promotion. Do not claim e2e coverage on the dev PR.

---

## Self-Review
- **Spec coverage (§6):** AuthContext org context → 1A; invite/accept → 1B(RPC)+1C(page); switcher/empty state/ProtectedRoute → 1C; retire global roles → 1B. ✓
- **`hasRole` signature preserved** (roles derived per active org) → 13 call sites untouched. ✓
- **Coupling guard:** 1A removes the `user_roles` *read* before 1B drops the *table*; 1B bundles policies+edge+frontend+fixtures so nothing half-lands. ✓
- **e2e honesty:** 1D explicitly flagged as not-validated on dev. ✓
- **Placeholders:** 1A fully specified; 1B–1D are outlines to expand JIT (per the agreed per-unit detailing), not placeholders in executable tasks.
