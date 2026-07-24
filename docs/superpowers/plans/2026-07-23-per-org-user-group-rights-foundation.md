# Per-org User Group Rights — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the per-org capability engine — a two-layer governance model (platform policies + org overrides), a layered resolver, the structured 27-right registry with its edge/SQL mirrors, and the client read/gate hooks — so later plans can wire the matrix menu and enforce every right.

**Architecture:** Extend the existing `org_capabilities` (org overrides) with a new `org_capability_policies` table (platform defaults + `locked`). One SQL resolver `is_capability_enabled(_org,_capability)` is upgraded in place to resolve `locked → org-override → platform-default → registry-default`, so all edge/RLS callers gain layered semantics with no signature change. A pure TS twin (`resolveCapability`) drives the client. The flat one-key registry becomes a structured `CapabilityDef[]` catalog (27 producer rights), mirrored byte-identically into the edge runtime and by the SQL `capability_default()` twin.

**Tech Stack:** React 18 + TypeScript + `@tanstack/react-query` v5 (frontend); Supabase Postgres + RLS + pgTAP (DB); Deno edge functions; Vitest + `src/test/supabaseFake.ts` (tests). This is Plan 1 of 3 — Plan 2 (matrix menu) and Plan 3 (enforcement rollout) follow.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-23-per-org-user-group-rights-design.md`. This plan implements §3, §4, §5 (registry only — enforcement is Plan 3), and the read side of §6.
- **Three-mirror discipline:** the capability registry block is byte-identical between `src/lib/capabilities.ts` and `supabase/functions/_shared/capabilities.ts`; every `key → defaultEnabled` also lives in the SQL `capability_default()`. Change all three together.
- **Never hand-edit** `supabase/migrations/**` or `src/integrations/supabase/types.ts`. Apply schema via the Supabase MCP `apply_migration` (records a real-timestamp version); regenerate types via the Supabase MCP `generate_typescript_types` and copy to both homes.
- **`any` is banned** (lint gate `--max-warnings 0`). Use explicit row interfaces + a single `as unknown as` cast at the query boundary, or the typed test helpers.
- **Semantic tokens only** in any UI (none in this plan).
- **No em/en dashes** in user-facing copy (labels/descriptions here use period/comma/colon).
- **Local commands:** `npx vitest run <path>` (unit), `npm run lint`, `npx tsc --noEmit` (types). Deno: `deno test --allow-all --node-modules-dir=none <path>`. pgTAP: run the file via the Supabase MCP `execute_sql` wrapped in `BEGIN; … ROLLBACK;` (pgtap is installed on the project); CI runs it via `supabase test db`.
- **Behavior note:** this plan flips `producer_can_invite`'s default off→on (spec §9). That is the only live behavior change in Foundation; every other new key is unconsumed until Plan 3. If Foundation ships as its own PR, producers gain invite-artist at that deploy (the menu to retune it arrives in Plan 2).

---

## File Structure

**Created:**
- `supabase/migrations/<version>_org_capability_policies.sql` — platform-policy table + RLS + triggers.
- `supabase/migrations/<version>_capability_layered_resolver.sql` — `capability_default()`, layered `is_capability_enabled()`, `is_capability_locked()`.
- `supabase/migrations/<version>_org_capabilities_admin_write.sql` — org-admin write RLS on `org_capabilities`.
- `src/lib/capabilities.mirror.test.ts` — byte-equality of the registry block across the two runtimes.
- `src/data/capabilities.test.ts` — data-access tests (fake client).
- `src/hooks/useCapabilities.test.tsx` — hook tests.
- `supabase/tests/rpc/org_capability_policies.sql` — pgTAP: resolver layering, lock, org-admin write RLS, audit.

**Modified:**
- `src/lib/capabilities.ts` — structured registry + pure layered resolver (resolver lives OUTSIDE the mirror block).
- `supabase/functions/_shared/capabilities.ts` — mirror the structured registry block only.
- `src/data/capabilities.ts` — add `fetchCapabilityPolicies`, `fetchCapabilityState`.
- `src/hooks/useCapabilities.ts` — add `useResolvedCapabilities`, `useCan`; rewire `useCapability`/`useCapabilities` to layered values.
- `src/integrations/supabase/types.ts` + `supabase/functions/_shared/database.types.ts` — regenerated (new table).
- `supabase/tests/rpc/org_capabilities.sql` — update the `producer_can_invite` default expectation (now `true`).

---

## Task 1: Structured capability registry (lib)

Replace the one-key `Record` registry with a structured `CapabilityDef[]` catalog of all 27 producer rights, keeping the existing `enabledCapabilities`/`isCapabilityEnabled` helpers working.

**Files:**
- Modify: `src/lib/capabilities.ts`
- Test: `src/lib/capabilities.test.ts` (create)

**Interfaces:**
- Produces: `CapabilityDef` (fields `key, action, role, group, label, description, risk, defaultEnabled, module?`), `CAPABILITY_DEFS: CapabilityDef[]`, `CAPABILITY_REGISTRY: Record<string, CapabilityDef>` (derived, back-compat), `CAPABILITY_KEYS: string[]`, `capabilityByKey(key): CapabilityDef | undefined`, `capabilityFor(role, action): CapabilityDef | undefined`, and the unchanged `CapabilityRow`, `enabledCapabilities`, `isCapabilityEnabled`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/capabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_DEFS,
  CAPABILITY_KEYS,
  capabilityByKey,
  capabilityFor,
  enabledCapabilities,
  isCapabilityEnabled,
} from "./capabilities";

describe("capability registry", () => {
  it("has 27 producer rights, all role=producer, unique keys", () => {
    expect(CAPABILITY_DEFS).toHaveLength(27);
    expect(CAPABILITY_DEFS.every((d) => d.role === "producer")).toBe(true);
    expect(new Set(CAPABILITY_KEYS).size).toBe(27);
  });

  it("pins the spec defaults (§5 / §9)", () => {
    const on = (k: string) => capabilityByKey(k)!.defaultEnabled;
    // §9 default-ON-beyond-today
    expect(on("producer_can_invite")).toBe(true);
    expect(on("producer_can_manage_invitations")).toBe(true);
    expect(on("producer_can_view_linked_accounts")).toBe(true);
    expect(on("producer_can_issue_hire_orders")).toBe(true);
    expect(on("producer_can_void_hire_orders")).toBe(true);
    expect(on("producer_can_add_artists")).toBe(true);
    // sensitive, default OFF
    expect(on("producer_can_hard_delete_productions")).toBe(false);
    expect(on("producer_can_edit_booking_settings")).toBe(false);
    expect(on("producer_can_rename_org")).toBe(false);
    expect(on("producer_can_configure_airtable")).toBe(false);
  });

  it("capabilityFor maps (role, action) to its def", () => {
    expect(capabilityFor("producer", "issue_hire_orders")?.key).toBe("producer_can_issue_hire_orders");
    expect(capabilityFor("producer", "does_not_exist")).toBeUndefined();
  });

  it("enabledCapabilities falls back to registry defaults for missing rows", () => {
    const set = enabledCapabilities([{ capability: "producer_can_hard_delete_productions", enabled: true }]);
    expect(set.has("producer_can_hard_delete_productions")).toBe(true); // override
    expect(set.has("producer_can_invite")).toBe(true); // default on
    expect(set.has("producer_can_rename_org")).toBe(false); // default off
    expect(isCapabilityEnabled([], "producer_can_issue_hire_orders")).toBe(true);
  });

  it("hire-order rights carry the module gate", () => {
    expect(capabilityByKey("producer_can_issue_hire_orders")!.module).toBe("hire_orders");
    expect(capabilityByKey("producer_can_invite")!.module).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/capabilities.test.ts`
Expected: FAIL (`CAPABILITY_DEFS` is not exported / has wrong length).

- [ ] **Step 3: Rewrite the registry block**

Replace the block between the `// >>> CAPABILITY REGISTRY MIRROR … >>>` and `// <<< CAPABILITY REGISTRY MIRROR <<<` markers in `src/lib/capabilities.ts` with:

```ts
// >>> CAPABILITY REGISTRY MIRROR (keep byte-identical with the twin file) >>>
export type GrantableRole = "producer" | "artist";
export type CapabilityRisk = "standard" | "sensitive";

export interface CapabilityDef {
  key: string;
  action: string;
  role: GrantableRole;
  group: string;
  label: string;
  description: string;
  risk: CapabilityRisk;
  defaultEnabled: boolean;
  module?: string;
}

export const CAPABILITY_DEFS: CapabilityDef[] = [
  // A. Members & access
  { key: "producer_can_invite", action: "invite_artists", role: "producer", group: "Members & access", label: "Invite artists to the app", description: "Producers can send app-login invites to artists.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_manage_invitations", action: "manage_artist_invitations", role: "producer", group: "Members & access", label: "Revoke or resend artist invitations", description: "Producers can revoke or resend pending artist invitations.", risk: "standard", defaultEnabled: true },
  // B. Productions & show dates
  { key: "producer_can_manage_productions", action: "manage_productions", role: "producer", group: "Productions & show dates", label: "Create and edit productions", description: "Producers can create and edit productions.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_archive_productions", action: "archive_productions", role: "producer", group: "Productions & show dates", label: "Archive productions", description: "Producers can archive and unarchive productions.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_reorder_productions", action: "reorder_productions", role: "producer", group: "Productions & show dates", label: "Reorder productions", description: "Producers can drag to reorder the production list.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_hard_delete_productions", action: "hard_delete_productions", role: "producer", group: "Productions & show dates", label: "Delete productions", description: "Producers can permanently delete productions.", risk: "sensitive", defaultEnabled: false },
  { key: "producer_can_manage_show_dates", action: "manage_show_dates", role: "producer", group: "Productions & show dates", label: "Create and edit show dates", description: "Producers can create and edit show dates.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_hard_delete_show_dates", action: "hard_delete_show_dates", role: "producer", group: "Productions & show dates", label: "Delete show dates", description: "Producers can permanently delete show dates.", risk: "sensitive", defaultEnabled: false },
  // C. Bookings & engine
  { key: "producer_can_manage_casts", action: "manage_casts", role: "producer", group: "Bookings & engine", label: "Manage casts", description: "Producers can create, edit, and delete casts.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_run_offer_engine", action: "run_offer_engine", role: "producer", group: "Bookings & engine", label: "Open and close offer tiers", description: "Producers can open and close offer tiers.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_confirm_bookings", action: "confirm_bookings", role: "producer", group: "Bookings & engine", label: "Confirm bookings", description: "Producers can confirm soft-booked artists.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_edit_booking_settings", action: "edit_booking_settings", role: "producer", group: "Bookings & engine", label: "Edit booking-engine settings", description: "Producers can change booking-engine settings.", risk: "sensitive", defaultEnabled: false },
  // D. Artists
  { key: "producer_can_add_artists", action: "add_artists", role: "producer", group: "Artists", label: "Add and import artists", description: "Producers can add single artists and bulk-import.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_edit_artists", action: "edit_artists", role: "producer", group: "Artists", label: "Edit artist details, skills, and status", description: "Producers can edit artist records.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_view_linked_accounts", action: "resend_account_invite", role: "producer", group: "Artists", label: "Resend linked-account invites", description: "Producers can resend an artist's app-login invite.", risk: "standard", defaultEnabled: true },
  // E. Hire orders
  { key: "producer_can_generate_hire_orders", action: "generate_hire_orders", role: "producer", group: "Hire orders", label: "Generate and draft hire orders", description: "Producers can draft hire orders.", risk: "standard", defaultEnabled: true, module: "hire_orders" },
  { key: "producer_can_issue_hire_orders", action: "issue_hire_orders", role: "producer", group: "Hire orders", label: "Issue hire orders", description: "Producers can issue hire orders and email the PDF to artists.", risk: "sensitive", defaultEnabled: true, module: "hire_orders" },
  { key: "producer_can_void_hire_orders", action: "void_hire_orders", role: "producer", group: "Hire orders", label: "Void hire orders", description: "Producers can void issued hire orders.", risk: "sensitive", defaultEnabled: true, module: "hire_orders" },
  { key: "producer_can_manage_countersign", action: "manage_countersign", role: "producer", group: "Hire orders", label: "Manage countersign", description: "Producers can manage the countersign step.", risk: "standard", defaultEnabled: true, module: "hire_orders" },
  { key: "producer_can_edit_hire_order_settings", action: "edit_hire_order_settings", role: "producer", group: "Hire orders", label: "Edit hire-order settings", description: "Producers can change letterhead, numbering, and terms.", risk: "sensitive", defaultEnabled: false, module: "hire_orders" },
  // F. Settings & organization
  { key: "producer_can_rename_org", action: "rename_org", role: "producer", group: "Settings & organization", label: "Rename the organization", description: "Producers can rename the organization.", risk: "sensitive", defaultEnabled: false },
  { key: "producer_can_manage_ownership", action: "manage_ownership", role: "producer", group: "Settings & organization", label: "Manage production ownership", description: "Producers can assign production ownership.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_manage_cities", action: "manage_cities", role: "producer", group: "Settings & organization", label: "Manage casts and cities", description: "Producers can manage the casts and cities lists.", risk: "standard", defaultEnabled: true },
  { key: "producer_can_edit_filter_settings", action: "edit_filter_settings", role: "producer", group: "Settings & organization", label: "Edit filter and notification defaults", description: "Producers can change org filter and notification defaults.", risk: "standard", defaultEnabled: false },
  { key: "producer_can_edit_scheduling", action: "edit_scheduling", role: "producer", group: "Settings & organization", label: "Edit scheduling settings", description: "Producers can change scheduling settings.", risk: "standard", defaultEnabled: true },
  // G. Integrations
  { key: "producer_can_configure_airtable", action: "configure_airtable", role: "producer", group: "Integrations", label: "Configure Airtable sync", description: "Producers can edit the Airtable mapping and keys.", risk: "sensitive", defaultEnabled: false },
  { key: "producer_can_trigger_sync", action: "trigger_sync", role: "producer", group: "Integrations", label: "Trigger a manual sync", description: "Producers can run an on-demand Airtable sync.", risk: "standard", defaultEnabled: false },
];

export const CAPABILITY_REGISTRY: Record<string, CapabilityDef> = Object.fromEntries(
  CAPABILITY_DEFS.map((d) => [d.key, d]),
);

export const CAPABILITY_KEYS: string[] = CAPABILITY_DEFS.map((d) => d.key);

export function capabilityByKey(key: string): CapabilityDef | undefined {
  return CAPABILITY_REGISTRY[key];
}

export function capabilityFor(role: GrantableRole, action: string): CapabilityDef | undefined {
  return CAPABILITY_DEFS.find((d) => d.role === role && d.action === action);
}

export interface CapabilityRow {
  capability: string;
  enabled: boolean;
}

export function enabledCapabilities(rows: CapabilityRow[]): Set<string> {
  const byKey = new Map(rows.map((r) => [r.capability, r.enabled]));
  return new Set(CAPABILITY_KEYS.filter((k) => byKey.get(k) ?? CAPABILITY_REGISTRY[k].defaultEnabled));
}

export function isCapabilityEnabled(rows: CapabilityRow[], capability: string): boolean {
  return enabledCapabilities(rows).has(capability);
}
// <<< CAPABILITY REGISTRY MIRROR <<<
```

Then delete the now-stale `export type CapabilityKey = "producer_can_invite";` if it remains, and update the file header comment above the block to drop the single-key wording (keep the mirror/twin note).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/capabilities.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Fix any consumer type breakage**

`useCapability(capability: CapabilityKey)` and `setOrgCapability(..., capability: CapabilityKey, ...)` referenced the old union type. Run `npx tsc --noEmit` and change any `CapabilityKey` references to `string` (the registry now validates keys at runtime + via tests). Expected consumers: `src/hooks/useCapabilities.ts`, `src/data/platform.ts`, `supabase/functions/_shared/capabilities.ts` (Task 3). Fix only the frontend ones now; the edge file is Task 3.

Run: `npx tsc --noEmit`
Expected: no errors in `src/**` (edge Deno files are not part of tsc).

- [ ] **Step 6: Commit**

```bash
git add src/lib/capabilities.ts src/lib/capabilities.test.ts src/hooks/useCapabilities.ts src/data/platform.ts
git commit -m "add structured 27-right capability registry"
```

---

## Task 2: Pure layered resolver (lib)

Add the client-side twin of the SQL resolver: given a key's org override, platform policy, and registry default, compute the effective value + lock + source. Lives **outside** the mirror block (client-only; the edge uses the SQL RPC).

**Files:**
- Modify: `src/lib/capabilities.ts`
- Test: `src/lib/capabilities.test.ts`

**Interfaces:**
- Produces: `CapabilityPolicyRow { capability: string; enabled: boolean | null; locked: boolean }`, `CapabilitySource = "policy_lock" | "org" | "policy_default" | "registry"`, `ResolvedCapability { effective: boolean; locked: boolean; source: CapabilitySource }`, `resolveCapability(key, { orgRow?, policyRow?, registryDefault }): ResolvedCapability`, `resolveAllCapabilities(overrides: CapabilityRow[], policies: CapabilityPolicyRow[]): Map<string, ResolvedCapability>`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/capabilities.test.ts`:

```ts
import { resolveCapability, resolveAllCapabilities } from "./capabilities";

describe("layered resolver", () => {
  const KEY = "producer_can_rename_org"; // registry default false

  it("registry default when nothing set", () => {
    expect(resolveCapability(KEY, { registryDefault: false })).toEqual({
      effective: false, locked: false, source: "registry",
    });
  });

  it("org override wins over registry default", () => {
    expect(resolveCapability(KEY, { orgRow: { capability: KEY, enabled: true }, registryDefault: false }))
      .toEqual({ effective: true, locked: false, source: "org" });
  });

  it("platform default applies when no org override", () => {
    expect(resolveCapability(KEY, { policyRow: { capability: KEY, enabled: true, locked: false }, registryDefault: false }))
      .toEqual({ effective: true, locked: false, source: "policy_default" });
  });

  it("lock overrides the org override and reports locked", () => {
    expect(resolveCapability(KEY, {
      orgRow: { capability: KEY, enabled: true },
      policyRow: { capability: KEY, enabled: false, locked: true },
      registryDefault: false,
    })).toEqual({ effective: false, locked: true, source: "policy_lock" });
  });

  it("lock with null platform value falls back to registry default", () => {
    expect(resolveCapability(KEY, {
      policyRow: { capability: KEY, enabled: null, locked: true },
      registryDefault: true,
    })).toEqual({ effective: true, locked: true, source: "policy_lock" });
  });

  it("resolveAllCapabilities covers every registry key", () => {
    const map = resolveAllCapabilities([], []);
    expect(map.size).toBe(27);
    expect(map.get("producer_can_invite")!.effective).toBe(true);
    expect(map.get("producer_can_rename_org")!.effective).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/capabilities.test.ts`
Expected: FAIL (`resolveCapability` not exported).

- [ ] **Step 3: Add the resolver below the mirror block**

Append after the `// <<< CAPABILITY REGISTRY MIRROR <<<` line in `src/lib/capabilities.ts`:

```ts
// ── Client-only layered resolver (SQL twin: public.is_capability_enabled) ──
// NOT part of the mirror block: the edge runtime resolves via the RPC.
export interface CapabilityPolicyRow {
  capability: string;
  enabled: boolean | null;
  locked: boolean;
}

export type CapabilitySource = "policy_lock" | "org" | "policy_default" | "registry";

export interface ResolvedCapability {
  effective: boolean;
  locked: boolean;
  source: CapabilitySource;
}

export function resolveCapability(
  key: string,
  opts: { orgRow?: CapabilityRow; policyRow?: CapabilityPolicyRow; registryDefault: boolean },
): ResolvedCapability {
  const { orgRow, policyRow, registryDefault } = opts;
  if (policyRow?.locked) {
    return { effective: policyRow.enabled ?? registryDefault, locked: true, source: "policy_lock" };
  }
  if (orgRow) return { effective: orgRow.enabled, locked: false, source: "org" };
  if (policyRow && policyRow.enabled != null) {
    return { effective: policyRow.enabled, locked: false, source: "policy_default" };
  }
  return { effective: registryDefault, locked: false, source: "registry" };
}

export function resolveAllCapabilities(
  overrides: CapabilityRow[],
  policies: CapabilityPolicyRow[],
): Map<string, ResolvedCapability> {
  const orgByKey = new Map(overrides.map((r) => [r.capability, r]));
  const polByKey = new Map(policies.map((r) => [r.capability, r]));
  const out = new Map<string, ResolvedCapability>();
  for (const def of CAPABILITY_DEFS) {
    out.set(def.key, resolveCapability(def.key, {
      orgRow: orgByKey.get(def.key),
      policyRow: polByKey.get(def.key),
      registryDefault: def.defaultEnabled,
    }));
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/capabilities.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/capabilities.ts src/lib/capabilities.test.ts
git commit -m "add client-side layered capability resolver"
```

---

## Task 3: Edge mirror + byte-equality test

Mirror the registry block into the edge runtime and lock it with a byte-equality test that compares only the marker-delimited block (the two files' headers/footers differ).

**Files:**
- Modify: `supabase/functions/_shared/capabilities.ts`
- Test: `src/lib/capabilities.mirror.test.ts` (create)

**Interfaces:**
- Consumes: the mirror block from Task 1.
- Produces: an identical block in the edge file; `checkCapability`/`requireCapability` (existing) now typed against `string` keys.

- [ ] **Step 1: Write the failing test**

Create `src/lib/capabilities.mirror.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Deno edge runtime cannot import from src/, so the capability registry is
// dual-homed. This test is the sync contract: the marker-delimited block must
// be byte-identical across both files (their headers/footers legitimately differ).
const START = "// >>> CAPABILITY REGISTRY MIRROR (keep byte-identical with the twin file) >>>";
const END = "// <<< CAPABILITY REGISTRY MIRROR <<<";

function block(path: string): string {
  const src = readFileSync(path, "utf8");
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from === -1 || to === -1) throw new Error(`markers not found in ${path}`);
  return src.slice(from, to + END.length);
}

describe("capability registry mirror", () => {
  it("src and edge registry blocks are byte-identical", () => {
    expect(block("supabase/functions/_shared/capabilities.ts"))
      .toBe(block("src/lib/capabilities.ts"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/capabilities.mirror.test.ts`
Expected: FAIL (the edge file still has the old one-key block).

- [ ] **Step 3: Replace the edge mirror block**

In `supabase/functions/_shared/capabilities.ts`, replace everything between the `// >>> …>>>` and `// <<< … <<<` markers with the exact block from `src/lib/capabilities.ts` (copy it verbatim, including the `GrantableRole`/`CapabilityRisk` types, all 27 defs, and the helpers). Leave the edge-only helpers below the block (`checkCapability`, `requireCapability`) unchanged, except change their `capability: CapabilityKey` parameter types to `capability: string` (the `CapabilityKey` union no longer exists).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/capabilities.mirror.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the edge runtime still type-checks**

Run: `deno check --node-modules-dir=none supabase/functions/_shared/capabilities.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/capabilities.ts src/lib/capabilities.mirror.test.ts
git commit -m "mirror structured capability registry into edge runtime"
```

---

## Task 4: Migration — platform-policy table

Create `org_capability_policies` with RLS (super-admin write, member read, restrictive org-isolation), the stamp trigger, and the audit trigger (key `capability_policy:<name>`).

**Files:**
- Create: `supabase/migrations/<version>_org_capability_policies.sql`
- (Test coverage arrives in Task 10.)

**Interfaces:**
- Produces: table `public.org_capability_policies(org_id, capability, enabled bool null, locked bool not null default false, updated_by, updated_at)`.

- [ ] **Step 1: Apply the migration**

Use the Supabase MCP `apply_migration` with name `org_capability_policies` and this SQL:

```sql
create table public.org_capability_policies (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  capability text not null,
  enabled    boolean,
  locked     boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, capability)
);

alter table public.org_capability_policies enable row level security;

create policy "Members can view org capability policies"
  on public.org_capability_policies for select to authenticated
  using (public.is_org_member(auth.uid(), org_id));

create policy "Super admins manage capability policies"
  on public.org_capability_policies for all to authenticated
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

create policy org_isolation on public.org_capability_policies
  as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));

create or replace function public.stamp_org_capability_policy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger stamp_org_capability_policy before insert or update on public.org_capability_policies
  for each row execute function public.stamp_org_capability_policy();

create or replace function public.log_org_capability_policy_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.enabled is not distinct from old.enabled
     and new.locked is not distinct from old.locked then
    return null;
  end if;
  insert into public.settings_audit_log (org_id, key, actor, old_value, new_value)
  values (
    new.org_id,
    'capability_policy:' || new.capability,
    auth.uid(),
    case when tg_op = 'UPDATE' then jsonb_build_object('enabled', old.enabled, 'locked', old.locked) else null end,
    jsonb_build_object('enabled', new.enabled, 'locked', new.locked)
  );
  return null;
end $$;

create trigger log_org_capability_policy_change after insert or update on public.org_capability_policies
  for each row execute function public.log_org_capability_policy_change();
```

Expected: success; note the returned version string.

- [ ] **Step 2: Verify the table exists**

Use the Supabase MCP `list_tables` (schema `public`) and confirm `org_capability_policies` is present with the columns above.

- [ ] **Step 3: Commit the generated migration file**

```bash
git add supabase/migrations/*_org_capability_policies.sql
git commit -m "add org_capability_policies platform-policy table"
```

---

## Task 5: Migration — layered resolver + lock helper

Extract the registry-default `case` into `capability_default()`, upgrade `is_capability_enabled()` to the layered resolver, and add `is_capability_locked()`. Flip `producer_can_invite`'s default to `true` here (spec §9).

**Files:**
- Create: `supabase/migrations/<version>_capability_layered_resolver.sql`

**Interfaces:**
- Consumes: `org_capabilities` (Task-pre-existing), `org_capability_policies` (Task 4).
- Produces: `capability_default(text) → bool`, layered `is_capability_enabled(uuid, text) → bool`, `is_capability_locked(uuid, text) → bool`.

- [ ] **Step 1: Apply the migration**

Use the Supabase MCP `apply_migration` with name `capability_layered_resolver` and this SQL (the `capability_default` `case` is the SQL twin of `CAPABILITY_DEFS.defaultEnabled` — keep in sync):

```sql
-- Registry-default twin of CAPABILITY_DEFS[*].defaultEnabled (src/lib/capabilities.ts).
create or replace function public.capability_default(_capability text)
returns boolean language sql immutable set search_path = public as $$
  select case _capability
    when 'producer_can_invite' then true
    when 'producer_can_manage_invitations' then true
    when 'producer_can_manage_productions' then true
    when 'producer_can_archive_productions' then true
    when 'producer_can_reorder_productions' then true
    when 'producer_can_hard_delete_productions' then false
    when 'producer_can_manage_show_dates' then true
    when 'producer_can_hard_delete_show_dates' then false
    when 'producer_can_manage_casts' then true
    when 'producer_can_run_offer_engine' then true
    when 'producer_can_confirm_bookings' then true
    when 'producer_can_edit_booking_settings' then false
    when 'producer_can_add_artists' then true
    when 'producer_can_edit_artists' then true
    when 'producer_can_view_linked_accounts' then true
    when 'producer_can_generate_hire_orders' then true
    when 'producer_can_issue_hire_orders' then true
    when 'producer_can_void_hire_orders' then true
    when 'producer_can_manage_countersign' then true
    when 'producer_can_edit_hire_order_settings' then false
    when 'producer_can_rename_org' then false
    when 'producer_can_manage_ownership' then true
    when 'producer_can_manage_cities' then true
    when 'producer_can_edit_filter_settings' then false
    when 'producer_can_edit_scheduling' then true
    when 'producer_can_configure_airtable' then false
    when 'producer_can_trigger_sync' then false
    else false
  end;
$$;

-- Layered resolver: lock -> org override -> platform default -> registry default.
create or replace function public.is_capability_enabled(_org uuid, _capability text)
returns boolean language sql stable security definer set search_path = public as $$
  with pol as (
    select enabled, locked from public.org_capability_policies
    where org_id = _org and capability = _capability
  ),
  org as (
    select enabled from public.org_capabilities
    where org_id = _org and capability = _capability
  )
  select case
    when (select locked from pol) then coalesce((select enabled from pol), public.capability_default(_capability))
    when exists (select 1 from org) then (select enabled from org)
    when (select enabled from pol) is not null then (select enabled from pol)
    else public.capability_default(_capability)
  end;
$$;

create or replace function public.is_capability_locked(_org uuid, _capability text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select locked from public.org_capability_policies where org_id = _org and capability = _capability),
    false
  );
$$;
```

Expected: success; note the version.

- [ ] **Step 2: Sanity-check the resolver via SQL**

Use the Supabase MCP `execute_sql`:

```sql
select public.capability_default('producer_can_invite')        as invite_default,   -- expect true
       public.capability_default('producer_can_rename_org')    as rename_default,   -- expect false
       public.is_capability_enabled('00000000-0000-0000-0000-000000000000','producer_can_invite') as no_org_invite; -- expect true (registry default)
```

Expected: `invite_default=t, rename_default=f, no_org_invite=t`.

- [ ] **Step 3: Commit the generated migration file**

```bash
git add supabase/migrations/*_capability_layered_resolver.sql
git commit -m "layer is_capability_enabled over platform policies + lock"
```

---

## Task 6: Migration — org-admin write RLS on org_capabilities

Let org admins write capability overrides, but only for **unlocked** rights. Super-admins already have full write; members keep read; the permissive union means admin SELECT of locked rows still works via the members policy.

**Files:**
- Create: `supabase/migrations/<version>_org_capabilities_admin_write.sql`

**Interfaces:**
- Consumes: `is_capability_locked` (Task 5), `has_org_role`.

- [ ] **Step 1: Apply the migration**

Use the Supabase MCP `apply_migration` with name `org_capabilities_admin_write` and this SQL:

```sql
create policy "Org admins manage unlocked capabilities"
  on public.org_capabilities for all to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    and not public.is_capability_locked(org_id, capability)
  )
  with check (
    public.has_org_role(auth.uid(), org_id, 'admin')
    and not public.is_capability_locked(org_id, capability)
  );
```

Expected: success; note the version.

- [ ] **Step 2: Confirm `has_org_role`'s signature matches**

Use the Supabase MCP `execute_sql`:

```sql
select pg_get_function_arguments(oid) from pg_proc where proname = 'has_org_role';
```

Expected: an argument list of `(uuid, uuid, app_role)` (or equivalent). If it differs (e.g. takes an array), adjust the policy's `has_org_role(...)` call in a follow-up `apply_migration` before proceeding — the RLS pgTAP in Task 10 will otherwise fail.

- [ ] **Step 3: Commit the generated migration file**

```bash
git add supabase/migrations/*_org_capabilities_admin_write.sql
git commit -m "allow org admins to write unlocked capability overrides"
```

---

## Task 7: Regenerate database types (both homes)

The new table changes the generated types. Regenerate and re-copy the edge mirror; the `typesMirror` test is the contract.

**Files:**
- Modify: `src/integrations/supabase/types.ts`
- Modify: `supabase/functions/_shared/database.types.ts`

- [ ] **Step 1: Regenerate the frontend types**

Use the Supabase MCP `generate_typescript_types`; write the full output to `src/integrations/supabase/types.ts` (overwrite).

- [ ] **Step 2: Copy the mirror byte-for-byte**

Copy `src/integrations/supabase/types.ts` verbatim to `supabase/functions/_shared/database.types.ts`.

- [ ] **Step 3: Run the mirror + type tests**

Run: `npx vitest run src/integrations/supabase/typesMirror.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors (the new `org_capability_policies` row type is now available).

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts
git commit -m "regenerate types for org_capability_policies"
```

---

## Task 8: Data access — policies + combined state

Add `fetchCapabilityPolicies` and `fetchCapabilityState` (overrides + policies in one call), tested with the fake client.

**Files:**
- Modify: `src/data/capabilities.ts`
- Test: `src/data/capabilities.test.ts` (create)

**Interfaces:**
- Consumes: `CapabilityRow`, `CapabilityPolicyRow` (lib).
- Produces: `fetchCapabilityPolicies(client, orgId): Promise<CapabilityPolicyRow[]>`, `fetchCapabilityState(client, orgId): Promise<{ overrides: CapabilityRow[]; policies: CapabilityPolicyRow[] }>`.

- [ ] **Step 1: Write the failing test**

Create `src/data/capabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeSupabaseFake } from "@/test/supabaseFake";
import { fetchCapabilityPolicies, fetchCapabilityState } from "./capabilities";

describe("capability data access", () => {
  it("fetchCapabilityPolicies selects capability, enabled, locked for the org", async () => {
    const fake = makeSupabaseFake({
      org_capability_policies: [
        { org_id: "o1", capability: "producer_can_issue_hire_orders", enabled: false, locked: true },
      ],
    });
    const rows = await fetchCapabilityPolicies(fake.client, "o1");
    expect(rows).toEqual([{ capability: "producer_can_issue_hire_orders", enabled: false, locked: true }]);
    expect(fake.lastFilters("org_capability_policies")).toContainEqual(["eq", "org_id", "o1"]);
  });

  it("fetchCapabilityState returns overrides and policies together", async () => {
    const fake = makeSupabaseFake({
      org_capabilities: [{ org_id: "o1", capability: "producer_can_rename_org", enabled: true }],
      org_capability_policies: [{ org_id: "o1", capability: "producer_can_rename_org", enabled: null, locked: true }],
    });
    const state = await fetchCapabilityState(fake.client, "o1");
    expect(state.overrides).toEqual([{ capability: "producer_can_rename_org", enabled: true }]);
    expect(state.policies).toEqual([{ capability: "producer_can_rename_org", enabled: null, locked: true }]);
  });
});
```

> Note: confirm the exact `makeSupabaseFake` / `lastFilters` API against `src/test/supabaseFake.ts` before running; adjust the helper calls to match its real surface (the seeded-tables shape and a filter accessor exist — use whatever the file exports).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/capabilities.test.ts`
Expected: FAIL (`fetchCapabilityPolicies` not exported).

- [ ] **Step 3: Implement**

Append to `src/data/capabilities.ts`:

```ts
import type { CapabilityPolicyRow } from "@/lib/capabilities";

/** The org's platform-policy rows (capability + enabled + locked). */
export async function fetchCapabilityPolicies(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<CapabilityPolicyRow[]> {
  const { data, error } = await client
    .from("org_capability_policies")
    .select("capability, enabled, locked")
    .eq("org_id", orgId);
  if (error) throw error;
  return (data ?? []) as CapabilityPolicyRow[];
}

/** Both layers in one call: org overrides + platform policies. */
export async function fetchCapabilityState(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<{ overrides: CapabilityRow[]; policies: CapabilityPolicyRow[] }> {
  const [overrides, policies] = await Promise.all([
    fetchCapabilities(client, orgId),
    fetchCapabilityPolicies(client, orgId),
  ]);
  return { overrides, policies };
}
```

(Add the `CapabilityRow` import if not already present.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/capabilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/capabilities.ts src/data/capabilities.test.ts
git commit -m "add capability policy + combined-state data access"
```

---

## Task 9: Hooks — useResolvedCapabilities + useCan

Rewire the read path to the layered resolver and add `useCan(action)`. Keep `useCapability(key)` working (now layered).

**Files:**
- Modify: `src/hooks/useCapabilities.ts`
- Test: `src/hooks/useCapabilities.test.tsx` (create)

**Interfaces:**
- Consumes: `fetchCapabilityState` (Task 8), `resolveAllCapabilities`, `capabilityFor`, `CAPABILITY_REGISTRY` (lib), `useAuth().currentOrg` + `useAuth().hasRole`.
- Produces: `useResolvedCapabilities(): { resolved: Map<string, ResolvedCapability>; isLoading: boolean }`, `useCan(action: string): boolean`, and the retained `useCapabilities()` / `useCapability(key)`.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useCapabilities.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { makeWrapper } from "@/test/renderWithProviders";
import { useCan } from "./useCapabilities";

// makeWrapper seeds AuthContext + a QueryClient; pass role + seeded tables.
// Confirm its real signature in src/test/renderWithProviders.tsx and adjust.

describe("useCan", () => {
  it("admins can do everything regardless of capabilities", async () => {
    const { result } = renderHook(() => useCan("rename_org"), {
      wrapper: makeWrapper({ role: "admin", orgId: "o1", tables: {} }),
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("producers get the registry default when no override (rename off, issue on)", async () => {
    const wrapper = makeWrapper({ role: "producer", orgId: "o1", tables: {} });
    const rename = renderHook(() => useCan("rename_org"), { wrapper });
    const issue = renderHook(() => useCan("issue_hire_orders"), { wrapper });
    await waitFor(() => {
      expect(rename.result.current).toBe(false);
      expect(issue.result.current).toBe(true);
    });
  });

  it("a lock forces the platform value over an org override", async () => {
    const wrapper = makeWrapper({
      role: "producer", orgId: "o1",
      tables: {
        org_capabilities: [{ org_id: "o1", capability: "producer_can_issue_hire_orders", enabled: true }],
        org_capability_policies: [{ org_id: "o1", capability: "producer_can_issue_hire_orders", enabled: false, locked: true }],
      },
    });
    const { result } = renderHook(() => useCan("issue_hire_orders"), { wrapper });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useCapabilities.test.tsx`
Expected: FAIL (`useCan` not exported).

- [ ] **Step 3: Rewrite the hooks**

Replace `src/hooks/useCapabilities.ts` with:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import {
  resolveAllCapabilities,
  capabilityFor,
  CAPABILITY_REGISTRY,
  type GrantableRole,
  type ResolvedCapability,
} from "@/lib/capabilities";
import { fetchCapabilityState } from "@/data/capabilities";

const EMPTY: Map<string, ResolvedCapability> = new Map();

/** The current org's fully-resolved capability map (layered: lock -> org -> platform -> registry). */
export function useResolvedCapabilities(): { resolved: Map<string, ResolvedCapability>; isLoading: boolean } {
  const { currentOrg } = useAuth();
  const q = useQuery({
    queryKey: ["capabilities", currentOrg?.id],
    queryFn: () => fetchCapabilityState(supabase, currentOrg!.id),
    enabled: !!currentOrg,
    staleTime: 60_000,
  });
  const resolved = q.data ? resolveAllCapabilities(q.data.overrides, q.data.policies) : EMPTY;
  return { resolved, isLoading: q.isLoading };
}

/** Whether the current user may perform `action` in the current org.
 *  Admins always may. While loading, falls back to the registry default for the user's role. */
export function useCan(action: string): boolean {
  const { hasRole } = useAuth();
  const { resolved, isLoading } = useResolvedCapabilities();
  if (hasRole("admin")) return true;
  for (const role of ["producer", "artist"] as GrantableRole[]) {
    if (!hasRole(role)) continue;
    const def = capabilityFor(role, action);
    if (!def) continue;
    if (isLoading) return def.defaultEnabled;
    if (resolved.get(def.key)?.effective) return true;
  }
  return false;
}

/** Back-compat: enabled set of capability keys for the current org. */
export function useCapabilities(): { capabilities: Set<string>; isLoading: boolean } {
  const { resolved, isLoading } = useResolvedCapabilities();
  const capabilities = new Set<string>();
  resolved.forEach((v, k) => { if (v.effective) capabilities.add(k); });
  return { capabilities, isLoading };
}

/** Back-compat single-key check (now layered). Returns the registry default while loading. */
export function useCapability(capability: string): boolean {
  const { resolved, isLoading } = useResolvedCapabilities();
  if (isLoading) return CAPABILITY_REGISTRY[capability]?.defaultEnabled ?? false;
  return resolved.get(capability)?.effective ?? false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useCapabilities.test.tsx`
Expected: PASS.

- [ ] **Step 5: Confirm existing consumers still compile**

`ArtistProfileSheet.tsx` calls `useCapability('producer_can_invite')` — still valid (string key). Run:

Run: `npx tsc --noEmit && npx vitest run src/hooks src/lib/capabilities.test.ts`
Expected: no type errors; all pass.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useCapabilities.ts src/hooks/useCapabilities.test.tsx
git commit -m "add useResolvedCapabilities + useCan; layer useCapability"
```

---

## Task 10: pgTAP — resolver, lock, RLS, audit

Prove the layered resolver, the lock helper, the org-admin write RLS (including the locked-row denial), and the audit trail.

**Files:**
- Create: `supabase/tests/rpc/org_capability_policies.sql`
- Modify: `supabase/tests/rpc/org_capabilities.sql` (update `producer_can_invite` default expectation to `true`)

**Interfaces:**
- Consumes: `is_capability_enabled`, `is_capability_locked`, `capability_default`, `org_capability_policies`, `org_capabilities` RLS.

- [ ] **Step 1: Write the pgTAP test**

Create `supabase/tests/rpc/org_capability_policies.sql` (bootstrap org id `00000000-0000-0000-0000-00000000b007` matches the other suites):

```sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-cap0-0001-0000-000000000000','authenticated','authenticated','cap-admin@test.com',now(),'{"provider":"email"}'::jsonb,'{}'::jsonb,now(),now()),
  ('aaaaaaaa-cap0-0002-0000-000000000000','authenticated','authenticated','cap-producer@test.com',now(),'{"provider":"email"}'::jsonb,'{}'::jsonb,now(),now());
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-cap0-0001-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000b007','aaaaaaaa-cap0-0002-0000-000000000000','producer');
SET session_replication_role = DEFAULT;

-- ── Resolver layering (as definer; no auth needed) ──────────────────────────
-- 1. registry default
SELECT is(public.is_capability_enabled('00000000-0000-0000-0000-00000000b007','producer_can_rename_org'), false, 'rename_org registry default false');
-- 2. org override wins
INSERT INTO public.org_capabilities (org_id, capability, enabled)
VALUES ('00000000-0000-0000-0000-00000000b007','producer_can_rename_org', true);
SELECT is(public.is_capability_enabled('00000000-0000-0000-0000-00000000b007','producer_can_rename_org'), true, 'org override wins');
-- 3. lock forces platform value over the org override
INSERT INTO public.org_capability_policies (org_id, capability, enabled, locked)
VALUES ('00000000-0000-0000-0000-00000000b007','producer_can_rename_org', false, true);
SELECT is(public.is_capability_enabled('00000000-0000-0000-0000-00000000b007','producer_can_rename_org'), false, 'lock beats org override');
SELECT is(public.is_capability_locked('00000000-0000-0000-0000-00000000b007','producer_can_rename_org'), true, 'is_capability_locked true');
-- 4. platform default applies when unlocked with no org override
INSERT INTO public.org_capability_policies (org_id, capability, enabled, locked)
VALUES ('00000000-0000-0000-0000-00000000b007','producer_can_edit_scheduling', false, false);
SELECT is(public.is_capability_enabled('00000000-0000-0000-0000-00000000b007','producer_can_edit_scheduling'), false, 'platform default applies');

-- ── Org-admin write RLS ─────────────────────────────────────────────────────
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-cap0-0001-0000-000000000000';
-- 5. admin may insert an override for an UNLOCKED capability
SELECT lives_ok(
  $$ insert into public.org_capabilities (org_id, capability, enabled)
     values ('00000000-0000-0000-0000-00000000b007','producer_can_hard_delete_productions', true) $$,
  'admin writes unlocked capability');
-- 6. admin may NOT write a LOCKED capability (rename_org locked above)
SELECT throws_ok(
  $$ update public.org_capabilities set enabled = true
     where org_id = '00000000-0000-0000-0000-00000000b007' and capability = 'producer_can_rename_org' $$,
  '42501', NULL, 'admin blocked on locked capability');

SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-cap0-0002-0000-000000000000';
-- 7. producer may NOT write capability overrides at all
SELECT throws_ok(
  $$ insert into public.org_capabilities (org_id, capability, enabled)
     values ('00000000-0000-0000-0000-00000000b007','producer_can_manage_casts', false) $$,
  '42501', NULL, 'producer cannot write capabilities');
-- 8. producer may READ policies (member select)
SELECT is(
  (select count(*)::int from public.org_capability_policies
   where org_id = '00000000-0000-0000-0000-00000000b007'),
  2, 'producer can read policies');

RESET role;
-- ── Audit trail ─────────────────────────────────────────────────────────────
-- 9-10. policy insert + update both logged under capability_policy:<name>
SELECT is(
  (select count(*)::int from public.settings_audit_log
   where key = 'capability_policy:producer_can_rename_org'),
  1, 'policy insert audited');
UPDATE public.org_capability_policies SET locked = false
  WHERE org_id = '00000000-0000-0000-0000-00000000b007' AND capability = 'producer_can_rename_org';
SELECT is(
  (select count(*)::int from public.settings_audit_log
   where key = 'capability_policy:producer_can_rename_org'),
  2, 'policy update audited');
-- 11. no-op update is not audited
UPDATE public.org_capability_policies SET locked = false
  WHERE org_id = '00000000-0000-0000-0000-00000000b007' AND capability = 'producer_can_rename_org';
SELECT is(
  (select count(*)::int from public.settings_audit_log
   where key = 'capability_policy:producer_can_rename_org'),
  2, 'no-op update not audited');

SELECT * FROM finish();
ROLLBACK;
```

> Note: the JWT-claim mechanism for impersonating a role in pgTAP must match the other suites in `supabase/tests/rls/*` — open one (e.g. `per_org_settings.sql`) and copy its exact `set_config`/`SET LOCAL` idiom for `request.jwt.claim.sub` and `role`. Adjust the block above to match before running.

- [ ] **Step 2: Run the pgTAP test**

Run it via the Supabase MCP `execute_sql`, pasting the whole file contents (it is already wrapped in `BEGIN … ROLLBACK`, so it leaves no residue).
Expected: all 11 tests report `ok`, `finish()` shows no failures.

- [ ] **Step 3: Update the pre-existing capability default test**

In `supabase/tests/rpc/org_capabilities.sql`, find the assertion that `is_capability_enabled(..., 'producer_can_invite')` is `false` by default and change the expected value to `true` (default flipped in Task 5). Re-run that file via `execute_sql`; expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/rpc/org_capability_policies.sql supabase/tests/rpc/org_capabilities.sql
git commit -m "pgTAP: capability resolver, lock, org-admin write RLS, audit"
```

---

## Task 11: Update the create-invitation edge test for the flipped default

`producer_can_invite` now defaults `true`, so a producer with no override is allowed by default. Update the edge test that asserted the opposite.

**Files:**
- Modify: `supabase/functions/create-invitation/index.di.test.ts` (or whichever test asserts the producer-invite gate)

- [ ] **Step 1: Locate the assertion**

Run: `grep -rn "producer_can_invite\|capability_disabled" supabase/functions/create-invitation/`
Identify the test case that expects a producer to be blocked when the capability is unset.

- [ ] **Step 2: Update the expectation**

If the test relied on the DB default (unset → off), make it explicit instead: seed the fake so the capability RPC returns `false` for the "blocked" case and `true` for the "allowed" case (do not rely on the default, which is now `true`). Keep one blocked case (RPC → false → 403 `capability_disabled`) and one allowed case (RPC → true → invite proceeds).

- [ ] **Step 3: Run the edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/create-invitation/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-invitation/
git commit -m "update create-invitation test for flipped invite default"
```

---

## Task 12: Full-suite green + lint

- [ ] **Step 1: Run the whole frontend suite**

Run: `npx vitest run`
Expected: PASS (existing count + the new capability/hook/data tests).

- [ ] **Step 2: Run the edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS.

- [ ] **Step 3: Lint + types**

Run: `npm run lint && npx tsc --noEmit`
Expected: zero warnings, no type errors.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "foundation: full suite green" --allow-empty
```

---

## Self-Review

**Spec coverage (Plan 1 slice):**
- §3 two-layer model → Tasks 4 (policy table), 5 (layered resolver + lock). ✓
- §3 org-admin write on unlocked → Task 6 + pgTAP Task 10. ✓
- §4 structured registry + three-mirror discipline → Tasks 1 (lib), 3 (edge mirror + test), 5 (`capability_default` SQL twin). ✓
- §5 all 27 keys/defaults → Task 1 registry + Task 5 `capability_default`; defaults-posture pinned in Task 1 test. ✓
- §6 read side (`useCan`, layered resolution) → Tasks 2 (resolver), 8 (data), 9 (hooks). ✓
- §9 `producer_can_invite` default flip + downstream test updates → Tasks 5, 10 step 3, 11. ✓
- Audit trigger for policies (§8) → Task 4 + pgTAP Task 10. ✓

**Deferred to Plan 2/3 (not gaps):** the matrix menu, the platform lock/override UI, the write setters (`setOrgCapability` org path, `setOrgCapabilityPolicy`), rewiring the 27 gates, read-only Settings surfaces, and the E2E. Called out in the roadmap below.

**Placeholder scan:** the three "confirm the real helper API" notes (Tasks 8, 9, 10) point at existing files whose exact surface must be matched — they are verification steps, not unfinished content; the code to write is fully specified.

**Type consistency:** `ResolvedCapability`, `CapabilityPolicyRow`, `resolveAllCapabilities`, `capabilityFor`, `useCan`, `fetchCapabilityState` are named identically across Tasks 2, 8, 9. `capability_default` / `is_capability_enabled` / `is_capability_locked` names match across Tasks 5, 10. The registry block is byte-identical by construction (Task 3 test).

---

## Roadmap: Plans 2 and 3 (written in full after Foundation lands)

**Plan 2 — The matrix menu** (consumes Task 9 hooks + adds write setters):
- `setOrgCapability`/`clearOrgCapability` (org-admin) and `setOrgCapabilityPolicy` (platform) in `src/data/capabilities.ts`, with `['capabilities']` invalidation.
- `PermissionsMatrix` component (rows grouped by `CapabilityDef.group`, columns = roles; admin read-only ✓; locked cells disabled with "managed by ShowFlow"; module-gated rows hidden when the module is off; sensitive toggles confirm).
- Settings → "Roles & permissions" admin-only tab.
- Platform per-org view (lock control + platform-default setter) replacing the lone `producer_can_invite` toggle in `EditOrgDialog`, behind a "Manage all rights" button + compact summary.

**Plan 3 — Enforcement rollout** (consumes `useCan` + `requireCapability`):
- Rewire every UI gate site (from the spec §5 "replaces" column) to `useCan`, rendering read-only rather than hiding.
- Add `requireCapability` to the edge-tagged actions (invite/producers already wired; add hire-order issue/void/generate, offer tiers, airtable, resend).
- Add capability-aware branches to the write RLS policies for the rls-tagged rights; **spike-resolved in-task**: the `confirm_bookings` transition policy shape and an `app_setting_capability(key)` mapping function for the `app_settings` key partitioning (spec §11).
- Broad-Settings read-only surfaces (Booking flow / Airtable / Filters / Notifications tabs visible read-only to producers).
- pgTAP per rls right (producer denied off / allowed on / admin always / read-only floor) and the headline E2E.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-23-per-org-user-group-rights-foundation.md`.**
