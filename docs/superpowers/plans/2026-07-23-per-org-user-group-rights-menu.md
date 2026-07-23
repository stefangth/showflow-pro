# Per-org User Group Rights — Plan 2: The Matrix Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `PermissionsMatrix` UI and its two homes — an admin-only Settings "Roles & permissions" tab (org overrides) and a platform per-org view inside `EditOrgDialog` (platform defaults + lock) — on top of the Plan 1 capability engine.

**Architecture:** One shared `PermissionsMatrix` component driven by an explicit `orgId` and a `mode` (`"org"` | `"platform"`), reading resolved cells from a new `useCapabilityMatrix(orgId)` hook (built on the Plan 1 `fetchCapabilityState` + `resolveAllCapabilities`). Org mode writes `org_capabilities` overrides (respecting locks, which RLS also enforces); platform mode writes `org_capability_policies` (platform default + `locked`). Rows are grouped by `CapabilityDef.group`; the admin column is read-only; locked cells are disabled with a "managed by ShowFlow" note; module-gated rows hide when the module is off; sensitive rights confirm before changing.

**Tech Stack:** React 18 + TypeScript + `@tanstack/react-query` v5 + shadcn/ui (Switch, Card, Dialog, AlertDialog, Tooltip, Badge). Tests: Vitest + `@testing-library/react` + `createFakeSupabase` + the `vi.mock("@/features/auth/AuthContext")` pattern. This is Plan 2 of 3 (Plan 1 Foundation is merged into this branch; Plan 3 is the 27-gate enforcement rollout).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-23-per-org-user-group-rights-design.md` §7 (the menu, two homes), §8 (guardrails: sensitive confirm, locked read-only, module-gated hidden).
- **Plan 1 engine (already built, do not re-implement):** `src/lib/capabilities.ts` exports `CAPABILITY_DEFS` (each `{key, action, role:"producer", group, label, description, risk:"standard"|"sensitive", defaultEnabled, module?}`), `resolveCapability`/`resolveAllCapabilities`, `CapabilityRow`, `CapabilityPolicyRow`, `ResolvedCapability`. `src/data/capabilities.ts` exports `fetchCapabilities`, `fetchCapabilityPolicies`, `fetchCapabilityState`. `src/hooks/useCapabilities.ts` exports `useResolvedCapabilities`, `useCan`, `useCapability` (query key `["capabilities","state",orgId]`). `src/data/platform.ts` exports `setOrgCapability(client, orgId, capability, enabled)` (upsert `org_capabilities`).
- **Two org shapes:** the Settings tab reads `useAuth().currentOrg.id`; `EditOrgDialog` gets `org.org_id` (`OrgStat`). The matrix takes an explicit `orgId: string` — never assume a shape.
- **Query keys:** all capability reads use `["capabilities","state",orgId]` (shared with the Plan 1 hook — same `{overrides,policies}` shape, so sharing is safe). All capability writes invalidate the broad `["capabilities"]` prefix (never an exact sub-key). Do NOT reintroduce a `["capabilities",orgId]`-array-shape query (the Plan 1 final review removed that collision).
- **Semantic tokens only** (`bg-background`, `text-muted-foreground`, `border-border`, …); accent numbered stops do not take `/alpha`. **No em/en dashes** in UI copy (use period, comma, colon; arrows OK). Display font via `font-display` on titles.
- **No `any`** (lint gate `--max-warnings 0`). Prefer types derived from `CapabilityDef`.
- **Commands:** `npx vitest run <path>`, `npm run lint`, `npx tsc --noEmit`.
- **Ships live on faithful defaults** (Plan 1 already flipped the DB defaults). This plan adds only UI; no migration.

---

## File Structure

**Created:**
- `src/components/settings/permissions/PermissionRow.tsx` — one matrix row (label + admin ✓ + the role control). One responsibility: render/handle a single cell.
- `src/components/settings/permissions/PermissionsMatrix.tsx` — groups rows by `CapabilityDef.group` into Cards; owns the sensitive-confirm dialog; wired to `useCapabilityMatrix` + the write mutations.
- `src/components/settings/permissions/PermissionsTab.tsx` — the Settings tab wrapper (org mode, `currentOrg.id`).
- Co-located tests: `PermissionRow.test.tsx`, `PermissionsMatrix.test.tsx`, `PermissionsTab.test.tsx`.

**Modified:**
- `src/data/capabilities.ts` — add `clearOrgCapability`, `setOrgCapabilityPolicy`, `clearOrgCapabilityPolicy` (+ tests in `capabilities.test.ts`).
- `src/hooks/useCapabilities.ts` — add `useCapabilityMatrix(orgId)` (+ tests in `useCapabilities.test.tsx`).
- `src/pages/SettingsPage.tsx` — add the admin-only "Roles & permissions" nav item + `TabsContent`.
- `src/components/platform/EditOrgDialog.tsx` — replace the flat "User rights" switch list (lines ~151-171) with a compact summary + "Manage all rights" button opening the matrix in platform mode (+ update `EditOrgDialog.test.tsx`).
- `src/lib/capabilities.ts` — add `CAPABILITY_GROUPS` ordered-group helper (pure, small) for stable matrix section order (+ test).

---

## Task 1: Group-order helper (lib)

Add a stable, ordered list of the 7 groups so the matrix renders sections deterministically.

**Files:**
- Modify: `src/lib/capabilities.ts`
- Test: `src/lib/capabilities.test.ts`

**Interfaces:**
- Produces: `CAPABILITY_GROUPS: string[]` (unique groups in `CAPABILITY_DEFS` order), `capabilitiesByGroup(): Array<{ group: string; defs: CapabilityDef[] }>`.

- [ ] **Step 1: Write the failing test** — append to `src/lib/capabilities.test.ts`:

```ts
import { CAPABILITY_GROUPS, capabilitiesByGroup } from "./capabilities";

describe("capability grouping", () => {
  it("lists the 7 groups in registry order", () => {
    expect(CAPABILITY_GROUPS).toEqual([
      "Members & access",
      "Productions & show dates",
      "Bookings & engine",
      "Artists",
      "Hire orders",
      "Settings & organization",
      "Integrations",
    ]);
  });
  it("capabilitiesByGroup partitions all 27 defs, preserving order", () => {
    const groups = capabilitiesByGroup();
    expect(groups.map((g) => g.group)).toEqual(CAPABILITY_GROUPS);
    expect(groups.reduce((n, g) => n + g.defs.length, 0)).toBe(27);
    expect(groups[0].defs.every((d) => d.group === "Members & access")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/capabilities.test.ts` → FAIL (`CAPABILITY_GROUPS` undefined).

- [ ] **Step 3: Implement** — append below the resolver in `src/lib/capabilities.ts`:

```ts
export const CAPABILITY_GROUPS: string[] = CAPABILITY_DEFS.reduce<string[]>((acc, d) => {
  if (!acc.includes(d.group)) acc.push(d.group);
  return acc;
}, []);

export function capabilitiesByGroup(): Array<{ group: string; defs: CapabilityDef[] }> {
  return CAPABILITY_GROUPS.map((group) => ({
    group,
    defs: CAPABILITY_DEFS.filter((d) => d.group === group),
  }));
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/capabilities.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capabilities.ts src/lib/capabilities.test.ts
git commit -m "add capability group-order helpers"
```

---

## Task 2: Write setters (data)

Add the three missing capability writers.

**Files:**
- Modify: `src/data/capabilities.ts`
- Test: `src/data/capabilities.test.ts`

**Interfaces:**
- Produces: `clearOrgCapability(client, orgId, capability): Promise<void>` (delete override), `setOrgCapabilityPolicy(client, orgId, capability, patch: { enabled?: boolean | null; locked?: boolean }): Promise<void>` (upsert `org_capability_policies` on `org_id,capability`), `clearOrgCapabilityPolicy(client, orgId, capability): Promise<void>` (delete policy).

- [ ] **Step 1: Write the failing test** — append to `src/data/capabilities.test.ts`, mirroring the existing `createFakeSupabase` + `fake.calls` style already in that file:

```ts
import { clearOrgCapability, setOrgCapabilityPolicy, clearOrgCapabilityPolicy } from "./capabilities";

describe("clearOrgCapability", () => {
  it("deletes the override row for (org, capability)", async () => {
    const fake = createFakeSupabase({ org_capabilities: { data: null, error: null } });
    await clearOrgCapability(fake as never, "org-1", "producer_can_rename_org");
    expect(fake.calls).toContainEqual({ table: "org_capabilities", method: "delete", args: [] });
    expect(fake.calls).toContainEqual({ table: "org_capabilities", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "org_capabilities", method: "eq", args: ["capability", "producer_can_rename_org"] });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ org_capabilities: { data: null, error: { message: "boom" } } });
    await expect(clearOrgCapability(fake as never, "org-1", "x")).rejects.toBeTruthy();
  });
});

describe("setOrgCapabilityPolicy", () => {
  it("upserts a partial patch on (org_id, capability)", async () => {
    const fake = createFakeSupabase({ org_capability_policies: { data: null, error: null } });
    await setOrgCapabilityPolicy(fake as never, "org-1", "producer_can_issue_hire_orders", { locked: true });
    expect(fake.calls).toContainEqual({
      table: "org_capability_policies",
      method: "upsert",
      args: [{ org_id: "org-1", capability: "producer_can_issue_hire_orders", locked: true }, { onConflict: "org_id,capability" }],
    });
  });
});

describe("clearOrgCapabilityPolicy", () => {
  it("deletes the policy row for (org, capability)", async () => {
    const fake = createFakeSupabase({ org_capability_policies: { data: null, error: null } });
    await clearOrgCapabilityPolicy(fake as never, "org-1", "producer_can_rename_org");
    expect(fake.calls).toContainEqual({ table: "org_capability_policies", method: "delete", args: [] });
    expect(fake.calls).toContainEqual({ table: "org_capability_policies", method: "eq", args: ["capability", "producer_can_rename_org"] });
  });
});
```

> Confirm `createFakeSupabase`'s `delete()`/`upsert()` call-recording shape against `src/test/supabaseFake.ts` and the existing `setOrgCapability` sibling test before finalizing the exact `fake.calls` entries; match whatever the fake actually records.

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/data/capabilities.test.ts` → FAIL (functions not exported).

- [ ] **Step 3: Implement** — append to `src/data/capabilities.ts`:

```ts
/** Delete an org's override for a capability (revert to platform/registry default). */
export async function clearOrgCapability(
  client: SupabaseClient<Database>,
  orgId: string,
  capability: string,
): Promise<void> {
  const { error } = await client.from("org_capabilities").delete().eq("org_id", orgId).eq("capability", capability);
  if (error) throw error;
}

/** Upsert a platform policy patch (enabled and/or locked) for a capability. Super-admin only via RLS. */
export async function setOrgCapabilityPolicy(
  client: SupabaseClient<Database>,
  orgId: string,
  capability: string,
  patch: { enabled?: boolean | null; locked?: boolean },
): Promise<void> {
  const { error } = await client
    .from("org_capability_policies")
    .upsert({ org_id: orgId, capability, ...patch }, { onConflict: "org_id,capability" });
  if (error) throw error;
}

/** Delete a capability's platform policy row (clear platform default + unlock). Super-admin only via RLS. */
export async function clearOrgCapabilityPolicy(
  client: SupabaseClient<Database>,
  orgId: string,
  capability: string,
): Promise<void> {
  const { error } = await client.from("org_capability_policies").delete().eq("org_id", orgId).eq("capability", capability);
  if (error) throw error;
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/data/capabilities.test.ts` → PASS. Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/data/capabilities.ts src/data/capabilities.test.ts
git commit -m "add clear-override + policy write setters for capabilities"
```

---

## Task 3: `useCapabilityMatrix` hook

A read hook that, for any `orgId`, returns one fully-resolved cell per registry capability (def + effective/locked/source + the raw override/policy values needed to drive the platform controls).

**Files:**
- Modify: `src/hooks/useCapabilities.ts`
- Test: `src/hooks/useCapabilities.test.tsx`

**Interfaces:**
- Consumes: `fetchCapabilityState`, `resolveCapability`, `CAPABILITY_DEFS`.
- Produces: `CapabilityMatrixCell { def: CapabilityDef; effective: boolean; locked: boolean; source: CapabilitySource; orgEnabled?: boolean; policyEnabled?: boolean | null; policyLocked: boolean }` and `useCapabilityMatrix(orgId: string | null): { cells: CapabilityMatrixCell[]; isLoading: boolean }`.

- [ ] **Step 1: Write the failing test** — append to `src/hooks/useCapabilities.test.tsx` (same `vi.mock("@/data/capabilities")` + `QueryClientProvider` wrapper pattern already used there):

```ts
import { useCapabilityMatrix } from "./useCapabilities";

describe("useCapabilityMatrix", () => {
  it("returns one cell per registry capability with resolved + raw values", async () => {
    vi.mocked(fetchCapabilityState).mockResolvedValue({
      overrides: [{ capability: "producer_can_rename_org", enabled: true }],
      policies: [{ capability: "producer_can_issue_hire_orders", enabled: false, locked: true }],
    });
    const { result } = renderHook(() => useCapabilityMatrix("org-1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.cells.length).toBe(27));
    const rename = result.current.cells.find((c) => c.def.key === "producer_can_rename_org")!;
    expect(rename.effective).toBe(true);
    expect(rename.source).toBe("org");
    expect(rename.orgEnabled).toBe(true);
    const issue = result.current.cells.find((c) => c.def.key === "producer_can_issue_hire_orders")!;
    expect(issue.effective).toBe(false);
    expect(issue.locked).toBe(true);
    expect(issue.policyLocked).toBe(true);
  });

  it("is disabled (no fetch) when orgId is null", () => {
    const { result } = renderHook(() => useCapabilityMatrix(null), { wrapper: wrapper() });
    expect(result.current.cells).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/hooks/useCapabilities.test.tsx` → FAIL (`useCapabilityMatrix` not exported).

- [ ] **Step 3: Implement** — add to `src/hooks/useCapabilities.ts` (import `CAPABILITY_DEFS`, `resolveCapability`, `type CapabilityDef`, `type CapabilitySource` from `@/lib/capabilities`):

```ts
export interface CapabilityMatrixCell {
  def: CapabilityDef;
  effective: boolean;
  locked: boolean;
  source: CapabilitySource;
  orgEnabled?: boolean;
  policyEnabled?: boolean | null;
  policyLocked: boolean;
}

/** Resolved matrix cells for an explicit org (platform console or the org's own Settings tab). */
export function useCapabilityMatrix(orgId: string | null): { cells: CapabilityMatrixCell[]; isLoading: boolean } {
  const q = useQuery({
    queryKey: ["capabilities", "state", orgId],
    queryFn: () => fetchCapabilityState(supabase, orgId!),
    enabled: !!orgId,
    staleTime: 60_000,
  });
  if (!q.data) return { cells: [], isLoading: q.isLoading };
  const orgByKey = new Map(q.data.overrides.map((r) => [r.capability, r]));
  const polByKey = new Map(q.data.policies.map((r) => [r.capability, r]));
  const cells = CAPABILITY_DEFS.map((def) => {
    const orgRow = orgByKey.get(def.key);
    const policyRow = polByKey.get(def.key);
    const r = resolveCapability(def.key, { orgRow, policyRow, registryDefault: def.defaultEnabled });
    return {
      def,
      effective: r.effective,
      locked: r.locked,
      source: r.source,
      orgEnabled: orgRow?.enabled,
      policyEnabled: policyRow?.enabled,
      policyLocked: policyRow?.locked ?? false,
    };
  });
  return { cells, isLoading: q.isLoading };
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/hooks/useCapabilities.test.tsx` → PASS. Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCapabilities.ts src/hooks/useCapabilities.test.tsx
git commit -m "add useCapabilityMatrix hook"
```

---

## Task 4: `PermissionRow` component

One row: the capability label + description, an always-on read-only admin ✓, and the role control (org-mode Switch, or platform-mode default-Switch + lock-toggle). Pure presentational: all state/handlers come via props.

**Files:**
- Create: `src/components/settings/permissions/PermissionRow.tsx`
- Test: `src/components/settings/permissions/PermissionRow.test.tsx`

**Interfaces:**
- Consumes: `CapabilityMatrixCell`.
- Produces: `PermissionRow` with props `{ cell: CapabilityMatrixCell; mode: "org" | "platform"; onToggleOverride: (enabled: boolean) => void; onToggleLock?: (locked: boolean) => void; onSetPlatformDefault?: (enabled: boolean) => void; }`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PermissionRow } from "./PermissionRow";
import type { CapabilityMatrixCell } from "@/hooks/useCapabilities";
import { CAPABILITY_REGISTRY } from "@/lib/capabilities";

function cell(key: string, over: Partial<CapabilityMatrixCell> = {}): CapabilityMatrixCell {
  const def = CAPABILITY_REGISTRY[key];
  return { def, effective: def.defaultEnabled, locked: false, source: "registry", policyLocked: false, ...over };
}

describe("PermissionRow", () => {
  it("renders the label and an enabled producer switch reflecting effective", () => {
    render(<PermissionRow cell={cell("producer_can_rename_org", { effective: false })} mode="org" onToggleOverride={vi.fn()} />);
    expect(screen.getByText(/Rename the organization/i)).toBeInTheDocument();
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("org mode: toggling the switch calls onToggleOverride with the new value", () => {
    const onToggle = vi.fn();
    render(<PermissionRow cell={cell("producer_can_manage_casts", { effective: true })} mode="org" onToggleOverride={onToggle} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("locked cell in org mode is disabled and shows the managed note", () => {
    render(<PermissionRow cell={cell("producer_can_issue_hire_orders", { locked: true, effective: false })} mode="org" onToggleOverride={vi.fn()} />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText(/managed by ShowFlow/i)).toBeInTheDocument();
  });

  it("platform mode shows a lock toggle wired to onToggleLock", () => {
    const onLock = vi.fn();
    render(<PermissionRow cell={cell("producer_can_rename_org")} mode="platform" onToggleOverride={vi.fn()} onToggleLock={onLock} onSetPlatformDefault={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /lock/i }));
    expect(onLock).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/components/settings/permissions/PermissionRow.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/components/settings/permissions/PermissionRow.tsx` (semantic tokens only; use `Switch`, `Badge`, `Button`, `Lock`/`LockOpen`/`Check` from `lucide-react`; no dashes in copy):

```tsx
import { Check, Lock, LockOpen } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CapabilityMatrixCell } from "@/hooks/useCapabilities";

interface Props {
  cell: CapabilityMatrixCell;
  mode: "org" | "platform";
  onToggleOverride: (enabled: boolean) => void;
  onToggleLock?: (locked: boolean) => void;
  onSetPlatformDefault?: (enabled: boolean) => void;
}

export function PermissionRow({ cell, mode, onToggleOverride, onToggleLock, onSetPlatformDefault }: Props) {
  const { def, effective, locked, policyLocked } = cell;
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{def.label}</p>
          {def.risk === "sensitive" && <Badge variant="outline" className="text-xs">Sensitive</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">{def.description}</p>
        {mode === "org" && locked && (
          <p className="text-xs text-muted-foreground mt-1">Managed by ShowFlow.</p>
        )}
      </div>
      <div className="flex items-center gap-4 shrink-0">
        {/* Admin column: always granted, read-only */}
        <div className="flex flex-col items-center gap-1 w-16">
          <span className="text-[11px] text-muted-foreground">Admin</span>
          <Check className="h-4 w-4 text-muted-foreground" aria-label="Admins always have this right" />
        </div>
        {/* Producer control */}
        <div className="flex flex-col items-center gap-1 w-24">
          <span className="text-[11px] text-muted-foreground">Producer</span>
          {mode === "org" ? (
            <Switch
              checked={effective}
              disabled={locked}
              onCheckedChange={(v) => onToggleOverride(v)}
              aria-label={`Producer: ${def.label}`}
            />
          ) : (
            <div className="flex items-center gap-2">
              <Switch
                checked={effective}
                onCheckedChange={(v) => onSetPlatformDefault?.(v)}
                aria-label={`Platform default: ${def.label}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={policyLocked ? "Unlock" : "Lock"}
                onClick={() => onToggleLock?.(!policyLocked)}
              >
                {policyLocked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4 text-muted-foreground" />}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/components/settings/permissions/PermissionRow.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/permissions/PermissionRow.tsx src/components/settings/permissions/PermissionRow.test.tsx
git commit -m "add PermissionRow matrix cell component"
```

---

## Task 5: `PermissionsMatrix` component

Groups rows into Cards (one per `CapabilityDef.group`), hides module-gated rows when the module is off, and owns the sensitive-confirm `AlertDialog`. Wires org-mode writes to `setOrgCapability`/`clearOrgCapability` and platform-mode writes to `setOrgCapabilityPolicy`.

**Files:**
- Create: `src/components/settings/permissions/PermissionsMatrix.tsx`
- Test: `src/components/settings/permissions/PermissionsMatrix.test.tsx`

**Interfaces:**
- Consumes: `useCapabilityMatrix`, `capabilitiesByGroup`, `setOrgCapability` (from `@/data/platform`), `clearOrgCapability`/`setOrgCapabilityPolicy` (from `@/data/capabilities`), `PermissionRow`.
- Produces: `PermissionsMatrix` with props `{ orgId: string; mode: "org" | "platform"; moduleEnabled: (module: string) => boolean }`.

**Behavior:**
- Rows for a def with `def.module` are hidden when `!moduleEnabled(def.module)`.
- Org mode: toggling ON/OFF a `standard` right calls `setOrgCapability(orgId, key, value)` immediately; a `sensitive` right opens the confirm dialog first, and only on confirm writes. (Org mode never renders a locked row's control as enabled; RLS also rejects locked writes.)
- Platform mode: the default Switch calls `setOrgCapabilityPolicy(orgId, key, { enabled: value })`; the lock button calls `setOrgCapabilityPolicy(orgId, key, { locked })`.
- Every mutation invalidates `["capabilities"]` (prefix) and toasts.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/data/platform", () => ({ setOrgCapability: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/data/capabilities", () => ({
  clearOrgCapability: vi.fn().mockResolvedValue(undefined),
  setOrgCapabilityPolicy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/useCapabilities", () => ({ useCapabilityMatrix: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { setOrgCapability } from "@/data/platform";
import { setOrgCapabilityPolicy } from "@/data/capabilities";
import { useCapabilityMatrix } from "@/hooks/useCapabilities";
import { PermissionsMatrix } from "./PermissionsMatrix";
import { CAPABILITY_DEFS, CAPABILITY_REGISTRY } from "@/lib/capabilities";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
}
function allCells() {
  return CAPABILITY_DEFS.map((def) => ({ def, effective: def.defaultEnabled, locked: false, source: "registry", policyLocked: false }));
}

beforeEach(() => vi.clearAllMocks());

describe("PermissionsMatrix", () => {
  it("hides hire-order rows when the module is off", () => {
    vi.mocked(useCapabilityMatrix).mockReturnValue({ cells: allCells(), isLoading: false });
    render(<PermissionsMatrix orgId="org-1" mode="org" moduleEnabled={() => false} />, { wrapper: wrap() });
    expect(screen.queryByText(CAPABILITY_REGISTRY["producer_can_issue_hire_orders"].label)).not.toBeInTheDocument();
    expect(screen.getByText(CAPABILITY_REGISTRY["producer_can_manage_casts"].label)).toBeInTheDocument();
  });

  it("org mode: toggling a standard right writes immediately", async () => {
    vi.mocked(useCapabilityMatrix).mockReturnValue({ cells: allCells(), isLoading: false });
    render(<PermissionsMatrix orgId="org-1" mode="org" moduleEnabled={() => true} />, { wrapper: wrap() });
    const row = screen.getByText(CAPABILITY_REGISTRY["producer_can_manage_casts"].label).closest("div")!.parentElement!.parentElement!;
    fireEvent.click(within(row).getByRole("switch"));
    await waitFor(() => expect(setOrgCapability).toHaveBeenCalledWith(expect.anything(), "org-1", "producer_can_manage_casts", false));
  });

  it("org mode: a sensitive right requires confirmation before writing", async () => {
    vi.mocked(useCapabilityMatrix).mockReturnValue({ cells: allCells(), isLoading: false });
    render(<PermissionsMatrix orgId="org-1" mode="org" moduleEnabled={() => true} />, { wrapper: wrap() });
    const row = screen.getByText(CAPABILITY_REGISTRY["producer_can_hard_delete_productions"].label).closest("div")!.parentElement!.parentElement!;
    fireEvent.click(within(row).getByRole("switch"));
    expect(setOrgCapability).not.toHaveBeenCalled();          // not yet
    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(setOrgCapability).toHaveBeenCalledWith(expect.anything(), "org-1", "producer_can_hard_delete_productions", true));
  });

  it("platform mode: lock button writes a policy patch", async () => {
    vi.mocked(useCapabilityMatrix).mockReturnValue({ cells: allCells(), isLoading: false });
    render(<PermissionsMatrix orgId="org-1" mode="platform" moduleEnabled={() => true} />, { wrapper: wrap() });
    const row = screen.getByText(CAPABILITY_REGISTRY["producer_can_rename_org"].label).closest("div")!.parentElement!.parentElement!;
    fireEvent.click(within(row).getByRole("button", { name: /lock/i }));
    await waitFor(() => expect(setOrgCapabilityPolicy).toHaveBeenCalledWith(expect.anything(), "org-1", "producer_can_rename_org", { locked: true }));
  });
});
```

> The DOM-walk (`closest(...).parentElement`) in these tests is brittle; when implementing, add a stable `data-testid={`cap-row-${def.key}`}` to `PermissionRow`'s outer `div` and select via `screen.getByTestId` instead. Update `PermissionRow` (Task 4) with the `data-testid` if not already present, and re-run Task 4's test.

- [ ] **Step 2: Run to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Implement** — `src/components/settings/permissions/PermissionsMatrix.tsx`:

```tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { capabilitiesByGroup } from "@/lib/capabilities";
import { useCapabilityMatrix, type CapabilityMatrixCell } from "@/hooks/useCapabilities";
import { setOrgCapability } from "@/data/platform";
import { clearOrgCapability, setOrgCapabilityPolicy } from "@/data/capabilities";
import { PermissionRow } from "./PermissionRow";

interface Props {
  orgId: string;
  mode: "org" | "platform";
  moduleEnabled: (module: string) => boolean;
}

export function PermissionsMatrix({ orgId, mode, moduleEnabled }: Props) {
  const qc = useQueryClient();
  const { cells, isLoading } = useCapabilityMatrix(orgId);
  const [pending, setPending] = useState<{ cell: CapabilityMatrixCell; enabled: boolean } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["capabilities"] });

  const writeOverride = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      setOrgCapability(supabase, orgId, key, enabled),
    onSuccess: () => { invalidate(); toast.success("Rights updated"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const writePolicy = useMutation({
    mutationFn: ({ key, patch }: { key: string; patch: { enabled?: boolean | null; locked?: boolean } }) =>
      setOrgCapabilityPolicy(supabase, orgId, key, patch),
    onSuccess: () => { invalidate(); toast.success("Policy updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const byKey = new Map(cells.map((c) => [c.def.key, c]));
  const onToggleOverride = (cell: CapabilityMatrixCell, enabled: boolean) => {
    if (cell.def.risk === "sensitive") { setPending({ cell, enabled }); return; }
    writeOverride.mutate({ key: cell.def.key, enabled });
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading rights...</p>;

  return (
    <div className="space-y-6">
      {capabilitiesByGroup().map(({ group, defs }) => {
        const visible = defs.filter((d) => !d.module || moduleEnabled(d.module));
        if (visible.length === 0) return null;
        return (
          <Card key={group}>
            <CardHeader><CardTitle className="font-display text-base">{group}</CardTitle></CardHeader>
            <CardContent className="pt-0">
              {visible.map((def) => {
                const cell = byKey.get(def.key);
                if (!cell) return null;
                return (
                  <PermissionRow
                    key={def.key}
                    cell={cell}
                    mode={mode}
                    onToggleOverride={(enabled) => onToggleOverride(cell, enabled)}
                    onToggleLock={(locked) => writePolicy.mutate({ key: def.key, patch: { locked } })}
                    onSetPlatformDefault={(enabled) => writePolicy.mutate({ key: def.key, patch: { enabled } })}
                  />
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change a sensitive right?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending && `${pending.enabled ? "Grant" : "Remove"} "${pending.cell.def.label}" for producers. This is a sensitive right.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) writeOverride.mutate({ key: pending.cell.def.key, enabled: pending.enabled });
                setPending(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

> Note: `clearOrgCapability` is imported for a future "reset to default" affordance but is not yet wired to a control in this task — if lint flags the unused import, wire a small per-row "reset" only where `cell.source === "org"`, or omit the import until a later task adds it. Prefer omitting it now (YAGNI) and adding when the reset control lands.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/components/settings/permissions/PermissionsMatrix.test.tsx` → PASS. Then `npx tsc --noEmit && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/permissions/PermissionsMatrix.tsx src/components/settings/permissions/PermissionsMatrix.test.tsx src/components/settings/permissions/PermissionRow.tsx
git commit -m "add PermissionsMatrix grouped component with sensitive-confirm"
```

---

## Task 6: `PermissionsTab` + Settings wiring

The Settings home for org admins: renders the matrix in org mode for the current org, hiding hire-order rows when the org lacks the module.

**Files:**
- Create: `src/components/settings/permissions/PermissionsTab.tsx`
- Test: `src/components/settings/permissions/PermissionsTab.test.tsx`
- Modify: `src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: `useAuth().currentOrg`, `useFeature` (from `@/hooks/useEntitlements`), `PermissionsMatrix`.
- Produces: default-exported? No — named `PermissionsTab` (matches sibling tabs).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useEntitlements", () => ({ useFeature: vi.fn() }));
vi.mock("./PermissionsMatrix", () => ({ PermissionsMatrix: (p: { orgId: string; mode: string }) => <div data-testid="matrix" data-org={p.orgId} data-mode={p.mode} /> }));
import { useAuth } from "@/features/auth/AuthContext";
import { useFeature } from "@/hooks/useEntitlements";
import { PermissionsTab } from "./PermissionsTab";

describe("PermissionsTab", () => {
  it("renders the matrix in org mode for the current org", () => {
    vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-9" } } as never);
    vi.mocked(useFeature).mockReturnValue(true);
    render(<PermissionsTab />);
    const m = screen.getByTestId("matrix");
    expect(m).toHaveAttribute("data-org", "org-9");
    expect(m).toHaveAttribute("data-mode", "org");
  });
  it("returns null without a current org", () => {
    vi.mocked(useAuth).mockReturnValue({ currentOrg: null } as never);
    vi.mocked(useFeature).mockReturnValue(false);
    const { container } = render(<PermissionsTab />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Implement** — `src/components/settings/permissions/PermissionsTab.tsx`:

```tsx
import { useAuth } from "@/features/auth/AuthContext";
import { useFeature } from "@/hooks/useEntitlements";
import { PermissionsMatrix } from "./PermissionsMatrix";

export function PermissionsTab() {
  const { currentOrg } = useAuth();
  const hireOrders = useFeature("hire_orders");
  if (!currentOrg) return null;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold">Roles and permissions</h2>
        <p className="text-sm text-muted-foreground">
          Choose what producers can do. Admins always have every right. Sensitive rights ask for confirmation.
        </p>
      </div>
      <PermissionsMatrix orgId={currentOrg.id} mode="org" moduleEnabled={(m) => (m === "hire_orders" ? hireOrders : true)} />
    </div>
  );
}
```

- [ ] **Step 4: Wire into `src/pages/SettingsPage.tsx`** — (a) import the tab with the other settings-tab imports (~line 22-28): `import { PermissionsTab } from "@/components/settings/permissions/PermissionsTab";` and add `ShieldCheck` to the existing `lucide-react` import; (b) add a nav item to the "Organization" group in `navGroups` (after `organization`): `{ value: "permissions", label: "Roles & permissions", icon: ShieldCheck, show: isAdmin },`; (c) add the panel next to the `organization` `TabsContent`:

```tsx
{isAdmin && (
  <TabsContent value="permissions" className="mt-4">
    <PermissionsTab />
  </TabsContent>
)}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/components/settings/permissions/PermissionsTab.test.tsx`
Expected: PASS.

Run: `npx tsc --noEmit && npm run lint`
Expected: clean (confirm `ShieldCheck` import resolves and the new nav item type matches the `navGroups` item shape).

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/permissions/PermissionsTab.tsx src/components/settings/permissions/PermissionsTab.test.tsx src/pages/SettingsPage.tsx
git commit -m "add Roles & permissions settings tab"
```

---

## Task 7: `EditOrgDialog` platform integration

Replace the flat, policy-unaware "User rights" switch list with a compact summary + a "Manage all rights" button that opens the matrix in platform mode (writing `org_capability_policies`).

**Files:**
- Modify: `src/components/platform/EditOrgDialog.tsx`
- Test: `src/components/platform/EditOrgDialog.test.tsx`

**Interfaces:**
- Consumes: `PermissionsMatrix` (platform mode, `org.org_id`), `Dialog`.

- [ ] **Step 1: Write the failing test** — extend `src/components/platform/EditOrgDialog.test.tsx` (do not delete existing coverage). Mock `PermissionsMatrix` to a probe, and assert the summary button opens a dialog rendering it in platform mode for `org.org_id`:

```tsx
// add to the existing test file's mocks:
vi.mock("@/components/settings/permissions/PermissionsMatrix", () => ({
  PermissionsMatrix: (p: { orgId: string; mode: string }) => <div data-testid="matrix" data-org={p.orgId} data-mode={p.mode} />,
}));

it("opens the permissions matrix in platform mode for the org", async () => {
  // render EditOrgDialog with an org whose org_id is 'org-7' (reuse the file's existing render helper)
  fireEvent.click(screen.getByRole("button", { name: /manage all rights/i }));
  const m = await screen.findByTestId("matrix");
  expect(m).toHaveAttribute("data-org", "org-7");
  expect(m).toHaveAttribute("data-mode", "platform");
});
```

> Match the existing test file's render helper and org fixture (it already builds an `OrgStat`); set its `org_id` to `org-7` for this case or assert against whatever id the helper uses. The prior "User rights" render/toggle test that referenced the flat switch list must be removed or rewritten, since that UI is being replaced — replace it with the summary+button assertion above.

- [ ] **Step 2: Run to verify it fails** — FAIL (no "Manage all rights" button yet).

- [ ] **Step 3: Implement** — in `src/components/platform/EditOrgDialog.tsx`: remove the capabilities `useQuery`, the `toggleCapability` mutation, `isCapabilityOn`, and the flat switch list (the current lines ~92-111 and ~151-171 that read/write `org_capabilities` via `setOrgCapability`/`fetchCapabilities` and iterate `CAPABILITY_KEYS`). Replace the "User rights" card body with a summary + a button that opens a nested `Dialog` containing the matrix in platform mode:

```tsx
// imports
import { PermissionsMatrix } from "@/components/settings/permissions/PermissionsMatrix";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
// component state
const [rightsOpen, setRightsOpen] = useState(false);
// ... in the render, replacing the old "User rights" block:
<div className="rounded-lg border border-border p-4">
  <div className="flex items-center justify-between">
    <div>
      <p className="text-sm font-medium">User rights</p>
      <p className="text-xs text-muted-foreground">Set platform defaults and lock rights for this org.</p>
    </div>
    <Button variant="outline" size="sm" onClick={() => setRightsOpen(true)}>Manage all rights</Button>
  </div>
</div>
{org && (
  <Dialog open={rightsOpen} onOpenChange={setRightsOpen}>
    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
      <DialogHeader><DialogTitle className="font-display">User rights: {org.name}</DialogTitle></DialogHeader>
      <PermissionsMatrix orgId={org.org_id} mode="platform" moduleEnabled={() => true} />
    </DialogContent>
  </Dialog>
)}
```

Remove now-unused imports (`fetchCapabilities`, `setOrgCapability`, `CAPABILITY_KEYS`, and any capability registry imports the old block used). Keep the "Modules" (entitlements) section unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/platform/EditOrgDialog.test.tsx`
Expected: PASS.

Run: `npx tsc --noEmit && npm run lint`
Expected: clean (no unused imports).

- [ ] **Step 5: Commit**

```bash
git add src/components/platform/EditOrgDialog.tsx src/components/platform/EditOrgDialog.test.tsx
git commit -m "replace flat capability toggles with platform rights matrix"
```

---

## Task 8: SQL default sync-guard + full verification

Close the one unguarded leg of the three-mirror discipline (the SQL `capability_default` vs `CAPABILITY_DEFS`) with a lightweight test, then verify the whole suite.

**Files:**
- Create: `src/lib/capabilityDefaultsSql.test.ts`

- [ ] **Step 1: Write the guard test** — a Vitest that reads the applied migration SQL and asserts every `CAPABILITY_DEFS[key] → defaultEnabled` has a matching `when '<key>' then <bool>` arm in `capability_default()` (catches a future key added to TS but not SQL):

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPABILITY_DEFS } from "./capabilities";

describe("capability_default SQL twin covers every registry key", () => {
  it("has a matching CASE arm and default for all 27 keys", () => {
    const sql = readFileSync("supabase/migrations/20260723141017_capability_layered_resolver.sql", "utf8");
    for (const def of CAPABILITY_DEFS) {
      const arm = new RegExp(`when '${def.key}' then (true|false)`).exec(sql);
      expect(arm, `missing capability_default arm for ${def.key}`).not.toBeNull();
      expect(arm![1]).toBe(String(def.defaultEnabled));
    }
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/lib/capabilityDefaultsSql.test.ts` → PASS (it matches the migration written in Plan 1). If a mismatch surfaces, fix the SQL twin via a `CREATE OR REPLACE` follow-up migration (never edit an applied migration).

- [ ] **Step 3: Full verification**

Run: `npx vitest run`
Expected: PASS (the only tolerated failures are the pre-existing full-suite-load flakes `AirtableSyncTab.test.tsx` / `HireOrdersPage.test.tsx`, which pass in isolation; confirm any failure is one of those and not a permissions file).

Run: `npm run lint && npx tsc --noEmit`
Expected: zero warnings, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/capabilityDefaultsSql.test.ts
git commit -m "guard SQL capability_default against the registry"
```

---

## Self-Review

**Spec coverage (§7-§8):**
- Shared matrix component, two homes → Tasks 5 (matrix), 6 (Settings tab, org mode), 7 (EditOrgDialog, platform mode). ✓
- Rows grouped by domain → Task 1 (group helper) + Task 5. ✓
- Admin column read-only ✓; producer control → Task 4 (`PermissionRow`). ✓
- Locked cells disabled + "managed by ShowFlow" → Task 4. ✓
- Module-gated rows hidden when off → Task 5 (`moduleEnabled`). ✓
- Sensitive → confirm dialog → Task 5. ✓
- Platform lock + platform-default setter → Tasks 2 (setters), 4 (lock toggle), 5 (writePolicy), 7. ✓
- Writes go to `org_capabilities` (org) vs `org_capability_policies` (platform) → Tasks 2, 5. ✓
- Reviewer follow-up (SQL twin sync guard) → Task 8. ✓

**Deferred (Plan 3):** rewiring the 27 gates to `useCan`, edge `requireCapability` additions, capability-aware RLS, read-only Settings surfaces, the headline E2E.

**Type consistency:** `CapabilityMatrixCell` (Task 3) is consumed identically in Tasks 4 and 5. `setOrgCapabilityPolicy(orgId, key, patch)` signature matches across Tasks 2, 5. `PermissionsMatrix` props `{ orgId, mode, moduleEnabled }` match across Tasks 5, 6, 7. `moduleEnabled: (module: string) => boolean` is used consistently.

**Known brittleness flagged inline:** the DOM-walk selectors in Task 5's test are replaced by a `data-testid` on `PermissionRow` (noted in Task 5 Step 1 and to backfill in Task 4). The `clearOrgCapability` import in Task 5 is called out as YAGNI-omit until a reset control lands.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-23-per-org-user-group-rights-menu.md`.**
