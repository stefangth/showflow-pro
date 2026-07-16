# Entitlements Platform Implementation Plan (Hire Orders initiative, PR ①)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Git safety:** never run `git reset --hard`, `git checkout -- .`, or any history-destroying command. Commit early and often on the current branch.

**Goal:** Per-org feature entitlements ("modules") toggled by super-admins from the Platform console, gating `booking_flow` (grandfathered on) and `hire_orders` (default off), enforced in UI, edge functions, and SQL, with non-breaking fallback semantics.

**Architecture:** A dual-home pure registry (`src/lib/entitlements.ts` ↔ `supabase/functions/_shared/entitlements.ts`, same pattern as `bookingFlow.ts`), a super-admin-writable `org_entitlements` table with an `is_feature_enabled()` SQL twin, and thin wrappers at the three existing resolution funnels (`fetchBookingFlow`, `resolveBookingFlow`, trigger-time `get_org_setting`) so a disabled org degrades to classic defaults instead of breaking.

**Tech Stack:** Postgres/RLS (Supabase), Deno edge functions with DI (`_shared/deps.ts`), React 18 + TanStack Query v5, shadcn/ui, vitest + supabaseFake, pgTAP, Deno test, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-17-hire-orders-design.md` §1 (read it before starting).

## Global Constraints

- TDD everywhere; tests import the real module (never re-implement logic in tests).
- Local runnables: `deno test --allow-all --node-modules-dir=none supabase/functions/` only. vitest, pgTAP, and eslint run in CI — author the tests first anyway, commit, and let CI gate. Never claim they pass locally.
- Migrations: apply via the Supabase MCP `apply_migration` (never hand-edit `supabase/migrations/` or run the CLI); the MCP records a real-timestamp version — name the committed file to match it. Regenerate `src/integrations/supabase/types.ts` via MCP `generate_typescript_types` after DDL; never hand-edit it.
- New tables: RLS enabled, explicit policies, plus the RESTRICTIVE `org_isolation` template.
- Frontend data access lives in `src/data/<domain>.ts` as `fetchX(client, args)`/`mutateX(client, args)`; hooks are thin wrappers; test with `src/test/supabaseFake.ts`.
- Edge functions: `handle(req, deps)` + `realDeps()`; shared helpers from `_shared/http.ts`, `_shared/auth.ts`, `_shared/settings.ts`. Run the WHOLE `supabase/functions/` Deno suite after any edge change.
- No em-dashes or en-dashes in any user-facing copy (UI strings, emails, changelog). Use period/comma/colon.
- Commit messages: imperative, lowercase, ≤72 chars.
- Semantic styling tokens only; `accent-50..900` never takes Tailwind opacity modifiers.
- The dual-home rule: `src/lib/entitlements.ts` and `supabase/functions/_shared/entitlements.ts` must change in the same commit whenever registry content changes (same rule as `bookingFlow.ts`, see its header comment).
- Feature defaults are the single most load-bearing values in this PR: `booking_flow` → `true` (grandfather every existing org, zero deploy-time behavior change), `hire_orders` → `false` (ships dark).

## File structure (what gets created/modified)

```
src/lib/entitlements.ts                                  (new; pure registry + resolvers)
src/lib/entitlements.test.ts                             (new)
supabase/functions/_shared/entitlements.ts               (new; mirror + requireFeature + gated resolveBookingFlow helper)
supabase/functions/_shared/entitlements.test.ts          (new; deno)
supabase/migrations/<ts>_org_entitlements.sql            (new; table + RLS + is_feature_enabled + audit trigger)
supabase/migrations/<ts>_booking_flow_entitlement_gate.sql (new; get_effective_booking_flow + 4 call-site swaps)
supabase/tests/org_entitlements.sql                      (new; pgTAP — match existing naming in supabase/tests/)
src/data/entitlements.ts                                 (new; fetchEntitlements)
src/data/entitlements.test.ts                            (new)
src/data/platform.ts                                     (modify; setOrgEntitlement, fetchAllOrgEntitlements)
src/data/settings.ts:61-66                               (modify; gate fetchBookingFlow)
src/hooks/useEntitlements.ts                             (new; useEntitlements + useFeature)
src/components/layout/navItems.ts                        (modify; NavItem.feature + visibleNavItems)
src/components/layout/AppLayout.tsx:82                   (modify; thread enabledFeatures into ctx)
src/features/auth/ProtectedRoute.tsx                     (modify; route feature gate)
src/pages/FeatureDisabledScreen.tsx                      (new)
src/config/app.config.ts                                 (modify; ROUTE_FEATURES map; delete dead FEATURES object)
src/components/settings/bookingFlow/BookingFlowTab.tsx   (modify; locked state)
src/components/platform/EditOrgDialog.tsx                (modify; Modules section)
src/components/platform/OrganizationsTab.tsx             (modify; module chips)
src/components/platform/PlatformDefaultsTab.tsx          (modify; default-modules card)
supabase/functions/provision-org/index.ts                (modify; seed entitlement rows)
docs/system-map.md + src/data/systemMap.ts               (modify; get_effective_booking_flow note)
e2e/…                                                    (new spec; entitlement toggle)
```

---

### Task 1: Entitlements registry (dual-home pure module)

**Files:**
- Create: `src/lib/entitlements.ts`
- Create: `src/lib/entitlements.test.ts`
- Create: `supabase/functions/_shared/entitlements.ts` (mirror of the pure part; edge-only helpers arrive in Task 6)
- Create: `supabase/functions/_shared/entitlements.test.ts`

**Interfaces:**
- Produces: `FeatureKey = "booking_flow" | "hire_orders"`, `FEATURE_REGISTRY: Record<FeatureKey, FeatureDef>`, `FEATURE_KEYS: FeatureKey[]`, `EntitlementRow = { feature: string; enabled: boolean }`, `enabledFeatures(rows: EntitlementRow[]): Set<FeatureKey>`, `isFeatureEnabled(rows: EntitlementRow[], feature: FeatureKey): boolean`. Later tasks (4, 6, 7) import exactly these names.

- [ ] **Step 1: Write the failing vitest**

```ts
// src/lib/entitlements.test.ts
import { describe, expect, it } from "vitest";
import { FEATURE_KEYS, FEATURE_REGISTRY, enabledFeatures, isFeatureEnabled } from "./entitlements";

describe("entitlements registry", () => {
  it("registers booking_flow default-on and hire_orders default-off", () => {
    expect(FEATURE_REGISTRY.booking_flow.defaultEnabled).toBe(true);
    expect(FEATURE_REGISTRY.hire_orders.defaultEnabled).toBe(false);
    expect(FEATURE_KEYS).toEqual(["booking_flow", "hire_orders"]);
  });
  it("falls back to registry defaults when no row exists", () => {
    expect(enabledFeatures([])).toEqual(new Set(["booking_flow"]));
  });
  it("row wins over default in both directions", () => {
    const rows = [
      { feature: "booking_flow", enabled: false },
      { feature: "hire_orders", enabled: true },
    ];
    expect(isFeatureEnabled(rows, "booking_flow")).toBe(false);
    expect(isFeatureEnabled(rows, "hire_orders")).toBe(true);
  });
  it("ignores unknown feature rows", () => {
    expect(enabledFeatures([{ feature: "mystery", enabled: true }])).toEqual(new Set(["booking_flow"]));
  });
});
```

- [ ] **Step 2: Implement the module**

```ts
// src/lib/entitlements.ts
// Per-org feature entitlements ("modules"). Pure logic only, no DB access.
// MIRROR: supabase/functions/_shared/entitlements.ts carries the same
// registry + resolvers (the two runtimes cannot share an import). Change
// both files in the same commit. SQL twin: public.is_feature_enabled().

export type FeatureKey = "booking_flow" | "hire_orders";

export interface FeatureDef {
  key: FeatureKey;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

export const FEATURE_REGISTRY: Record<FeatureKey, FeatureDef> = {
  booking_flow: {
    key: "booking_flow",
    label: "Booking flow",
    description: "Configurable offer, escalation and confirmation automation.",
    defaultEnabled: true,
  },
  hire_orders: {
    key: "hire_orders",
    label: "Hire orders",
    description: "PDF engagement sheets with delivery and countersignature.",
    defaultEnabled: false,
  },
};

export const FEATURE_KEYS = Object.keys(FEATURE_REGISTRY) as FeatureKey[];

export interface EntitlementRow {
  feature: string;
  enabled: boolean;
}

export function enabledFeatures(rows: EntitlementRow[]): Set<FeatureKey> {
  const byKey = new Map(rows.map((r) => [r.feature, r.enabled]));
  return new Set(FEATURE_KEYS.filter((k) => byKey.get(k) ?? FEATURE_REGISTRY[k].defaultEnabled));
}

export function isFeatureEnabled(rows: EntitlementRow[], feature: FeatureKey): boolean {
  return enabledFeatures(rows).has(feature);
}
```

- [ ] **Step 3: Create the edge mirror + Deno test**

Copy the file verbatim to `supabase/functions/_shared/entitlements.ts` (add the mirror header comment pointing back at `src/lib/entitlements.ts`). Port the same four test cases to `supabase/functions/_shared/entitlements.test.ts` using `Deno.test` + `assertEquals` from the std assert import used by the sibling `_shared/*.test.ts` files (copy the exact import line from `_shared/settings.test.ts` or nearest).

- [ ] **Step 4: Run the Deno suite locally**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS (all existing tests + 4 new). vitest verifies in CI.

- [ ] **Step 5: Commit**

```bash
git add src/lib/entitlements.ts src/lib/entitlements.test.ts supabase/functions/_shared/entitlements.ts supabase/functions/_shared/entitlements.test.ts
git commit -m "add dual-home entitlements registry"
```

---

### Task 2: `org_entitlements` table, `is_feature_enabled()`, audit trigger

**Files:**
- Create: `supabase/migrations/<real-ts>_org_entitlements.sql` (name = version the MCP records)
- Create: `supabase/tests/org_entitlements.sql` (pgTAP; match the naming style of existing files in `supabase/tests/` before creating)

**Interfaces:**
- Produces: table `public.org_entitlements(org_id, feature, enabled, updated_by, updated_at)`; function `public.is_feature_enabled(_org uuid, _feature text) returns boolean`; audit rows in `settings_audit_log` with `key = 'entitlement:<feature>'`. Tasks 3-9 and the hire-orders plans consume these exact names.

- [ ] **Step 1: Write the failing pgTAP test**

Read one existing file in `supabase/tests/` first and copy its preamble (extension setup, `begin;`/`select plan(n);` style, helper users/orgs seeding). Then assert:

```sql
-- supabase/tests/org_entitlements.sql (structure; adapt preamble from existing tests)
-- plan(10)
-- 1. table exists with PK (org_id, feature)
select has_table('public', 'org_entitlements', 'org_entitlements exists');
select col_is_pk('public', 'org_entitlements', array['org_id','feature'], 'composite pk');
-- 2. defaults: no row => booking_flow true, hire_orders false
select is(public.is_feature_enabled(:org_a, 'booking_flow'), true,  'booking_flow default on');
select is(public.is_feature_enabled(:org_a, 'hire_orders'),  false, 'hire_orders default off');
-- 3. row wins over default
insert into public.org_entitlements (org_id, feature, enabled) values (:org_a, 'hire_orders', true);
select is(public.is_feature_enabled(:org_a, 'hire_orders'), true, 'explicit row wins');
-- 4. RLS: org member can SELECT own org rows; cannot INSERT/UPDATE
--    (set local role/jwt claims per the existing tests' authenticated-user helper)
-- 5. RLS: member of org B cannot SELECT org A rows (org_isolation)
-- 6. super-admin (platform_admins row) can INSERT/UPDATE
-- 7. update writes a settings_audit_log row with key 'entitlement:hire_orders'
update public.org_entitlements set enabled = false where org_id = :org_a and feature = 'hire_orders';
select is(
  (select count(*)::int from public.settings_audit_log where org_id = :org_a and key = 'entitlement:hire_orders'),
  2, 'insert + update both audited');
```

- [ ] **Step 2: Write and apply the migration**

Apply via MCP `apply_migration` with name `org_entitlements`:

```sql
create table public.org_entitlements (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  feature    text not null,
  enabled    boolean not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, feature)
);

alter table public.org_entitlements enable row level security;

create policy "Members can view org entitlements"
  on public.org_entitlements for select to authenticated
  using (public.is_org_member(auth.uid(), org_id));

create policy "Super admins manage entitlements"
  on public.org_entitlements for all to authenticated
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

create policy org_isolation on public.org_entitlements
  as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));

-- Registry twin. Defaults MUST mirror FEATURE_REGISTRY in
-- src/lib/entitlements.ts + _shared/entitlements.ts (same-PR rule).
create or replace function public.is_feature_enabled(_org uuid, _feature text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select enabled from public.org_entitlements where org_id = _org and feature = _feature),
    case _feature
      when 'booking_flow' then true
      when 'hire_orders'  then false
      else false
    end
  );
$$;

-- Stamp updated_at + updated_by on every write.
create or replace function public.stamp_org_entitlement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger stamp_org_entitlement before insert or update on public.org_entitlements
  for each row execute function public.stamp_org_entitlement();

-- Audit into the existing generic settings_audit_log (20260714103537).
create or replace function public.log_org_entitlement_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.enabled is not distinct from old.enabled then
    return null;
  end if;
  insert into public.settings_audit_log (org_id, key, actor, old_value, new_value)
  values (
    new.org_id,
    'entitlement:' || new.feature,
    auth.uid(),
    case when tg_op = 'UPDATE' then to_jsonb(old.enabled) else null end,
    to_jsonb(new.enabled)
  );
  return null;
end $$;

create trigger log_org_entitlement_change after insert or update on public.org_entitlements
  for each row execute function public.log_org_entitlement_change();
```

Save the applied SQL to `supabase/migrations/<recorded-version>_org_entitlements.sql`.

- [ ] **Step 3: Regenerate types**

MCP `generate_typescript_types` → overwrite `src/integrations/supabase/types.ts`. Verify `org_entitlements` appears.

- [ ] **Step 4: Commit (pgTAP verifies in CI)**

```bash
git add supabase/migrations/*_org_entitlements.sql supabase/tests/org_entitlements.sql src/integrations/supabase/types.ts
git commit -m "add org_entitlements table, is_feature_enabled, audit trigger"
```

---

### Task 3: Booking-flow SQL gating (`get_effective_booking_flow` + call-site swaps)

**Files:**
- Create: `supabase/migrations/<real-ts>_booking_flow_entitlement_gate.sql`
- Modify: `supabase/tests/org_entitlements.sql` (extend) or a sibling pgTAP file
- Modify: `docs/system-map.md`, `src/data/systemMap.ts`

**Interfaces:**
- Produces: `public.get_effective_booking_flow(_org uuid) returns jsonb` — returns the org's `booking_flow` setting when entitled, else `NULL` (so `normalize` paths fall back to classic defaults). All trigger-time booking-flow reads go through it from now on.

- [ ] **Step 1: Inventory the call sites**

Run: `grep -rn "get_org_setting(.*'booking_flow'" supabase/migrations/`
Expected four hits (current definitions): `20260714105906_understudy_promotion_flow_gates.sql:53`, `20260715130100_skill_aware_understudy_promotion.sql:30`, `20260714182625_booking_flow_review_hardening.sql:168`, `:291`. For each hit, identify the enclosing `create or replace function` and copy its FULL current body (the newest definition wins if a function was redefined across migrations — check with a second grep on the function name).

- [ ] **Step 2: Write the failing pgTAP assertions**

```sql
-- get_effective_booking_flow: entitled org passes through the setting
select is(public.get_effective_booking_flow(:org_a), (select value from app_settings where org_id = :org_a and key = 'booking_flow'), 'entitled org gets its config');
-- disabled org gets NULL (=> callers normalize to classic defaults)
insert into public.org_entitlements (org_id, feature, enabled) values (:org_a, 'booking_flow', false)
  on conflict (org_id, feature) do update set enabled = false;
select is(public.get_effective_booking_flow(:org_a), null, 'unentitled org falls back');
```

- [ ] **Step 3: Write and apply the migration**

```sql
create or replace function public.get_effective_booking_flow(_org uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case
    when public.is_feature_enabled(_org, 'booking_flow')
      then public.get_org_setting(_org, 'booking_flow')
    else null
  end;
$$;
```

Then, in the same migration, `create or replace` each of the four functions from Step 1 with their current bodies, changing ONLY the expression `public.get_org_setting(<org expr>, 'booking_flow')` → `public.get_effective_booking_flow(<org expr>)`. No other edits. Apply via MCP, save the file with the recorded version name.

- [ ] **Step 4: Update the system map (both homes, same PR rule)**

`docs/system-map.md`: in the triggers section, note that flow-gated triggers resolve config via `get_effective_booking_flow` (entitlement-aware, falls back to classic defaults). `src/data/systemMap.ts`: update the matching node `Rule`/`Cite` fields (cite the new migration).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_booking_flow_entitlement_gate.sql supabase/tests/ docs/system-map.md src/data/systemMap.ts
git commit -m "gate trigger-time booking flow reads on entitlement"
```

---

### Task 4: Frontend data access + hooks

**Files:**
- Create: `src/data/entitlements.ts`, `src/data/entitlements.test.ts`
- Modify: `src/data/platform.ts` (append `setOrgEntitlement`, `fetchAllOrgEntitlements`)
- Create: `src/hooks/useEntitlements.ts`

**Interfaces:**
- Consumes: `EntitlementRow`, `enabledFeatures`, `FEATURE_REGISTRY` from Task 1.
- Produces:
  - `fetchEntitlements(client, orgId: string): Promise<EntitlementRow[]>`
  - `setOrgEntitlement(client, orgId: string, feature: FeatureKey, enabled: boolean): Promise<void>` (upsert)
  - `fetchAllOrgEntitlements(client): Promise<Array<{ org_id: string } & EntitlementRow>>` (platform fleet view)
  - `useEntitlements(): { features: Set<FeatureKey>, isLoading: boolean }` (query key `['entitlements', orgId]`, staleTime 60_000)
  - `useFeature(feature: FeatureKey): boolean` (registry default while loading)

- [ ] **Step 1: Write failing data-access tests with supabaseFake**

```ts
// src/data/entitlements.test.ts
import { describe, expect, it } from "vitest";
import { makeSupabaseFake } from "@/test/supabaseFake"; // copy exact import/name from an existing src/data/*.test.ts
import { fetchEntitlements } from "./entitlements";
import { setOrgEntitlement } from "./platform";

it("fetchEntitlements selects feature+enabled scoped to the org", async () => {
  const fake = makeSupabaseFake({ data: [{ feature: "hire_orders", enabled: true }] });
  const rows = await fetchEntitlements(fake.client, "org-1");
  expect(rows).toEqual([{ feature: "hire_orders", enabled: true }]);
  expect(fake.calls).toContainEqual(expect.objectContaining({ table: "org_entitlements", op: "select" }));
});

it("setOrgEntitlement upserts on (org_id, feature)", async () => {
  const fake = makeSupabaseFake({ data: null });
  await setOrgEntitlement(fake.client, "org-1", "hire_orders", true);
  expect(fake.calls).toContainEqual(expect.objectContaining({ table: "org_entitlements", op: "upsert" }));
});
```

(Adapt the fake's construction/assert helpers to the real `src/test/supabaseFake.ts` API — read it first; do not vi.mock the client.)

- [ ] **Step 2: Implement**

```ts
// src/data/entitlements.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntitlementRow } from "@/lib/entitlements";

export async function fetchEntitlements(client: SupabaseClient, orgId: string): Promise<EntitlementRow[]> {
  const { data, error } = await client
    .from("org_entitlements")
    .select("feature, enabled")
    .eq("org_id", orgId);
  if (error) throw error;
  return data ?? [];
}
```

```ts
// append to src/data/platform.ts
export async function setOrgEntitlement(
  client: SupabaseClient, orgId: string, feature: FeatureKey, enabled: boolean,
): Promise<void> {
  const { error } = await client
    .from("org_entitlements")
    .upsert({ org_id: orgId, feature, enabled }, { onConflict: "org_id,feature" });
  if (error) throw error;
}

export async function fetchAllOrgEntitlements(client: SupabaseClient) {
  const { data, error } = await client.from("org_entitlements").select("org_id, feature, enabled");
  if (error) throw error;
  return data ?? [];
}
```

```ts
// src/hooks/useEntitlements.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext"; // copy exact import path from a sibling hook
import { enabledFeatures, FEATURE_REGISTRY, type FeatureKey } from "@/lib/entitlements";
import { fetchEntitlements } from "@/data/entitlements";

export function useEntitlements() {
  const { currentOrg } = useAuth();
  const q = useQuery({
    queryKey: ["entitlements", currentOrg?.id],
    enabled: !!currentOrg,
    staleTime: 60_000,
    queryFn: () => fetchEntitlements(supabase, currentOrg!.id),
  });
  return { features: enabledFeatures(q.data ?? []), isLoading: q.isLoading };
}

export function useFeature(feature: FeatureKey): boolean {
  const { features, isLoading } = useEntitlements();
  if (isLoading) return FEATURE_REGISTRY[feature].defaultEnabled;
  return features.has(feature);
}
```

- [ ] **Step 3: Commit (vitest in CI)**

```bash
git add src/data/entitlements.ts src/data/entitlements.test.ts src/data/platform.ts src/hooks/useEntitlements.ts
git commit -m "add entitlement data access and hooks"
```

---

### Task 5: Gate the frontend booking-flow funnel

**Files:**
- Modify: `src/data/settings.ts:61-66` (`fetchBookingFlow`)
- Modify: `src/data/settings.test.ts` (or create sibling test file if none)

**Interfaces:**
- Consumes: `is_feature_enabled` RPC (Task 2). The RPC is the single enforcement source; TS never re-implements the default table here.
- Produces: unchanged signature `fetchBookingFlow(client, orgId): Promise<BookingFlow>` — every existing consumer (`useBookingFlow` and its 9 consumer components) is gated for free.

- [ ] **Step 1: Failing test**

```ts
it("returns classic defaults without reading the override when booking_flow is disabled", async () => {
  const fake = makeSupabaseFake({ rpc: { is_feature_enabled: false } });
  const flow = await fetchBookingFlow(fake.client, "org-1");
  expect(flow).toEqual(normalizeBookingFlow(null));
  expect(fake.calls.filter((c) => c.table === "app_settings")).toHaveLength(0);
});

it("resolves the org override when entitled", async () => {
  const fake = makeSupabaseFake({ rpc: { is_feature_enabled: true }, data: [/* app_settings row */] });
  await fetchBookingFlow(fake.client, "org-1");
  expect(fake.calls).toContainEqual(expect.objectContaining({ rpc: "is_feature_enabled" }));
});
```

- [ ] **Step 2: Implement**

```ts
export async function fetchBookingFlow(client: SupabaseClient, orgId: string | null): Promise<BookingFlow> {
  if (orgId) {
    const { data: entitled, error } = await client.rpc("is_feature_enabled", {
      _org: orgId, _feature: "booking_flow",
    });
    if (!error && entitled === false) return normalizeBookingFlow(null);
    // On RPC error fail open to the existing behavior: never let an
    // entitlement hiccup take the booking pipeline down.
  }
  return normalizeBookingFlow(await resolveOrgSetting(client, orgId, "booking_flow", null));
}
```

- [ ] **Step 3: Commit**

```bash
git add src/data/settings.ts src/data/settings.test.ts
git commit -m "gate frontend booking flow resolution on entitlement"
```

---

### Task 6: Edge-side gating (`requireFeature`, gated `resolveBookingFlow`, cron filter)

**Files:**
- Modify: `supabase/functions/_shared/entitlements.ts` (add edge helpers below the mirrored pure part)
- Modify: `supabase/functions/_shared/bookingFlow.ts:100-105` (`resolveBookingFlow`)
- Modify/extend: `supabase/functions/_shared/entitlements.test.ts`, plus the existing `bookingFlow` deno tests

**Interfaces:**
- Consumes: `deps.admin` (`_shared/deps.ts`), `json` from `_shared/http.ts`.
- Produces (used by every hire-orders edge task in the follow-up plans):
  - `checkFeature(admin, orgId: string, feature: FeatureKey): Promise<boolean>` (RPC wrapper, fails CLOSED for `hire_orders`-style new features, i.e. returns false on error)
  - `requireFeature(deps, orgId: string, feature: FeatureKey): Promise<Response | null>` — returns `json({ error: "feature_disabled" }, 403)` or null; MATCH the return contract of `requireOrgRole` in `_shared/auth.ts` exactly (read it first; if it throws instead of returning a Response, mirror that)
  - `filterEntitledOrgs(admin, orgs: {id: string}[], feature: FeatureKey): Promise<{id: string}[]>`

- [ ] **Step 1: Failing Deno tests**

```ts
Deno.test("resolveBookingFlow returns defaults for unentitled org", async () => {
  const deps = makeFakeDeps({ rpcResults: { is_feature_enabled: false } }); // extend makeFakeDeps if rpc faking is missing
  const flow = await resolveBookingFlow(deps.admin, "org-1");
  assertEquals(flow, normalizeBookingFlow(null));
});

Deno.test("requireFeature 403s with feature_disabled", async () => {
  const deps = makeFakeDeps({ rpcResults: { is_feature_enabled: false } });
  const res = await requireFeature(deps, "org-1", "hire_orders");
  assertEquals(res?.status, 403);
});
```

(If `makeFakeDeps` in `_shared/testing.ts` cannot fake `.rpc`, extend it there in this task — that extension is itself test-covered by these tests.)

- [ ] **Step 2: Implement**

```ts
// _shared/entitlements.ts (edge-only section)
export async function checkFeature(admin: SupabaseClient, orgId: string, feature: FeatureKey): Promise<boolean> {
  const { data, error } = await admin.rpc("is_feature_enabled", { _org: orgId, _feature: feature });
  if (error) {
    // booking_flow fails OPEN (never break the live pipeline);
    // everything else fails CLOSED.
    return feature === "booking_flow";
  }
  return data === true;
}

export async function requireFeature(deps: Deps, orgId: string, feature: FeatureKey): Promise<Response | null> {
  return (await checkFeature(deps.admin, orgId, feature)) ? null : json({ error: "feature_disabled" }, 403);
}

export async function filterEntitledOrgs(
  admin: SupabaseClient, orgs: Array<{ id: string }>, feature: FeatureKey,
): Promise<Array<{ id: string }>> {
  const out: Array<{ id: string }> = [];
  for (const org of orgs) if (await checkFeature(admin, org.id, feature)) out.push(org);
  return out;
}
```

In `_shared/bookingFlow.ts`, change `resolveBookingFlow`:

```ts
export async function resolveBookingFlow(admin: SupabaseClient, orgId: string): Promise<BookingFlow> {
  if (!(await checkFeature(admin, orgId, "booking_flow"))) return normalizeBookingFlow(null);
  return normalizeBookingFlow(await resolveOrgSetting(admin, orgId, "booking_flow", null));
}
```

- [ ] **Step 3: Run the WHOLE Deno suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS. The six existing `resolveBookingFlow` consumers (airtable-poll, send-offer-digest, expire-offers, open-offer-tier, send-confirmation-digest, tier-at-risk-watcher) need no code change; their DI tests must still pass (extend fake rpc defaults to `is_feature_enabled: true` in `makeFakeDeps` so existing tests keep their behavior).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/
git commit -m "gate edge booking flow resolution and add requireFeature"
```

---

### Task 7: Nav + route gating, `FeatureDisabledScreen`

**Files:**
- Modify: `src/components/layout/navItems.ts` (NavItem type L8-16, `visibleNavItems` L48-60)
- Modify: `src/components/layout/AppLayout.tsx:82` (ctx)
- Modify: `src/config/app.config.ts` (add `ROUTE_FEATURES`; DELETE the dead `FEATURES` object L6-16 — grep confirmed zero usages)
- Modify: `src/features/auth/ProtectedRoute.tsx` (gate after the suspended check L38-40)
- Create: `src/pages/FeatureDisabledScreen.tsx`
- Test: `src/components/layout/navItems.test.ts` (extend existing if present), `src/features/auth/ProtectedRoute.test.tsx` (extend existing pattern with `renderWithProviders`)

**Interfaces:**
- Consumes: `useEntitlements` (Task 4).
- Produces: `NavItem.feature?: FeatureKey`; `visibleNavItems` ctx gains `enabledFeatures: Set<string>`; `ROUTE_FEATURES: Record<string, FeatureKey>` (empty except future `/hire-orders` entries added in the follow-up plans).

- [ ] **Step 1: Failing tests**

```ts
it("hides items whose feature is not enabled", () => {
  const items = [{ to: "/x", icon: X, label: "X", section: "workspace", feature: "hire_orders" } as NavItem];
  const ctx = { isEditorMode: false, isRealAdmin: false, isSuperAdmin: false, hasRole: () => true, enabledFeatures: new Set<string>() };
  expect(visibleNavItems(items, ctx)).toHaveLength(0);
  expect(visibleNavItems(items, { ...ctx, enabledFeatures: new Set(["hire_orders"]) })).toHaveLength(1);
});
```

ProtectedRoute test: render a route present in `ROUTE_FEATURES` with entitlements mocked empty → expect the FeatureDisabledScreen copy; with `isSuperAdmin` → expect children rendered.

- [ ] **Step 2: Implement**

`navItems.ts`: add `feature?: FeatureKey` to `NavItem`; in `visibleNavItems`, first check `if (item.feature && !ctx.enabledFeatures.has(item.feature)) return false;` (before the superAdmin/roles branches so it applies to every viewer including editor-mode and super-admins in the sidebar; direct URL god-mode access is handled in ProtectedRoute). `AppLayout.tsx:82`: `const { features } = useEntitlements();` and pass `enabledFeatures: features`.

`app.config.ts`:

```ts
import type { FeatureKey } from "@/lib/entitlements";
/** Routes owned by a gated module. Filled in as modules land. */
export const ROUTE_FEATURES: Record<string, FeatureKey> = {};
```

`ProtectedRoute.tsx`, after the suspended-org branch:

```tsx
const requiredFeature = ROUTE_FEATURES[location.pathname];
const { features, isLoading: entLoading } = useEntitlements();
if (requiredFeature && !entLoading && !features.has(requiredFeature) && !isSuperAdmin) {
  return <FeatureDisabledScreen feature={requiredFeature} />;
}
```

`FeatureDisabledScreen.tsx` (mirror `SuspendedOrgScreen`'s layout: centered Card, StageMark, copy without em-dashes):

```tsx
export default function FeatureDisabledScreen({ feature }: { feature: FeatureKey }) {
  const def = FEATURE_REGISTRY[feature];
  return (
    /* centered layout copied from SuspendedOrgScreen */
    <Card>
      <CardHeader><CardTitle>{def.label} is not enabled</CardTitle></CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          This module is not part of your organization's plan. Contact your ShowFlow
          administrator to enable it.
        </p>
        <Button asChild variant="secondary"><Link to={ROUTES.DASHBOARD}>Back to dashboard</Link></Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/ src/features/auth/ src/pages/FeatureDisabledScreen.tsx src/config/app.config.ts
git commit -m "add feature gating to nav and routes"
```

---

### Task 8: Locked state for Settings → Booking flow

**Files:**
- Modify: `src/components/settings/bookingFlow/BookingFlowTab.tsx`
- Test: extend `src/components/settings/bookingFlow/BookingFlowTab.test.tsx` (exists; follow its render harness)

**Interfaces:**
- Consumes: `useFeature("booking_flow")`.

- [ ] **Step 1: Failing test** — render the tab with entitlements mocked off; expect: the lock notice text "Booking flow is not enabled for your organization", preset chips disabled (`aria-disabled` or `disabled`), no Save button, and the timeline rendered read-only from `normalizeBookingFlow(null)`.

- [ ] **Step 2: Implement** — top of `BookingFlowTab`: `const entitled = useFeature("booking_flow");`. When false: render an `Alert` (icon `Lock`, title "Booking flow is not enabled", body "Your booking pipeline runs the standard flow. Contact your ShowFlow administrator to enable configuration.") and pass a `locked` prop down: `FlowPresets` and `FlowTimeline` receive `disabled={locked}` (thread to their inputs), `FlowRail` hides Save/Discard when locked (audit history stays visible). The displayed flow when locked = `normalizeBookingFlow(null)`, not the org's stored override.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/bookingFlow/
git commit -m "render locked booking flow settings when unentitled"
```

---

### Task 9: Platform console UI + provisioning defaults

**Files:**
- Modify: `src/components/platform/EditOrgDialog.tsx` (Modules section)
- Modify: `src/components/platform/OrganizationsTab.tsx` (module chips per row)
- Modify: `src/components/platform/PlatformDefaultsTab.tsx` (Default modules card)
- Modify: `supabase/functions/provision-org/index.ts` (+ its `index.di.test.ts`)
- Test: extend the existing platform component tests alongside each file

**Interfaces:**
- Consumes: `setOrgEntitlement`, `fetchEntitlements`, `fetchAllOrgEntitlements` (Task 4); `savePlatformSetting`/`resolveOrgSetting` (existing).
- Produces: platform default `app_settings` key `default_entitlements` = `Record<FeatureKey, boolean>` (platform rows are super-admin-write-only by existing RLS, safe home); `provision-org` inserts explicit `org_entitlements` rows from it at creation.

- [ ] **Step 1: EditOrgDialog Modules section (test first)** — component test: dialog renders one labeled `Switch` per `FEATURE_KEYS` seeded from `fetchEntitlements`; toggling calls `setOrgEntitlement` and invalidates `["platform"]` + `["entitlements"]`; toast "Module updated". Implement as a bordered section under the name/slug form, above the Danger zone: label = `def.label`, description = `def.description`, `Switch` bound per feature, using the dialog's existing `useMutation` + toast pattern.

- [ ] **Step 2: OrganizationsTab chips (test first)** — `useQuery(["platform","entitlements"], () => fetchAllOrgEntitlements(supabase))`, group by org, and per row render compact `Badge variant="outline"` chips for enabled features only (`BF`, `HO` short labels; add `short: "BF" | "HO"` to `FeatureDef` in BOTH registry homes, same commit).

- [ ] **Step 3: PlatformDefaultsTab card (test first)** — new `DefaultModulesCard` mirroring `AirtableDefaultsCard`'s structure: reads `resolveOrgSetting(supabase, null, "default_entitlements", { booking_flow: true, hire_orders: false })`, one Switch per feature, saves via `savePlatformSetting(supabase, "default_entitlements", value)`, invalidates `["platform"]`.

- [ ] **Step 4: provision-org seeding (Deno test first)** — DI test: after successful org creation, `org_entitlements` receives one insert per registry key with values from the resolved `default_entitlements` (fake returns `{ booking_flow: true, hire_orders: true }` → expect both rows true). Implement after the org insert in `provision-org/index.ts` using `resolveOrgSetting(deps.admin, null, "default_entitlements", ...)` + a single `.insert(rows)`. Run the whole Deno suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/platform/ supabase/functions/provision-org/ src/lib/entitlements.ts supabase/functions/_shared/entitlements.ts
git commit -m "add module toggles to platform console and provisioning"
```

---

### Task 10: E2E + docs sweep

**Files:**
- Create: `e2e/entitlements.spec.ts` (follow the harness/seeding helpers of the existing specs in `e2e/`)
- Modify: `CLAUDE.md` (architecture: add `entitlements` to the `src/data/` domain list + key-files table row for the registry)
- Modify: `docs/superpowers/specs/2026-07-17-hire-orders-design.md` (mark §1 as implemented if all landed)

- [ ] **Step 1: E2E spec** — scenario: super-admin signs in → Platform → Organizations → Edit org → toggles Booking flow off → as org admin, Settings shows the locked booking-flow tab; toggle back on → editor is interactive again. (Keep to one spec; the hire-orders route gate gets its e2e in the follow-up plans.)
- [ ] **Step 2: Run lint/build sanity via CI** — push the branch, verify CI green (vitest + pgTAP + deno + eslint + e2e).
- [ ] **Step 3: Commit docs**

```bash
git add CLAUDE.md docs/
git commit -m "document entitlements platform"
```

---

## After the last task

- Open the PR titled "per-org module entitlements (hire orders PR 1)". No version bump or changelog yet: user-visible release bookkeeping happens once at the end of the initiative (see `2026-07-17-hire-orders-extended.md`, final task).
- Deploy note: edge functions auto-deploy on merge; migrations were already applied via MCP during implementation. Verify the Platform console toggles against the live project post-merge.

## Self-review checklist (run before opening the PR)

- Spec §1 coverage: registry (T1), table+RLS+audit (T2), SQL gating (T3), client resolution (T4-5), edge gating (T6), nav/route/locked-state (T7-8), console+provisioning (T9), e2e (T10). No gaps.
- Defaults identical in all three homes (TS ×2 + SQL CASE): booking_flow=true, hire_orders=false.
- `checkFeature` fail-open ONLY for booking_flow; fail-closed otherwise.
