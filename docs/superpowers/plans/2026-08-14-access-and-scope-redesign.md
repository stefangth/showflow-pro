# Access & scope — Settings redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reimplement three Settings surfaces (Roles & rights, Casts & coverage, Skills) faithfully to the approved "Access & scope (S-tier)" design, wired to real data, building Roles & rights first.

**Architecture:** Frontend-only for Phase 1 — a redesigned org-admin capabilities editor with a local staged-changes buffer over the existing `useCapabilityMatrix`, applied as a batch of the existing `setOrgCapability`/`clearOrgCapability` writes. Phases 2–3 are presentation reorganizations over existing data-access (offer-order two-level model, casts/cities, production ownership, skills catalog) plus one new client-only routing-check tester. No DB migrations, no edge changes, no new RLS.

**Tech Stack:** React 18 + TS, Tailwind v3 + shadcn/ui, @tanstack/react-query v5, Vitest + @testing-library/react. Design tokens already in `src/index.css` / `tailwind.config.ts`.

**Spec:** `docs/superpowers/plans/../specs/2026-08-14-access-and-scope-redesign.md` (read it — it carries the token map and the build/change/delete gap analysis).

## Global Constraints

- **Decisions locked:** D1 per-member capability exceptions are DEFERRED (Individuals panel ships as a visible, disabled "coming soon" affordance, no member-scoped backend). D2 i18n DEFERRED — hardcode English, no new `settings` namespace. D3 Roles & rights first, then Casts & coverage + Skills (parallel with each other).
- **No migrations, no edge-function changes, no RLS changes** anywhere in this plan.
- **Use the real 29-capability registry** (`src/lib/capabilities.ts`) — the design's `CAPS` list is cosmetic mock. Never compare against role display strings; check literal `'producer'`.
- **Semantic tokens only.** `bg-card` (not `bg-surface`), `bg-muted` (not `bg-surface-2`), `bg-[var(--surface-3)]`, `text-foreground`/`text-muted-foreground`, `bg-accent-100`/`text-accent-700`, badge tints `bg-[var(--green-100)] text-[var(--green-600)]` (+amber/red), `rounded-[14px]` for the 14px radius. **Accent numbered stops do NOT support `/opacity` modifiers.**
- **No em/en dashes in copy** (`src/i18n/copyLint.test.ts` scans catalogs, but keep the rule for hardcoded strings too — use periods/commas/colons).
- **Zero-warning lint gate** (`npm run lint` `--max-warnings 0`), `any` banned.
- **Test-first.** Pure logic gets a failing Vitest test before implementation. Components use `renderWithProviders` + the `supabaseFake` harness — never `vi.mock` the client.
- **Preserve `PermissionsMatrix` platform-mode** (super-admin lock editing). Only the org-admin presentation is replaced. Verify the platform mount before deleting anything.
- **Help center impact:** update `src/lib/help/items.ts` (EN + DE, "Du") in the PR that changes where roles/casts/skills are managed, or state "No help center impact."
- **Commit frequently**, imperative lowercase ≤72 chars, on branch `claude/access-scope-design-build-f3b46c`.

---

## Parallelization map (the explicit ask)

Wall-clock is minimized by this dependency shape:

```
Phase 1 — Roles & rights  (build now)
  ├─ 1A presets.ts        ┐  three PURE modules, fully independent →
  ├─ 1B stagedDiff.ts     ├─ run in PARALLEL (separate files, separate tests)
  ├─ 1C rightsFilter.ts   ┘
  ├─ 1D SegmentedControl  ─ shared primitive, independent → parallel with 1A–1C
  ├─ 1E RightRow + RightGroupCard   ─ depends on nothing but tokens → parallel
  ├─ 1F EditingPickerCard (deferred Individuals) ─ parallel
  ├─ 1G StagedChangesCard  ─ consumes 1B types → after 1B
  ├─ 1H ChangeLogDialog    ─ independent (reuses useSettingsAudit) → parallel
  ├─ 1I RolesRightsTab orchestrator ─ consumes 1A–1H → integration, LAST
  └─ 1J nav/label wiring + platform-mode preservation ─ small, after 1I
        └── GATE: verify Phase 1 in-browser, then re-plan Phases 2–3 in detail

Phase 2 — Casts & coverage ┐  near-independent once the shell/nav pattern from 1I/1J exists;
Phase 3 — Skills           ┘  Phase 2 and Phase 3 run in PARALLEL with each other.
   Within Phase 2: routing-check tester (2E) and the coverage matrix reskin (2C)
   are independent → parallel.
```

Parallel-safe = different files, no shared mutable state. The single integration point per phase (the orchestrator/tab) is serial by nature. Dispatch 1A–1F together; 1G/1I are the join points.

---

# Phase 1 — Roles & rights (build now)

## File structure (Phase 1)

- Create `src/lib/capabilities/presets.ts` — preset keysets + `presetOnKeys`, `matchesPreset`.
- Create `src/lib/capabilities/stagedDiff.ts` — staged buffer types + `changedKeys`, `diffSentence`, `deltaSentence`.
- Create `src/lib/capabilities/rightsFilter.ts` — `RightsFilter` type, `matchesFilter`, `filterCounts`.
- Create `src/components/ui/segmented-control.tsx` — shared segmented control (surface-3 track).
- Create `src/components/settings/rolesRights/RolesRightsTab.tsx` — orchestrator (org-admin view).
- Create `src/components/settings/rolesRights/EditorHeaderCard.tsx` — title + preset segmented + diff row.
- Create `src/components/settings/rolesRights/RightsSearchFilters.tsx` — search input + filter chips.
- Create `src/components/settings/rolesRights/RightGroupCard.tsx` + `RightRow.tsx` — grouped rights + rows.
- Create `src/components/settings/rolesRights/EditingPickerCard.tsx` — team default + deferred Individuals.
- Create `src/components/settings/rolesRights/StagedChangesCard.tsx` — staged list + Apply/Discard.
- Create `src/components/settings/rolesRights/ChangeLogDialog.tsx` — audit viewer (`capability:*`).
- Modify `src/pages/SettingsPage.tsx` — nav label "Roles & rights"; render `RolesRightsTab` for org-admins.
- Modify `src/lib/settingsTabs.ts` — keep value `permissions`; label change only.
- Co-located `*.test.ts(x)` beside each source file.

Domain vocabulary (all local to Phase 1):

```ts
// presets.ts
type Preset = "Restricted" | "Standard" | "Full" | "Custom";
// staged buffer: which capability keys the admin has toggled away from current effective
type StagedMap = Record<string, boolean>; // key -> desired enabled
// a "row" here is the resolved matrix cell for the producer role
interface RightRow { key: string; label: string; description: string; group: string; risk: "standard"|"sensitive"; effective: boolean; locked: boolean; module?: string; }
```

---

### Task 1A: Presets module

**Files:**
- Create: `src/lib/capabilities/presets.ts`
- Test: `src/lib/capabilities/presets.test.ts`

**Interfaces:**
- Consumes: `CAPABILITY_REGISTRY`, `CAPABILITY_KEYS`, `CapabilityDef` from `src/lib/capabilities.ts`.
- Produces: `type Preset`, `presetOnKeys(preset: Preset): Set<string>`, `matchesPreset(effective: Record<string,boolean>, preset: Preset): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { presetOnKeys, matchesPreset } from "./presets";
import { CAPABILITY_REGISTRY } from "../capabilities";

describe("presets", () => {
  it("Standard = registry defaultEnabled set", () => {
    const on = presetOnKeys("Standard");
    for (const def of CAPABILITY_REGISTRY) {
      expect(on.has(def.key)).toBe(def.defaultEnabled);
    }
  });
  it("Full = every non-locked key on", () => {
    const on = presetOnKeys("Full");
    expect(on.size).toBe(CAPABILITY_REGISTRY.length);
  });
  it("Restricted excludes all sensitive keys", () => {
    const on = presetOnKeys("Restricted");
    const sensitiveOn = CAPABILITY_REGISTRY.filter(d => d.risk === "sensitive" && on.has(d.key));
    expect(sensitiveOn).toEqual([]);
  });
  it("matchesPreset is true when effective equals the preset set", () => {
    const on = presetOnKeys("Standard");
    const eff = Object.fromEntries(CAPABILITY_REGISTRY.map(d => [d.key, on.has(d.key)]));
    expect(matchesPreset(eff, "Standard")).toBe(true);
    expect(matchesPreset({ ...eff, rename_org: true }, "Standard")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/capabilities/presets.test.ts`
Expected: FAIL — `presetOnKeys` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
import { CAPABILITY_REGISTRY } from "../capabilities";

export type Preset = "Restricted" | "Standard" | "Full" | "Custom";

// Restricted = the safe day-to-day set: standard-risk, non-sensitive core ops.
const RESTRICTED = new Set([
  "producer_can_invite", "manage_productions", "manage_show_dates",
  "edit_artists", "confirm_bookings", "run_offer_engine",
]);

export function presetOnKeys(preset: Preset): Set<string> {
  if (preset === "Full") return new Set(CAPABILITY_REGISTRY.map(d => d.key));
  if (preset === "Restricted") return new Set([...RESTRICTED]);
  // Standard (and any unknown) => registry defaults
  return new Set(CAPABILITY_REGISTRY.filter(d => d.defaultEnabled).map(d => d.key));
}

export function matchesPreset(effective: Record<string, boolean>, preset: Preset): boolean {
  if (preset === "Custom") return false;
  const on = presetOnKeys(preset);
  return CAPABILITY_REGISTRY.every(d => (effective[d.key] ?? false) === on.has(d.key));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/capabilities/presets.test.ts`
Expected: PASS. (If Restricted accidentally includes a sensitive key, adjust `RESTRICTED`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/capabilities/presets.ts src/lib/capabilities/presets.test.ts
git commit -m "add roles-rights preset keyset helpers"
```

---

### Task 1B: Staged-diff module

**Files:**
- Create: `src/lib/capabilities/stagedDiff.ts`
- Test: `src/lib/capabilities/stagedDiff.test.ts`

**Interfaces:**
- Consumes: `RightRow` shape (key/label/effective/risk).
- Produces: `type StagedMap = Record<string, boolean>`; `changedKeys(rows: RightRow[], staged: StagedMap): string[]`; `desiredFor(row, staged): boolean`; `diffSentence(rows, staged, presetLabel): string`; `deltaSentence(rows, staged, who): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { changedKeys, desiredFor, diffSentence, deltaSentence } from "./stagedDiff";

const rows = [
  { key: "a", label: "Delete productions", effective: false, risk: "sensitive" as const },
  { key: "b", label: "Confirm bookings", effective: true, risk: "standard" as const },
];

describe("stagedDiff", () => {
  it("desiredFor falls back to effective when unstaged", () => {
    expect(desiredFor(rows[0], {})).toBe(false);
    expect(desiredFor(rows[0], { a: true })).toBe(true);
  });
  it("changedKeys lists only keys staged away from effective", () => {
    expect(changedKeys(rows, { a: true, b: true })).toEqual(["a"]);
    expect(changedKeys(rows, { a: false })).toEqual([]);
  });
  it("diffSentence reports the count and named rights", () => {
    expect(diffSentence(rows, {}, "Standard")).toMatch(/Matches the Standard baseline/i);
    expect(diffSentence(rows, { a: true }, "Standard")).toMatch(/1 right differs .*delete productions/i);
  });
  it("deltaSentence describes gains and losses with sensitivity", () => {
    const s = deltaSentence(rows, { a: true, b: false }, "every Production Team member");
    expect(s).toMatch(/gains: Delete productions/);
    expect(s).toMatch(/loses: Confirm bookings/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/capabilities/stagedDiff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
export type StagedMap = Record<string, boolean>;
interface Row { key: string; label: string; effective: boolean; risk: "standard" | "sensitive"; }

export function desiredFor(row: Row, staged: StagedMap): boolean {
  return staged[row.key] === undefined ? row.effective : staged[row.key];
}
export function changedKeys(rows: Row[], staged: StagedMap): string[] {
  return rows.filter(r => staged[r.key] !== undefined && staged[r.key] !== r.effective).map(r => r.key);
}
export function diffSentence(rows: Row[], staged: StagedMap, presetLabel: string): string {
  const changed = rows.filter(r => changedKeys(rows, staged).includes(r.key));
  if (changed.length === 0) return `Matches the ${presetLabel} baseline exactly.`;
  const names = changed.slice(0, 2).map(r => r.label.toLowerCase()).join(", ");
  const more = changed.length > 2 ? ` and ${changed.length - 2} more.` : ".";
  const verb = changed.length === 1 ? "right differs" : "rights differ";
  return `${changed.length} ${verb} from ${presetLabel}. ${names}${more}`;
}
export function deltaSentence(rows: Row[], staged: StagedMap, who: string): string {
  const changed = rows.filter(r => changedKeys(rows, staged).includes(r.key));
  if (changed.length === 0) return "";
  const gains = changed.filter(r => desiredFor(r, staged)).map(r => r.label);
  const loses = changed.filter(r => !desiredFor(r, staged)).map(r => r.label);
  const parts: string[] = [];
  if (gains.length) parts.push(`On apply, ${who} gains: ${gains.join("; ")}`);
  if (loses.length) parts.push(`${gains.length ? who + " loses: " : "On apply, " + who + " loses: "}${loses.join("; ")}`);
  return parts.join(". ") + ".";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/capabilities/stagedDiff.test.ts` → PASS. Tune the punctuation regexes/strings until green (keep dash-free copy).

- [ ] **Step 5: Commit**

```bash
git add src/lib/capabilities/stagedDiff.ts src/lib/capabilities/stagedDiff.test.ts
git commit -m "add roles-rights staged diff and sentence builders"
```

---

### Task 1C: Rights search + filter module

**Files:**
- Create: `src/lib/capabilities/rightsFilter.ts`
- Test: `src/lib/capabilities/rightsFilter.test.ts`

**Interfaces:**
- Produces: `type RightsFilter = "All" | "Sensitive" | "Changed" | "Off"`; `matchesFilter(row, ctx): boolean` where `ctx = { query: string; filter: RightsFilter; changed: boolean; desired: boolean }`; `filterCounts(rows, staged): Record<RightsFilter, number>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { matchesFilter, filterCounts } from "./rightsFilter";

const row = { key: "hard_delete_productions", label: "Delete productions", description: "Permanently delete productions.", risk: "sensitive" as const, effective: false };

describe("rightsFilter", () => {
  it("query matches label or description, case-insensitive", () => {
    expect(matchesFilter(row, { query: "delete", filter: "All", changed: false, desired: false })).toBe(true);
    expect(matchesFilter(row, { query: "airtable", filter: "All", changed: false, desired: false })).toBe(false);
  });
  it("Sensitive filter keeps only sensitive rows", () => {
    expect(matchesFilter(row, { query: "", filter: "Sensitive", changed: false, desired: false })).toBe(true);
  });
  it("Off filter keeps rows whose desired state is off", () => {
    expect(matchesFilter(row, { query: "", filter: "Off", changed: false, desired: false })).toBe(true);
    expect(matchesFilter(row, { query: "", filter: "Off", changed: false, desired: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/capabilities/rightsFilter.test.ts` → FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
export type RightsFilter = "All" | "Sensitive" | "Changed" | "Off";
interface Row { key: string; label: string; description: string; risk: "standard" | "sensitive"; effective: boolean; }
interface Ctx { query: string; filter: RightsFilter; changed: boolean; desired: boolean; }

export function matchesFilter(row: Row, ctx: Ctx): boolean {
  const q = ctx.query.trim().toLowerCase();
  if (q && !(`${row.label} ${row.description}`.toLowerCase().includes(q))) return false;
  if (ctx.filter === "Sensitive") return row.risk === "sensitive";
  if (ctx.filter === "Changed") return ctx.changed;
  if (ctx.filter === "Off") return !ctx.desired;
  return true;
}
export function filterCounts(
  rows: Array<Row & { changed: boolean; desired: boolean }>,
): Record<RightsFilter, number> {
  return {
    All: rows.length,
    Sensitive: rows.filter(r => r.risk === "sensitive").length,
    Changed: rows.filter(r => r.changed).length,
    Off: rows.filter(r => !r.desired).length,
  };
}
```

- [ ] **Step 4: Run** the test → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capabilities/rightsFilter.ts src/lib/capabilities/rightsFilter.test.ts
git commit -m "add roles-rights search and filter predicates"
```

---

### Task 1D: Shared SegmentedControl primitive

**Files:**
- Create: `src/components/ui/segmented-control.tsx`
- Test: `src/components/ui/segmented-control.test.tsx`

**Interfaces:**
- Produces: `SegmentedControl<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; count?: number }> })`.

- [ ] **Step 1: Write the failing test** (RTL: renders options, active has selected styling, click calls onChange). Keep role queries out of `findBy`/`waitFor` retry loops (see memory rtl-role-name-queries-in-retry-loops).

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedControl } from "./segmented-control";
import { vi } from "vitest";

it("calls onChange with the clicked option value", async () => {
  const onChange = vi.fn();
  render(<SegmentedControl value="a" onChange={onChange} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
  await userEvent.click(screen.getByText("B"));
  expect(onChange).toHaveBeenCalledWith("b");
});
```

- [ ] **Step 2: Run** `npx vitest run src/components/ui/segmented-control.test.tsx` → FAIL.

- [ ] **Step 3: Implement** — a `role="tablist"` div with `bg-[var(--surface-3)]` track, `p-[2px]`, `rounded-m`; each option a button, active = `bg-card text-foreground shadow-[var(--shadow-1)]`, inactive = `text-muted-foreground`; optional mono count span (`font-mono tabular-nums text-[11px]`). Height 28–30px per design segmented controls.

- [ ] **Step 4: Run** the test → PASS.

- [ ] **Step 5: Commit** `git commit -m "add SegmentedControl ui primitive"`.

---

### Task 1E: RightRow + RightGroupCard

**Files:**
- Create: `src/components/settings/rolesRights/RightRow.tsx`
- Create: `src/components/settings/rolesRights/RightGroupCard.tsx`
- Test: `src/components/settings/rolesRights/RightRow.test.tsx`

**Interfaces:**
- Consumes: `RightRow` shape; `Switch` from `ui/switch`; `Badge` from `ui/badge`.
- Produces: `RightRow({ row, changed, desired, onToggle })`; `RightGroupCard({ group, summary, allOn, onToggleAll, children })`.

- [ ] **Step 1: Write the failing test** — a row renders label + description; sensitive row shows `Badge variant="hold"` "Sensitive"; locked row shows a Lock chip and its Switch is disabled; toggling a non-locked row calls `onToggle`. Changed row shows an accent "Granting"/"Removing" chip and tinted bg.

```tsx
it("locked row disables the switch and shows Managed by ShowFlow", () => {
  render(<RightRow row={{ key:"rename_org", label:"Rename the organization", description:"Rename the organization.", risk:"sensitive", effective:false, locked:true }} changed={false} desired={false} onToggle={() => {}} />);
  expect(screen.getByText(/Managed by ShowFlow/i)).toBeInTheDocument();
  expect(screen.getByRole("switch")).toBeDisabled();
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** both components to the design (row: 11px/16px padding, `border-b border-[var(--line)]`; badges via existing variants; Switch track uses accent when on — shadcn Switch already maps to `--primary`, confirm `--primary` = accent-500). Group card: `rounded-l border shadow-2`, header with "N of M on" mono summary + "Turn all on/off" accent link.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "add roles-rights RightRow and RightGroupCard"`.

---

### Task 1F: EditingPickerCard (team default + deferred Individuals)

**Files:**
- Create: `src/components/settings/rolesRights/EditingPickerCard.tsx`
- Test: `src/components/settings/rolesRights/EditingPickerCard.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks (member list is illustrative/deferred).
- Produces: `EditingPickerCard({ roleOnCount, memberCount }: { roleOnCount: string; memberCount: number })`.

- [ ] **Step 1: Write the failing test** — renders the "Production Team" row selected; renders an "Individuals" section that is **disabled** and shows a "coming soon" note; the section contains no interactive controls (D1).

```tsx
it("renders Individuals as an explicitly deferred, non-interactive section", () => {
  render(<EditingPickerCard roleOnCount="24/29" memberCount={6} />);
  expect(screen.getByText(/Production Team/)).toBeInTheDocument();
  expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  // no clickable member rows
  expect(screen.queryByRole("button", { name: /Lena/i })).toBeNull();
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — team-default row (users icon chip, "Team default", `roleOnCount` mono) always selected/highlighted; an INDIVIDUALS eyebrow followed by a muted, `opacity-60`, `pointer-events-none` placeholder block reading "Per-person exceptions are coming soon." Do not render mock member names as if actionable.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "add roles-rights editing picker with deferred individuals"`.

---

### Task 1G: StagedChangesCard

**Files:**
- Create: `src/components/settings/rolesRights/StagedChangesCard.tsx`
- Test: `src/components/settings/rolesRights/StagedChangesCard.test.tsx`

**Interfaces:**
- Consumes: `changedKeys`/`deltaSentence` outputs (pass computed props, keep the card presentational).
- Produces: `StagedChangesCard({ count, scopeLine, changes, deltaSentence, canApply, onDiscard, onApply })` where `changes: Array<{ label: string; transition: string; on: boolean }>`.

- [ ] **Step 1: Write the failing test** — with `count=0`, shows the "Nothing staged." empty line and Apply is dimmed/disabled; with changes, lists each transition and enables Apply; clicking Apply/Discard calls handlers.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** to the design (eyebrow STAGED CHANGES, big mono count, scope line, dotted list green/red per on/off, delta paragraph, footer Discard + Apply buttons; Apply is accent-500 bg).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "add roles-rights staged changes card"`.

---

### Task 1H: ChangeLogDialog

**Files:**
- Create: `src/components/settings/rolesRights/ChangeLogDialog.tsx`
- Test: `src/components/settings/rolesRights/ChangeLogDialog.test.tsx`

**Interfaces:**
- Consumes: `useSettingsAudit(keys)` from `src/hooks/useSettingsAudit.ts`.
- Produces: `ChangeLogDialog({ open, onOpenChange })` — fetches audit for capability keys.

- [ ] **Step 1: Write the failing test** — using `renderWithProviders` + `supabaseFake` seeded with a `settings_audit_log` row keyed `capability:hard_delete_productions`, the dialog renders the actor + a human transition line. (Follow the `supabaseFake` pattern; the audit fetch joins `profiles.display_name`.)
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — shadcn `Dialog`; call `useSettingsAudit(["capability:*", "capability_policy:*"])` — confirm the hook/`fetchSettingsAudit` supports a wildcard/prefix; if it only takes exact keys, pass the full `capability:${key}` list built from `CAPABILITY_KEYS`. Render newest-first list: actor, old→new, timestamp via `formatDateWithWeekday`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "add roles-rights change log dialog"`.

---

### Task 1I: RolesRightsTab orchestrator (integration)

**Files:**
- Create: `src/components/settings/rolesRights/RolesRightsTab.tsx`
- Test: `src/components/settings/rolesRights/RolesRightsTab.test.tsx`

**Interfaces:**
- Consumes: `useCapabilityMatrix(orgId)`, `setOrgCapability`/`clearOrgCapability` (`src/data/platform.ts` / `src/data/capabilities.ts`), `useCan`, `useFeature` (hide hire-order rows without the module), all Phase-1 components + pure modules.
- Produces: default org-admin Roles & rights surface consumed by `SettingsPage`.

- [ ] **Step 1: Write the failing integration test** — with `supabaseFake` seeded org capabilities, render the tab; assert: preset segmented shows "Standard" active; toggling a right stages it (Apply enables, Staged count = 1, diff sentence updates); clicking Apply calls the batched write and clears staged; a sensitive toggle routes through the confirm dialog before writing. Assert on first meaningful render, not internal state (see memory seed-once-ref…).

```tsx
it("stages a toggle then applies it as a batched write", async () => {
  // seed org_capabilities via supabaseFake; render <RolesRightsTab orgId="org1" />
  // toggle "Archive productions" off -> staged count 1, Apply enabled
  // click Apply -> expect clearOrgCapability/setOrgCapability recorded once, staged cleared
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the orchestrator:
  - Build `RightRow[]` from `useCapabilityMatrix` (map cell → {effective, locked, risk, group, module}); filter module-gated hire-order rows when `!useFeature('hire_orders')`.
  - Local `staged: StagedMap` state; `preset` state; `query`/`filter` state.
  - Preset segmented: selecting a preset seeds `staged` so effective matches `presetOnKeys` (or resets to baseline as the design does — selecting a preset clears role staging then applies preset deltas); auto-select "Custom" when `!matchesPreset(desiredMap, preset)`.
  - Grouped render via `RightGroupCard` + `RightRow`; per-group bulk toggle stages every non-locked key.
  - Right rail: `EditingPickerCard` (deferred) + `StagedChangesCard` (wired to `changedKeys`/`deltaSentence`).
  - `onApply`: for each changed key, if desired == registry/policy baseline → `clearOrgCapability`, else `setOrgCapability(enabled)`; sensitive keys gather into one `AlertDialog` confirm first; then `invalidateQueries(['capabilities'])`, toast, clear staged. `onDiscard`: clear staged.
  - Header: eyebrow + h1 "Roles & rights" + subtitle + Change log button → `ChangeLogDialog`.
- [ ] **Step 4: Run** → PASS; then `npx vitest run src/components/settings/rolesRights/` and `npm run lint`.
- [ ] **Step 5: Commit** `git commit -m "wire roles-rights tab with staged apply"`.

---

### Task 1J: Nav wiring + platform-mode preservation

**Files:**
- Modify: `src/pages/SettingsPage.tsx` (label + component swap for the `permissions` tab)
- Modify: `src/lib/settingsTabs.ts` (label only; value `permissions` unchanged for deep links)
- Verify: where `PermissionsMatrix mode="platform"` is mounted (super-admin console) — keep it.

**Interfaces:**
- Consumes: `RolesRightsTab`.

- [ ] **Step 1:** Grep `PermissionsMatrix` and `mode="platform"` to confirm the platform mount is not `PermissionsTab`. Run: `rg -n "PermissionsMatrix|mode=\"platform\"" src`.
- [ ] **Step 2:** In `SettingsPage.tsx`, change the nav label "Roles & permissions" → "Roles & rights" (icon `ShieldCheck` stays), and render `<RolesRightsTab orgId={currentOrg.id} />` in the `permissions` `TabsContent` for org-admins (keep the admin-only gate). Leave `PermissionsTab`/`PermissionsMatrix` in place if still used by the platform console; otherwise mark `PermissionsTab` for deletion in a later cleanup task.
- [ ] **Step 3:** Update the stale comment at `src/data/platform.ts:336` ("Super-admin only") to reflect org-admin unlocked writes.
- [ ] **Step 4:** Run `npm run lint`, `npx tsc -p tsconfig.app.json --noEmit`, `npx vitest run`.
- [ ] **Step 5: Commit** `git commit -m "surface roles-rights redesign in settings nav"`.

---

### Task 1K: Verify Phase 1 in-browser + help center

- [ ] Start the local stack + dev server per CLAUDE.md (`npm run local:up` then `npm run dev`), open Settings → Roles & rights via the Browser pane. Verify: light + dark (resize_window colorScheme), preset switching, search/filter counts, staged panel + Apply, sensitive confirm, deferred Individuals block, change log. Capture a screenshot for the PR.
- [ ] Update `src/lib/help/items.ts` (EN + DE, "Du") for the renamed surface, or record "No help center impact."
- [ ] `git commit -m "verify roles-rights and update help"`.

**GATE:** Do not start Phase 2/3 implementation until Phase 1 is verified. Then expand Phase 2/3 below into bite-sized steps (a short re-planning pass) using the same TDD structure.

---

# Phase 2 — Casts & coverage (after Phase 1 gate; parallel with Phase 3)

Presentation reorg over existing data-access. No new tables. Task breakdown (expand to steps at execution time):

- **Task 2A — Tab plumbing & shell.** New `casts-coverage` value in `src/lib/settingsTabs.ts` (+ back-compat: `production-ownership`/`casts-cities` → `casts-coverage`); nav rail entry "Casts & coverage" (`MapPin`), remove the two old entries; `CastsCoverageTab.tsx` shell with a Coverage/Ownership `SegmentedControl`. Test: `resolveInitialTab` maps old params to the new value.
- **Task 2B — Coverage scope switch + KPIs.** Org-default vs Per-show `SegmentedControl`; KPI row computed from the matrix (`blocked` = no Tier 1, `single` = 1 filled, `overrides` = shows with any override). Pure `coverageKpis(matrix)` helper + test.
- **Task 2C — Offer-order matrix (reskin).** City × Tier 1/2/3 grid with `Popover` cell dropdowns (cast options + "Clear slot"), dashed empty cells, per-row status/source chip. Org scope → `cast_city_priority` writes; per-show scope → `show_cast_eligibility.priority` writes + override banner + "Clear all overrides". Reuse the existing write helpers from `casts.ts`/`eligibility.ts`. **Parallel with 2E.**
- **Task 2D — Casts + Cities lists.** Casts list (opens the detail sheet) + Cities list (delete-when-unused, admin-only). Reuse `fetchCasts`/`fetchCastMemberCounts`/`cities.ts`.
- **Task 2E — Cast detail sheet: add Offer-order tab.** Extend/ share `CastDetailsSheet` (Members + Eligibility exist) with a third **Offer order** tab reading per-city tier placement (same `priority`). Decide share-vs-move with `CastsSection` (Artists page) — prefer a shared component import. **Parallel with 2C.**
- **Task 2F — Production Ownership sub-tab.** Owners-by-program grouped list with specificity chips + rank badge; assign-owner composer → `show_assignments`; no-owner warning. Reuse `showAssignments.ts` + client specificity ranking (`rankOf`) mirroring `resolve_show_assignments`.
- **Task 2G — Routing-check tester (NEW).** Client-only: Program/Sub-program/City selects → winning owner + reason + precedence ladder (rank 1→4) with admin fallback. Pure `resolveRouting(assignments, {program, sub, city})` helper + test (mirror the RPC's specificity 4→1 and the empty→admins fallback). No backend call needed.
- **Task 2H — Retire old tabs.** Delete `CastsCitiesTab.tsx` + `ProductionOwnershipTab.tsx` once `CastsCoverageTab` covers them; ensure `SkillsCard` no longer mounted here (moved in Phase 3). Verify in-browser.

---

# Phase 3 — Skills (after Phase 1 gate; parallel with Phase 2)

- **Task 3A — Standalone Skills tab.** New `skills` value + nav entry (`Sparkles`) in `settingsTabs.ts`/`SettingsPage.tsx`; `SkillsTab.tsx` rendering the catalog. Test `resolveInitialTab` includes `skills`.
- **Task 3B — Reskin to the design table.** Re-skin `SkillsCard` (or a new `SkillsTable`) to the design: search + New skill header, columns SKILL / ARTISTS / REQUIRED BY / action, Archived badge, violet Rename/Restore link. Keep `useSkillCatalog` + `useSkills` mutations and the `manage_skills` gate; delete-when-unused unchanged.
- **Task 3C — Remove old mount.** Remove `SkillsCard` from the (now-deleted) `CastsCitiesTab`; keep `SkillsCard` file only if still imported elsewhere. Verify in-browser (light/dark), update help center or note no impact.

---

## Self-review notes

- **Spec coverage:** Surface A → Phase 1 (all sub-parts: presets 1A, staged 1B/1G, filters 1C, matrix rows 1E, picker+deferred 1F, change log 1H, orchestrator 1I, nav 1J). Surface B → Phase 2 (2A–2H incl. the new routing-check 2G and offer-order sheet tab 2E). Surface C → Phase 3. Token map + gotchas → Global Constraints. Deferred D1 → 1F. i18n D2 → hardcoded EN (no namespace task). Nav delta §6 → 1J/2A/3A with deep-link back-compat.
- **Placeholder scan:** Phase 1 tasks carry real code/tests. Phases 2–3 are task-level (per the "Roles & rights first" decision, they are expanded to steps after the Phase 1 gate) — each names exact files, reused helpers, and its one testable deliverable; none say "TBD".
- **Type consistency:** `StagedMap`, `RightRow`, `Preset`, `RightsFilter`, `presetOnKeys`, `matchesPreset`, `changedKeys`, `desiredFor`, `diffSentence`, `deltaSentence`, `matchesFilter`, `filterCounts`, `SegmentedControl` used consistently across 1A–1I.
