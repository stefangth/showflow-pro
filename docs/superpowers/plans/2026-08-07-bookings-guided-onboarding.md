# Bookings Guided Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dismissible "Get bookings running" setup rail beside the Shows & Bookings table (design 1a), plus the producer waiting card and artist first-offer card, all reusing the shipped #210 rail primitive and the live booking-flow policy.

**Architecture:** A pure readiness module (`src/lib/bookings/setupStatus.ts`) computes five step states from four org-scoped reads, with the cast ladder as the only offer-blocker and a shared tier-1 coverage rule spanning `show_cast_eligibility` and `cast_city_priority`. The rail row and dismissal hook are extracted from `hireOrders/setup/` into a shared `components/setup/` primitive. No schema, migration, or edge-function change: every step reads an existing table and writes an existing settings/`shows` path.

**Tech Stack:** React 18 + TypeScript, @tanstack/react-query v5, Tailwind + shadcn/ui, Vitest + @testing-library/react, the `src/test/supabaseFake.ts` call-recording client.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-bookings-guided-onboarding-design.md`.
- No migration, no edge-function change, no `src/integrations/supabase/types.ts` edit.
- Semantic tokens only. No opacity modifier on any numbered accent stop (`accent-50`–`900`). Amber via the `--amber-*` vars (or the Badge `risk`/`neutral` variants), never Tailwind's built-in amber.
- No em-dashes in user-facing copy (period, comma, colon, or middot).
- Data-access functions take the client as first arg and live in `src/data/**`; hooks are thin wrappers passing the `supabase` singleton. Test data-access with `supabaseFake`, never `vi.mock` the client module chain.
- Test-first: write the failing test before the implementation. Tests import the real module; never re-implement production logic in a test.
- Query keys are hierarchical by domain: `['app-settings',...]`, `['shows',...]`, `['eligibility',...]`. Mutations invalidate the whole domain prefix.
- Lint gate is `--max-warnings 0`; `any` is banned (use an explicit row interface + a single `as unknown as` cast at the query boundary).
- Booking-flow reads/writes are gated by the `booking_flow` entitlement (mirror `requireFeature` — a frontend bypass the server doesn't mirror yields a UI whose writes 403).

**Verification commands** (run the relevant ones at each task's end):

```bash
npx vitest run src/lib/bookings src/components/setup src/components/bookings src/hooks/useBookingSetup.test.ts
npx tsc -p tsconfig.app.json --noEmit
npm run lint
```

---

### Task 1: Extract the shared rail primitive

Move `SetupStepRow` and `useRailDismissed` out of `hireOrders/setup/` into a domain-neutral `components/setup/`, generalising the chip to a `{ label, tone }` and the dismissal to a namespaced key. Behaviour for hire orders must be identical.

**Files:**
- Create: `src/components/setup/SetupStepRow.tsx`
- Create: `src/components/setup/SetupStepRow.test.tsx`
- Create: `src/components/setup/useRailDismissed.ts`
- Delete: `src/components/hireOrders/setup/useRailDismissed.ts`
- Modify: `src/components/hireOrders/setup/SetupRail.tsx` (imports + `block` prop + namespaced dismissal)
- Modify: `src/components/hireOrders/setup/useSetupRailVisible.ts` (namespaced dismissal)
- Modify: `src/components/hireOrders/setup/SetupRail.test.tsx` (only if it imports `SetupStepRow`/`useRailDismissed` paths — update imports)

**Interfaces:**
- Produces `SetupStepBlock`, `SetupStepRow`, `SetupStepRowProps` from `@/components/setup/SetupStepRow`.
- Produces `useRailDismissed(namespace: string, orgId: string | null): [boolean, () => void]` from `@/components/setup/useRailDismissed`.

- [ ] **Step 1: Write the failing test for the generalised row**

Create `src/components/setup/SetupStepRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SetupStepRow } from "./SetupStepRow";

describe("SetupStepRow", () => {
  it("shows the step number and no chip when block is null and not done", () => {
    render(
      <SetupStepRow index={3} title="Cast priorities" hint="per city" done={false}
        block={null} expanded={false} onToggle={() => {}} />,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText(/blocks/i)).not.toBeInTheDocument();
  });

  it("renders a risk-tone chip with the given label", () => {
    render(
      <SetupStepRow index={1} title="Ladder" hint="h" done={false}
        block={{ label: "Blocks offers", tone: "risk" }} expanded={false} onToggle={() => {}} />,
    );
    const chip = screen.getByText("Blocks offers");
    expect(chip.className).toContain("var(--amber-100)"); // Badge risk variant
  });

  it("hides the chip once the step is done, even with a block", () => {
    render(
      <SetupStepRow index={1} title="Ladder" hint="h" done={true}
        block={{ label: "Blocks offers", tone: "risk" }} expanded={false} onToggle={() => {}} />,
    );
    expect(screen.queryByText("Blocks offers")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/setup/SetupStepRow.test.tsx`
Expected: FAIL — cannot resolve `./SetupStepRow`.

- [ ] **Step 3: Create the generalised row**

Create `src/components/setup/SetupStepRow.tsx` (adapted from the hire-order original, `blocksIssue: boolean` replaced by `block: SetupStepBlock | null`):

```tsx
import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface SetupStepBlock {
  label: string;
  /** `risk` = amber "hard" blocker; `neutral` = muted "soft" blocker. */
  tone: "risk" | "neutral";
}

export interface SetupStepRowProps {
  /** 1-based position, shown while the step is outstanding. */
  index: number;
  title: string;
  hint: string;
  done: boolean;
  block: SetupStepBlock | null;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

/** One row of a setup rail: a tick or a number, the title, a one-line hint, and an
 *  optional chip carried by the caller. A checklist that overstates its blockers stops
 *  being believed, so `block` is null on steps that do not block anything. */
export function SetupStepRow({
  index, title, hint, done, block, expanded, onToggle, children,
}: SetupStepRowProps) {
  const panelId = useId();
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-start gap-2.5 p-3 text-left hover:bg-muted/50"
      >
        {done ? (
          <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent-500">
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          </span>
        ) : (
          <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground">
            {index}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="mt-0.5 block text-xs leading-[17px] text-muted-foreground">{hint}</span>
        </span>
        {/* A span, not <Badge>, because this sits inside a button and a div there is
            invalid markup. The tone rides the Badge cva so amber stays on the --amber-*
            vars (dark-mode override) rather than Tailwind's built-in amber. */}
        {!done && block && (
          <span className={cn(badgeVariants({ variant: block.tone }), "shrink-0 font-semibold")}>
            {block.label}
          </span>
        )}
      </button>
      {expanded && <div id={panelId} className="border-t border-border bg-muted/40 p-3">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run the row test to verify it passes**

Run: `npx vitest run src/components/setup/SetupStepRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Create the namespaced dismissal hook**

Create `src/components/setup/useRailDismissed.ts` (the hire-order original, with `namespace` threaded into `storageKey`):

```ts
import { useCallback, useSyncExternalStore } from "react";

/** Per-browser, per-org dismissal of a setup rail.
 *
 *  localStorage rather than app_settings: a dismissal in the org-scoped settings table
 *  would hide the rail for every admin at once. It does not follow a user across devices,
 *  an accepted limitation for a surface that retires itself once setup is complete.
 *  `namespace` keeps each rail's dismissal independent (e.g. "hireOrderSetup",
 *  "bookingSetup", "artistFirstOffer"). */
function storageKey(namespace: string, orgId: string | null): string {
  return `showflow.${namespace}.hidden.${orgId ?? "none"}`;
}

/** Every mounted reader, so a Hide click updates all of them at once. A single shared
 *  set across namespaces is fine: each reader re-reads its OWN key, so a Hide in one
 *  namespace triggers a harmless no-op re-read in the others. */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useRailDismissed(namespace: string, orgId: string | null): [boolean, () => void] {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(storageKey(namespace, orgId)) === "true",
  );
  const dismiss = useCallback(() => {
    localStorage.setItem(storageKey(namespace, orgId), "true");
    for (const notify of listeners) notify();
  }, [namespace, orgId]);
  return [dismissed, dismiss];
}
```

- [ ] **Step 6: Point the hire-order callers at the shared primitive**

In `src/components/hireOrders/setup/SetupRail.tsx`:
- Change the `SetupStepRow` import to `import { SetupStepRow } from "@/components/setup/SetupStepRow";`
- Change the `useRailDismissed` import to `import { useRailDismissed } from "@/components/setup/useRailDismissed";`
- Change the dismissal call to `const [, dismiss] = useRailDismissed("hireOrderSetup", orgId);`
- Change the `SetupStepRow` usage's `blocksIssue={s.blocksIssue}` to:
  `block={s.blocksIssue ? { label: "Blocks issue", tone: "risk" } : null}`

In `src/components/hireOrders/setup/useSetupRailVisible.ts`:
- Change the import to `import { useRailDismissed } from "@/components/setup/useRailDismissed";`
- Change the call to `const [dismissed] = useRailDismissed("hireOrderSetup", orgId);`

Delete `src/components/hireOrders/setup/useRailDismissed.ts`.

- [ ] **Step 7: Run the hire-order rail suite unchanged and green**

Run: `npx vitest run src/components/hireOrders/setup`
Expected: PASS. The storage key `showflow.hireOrderSetup.hidden.<org>` and the "Blocks issue" chip are unchanged, so `SetupRail.test.tsx` and `useSetupRailVisible.test.ts` assert the same behaviour. If either test imports the deleted `hireOrders/setup/useRailDismissed` path, update the import to `@/components/setup/useRailDismissed`.

- [ ] **Step 8: Typecheck and lint**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/setup src/components/hireOrders/setup
git commit -m "extract the setup rail row and dismissal into a shared primitive"
```

---

### Task 2: Pure booking-setup readiness module

The five step rules and the shared tier-1 coverage rule, with no client dependency.

**Files:**
- Create: `src/lib/bookings/setupStatus.ts`
- Create: `src/lib/bookings/setupStatus.test.ts`

**Interfaces:**
- Produces the types and `resolveCoverage` / `computeBookingSetupStatus` used by Task 3 (input shapes) and Task 4 (composition).

```ts
export type BookingSetupStepKey = "flow" | "slots" | "ladder" | "eligibility" | "timing";
export type BlockKind = "offers" | "filling" | null;
export interface BookingSetupStep { key: BookingSetupStepKey; done: boolean; block: BlockKind }
export interface BookingSetupStatus {
  steps: BookingSetupStep[]; doneCount: number; totalCount: number;
  canOffer: boolean; complete: boolean;
}
export interface LadderCoverageInputs {
  futurePairs: { showId: string; cityId: string | null }[];
  showPriorities: { showId: string; cityId: string; castId: string; priority: number }[];
  cityPriorities: { cityId: string; castId: string; priority: number }[];
}
export interface CoverageResult {
  uncoveredPairs: { showId: string; cityId: string }[];
  hasNullCity: boolean;
}
export interface BookingSetupStatusInput {
  flowChosen: boolean;
  shows: { main_cast_slots: number | null; understudy_slots: number | null }[] | null | undefined;
  timingChosen: boolean;
  coverage: LadderCoverageInputs | null | undefined;
}
export function resolveCoverage(inputs: LadderCoverageInputs): CoverageResult;
export function computeBookingSetupStatus(input: BookingSetupStatusInput): BookingSetupStatus;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/bookings/setupStatus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveCoverage, computeBookingSetupStatus, type LadderCoverageInputs } from "./setupStatus";

const emptyCoverage: LadderCoverageInputs = { futurePairs: [], showPriorities: [], cityPriorities: [] };

describe("resolveCoverage", () => {
  it("covers a pair when the city list has a tier-1 cast", () => {
    const r = resolveCoverage({
      futurePairs: [{ showId: "s1", cityId: "c1" }],
      showPriorities: [],
      cityPriorities: [{ cityId: "c1", castId: "k1", priority: 1 }],
    });
    expect(r.uncoveredPairs).toEqual([]);
    expect(r.hasNullCity).toBe(false);
  });

  it("reports uncovered when the city ladder starts at tier 2", () => {
    const r = resolveCoverage({
      futurePairs: [{ showId: "s1", cityId: "c1" }],
      showPriorities: [],
      cityPriorities: [{ cityId: "c1", castId: "k1", priority: 2 }],
    });
    expect(r.uncoveredPairs).toEqual([{ showId: "s1", cityId: "c1" }]);
  });

  it("lets show-scoped priorities override the city list outright", () => {
    // City list HAS a tier 1, but the show-scoped rows for this (show,city) do not,
    // so the show scope wins and the pair is uncovered (mirrors resolveTierLadder).
    const r = resolveCoverage({
      futurePairs: [{ showId: "s1", cityId: "c1" }],
      showPriorities: [{ showId: "s1", cityId: "c1", castId: "k9", priority: 2 }],
      cityPriorities: [{ cityId: "c1", castId: "k1", priority: 1 }],
    });
    expect(r.uncoveredPairs).toEqual([{ showId: "s1", cityId: "c1" }]);
  });

  it("flags a future date with no city and skips it as a pair", () => {
    const r = resolveCoverage({
      futurePairs: [{ showId: "s1", cityId: null }],
      showPriorities: [], cityPriorities: [],
    });
    expect(r.hasNullCity).toBe(true);
    expect(r.uncoveredPairs).toEqual([]);
  });

  it("dedupes repeated (show,city) pairs", () => {
    const r = resolveCoverage({
      futurePairs: [{ showId: "s1", cityId: "c1" }, { showId: "s1", cityId: "c1" }],
      showPriorities: [], cityPriorities: [],
    });
    expect(r.uncoveredPairs).toEqual([{ showId: "s1", cityId: "c1" }]);
  });
});

describe("computeBookingSetupStatus", () => {
  const base = { flowChosen: true, shows: [], timingChosen: true, coverage: emptyCoverage };

  it("orders the five steps and blocks only ladder/slots", () => {
    const s = computeBookingSetupStatus(base);
    expect(s.steps.map((x) => x.key)).toEqual(["flow", "slots", "ladder", "eligibility", "timing"]);
    expect(s.steps.find((x) => x.key === "ladder")!.block).toBe("offers");
    expect(s.steps.find((x) => x.key === "slots")!.block).toBe("filling");
    expect(s.steps.find((x) => x.key === "flow")!.block).toBeNull();
  });

  it("is complete when every step is done", () => {
    const s = computeBookingSetupStatus(base);
    expect(s.complete).toBe(true);
    expect(s.canOffer).toBe(true);
    expect(s.doneCount).toBe(5);
  });

  it("slots outstanding when any show has a null count", () => {
    const s = computeBookingSetupStatus({ ...base, shows: [{ main_cast_slots: null, understudy_slots: 2 }] });
    expect(s.steps.find((x) => x.key === "slots")!.done).toBe(false);
    expect(s.complete).toBe(false);
    expect(s.canOffer).toBe(true); // slots does not block offers
  });

  it("ladder outstanding blocks offers; eligibility also fails on a null city", () => {
    const s = computeBookingSetupStatus({
      ...base,
      coverage: {
        futurePairs: [{ showId: "s1", cityId: "c1" }, { showId: "s2", cityId: null }],
        showPriorities: [], cityPriorities: [],
      },
    });
    expect(s.steps.find((x) => x.key === "ladder")!.done).toBe(false);
    expect(s.steps.find((x) => x.key === "eligibility")!.done).toBe(false);
    expect(s.canOffer).toBe(false);
  });

  it("treats unread inputs as outstanding (fail-safe)", () => {
    const s = computeBookingSetupStatus({
      flowChosen: false, shows: undefined, timingChosen: false, coverage: undefined,
    });
    expect(s.doneCount).toBe(0);
    expect(s.canOffer).toBe(false);
    expect(s.complete).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/bookings/setupStatus.test.ts`
Expected: FAIL — cannot resolve `./setupStatus`.

- [ ] **Step 3: Implement the module**

Create `src/lib/bookings/setupStatus.ts`:

```ts
// Client-only booking-setup readiness for the guided-onboarding rail (design 1a).
//
// Deliberately SEPARATE from the engine's own gates. The coverage rule mirrors
// resolveTierLadder in supabase/functions/_shared/eligibility.ts (show-scoped
// show_cast_eligibility priorities win outright, else the org-wide
// cast_city_priority for the city) and only ever OVER-reports: it drives an
// affordance, and open-offer-tier remains authoritative.

export type BookingSetupStepKey = "flow" | "slots" | "ladder" | "eligibility" | "timing";
export type BlockKind = "offers" | "filling" | null;

export interface BookingSetupStep {
  key: BookingSetupStepKey;
  done: boolean;
  block: BlockKind;
}

export interface BookingSetupStatus {
  steps: BookingSetupStep[];
  doneCount: number;
  totalCount: number;
  /** Every offers-blocking step is done: a tier can open. */
  canOffer: boolean;
  /** Every step is done: the rail retires. */
  complete: boolean;
}

export interface LadderCoverageInputs {
  /** (show, city) of every future non-cancelled date; city may be null. */
  futurePairs: { showId: string; cityId: string | null }[];
  /** show_cast_eligibility rows with a non-null priority. */
  showPriorities: { showId: string; cityId: string; castId: string; priority: number }[];
  /** cast_city_priority rows for the org. */
  cityPriorities: { cityId: string; castId: string; priority: number }[];
}

export interface CoverageResult {
  /** Pairs with a city whose effective ladder has no tier-1 cast. */
  uncoveredPairs: { showId: string; cityId: string }[];
  /** At least one future date has no city assigned. */
  hasNullCity: boolean;
}

export interface BookingSetupStatusInput {
  /** The org has its OWN booking_flow row (inheriting the classic default is not a choice). */
  flowChosen: boolean;
  /** shows-with-slots; undefined while unread → slots reported outstanding. */
  shows: { main_cast_slots: number | null; understudy_slots: number | null }[] | null | undefined;
  /** The org has its own row for all three timing keys. */
  timingChosen: boolean;
  /** undefined while unread → ladder/eligibility reported outstanding. */
  coverage: LadderCoverageInputs | null | undefined;
}

const STEP_ORDER: BookingSetupStepKey[] = ["flow", "slots", "ladder", "eligibility", "timing"];
const BLOCK: Record<BookingSetupStepKey, BlockKind> = {
  flow: null, slots: "filling", ladder: "offers", eligibility: null, timing: null,
};

export function resolveCoverage(inputs: LadderCoverageInputs): CoverageResult {
  const uncoveredPairs: { showId: string; cityId: string }[] = [];
  let hasNullCity = false;
  const seen = new Set<string>();
  for (const p of inputs.futurePairs) {
    if (p.cityId === null) { hasNullCity = true; continue; }
    const key = `${p.showId}|${p.cityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const scoped = inputs.showPriorities.filter((r) => r.showId === p.showId && r.cityId === p.cityId);
    const ladder = scoped.length > 0 ? scoped : inputs.cityPriorities.filter((r) => r.cityId === p.cityId);
    if (!ladder.some((r) => r.priority === 1)) uncoveredPairs.push({ showId: p.showId, cityId: p.cityId });
  }
  return { uncoveredPairs, hasNullCity };
}

export function computeBookingSetupStatus(input: BookingSetupStatusInput): BookingSetupStatus {
  const coverage = input.coverage ? resolveCoverage(input.coverage) : undefined;
  const done: Record<BookingSetupStepKey, boolean> = {
    flow: input.flowChosen,
    // An empty shows array is vacuously done (nothing unconfigured); undefined is unread.
    slots: Array.isArray(input.shows)
      ? input.shows.every((s) => s.main_cast_slots != null && s.understudy_slots != null)
      : false,
    ladder: coverage ? coverage.uncoveredPairs.length === 0 : false,
    eligibility: coverage ? coverage.uncoveredPairs.length === 0 && !coverage.hasNullCity : false,
    timing: input.timingChosen,
  };
  const steps = STEP_ORDER.map((key) => ({ key, done: done[key], block: BLOCK[key] }));
  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    totalCount: steps.length,
    canOffer: steps.every((s) => s.block !== "offers" || s.done),
    complete: steps.every((s) => s.done),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/bookings/setupStatus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookings/setupStatus.ts src/lib/bookings/setupStatus.test.ts
git commit -m "add the pure booking-setup readiness rule"
```

---

### Task 3: Data reads

Three org-scoped reads: the coverage inputs, the owned-settings-key set, and the flow times.

**Files:**
- Modify: `src/data/eligibility.ts` (add `fetchLadderCoverageInputs`)
- Modify: `src/data/eligibility.test.ts` (add its test; create the file if absent)
- Modify: `src/data/settings.ts` (add `fetchOwnedSettingKeys`, `fetchFlowTimes`)
- Modify: `src/data/settings.test.ts` (add their tests)

**Interfaces:**
- Produces `fetchLadderCoverageInputs(client, { orgId, today }): Promise<LadderCoverageInputs>`.
- Produces `fetchOwnedSettingKeys(client, orgId, keys): Promise<Set<string>>`.
- Produces `fetchFlowTimes(client, orgId): Promise<FlowTimes>` (`FlowTimes` from `@/lib/bookingFlow`).

- [ ] **Step 1: Write the failing tests**

Add to `src/data/eligibility.test.ts` (create with the standard header if it does not exist):

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { fetchLadderCoverageInputs } from "./eligibility";

describe("fetchLadderCoverageInputs", () => {
  it("returns future pairs, show priorities, and city priorities", async () => {
    const client = createFakeSupabase({
      show_dates: { data: [{ show_id: "s1", city_id: "c1" }, { show_id: "s1", city_id: null }], error: null },
      show_cast_eligibility: { data: [{ show_id: "s1", city_id: "c1", cast_id: "k1", priority: 1 }], error: null },
      cast_city_priority: { data: [{ city_id: "c1", cast_id: "k2", priority: 2 }], error: null },
    });
    const r = await fetchLadderCoverageInputs(asSupabase(client), { orgId: "org-1", today: "2026-08-07" });
    expect(r.futurePairs).toEqual([{ showId: "s1", cityId: "c1" }, { showId: "s1", cityId: null }]);
    expect(r.showPriorities).toEqual([{ showId: "s1", cityId: "c1", castId: "k1", priority: 1 }]);
    expect(r.cityPriorities).toEqual([{ cityId: "c1", castId: "k2", priority: 2 }]);
  });
});
```

Add to `src/data/settings.test.ts` (extend the existing import line from that file):

```ts
import { fetchOwnedSettingKeys, fetchFlowTimes } from "./settings";

describe("fetchOwnedSettingKeys", () => {
  it("returns only the org's own keys among those asked for", async () => {
    const client = createFakeSupabase({ app_settings: { data: [{ key: "booking_flow" }], error: null } });
    const owned = await fetchOwnedSettingKeys(client as never, "org-1", ["booking_flow", "offer_digest_hour_berlin"]);
    expect(owned.has("booking_flow")).toBe(true);
    expect(owned.has("offer_digest_hour_berlin")).toBe(false);
  });
  it("is empty for a null org", async () => {
    const client = createFakeSupabase({});
    expect((await fetchOwnedSettingKeys(client as never, null, ["booking_flow"])).size).toBe(0);
  });
});

describe("fetchFlowTimes", () => {
  it("falls back to BOOKING_ENGINE_DEFAULTS when no rows exist", async () => {
    const client = createFakeSupabase({ app_settings: { data: [], error: null } });
    const t = await fetchFlowTimes(client as never, "org-1");
    expect(t).toEqual({ windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/data/eligibility.test.ts src/data/settings.test.ts`
Expected: FAIL — the three functions are undefined.

- [ ] **Step 3: Implement `fetchLadderCoverageInputs`**

Append to `src/data/eligibility.ts` (import the type at the top: `import type { LadderCoverageInputs } from "@/lib/bookings/setupStatus";`):

```ts
/** The raw rows the booking-setup coverage rule needs, in one place so the pure
 *  `resolveCoverage` stays client-free. `today` is a YYYY-MM-DD cutoff (caller passes
 *  the local-tz `toDateKey(new Date())`); dates on or after it are "future". */
export async function fetchLadderCoverageInputs(
  client: SupabaseClient<Database>,
  args: { orgId: string; today: string },
): Promise<LadderCoverageInputs> {
  const dates = await client
    .from("show_dates")
    .select("show_id, city_id")
    .eq("org_id", args.orgId)
    .neq("status", "cancelled")
    .gte("date", args.today);
  if (dates.error) throw dates.error;

  const showElig = await client
    .from("show_cast_eligibility")
    .select("show_id, city_id, cast_id, priority")
    .eq("org_id", args.orgId)
    .not("priority", "is", null);
  if (showElig.error) throw showElig.error;

  const cityPri = await client
    .from("cast_city_priority")
    .select("city_id, cast_id, priority")
    .eq("org_id", args.orgId);
  if (cityPri.error) throw cityPri.error;

  const dateRows = (dates.data ?? []) as { show_id: string; city_id: string | null }[];
  const showRows = (showElig.data ?? []) as { show_id: string; city_id: string; cast_id: string; priority: number }[];
  const cityRows = (cityPri.data ?? []) as { city_id: string; cast_id: string; priority: number }[];
  return {
    futurePairs: dateRows.map((r) => ({ showId: r.show_id, cityId: r.city_id })),
    showPriorities: showRows.map((r) => ({ showId: r.show_id, cityId: r.city_id, castId: r.cast_id, priority: r.priority })),
    cityPriorities: cityRows.map((r) => ({ cityId: r.city_id, castId: r.cast_id, priority: r.priority })),
  };
}
```

Confirm `src/data/eligibility.ts` already imports `SupabaseClient` and `Database`; if not, add `import type { SupabaseClient } from "@supabase/supabase-js";` and `import type { Database } from "@/integrations/supabase/types";`.

- [ ] **Step 4: Implement `fetchOwnedSettingKeys` and `fetchFlowTimes`**

Append to `src/data/settings.ts` (import `FlowTimes` and the defaults at the top: `import type { FlowTimes } from "@/lib/bookingFlow";` and `import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";` if not already present):

```ts
/** The subset of `keys` for which the org has its OWN app_settings row (platform-default
 *  rows, org_id null, are excluded). Presence, not value: an inherited default is not a
 *  decision, which is exactly what the flow/timing setup steps test. */
export async function fetchOwnedSettingKeys(
  client: SupabaseClient<Database>,
  orgId: string | null,
  keys: readonly string[],
): Promise<Set<string>> {
  if (!orgId) return new Set();
  const { data, error } = await client
    .from("app_settings")
    .select("key")
    .eq("org_id", orgId)
    .in("key", [...keys]);
  if (error) throw error;
  return new Set(((data ?? []) as { key: string }[]).map((r) => r.key));
}

const NUM = (v: unknown, fallback: number): number => {
  if (typeof v === "number") return v;
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** The org's effective offer window and digest hours (org row over platform default over
 *  BOOKING_ENGINE_DEFAULTS), shaped as FlowTimes for lifecycle previews and the rehearsal
 *  footer. */
export async function fetchFlowTimes(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<FlowTimes> {
  const [w, o, c] = await Promise.all([
    resolveOrgSetting<unknown>(client, orgId, "offer_response_window_hours", BOOKING_ENGINE_DEFAULTS.offer_response_window_hours),
    resolveOrgSetting<unknown>(client, orgId, "offer_digest_hour_berlin", BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin),
    resolveOrgSetting<unknown>(client, orgId, "confirmation_digest_hour_berlin", BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin),
  ]);
  return {
    windowHours: NUM(w, BOOKING_ENGINE_DEFAULTS.offer_response_window_hours),
    offerDigestHour: NUM(o, BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin),
    confirmationDigestHour: NUM(c, BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin),
  };
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/data/eligibility.test.ts src/data/settings.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: clean. (Watch the new cross-imports: `data/eligibility.ts` now imports a type from `lib/bookings/setupStatus.ts`.)

- [ ] **Step 7: Commit**

```bash
git add src/data/eligibility.ts src/data/eligibility.test.ts src/data/settings.ts src/data/settings.test.ts
git commit -m "add booking-setup coverage, owned-keys, and flow-times reads"
```

---

### Task 4: Composition hooks

`useBookingSetupStatus` composes the three reads and the pure rule; `useFlowTimes` wraps `fetchFlowTimes`; `useBookingSetupRailVisible` decides whether the page reserves a rail column.

**Files:**
- Create: `src/hooks/useBookingSetup.ts`
- Create: `src/hooks/useBookingSetup.test.ts`
- Modify: `src/hooks/useBookingFlow.ts` (add `useFlowTimes`)
- Create: `src/components/bookings/setup/useBookingSetupRailVisible.ts`
- Create: `src/components/bookings/setup/useBookingSetupRailVisible.test.ts`

**Interfaces:**
- Consumes `computeBookingSetupStatus`, `fetchLadderCoverageInputs`, `fetchOwnedSettingKeys`, `fetchShowsWithSlots`, `fetchFlowTimes`, `toDateKey`, `useCan`, `useRailDismissed`.
- Produces `useBookingSetupStatus(orgId): { status, coverage, isLoading, isError }`.
- Produces `useFlowTimes(orgId): UseQueryResult<FlowTimes>`.
- Produces `useBookingSetupRailVisible(orgId: string | null): boolean`.

- [ ] **Step 1: Write the failing hook test**

Create `src/hooks/useBookingSetup.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

import { useBookingSetupStatus } from "./useBookingSetup";

beforeEach(() => {
  seed({
    app_settings: { data: [{ key: "booking_flow" }], error: null },
    shows: { data: [], error: null },
    show_dates: { data: [], error: null },
    show_cast_eligibility: { data: [], error: null },
    cast_city_priority: { data: [], error: null },
  });
});

describe("useBookingSetupStatus", () => {
  it("marks flow chosen when the org owns a booking_flow row", async () => {
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.steps.find((s) => s.key === "flow")!.done).toBe(true);
  });

  it("returns a not-loading, all-outstanding status for a null org", async () => {
    const { result } = renderHookWithProviders(() => useBookingSetupStatus(null));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.status.doneCount).toBe(0);
  });
});
```

Create `src/components/bookings/setup/useBookingSetupRailVisible.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";

const { statusRef, canRef } = vi.hoisted(() => ({
  statusRef: { value: { status: { complete: false, canOffer: false }, isLoading: false } },
  canRef: { value: true },
}));
vi.mock("@/hooks/useBookingSetup", () => ({ useBookingSetupStatus: () => statusRef.value }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canRef.value }));

import { useBookingSetupRailVisible } from "./useBookingSetupRailVisible";

beforeEach(() => {
  localStorage.clear();
  canRef.value = true;
  statusRef.value = { status: { complete: false, canOffer: false } as never, isLoading: false };
});

describe("useBookingSetupRailVisible", () => {
  it("is false without an org", () => {
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible(null));
    expect(result.current).toBe(false);
  });
  it("is true for an admin who can edit while setup is incomplete", () => {
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current).toBe(true);
  });
  it("hides for a non-editor once offers are already possible", () => {
    canRef.value = false;
    statusRef.value = { status: { complete: false, canOffer: true } as never, isLoading: false };
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current).toBe(false);
  });
  it("hides once setup is complete", () => {
    statusRef.value = { status: { complete: true, canOffer: true } as never, isLoading: false };
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/hooks/useBookingSetup.test.ts src/components/bookings/setup/useBookingSetupRailVisible.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement `useBookingSetupStatus`**

Create `src/hooks/useBookingSetup.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchShowsWithSlots, fetchOwnedSettingKeys } from "@/data/settings";
import { fetchLadderCoverageInputs } from "@/data/eligibility";
import { toDateKey } from "@/lib/dates";
import {
  computeBookingSetupStatus,
  type BookingSetupStatus,
  type LadderCoverageInputs,
} from "@/lib/bookings/setupStatus";

const TIMING_KEYS = [
  "offer_response_window_hours",
  "offer_digest_hour_berlin",
  "confirmation_digest_hour_berlin",
] as const;
const OWNED_KEYS = ["booking_flow", ...TIMING_KEYS] as const;

/** Org-level booking-setup readiness for the rail: three org-scoped reads composed
 *  through the pure `computeBookingSetupStatus`. Every read failing/loading reports its
 *  step outstanding rather than done. */
export function useBookingSetupStatus(orgId: string | null): {
  status: BookingSetupStatus;
  coverage: LadderCoverageInputs | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const owned = useQuery({
    queryKey: ["app-settings", "owned-keys", orgId],
    enabled: !!orgId,
    queryFn: () => fetchOwnedSettingKeys(supabase, orgId, OWNED_KEYS),
  });
  const shows = useQuery({
    queryKey: ["shows", "with-slots", orgId],
    enabled: !!orgId,
    queryFn: () => fetchShowsWithSlots(supabase, orgId),
  });
  const coverage = useQuery({
    queryKey: ["eligibility", "ladder-coverage", orgId],
    enabled: !!orgId,
    queryFn: () => fetchLadderCoverageInputs(supabase, { orgId: orgId!, today: toDateKey(new Date()) }),
  });

  const isLoading = !!orgId && (owned.isLoading || shows.isLoading || coverage.isLoading);
  const isError = owned.isError || shows.isError || coverage.isError;
  const ownedSet = owned.data;
  const status = computeBookingSetupStatus({
    flowChosen: ownedSet ? ownedSet.has("booking_flow") : false,
    shows: shows.data,
    timingChosen: ownedSet ? TIMING_KEYS.every((k) => ownedSet.has(k)) : false,
    coverage: coverage.data,
  });
  return { status, coverage: coverage.data, isLoading, isError };
}
```

- [ ] **Step 4: Add `useFlowTimes` to `useBookingFlow.ts`**

Append to `src/hooks/useBookingFlow.ts`:

```ts
import { fetchFlowTimes } from "@/data/settings";
import type { FlowTimes } from "@/lib/bookingFlow";

/** The org's effective offer window and digest hours, for lifecycle previews and the
 *  rehearsal footer. */
export function useFlowTimes(orgId: string | null) {
  return useQuery({
    queryKey: ["app-settings", "flow-times", orgId],
    queryFn: () => fetchFlowTimes(supabase, orgId),
  });
}
```

(The file already imports `useQuery` and `supabase`.)

- [ ] **Step 5: Implement `useBookingSetupRailVisible`**

Create `src/components/bookings/setup/useBookingSetupRailVisible.ts`:

```ts
import { useCan } from "@/hooks/useCapabilities";
import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import { useRailDismissed } from "@/components/setup/useRailDismissed";

/**
 * Whether `BookingSetupRail` renders anything. Its own module rather than a second export
 * from the rail, because ShowsBookingsPage must know the answer before it picks its grid
 * template: a null child does not collapse a grid track. Mirrors
 * `hireOrders/setup/useSetupRailVisible`.
 */
export function useBookingSetupRailVisible(orgId: string | null): boolean {
  const canEdit = useCan("edit_booking_settings");
  const { status, isLoading } = useBookingSetupStatus(orgId);
  const [dismissed] = useRailDismissed("bookingSetup", orgId);

  if (!orgId) return false;
  if (isLoading || dismissed || status.complete) return false;
  // A non-editor (producer without edit_booking_settings) is only shown the waiting card
  // while offers are actually blocked, so an org that can already offer never shows a
  // producer a blocker no admin action would clear.
  return canEdit || !status.canOffer;
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run src/hooks/useBookingSetup.test.ts src/components/bookings/setup/useBookingSetupRailVisible.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc -p tsconfig.app.json --noEmit
git add src/hooks/useBookingSetup.ts src/hooks/useBookingSetup.test.ts src/hooks/useBookingFlow.ts src/components/bookings/setup/useBookingSetupRailVisible.ts src/components/bookings/setup/useBookingSetupRailVisible.test.ts
git commit -m "compose booking-setup status, flow times, and rail visibility"
```

---

### Task 5: Step panels

The five expandable panels. Flow and Slots and Timing write; Ladder and Eligibility are read-only with a link to Settings.

**Files:**
- Create: `src/components/bookings/setup/FlowStep.tsx`
- Create: `src/components/bookings/setup/FlowStep.test.tsx`
- Create: `src/components/bookings/setup/SlotsStep.tsx`
- Create: `src/components/bookings/setup/SlotsStep.test.tsx`
- Create: `src/components/bookings/setup/LadderStep.tsx`
- Create: `src/components/bookings/setup/EligibilityStep.tsx`
- Create: `src/components/bookings/setup/CoverageSteps.test.tsx`

**Interfaces:**
- Consumes `FlowPresets`, `lifecycleChips`, `inPracticeRows`, `applyPreset`, `normalizeBookingFlow`, `matchPreset`, `BOOKING_FLOW_DEFAULTS`, `useBookingFlow`, `useFlowTimes`, `upsertOrgSetting`, `updateShow`, `fetchShowsWithSlots`, `showSlots`, `useAllCities`, `useShows`, `ROUTES`, `LadderCoverageInputs`.
- Produces `FlowStep`, `SlotsStep`, `LadderStep`, `EligibilityStep`, each with props stated below.

- [ ] **Step 1: Write the failing panel tests**

Create `src/components/bookings/setup/FlowStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const { flowRef, timesRef } = vi.hoisted(() => ({
  flowRef: { value: undefined as unknown },
  timesRef: { value: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 } },
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowRef.value }),
  useFlowTimes: () => ({ data: timesRef.value }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { FlowStep } from "./FlowStep";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";

beforeEach(() => { flowRef.value = { ...BOOKING_FLOW_DEFAULTS }; });

describe("FlowStep", () => {
  it("renders the three preset cards and a live lifecycle preview", async () => {
    renderWithProviders(<FlowStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText("Classic")).toBeInTheDocument();
    expect(screen.getByText("Fast-track")).toBeInTheDocument();
    expect(screen.getByText("Direct book")).toBeInTheDocument();
    // Classic lifecycle chips: Suggested / Soft booked / Confirmed
    expect(screen.getByText("Soft booked")).toBeInTheDocument();
  });
});
```

Create `src/components/bookings/setup/SlotsStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const { showsRef } = vi.hoisted(() => ({ showsRef: { value: [] as unknown[] } }));
vi.mock("@/data/settings", () => ({ fetchShowsWithSlots: () => Promise.resolve(showsRef.value) }));
vi.mock("@/data/shows", () => ({ updateShow: vi.fn(() => Promise.resolve()) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { SlotsStep } from "./SlotsStep";

beforeEach(() => {
  showsRef.value = [
    { id: "s1", program: "Winterreise", sub_program: "Ensemble", main_cast_slots: null, understudy_slots: null },
    { id: "s2", program: "Set", sub_program: "Done", main_cast_slots: 4, understudy_slots: 2 },
  ];
});

describe("SlotsStep", () => {
  it("lists only shows missing a slot count", async () => {
    renderWithProviders(<SlotsStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText(/Winterreise/)).toBeInTheDocument();
    expect(screen.queryByText(/Set . Done|Set · Done/)).not.toBeInTheDocument();
  });
});
```

Create `src/components/bookings/setup/CoverageSteps.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/hooks/useAllCities", () => ({ useAllCities: () => ({ data: [{ id: "c1", name: "Hamburg" }] }) }));
vi.mock("@/hooks/useShows", () => ({ useShows: () => ({ data: [{ id: "s1", program: "Winterreise", sub_program: "Ensemble" }] }) }));

import { EligibilityStep } from "./EligibilityStep";
import type { LadderCoverageInputs } from "@/lib/bookings/setupStatus";

const uncovered: LadderCoverageInputs = {
  futurePairs: [{ showId: "s1", cityId: "c1" }],
  showPriorities: [], cityPriorities: [],
};

describe("EligibilityStep", () => {
  it("names the uncovered (show, city) pair", () => {
    renderWithProviders(
      <MemoryRouter><EligibilityStep coverage={uncovered} /></MemoryRouter>,
    );
    expect(screen.getByText(/Hamburg/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/bookings/setup/FlowStep.test.tsx src/components/bookings/setup/SlotsStep.test.tsx src/components/bookings/setup/CoverageSteps.test.tsx`
Expected: FAIL — panels do not exist.

- [ ] **Step 3: Implement `FlowStep`**

Create `src/components/bookings/setup/FlowStep.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { upsertOrgSetting } from "@/data/settings";
import { useBookingFlow, useFlowTimes } from "@/hooks/useBookingFlow";
import {
  applyPreset, matchPreset, normalizeBookingFlow, lifecycleChips, inPracticeRows,
  BOOKING_FLOW_DEFAULTS, type PresetName, type FlowTimes,
} from "@/lib/bookingFlow";
import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";
import { FlowPresets } from "@/components/settings/bookingFlow/FlowPresets";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Json } from "@/integrations/supabase/types";

const PRESET_NAMES: Record<PresetName, string> = { classic: "Classic", fasttrack: "Fast-track", direct: "Direct book" };
const CHIP_TONE: Record<string, string> = {
  violet: "bg-[var(--accent-500)]", amber: "bg-[var(--amber-500)]",
  green: "bg-[var(--green-500)]", neutral: "bg-muted-foreground",
};
const DEFAULT_TIMES: FlowTimes = {
  windowHours: BOOKING_ENGINE_DEFAULTS.offer_response_window_hours,
  offerDigestHour: BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin,
  confirmationDigestHour: BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin,
};

/** The rail's flow panel: pick a preset, see the live lifecycle and per-audience
 *  consequences (the real policy, not static prose), save through the settings path. */
export function FlowStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: flow } = useBookingFlow();
  const { data: times } = useFlowTimes(orgId);
  const base = flow ?? BOOKING_FLOW_DEFAULTS;
  const t = times ?? DEFAULT_TIMES;

  const [selected, setSelected] = useState<PresetName>("classic");
  const seeded = useRef(false);
  useEffect(() => {
    if (!flow || seeded.current) return;
    seeded.current = true;
    const m = matchPreset(flow);
    if (m !== "custom") setSelected(m);
  }, [flow]);

  const preview = normalizeBookingFlow(applyPreset(base, selected));
  const chips = lifecycleChips(preview);
  const rows = inPracticeRows(preview, t);

  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error("No active organization");
      return upsertOrgSetting(supabase, orgId, "booking_flow", preview as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success(`Booking flow set to ${PRESET_NAMES[selected]}`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        This decides what artists see and what the app calls things. Pick one, read what it does, change it any time in Settings.
      </p>
      <FlowPresets active={selected} onSelect={(p) => setSelected(p)} />
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">A booking then goes</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span key={c.label} className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-2 py-0.5 text-xs font-medium">
              <span className={cn("h-1.5 w-1.5 rounded-sm", CHIP_TONE[c.tone])} />
              {c.label}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.who} className="grid grid-cols-[78px_1fr] gap-2.5">
            <span className="pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{r.who}</span>
            <span className="text-xs leading-[18px] text-muted-foreground">{r.text}</span>
          </div>
        ))}
      </div>
      <Button size="sm" disabled={save.isPending || !orgId} onClick={() => save.mutate()}>
        Use {PRESET_NAMES[selected]}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Implement `SlotsStep`**

Create `src/components/bookings/setup/SlotsStep.tsx`:

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchShowsWithSlots } from "@/data/settings";
import { updateShow } from "@/data/shows";
import { showSlots } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Draft = Record<string, { main: string; us: string }>;

/** The rail's slots panel: number inputs for each show still missing a slot count.
 *  Saves through `updateShow`, the same path the Productions page uses. */
export function SlotsStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }) {
  const qc = useQueryClient();
  const shows = useQuery({
    queryKey: ["shows", "with-slots", orgId],
    enabled: !!orgId,
    queryFn: () => fetchShowsWithSlots(supabase, orgId),
  });
  const unset = (shows.data ?? []).filter((s) => showSlots(s) === null);
  const [draft, setDraft] = useState<Draft>({});
  const val = (id: string, k: "main" | "us") => draft[id]?.[k] ?? "";
  const setVal = (id: string, k: "main" | "us", v: string) =>
    setDraft((d) => ({ ...d, [id]: { main: d[id]?.main ?? "", us: d[id]?.us ?? "", [k]: v } }));

  const save = useMutation({
    mutationFn: async () => {
      const edits = unset
        .map((s) => ({ id: s.id, main: draft[s.id]?.main, us: draft[s.id]?.us }))
        .filter((e) => e.main !== undefined && e.main !== "" && e.us !== undefined && e.us !== "");
      if (edits.length === 0) throw new Error("Enter a main and understudy count");
      await Promise.all(
        edits.map((e) =>
          updateShow(supabase, e.id, { main_cast_slots: Number(e.main), understudy_slots: Number(e.us) }),
        ),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shows"] });
      toast.success("Slot counts saved");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (shows.isLoading) return <Skeleton className="h-24 w-full" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        A date with no slot count never reads as full, so it can't reach fully filled or auto-draft a hire order.
      </p>
      <div className="overflow-hidden rounded-md border border-border">
        {unset.map((s) => (
          <div key={s.id} className="flex items-center gap-2.5 border-b border-border p-2 last:border-b-0">
            <span className="min-w-0 flex-1 truncate text-sm">
              {s.program}
              {s.sub_program ? <span className="text-muted-foreground"> · {s.sub_program}</span> : null}
            </span>
            <label className="text-[11px] text-muted-foreground">main</label>
            <Input type="number" min={0} className="h-7 w-14" value={val(s.id, "main")}
              onChange={(e) => setVal(s.id, "main", e.target.value)} />
            <label className="text-[11px] text-muted-foreground">u/s</label>
            <Input type="number" min={0} className="h-7 w-14" value={val(s.id, "us")}
              onChange={(e) => setVal(s.id, "us", e.target.value)} />
          </div>
        ))}
      </div>
      <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save slot counts</Button>
    </div>
  );
}
```

- [ ] **Step 5: Implement `LadderStep` and `EligibilityStep`**

Create `src/components/bookings/setup/LadderStep.tsx`:

```tsx
import { Link } from "react-router-dom";
import { useAllCities } from "@/hooks/useAllCities";
import { ROUTES } from "@/config/app.config";
import type { LadderCoverageInputs } from "@/lib/bookings/setupStatus";

/** Read-only: the cities that have a future date, and whether each has a tier-1 cast in
 *  the org-wide priority list. Show-scoped overrides live per show, so this is the
 *  org-default view; deep edits happen in Settings. */
export function LadderStep({ coverage }: { coverage: LadderCoverageInputs | undefined }) {
  const cities = useAllCities();
  const nameOf = (id: string) => (cities.data ?? []).find((c) => c.id === id)?.name ?? "Unknown city";

  const cityIds = [...new Set((coverage?.futurePairs ?? []).map((p) => p.cityId).filter((x): x is string => !!x))];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        The order offers go out in. Tier 1 is asked first; unfilled tiers escalate down the ladder.
      </p>
      <div className="space-y-2">
        {cityIds.map((cid) => {
          const tiers = (coverage?.cityPriorities ?? [])
            .filter((r) => r.cityId === cid)
            .sort((a, b) => a.priority - b.priority);
          const hasTier1 = tiers.some((r) => r.priority === 1);
          return (
            <div key={cid} className="rounded-md border border-border bg-card p-2.5">
              <p className="text-xs font-semibold">{nameOf(cid)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {tiers.length === 0
                  ? "No casts ranked."
                  : hasTier1
                    ? `${tiers.length} tier${tiers.length === 1 ? "" : "s"} ranked.`
                    : "Ranked, but nothing at tier 1."}
              </p>
            </div>
          );
        })}
      </div>
      <Link to={ROUTES.SETTINGS} className="text-xs text-primary underline">
        Rank casts in Settings, Casts and cities
      </Link>
    </div>
  );
}
```

Create `src/components/bookings/setup/EligibilityStep.tsx`:

```tsx
import { Link } from "react-router-dom";
import { useAllCities } from "@/hooks/useAllCities";
import { useShows } from "@/hooks/useShows";
import { resolveCoverage, type LadderCoverageInputs } from "@/lib/bookings/setupStatus";
import { ROUTES } from "@/config/app.config";

/** Read-only: the (show, city) pairs with a future date but no tier-1 cast, plus a count
 *  of future dates that have no city. Both are why a tier would open to nobody. */
export function EligibilityStep({ coverage }: { coverage: LadderCoverageInputs | undefined }) {
  const cities = useAllCities();
  const shows = useShows();
  const cityName = (id: string) => (cities.data ?? []).find((c) => c.id === id)?.name ?? "Unknown city";
  const showName = (id: string) => {
    const s = (shows.data ?? []).find((x) => x.id === id);
    return s ? `${s.program}${s.sub_program ? ` · ${s.sub_program}` : ""}` : "Unknown show";
  };

  const result = coverage ? resolveCoverage(coverage) : { uncoveredPairs: [], hasNullCity: false };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Which casts can be offered a show in a city. Without a match the tier opens to nobody.
      </p>
      {result.uncoveredPairs.length === 0 && !result.hasNullCity ? (
        <p className="text-xs text-muted-foreground">Every scheduled show and city has a cast at tier 1.</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          {result.uncoveredPairs.map((p) => (
            <div key={`${p.showId}|${p.cityId}`} className="flex items-center gap-2.5 border-b border-border p-2 text-xs last:border-b-0">
              <span className="min-w-0 flex-1 truncate">{showName(p.showId)} · {cityName(p.cityId)}</span>
              <span className="text-muted-foreground">no tier-1 cast</span>
            </div>
          ))}
          {result.hasNullCity && (
            <div className="p-2 text-xs text-muted-foreground">One or more future dates have no city assigned.</div>
          )}
        </div>
      )}
      <Link to={ROUTES.SETTINGS} className="text-xs text-primary underline">
        Link casts in Settings, Casts and cities
      </Link>
    </div>
  );
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run src/components/bookings/setup/FlowStep.test.tsx src/components/bookings/setup/SlotsStep.test.tsx src/components/bookings/setup/CoverageSteps.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc -p tsconfig.app.json --noEmit
git add src/components/bookings/setup/FlowStep.tsx src/components/bookings/setup/FlowStep.test.tsx src/components/bookings/setup/SlotsStep.tsx src/components/bookings/setup/SlotsStep.test.tsx src/components/bookings/setup/LadderStep.tsx src/components/bookings/setup/EligibilityStep.tsx src/components/bookings/setup/CoverageSteps.test.tsx
git commit -m "add the booking-setup step panels"
```

---

### Task 6: Rail shell and producer waiting card

Assemble the panels into the rail, with the header, progress dashes, and the producer fallback.

**Files:**
- Create: `src/components/bookings/setup/BookingSetupRail.tsx`
- Create: `src/components/bookings/setup/BookingSetupRail.test.tsx`
- Create: `src/components/bookings/setup/BookingProducerWaitingCard.tsx`

**Interfaces:**
- Consumes `useBookingSetupStatus`, `useCan`, `useRailDismissed`, `SetupStepRow`, the four step panels, and (Task 7) `RehearsalBlock`.
- Produces `BookingSetupRail({ orgId })`.

- [ ] **Step 1: Write the failing rail test**

Create `src/components/bookings/setup/BookingSetupRail.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
const { canRef } = vi.hoisted(() => ({ canRef: { value: true } }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canRef.value }));
// Rehearsal makes an edge call; stub it out for the shell test.
vi.mock("./RehearsalBlock", () => ({ RehearsalBlock: () => null }));

import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

import { BookingSetupRail } from "./BookingSetupRail";

beforeEach(() => {
  localStorage.clear();
  canRef.value = true;
  seed({
    app_settings: { data: [], error: null },
    shows: { data: [], error: null },
    show_dates: { data: [], error: null },
    show_cast_eligibility: { data: [], error: null },
    cast_city_priority: { data: [], error: null },
  });
});

describe("BookingSetupRail", () => {
  it("renders the five steps with a blocking chip on ladder and slots", async () => {
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText("Booking flow")).toBeInTheDocument();
    expect(screen.getByText("Slots per show")).toBeInTheDocument();
    expect(screen.getByText("Cast priorities per city")).toBeInTheDocument();
    expect(screen.getByText("Who is eligible")).toBeInTheDocument();
    expect(screen.getByText("Response window and digests")).toBeInTheDocument();
    expect(screen.getByText("Blocks offers")).toBeInTheDocument();
    expect(screen.getByText("Blocks filling")).toBeInTheDocument();
  });

  it("shows the waiting card to a viewer who cannot edit booking settings", async () => {
    canRef.value = false;
    // Force an offers-blocking gap so a non-editor is shown the card at all.
    seed({
      app_settings: { data: [], error: null },
      shows: { data: [], error: null },
      show_dates: { data: [{ show_id: "s1", city_id: "c1" }], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
    });
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText(/Waiting on your admin/i)).toBeInTheDocument();
    expect(screen.queryByText("Blocks filling")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/bookings/setup/BookingSetupRail.test.tsx`
Expected: FAIL — `BookingSetupRail` does not exist.

- [ ] **Step 3: Implement the producer waiting card**

Create `src/components/bookings/setup/BookingProducerWaitingCard.tsx`:

```tsx
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { BookingSetupStep } from "@/lib/bookings/setupStatus";

const LABELS: Record<string, string> = {
  flow: "Booking flow",
  slots: "Slots per show",
  ladder: "Cast priorities per city",
  eligibility: "Who is eligible",
  timing: "Response window and digests",
};

/** Shown instead of the rail when the viewer lacks `edit_booking_settings`. Lists only
 *  steps that actually block something. Does not name the admin (list_org_members is
 *  admin-guarded). Adding dates and sessions is unaffected, which is the point. */
export function BookingProducerWaitingCard({ steps }: { steps: BookingSetupStep[] }) {
  const outstanding = steps.filter((s) => !s.done && s.block !== null);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--amber-600)]">
            Waiting on your admin
          </p>
          <p className="mt-1.5 font-display text-base font-semibold">Plan dates now, offer later</p>
          <p className="mt-1 text-xs leading-[19px] text-muted-foreground">
            Nothing stops you adding dates and sessions. An admin has to finish setup before a tier can open.
          </p>
        </div>
        <div className="space-y-2">
          {outstanding.map((s) => (
            <div key={s.key} className="flex items-center gap-2 rounded-md border border-border p-2.5">
              <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{LABELS[s.key] ?? s.key}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Implement the rail**

Create `src/components/bookings/setup/BookingSetupRail.tsx`:

```tsx
import { useState } from "react";
import { useCan } from "@/hooks/useCapabilities";
import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import type { BookingSetupStepKey, BlockKind } from "@/lib/bookings/setupStatus";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SetupStepRow, type SetupStepBlock } from "@/components/setup/SetupStepRow";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import { FlowStep } from "./FlowStep";
import { SlotsStep } from "./SlotsStep";
import { LadderStep } from "./LadderStep";
import { EligibilityStep } from "./EligibilityStep";
import { RehearsalBlock } from "./RehearsalBlock";
import { BookingProducerWaitingCard } from "./BookingProducerWaitingCard";

const TITLES: Record<BookingSetupStepKey, string> = {
  flow: "Booking flow",
  slots: "Slots per show",
  ladder: "Cast priorities per city",
  eligibility: "Who is eligible",
  timing: "Response window and digests",
};

const HINTS: Record<BookingSetupStepKey, { todo: string; done: string }> = {
  flow: { todo: "Offers, or straight to booked. Everything downstream reads this.", done: "Chosen. Change it any time in Settings." },
  slots: { todo: "A show with no slot count never reads as full.", done: "Set on every show." },
  ladder: { todo: "The order offers go out in, per city.", done: "Every scheduled city has a tier-1 cast." },
  eligibility: { todo: "Which casts can be offered which show in which city.", done: "Every scheduled show and city has a cast." },
  timing: { todo: "How long artists get, and when mail goes out.", done: "Window and digest hours set." },
};

const BLOCK_CHIP: Record<Exclude<BlockKind, null>, SetupStepBlock> = {
  offers: { label: "Blocks offers", tone: "risk" },
  filling: { label: "Blocks filling", tone: "neutral" },
};

/**
 * The bookings setup rail beside the Shows and bookings table. Renders nothing once setup
 * is complete or the viewer hid it (that decision lives in `useBookingSetupRailVisible`,
 * which the page also reads to choose its grid template). Setup happens here, but every
 * panel writes through the same path as its Settings card.
 */
export function BookingSetupRail({ orgId }: { orgId: string | null }) {
  const canEdit = useCan("edit_booking_settings");
  const { status, coverage } = useBookingSetupStatus(orgId);
  const [, dismiss] = useRailDismissed("bookingSetup", orgId);
  const [open, setOpen] = useState<BookingSetupStepKey | null>("flow");

  if (!canEdit) return <BookingProducerWaitingCard steps={status.steps} />;

  const toggle = (key: BookingSetupStepKey) => setOpen((cur) => (cur === key ? null : key));

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Set up · {status.doneCount} of {status.totalCount}
            </p>
            <Button variant="ghost" size="sm" className="h-auto p-1 text-xs" onClick={dismiss}>Hide</Button>
          </div>
          <p className="mt-1.5 font-display text-base font-semibold">Get bookings running</p>
          <p className="mt-1 text-xs leading-[19px] text-muted-foreground">
            Dates keep syncing and you can edit them now. These are what the first offer needs.
          </p>
          <div className="mt-3 flex gap-1">
            {status.steps.map((s) => (
              <span key={s.key} className={`h-[3px] w-full rounded-full ${s.done ? "bg-accent-500" : "bg-muted"}`} />
            ))}
          </div>
        </div>
        <div>
          {status.steps.map((s, i) => (
            <SetupStepRow
              key={s.key}
              index={i + 1}
              title={TITLES[s.key]}
              hint={s.done ? HINTS[s.key].done : HINTS[s.key].todo}
              done={s.done}
              block={s.block ? BLOCK_CHIP[s.block] : null}
              expanded={open === s.key}
              onToggle={() => toggle(s.key)}
            >
              {s.key === "flow" && <FlowStep orgId={orgId} onDone={() => setOpen("slots")} />}
              {s.key === "slots" && <SlotsStep orgId={orgId} onDone={() => setOpen(null)} />}
              {s.key === "ladder" && <LadderStep coverage={coverage} />}
              {s.key === "eligibility" && <EligibilityStep coverage={coverage} />}
              {s.key === "timing" && <TimingStep orgId={orgId} onDone={() => setOpen(null)} />}
            </SetupStepRow>
          ))}
        </div>
        <RehearsalBlock orgId={orgId} />
      </CardContent>
    </Card>
  );
}
```

Note: `TimingStep` is referenced here. Create it as a small sibling now (it is trivial and does not warrant its own task). Create `src/components/bookings/setup/TimingStep.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { upsertOrgSetting } from "@/data/settings";
import { useFlowTimes } from "@/hooks/useBookingFlow";
import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The rail's timing panel: offer window and the two Berlin digest hours, seeded from the
 *  live values (defaults 48h / 19:00 / 20:00), written as the three settings keys. */
export function TimingStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: times } = useFlowTimes(orgId);
  const [win, setWin] = useState(String(BOOKING_ENGINE_DEFAULTS.offer_response_window_hours));
  const [offer, setOffer] = useState(String(BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin));
  const [conf, setConf] = useState(String(BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin));
  const seeded = useRef(false);
  useEffect(() => {
    if (!times || seeded.current) return;
    seeded.current = true;
    setWin(String(times.windowHours));
    setOffer(String(times.offerDigestHour));
    setConf(String(times.confirmationDigestHour));
  }, [times]);

  const save = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No active organization");
      await Promise.all([
        upsertOrgSetting(supabase, orgId, "offer_response_window_hours", Number(win)),
        upsertOrgSetting(supabase, orgId, "offer_digest_hour_berlin", Number(offer)),
        upsertOrgSetting(supabase, orgId, "confirmation_digest_hour_berlin", Number(conf)),
      ]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Timing saved");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2.5">
        <div className="flex-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Window (h)</Label>
          <Input type="number" min={1} className="mt-1 h-8" value={win} onChange={(e) => setWin(e.target.value)} />
        </div>
        <div className="flex-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Offer digest</Label>
          <Input type="number" min={0} max={23} className="mt-1 h-8" value={offer} onChange={(e) => setOffer(e.target.value)} />
        </div>
        <div className="flex-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Confirmations</Label>
          <Input type="number" min={0} max={23} className="mt-1 h-8" value={conf} onChange={(e) => setConf(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Berlin time. An artist offered at the digest hour has until that hour, window later.</p>
      <Button size="sm" disabled={save.isPending || !orgId} onClick={() => save.mutate()}>Save timing</Button>
    </div>
  );
}
```

Add the `TimingStep` import to `BookingSetupRail.tsx`: `import { TimingStep } from "./TimingStep";`

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/components/bookings/setup/BookingSetupRail.test.tsx`
Expected: PASS. (The test stubs `./RehearsalBlock`, created in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add src/components/bookings/setup/BookingSetupRail.tsx src/components/bookings/setup/BookingSetupRail.test.tsx src/components/bookings/setup/BookingProducerWaitingCard.tsx src/components/bookings/setup/TimingStep.tsx
git commit -m "assemble the bookings setup rail and producer waiting card"
```

---

### Task 7: Rehearsal block

Auto-pick the soonest future date with a city, dry-run tier 1, render the result. Hidden under Direct book and when no eligible date exists. Button gated on `run_offer_engine`.

**Files:**
- Create: `src/components/bookings/setup/RehearsalBlock.tsx`
- Create: `src/components/bookings/setup/RehearsalBlock.test.tsx`
- Modify: `src/data/showDates.ts` (add `fetchNextRehearsalDate` if no existing read returns the soonest future date with a city; otherwise reuse)

**Interfaces:**
- Consumes `dryRunOfferTier` (`@/data/bookings`), `useBookingFlow`, `useFlowTimes`, `useCan`, `hh` (`@/lib/bookingFlow`).
- Produces `RehearsalBlock({ orgId })`.

- [ ] **Step 1: Add the next-date read (test first)**

Add to `src/data/showDates.test.ts` (create if absent, with the standard header):

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchNextRehearsalDate } from "./showDates";

describe("fetchNextRehearsalDate", () => {
  it("returns the soonest future non-cancelled date that has a city", async () => {
    const client = createFakeSupabase({
      show_dates: { data: [{ id: "d1", date: "2026-09-18", city_id: "c1" }], error: null },
    });
    const r = await fetchNextRehearsalDate(client as never, { orgId: "org-1", today: "2026-08-07" });
    expect(r).toEqual({ id: "d1", date: "2026-09-18" });
  });

  it("returns null when nothing qualifies", async () => {
    const client = createFakeSupabase({ show_dates: { data: [], error: null } });
    expect(await fetchNextRehearsalDate(client as never, { orgId: "org-1", today: "2026-08-07" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/data/showDates.test.ts`
Expected: FAIL — `fetchNextRehearsalDate` undefined.

- [ ] **Step 3: Implement `fetchNextRehearsalDate`**

Append to `src/data/showDates.ts` (reuse the file's existing `SupabaseClient`/`Database` imports):

```ts
/** The soonest future, non-cancelled show date that has a city, for the setup-rail
 *  rehearsal. Null when none qualifies (a date without a city cannot resolve a tier). */
export async function fetchNextRehearsalDate(
  client: SupabaseClient<Database>,
  args: { orgId: string; today: string },
): Promise<{ id: string; date: string } | null> {
  const { data, error } = await client
    .from("show_dates")
    .select("id, date")
    .eq("org_id", args.orgId)
    .neq("status", "cancelled")
    .not("city_id", "is", null)
    .gte("date", args.today)
    .order("date", { ascending: true })
    .limit(1);
  if (error) throw error;
  const row = ((data ?? []) as { id: string; date: string }[])[0];
  return row ? { id: row.id, date: row.date } : null;
}
```

- [ ] **Step 4: Write the failing block test**

Create `src/components/bookings/setup/RehearsalBlock.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const { flowRef, canRef, nextRef, dryRun } = vi.hoisted(() => ({
  flowRef: { value: { artist_acceptance: true, offer_delivery: "digest" } as Record<string, unknown> },
  canRef: { value: true },
  nextRef: { value: { id: "d1", date: "2026-09-18" } as { id: string; date: string } | null },
  dryRun: vi.fn(() => Promise.resolve({ candidates: [{ id: "a1", name: "Anna Kessler" }], excluded: {}, message: undefined })),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowRef.value }),
  useFlowTimes: () => ({ data: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 } }),
}));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canRef.value }));
vi.mock("@/data/bookings", () => ({ dryRunOfferTier: dryRun }));
vi.mock("@/data/showDates", () => ({ fetchNextRehearsalDate: () => Promise.resolve(nextRef.value) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { RehearsalBlock } from "./RehearsalBlock";

beforeEach(() => {
  flowRef.value = { artist_acceptance: true, offer_delivery: "digest" };
  canRef.value = true;
  nextRef.value = { id: "d1", date: "2026-09-18" };
  dryRun.mockClear();
});

describe("RehearsalBlock", () => {
  it("runs the dry run and lists candidates", async () => {
    renderWithProviders(<RehearsalBlock orgId="org-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /run the rehearsal/i }));
    expect(await screen.findByText("Anna Kessler")).toBeInTheDocument();
    expect(dryRun).toHaveBeenCalledWith(expect.anything(), { showDateId: "d1", tier: 1 });
  });

  it("renders nothing under direct book", async () => {
    flowRef.value = { artist_acceptance: false, offer_delivery: "digest" };
    const { container } = renderWithProviders(<RehearsalBlock orgId="org-1" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing when no future date has a city", async () => {
    nextRef.value = null;
    const { container } = renderWithProviders(<RehearsalBlock orgId="org-1" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("hides the run button without the offer-engine capability", async () => {
    canRef.value = false;
    renderWithProviders(<RehearsalBlock orgId="org-1" />);
    await waitFor(() => expect(screen.queryByRole("button", { name: /run the rehearsal/i })).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npx vitest run src/components/bookings/setup/RehearsalBlock.test.tsx`
Expected: FAIL — `RehearsalBlock` does not exist.

- [ ] **Step 6: Implement `RehearsalBlock`**

Create `src/components/bookings/setup/RehearsalBlock.tsx`:

```tsx
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBookingFlow, useFlowTimes } from "@/hooks/useBookingFlow";
import { useCan } from "@/hooks/useCapabilities";
import { dryRunOfferTier, type DryRunResult } from "@/data/bookings";
import { fetchNextRehearsalDate } from "@/data/showDates";
import { hh, BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import { toDateKey, formatDateWithWeekday } from "@/lib/dates";
import { Button } from "@/components/ui/button";

/** The rail's rehearsal: resolves the soonest future date with a city, dry-runs tier 1
 *  (creating nothing, sending nothing), and shows who would be offered and when. Hidden
 *  under Direct book (no offers to rehearse) and when no date qualifies. */
export function RehearsalBlock({ orgId }: { orgId: string | null }) {
  const { data: flow } = useBookingFlow();
  const { data: times } = useFlowTimes(orgId);
  const canRun = useCan("run_offer_engine");
  const next = useQuery({
    queryKey: ["show-dates", "next-rehearsal", orgId],
    enabled: !!orgId,
    queryFn: () => fetchNextRehearsalDate(supabase, { orgId: orgId!, today: toDateKey(new Date()) }),
  });

  const run = useMutation({
    mutationFn: (): Promise<DryRunResult> => {
      const id = next.data?.id;
      if (!id) throw new Error("No date to rehearse");
      return dryRunOfferTier(supabase, { showDateId: id, tier: 1 });
    },
  });

  const acceptance = (flow ?? BOOKING_FLOW_DEFAULTS).artist_acceptance;
  if (!acceptance) return null;          // Direct book: nothing to rehearse.
  if (next.isLoading) return null;
  if (!next.data) return null;           // No future date with a city.

  const delivery = (flow ?? BOOKING_FLOW_DEFAULTS).offer_delivery;
  const foot = delivery === "immediate"
    ? `Would email immediately, window closes +${times?.windowHours ?? 48} h`
    : `Would email in the ${hh(times?.offerDigestHour ?? 19)} digest, window closes +${times?.windowHours ?? 48} h`;
  const when = formatDateWithWeekday(next.data.date);

  return (
    <div className="bg-accent-50 p-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-accent-700">Rehearsal</p>
      <p className="mt-1 text-sm font-semibold">See it run before it runs</p>
      <p className="mt-0.5 text-xs leading-[18px] text-muted-foreground">
        A dry run on {when}. Resolves the real tier, the real artists, the real send time. Nothing is created and no email leaves.
      </p>
      {canRun && !run.data && (
        <Button variant="outline" size="sm" className="mt-2.5" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Resolving..." : "Run the rehearsal"}
        </Button>
      )}
      {run.data && (
        <div className="mt-2.5 overflow-hidden rounded-md border border-border bg-card">
          <div className="border-b border-border p-2.5 text-xs text-muted-foreground">
            {run.data.message ?? `Tier 1, ${run.data.candidates.length} artist${run.data.candidates.length === 1 ? "" : "s"} would be offered`}
          </div>
          {run.data.candidates.map((c) => (
            <div key={c.id} className="border-b border-border p-2 text-sm last:border-b-0">{c.name}</div>
          ))}
          <div className="p-2.5 font-mono text-[11px] text-muted-foreground">{foot}</div>
        </div>
      )}
    </div>
  );
}
```

`formatDateWithWeekday` accepts a `string | Date` and is exported from `@/lib/dates` (verified), so the raw `next.data.date` string is passed directly.

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run src/components/bookings/setup/RehearsalBlock.test.tsx`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
npx tsc -p tsconfig.app.json --noEmit
git add src/data/showDates.ts src/data/showDates.test.ts src/components/bookings/setup/RehearsalBlock.tsx src/components/bookings/setup/RehearsalBlock.test.tsx
git commit -m "add the setup-rail rehearsal with an auto-resolved date and tier"
```

---

### Task 8: Artist first-offer card

A dismissible explainer above `ArtistBookingsView`, shown while the artist has a pending offer, with copy from the live policy.

**Files:**
- Create: `src/components/bookings/setup/FirstOfferCard.tsx`
- Create: `src/components/bookings/setup/FirstOfferCard.test.tsx`
- Modify: `src/pages/ShowsBookingsPage.tsx` (wrap the artist branch)

**Interfaces:**
- Consumes `useMyArtist`, `fetchMyOpenOffersCount`, `useBookingFlow`, `useFlowTimes`, `inPracticeRows`, `useRailDismissed`, `useAuth`.
- Produces `FirstOfferCard()`.

- [ ] **Step 1: Write the failing test**

Create `src/components/bookings/setup/FirstOfferCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const { flowRef, artistRef, offersRef, orgRef } = vi.hoisted(() => ({
  flowRef: { value: { artist_acceptance: true, producer_confirmation: true, offer_delivery: "digest", confirmation_digest: true } as Record<string, unknown> },
  artistRef: { value: { id: "a1" } as { id: string } | null },
  offersRef: { value: 1 },
  orgRef: { value: { id: "org-1" } },
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowRef.value }),
  useFlowTimes: () => ({ data: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 } }),
}));
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: () => ({ data: artistRef.value }) }));
vi.mock("@/data/bookings", () => ({ fetchMyOpenOffersCount: () => Promise.resolve(offersRef.value) }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: orgRef.value }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { FirstOfferCard } from "./FirstOfferCard";

beforeEach(() => {
  localStorage.clear();
  flowRef.value = { artist_acceptance: true, producer_confirmation: true, offer_delivery: "digest", confirmation_digest: true };
  artistRef.value = { id: "a1" };
  offersRef.value = 1;
});

describe("FirstOfferCard", () => {
  it("explains the classic flow while an offer is pending", async () => {
    renderWithProviders(<FirstOfferCard />);
    expect(await screen.findByText(/soft-books the date/i)).toBeInTheDocument();
  });

  it("renders nothing when there is no pending offer", async () => {
    offersRef.value = 0;
    const { container } = renderWithProviders(<FirstOfferCard />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("changes the wording under fast-track", async () => {
    flowRef.value = { artist_acceptance: true, producer_confirmation: false, offer_delivery: "immediate", confirmation_digest: true };
    renderWithProviders(<FirstOfferCard />);
    expect(await screen.findByText(/confirms the booking instantly/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/bookings/setup/FirstOfferCard.test.tsx`
Expected: FAIL — `FirstOfferCard` does not exist.

- [ ] **Step 3: Implement `FirstOfferCard`**

Create `src/components/bookings/setup/FirstOfferCard.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useMyArtist } from "@/hooks/useMyArtist";
import { useBookingFlow, useFlowTimes } from "@/hooks/useBookingFlow";
import { fetchMyOpenOffersCount } from "@/data/bookings";
import { inPracticeRows, BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

/** A one-time explainer shown to an artist while they have a pending offer. The body is
 *  the Artist row of `inPracticeRows`, so it stays true under every preset. Dismissible
 *  per browser. */
export function FirstOfferCard() {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const { data: artist } = useMyArtist();
  const { data: flow } = useBookingFlow();
  const { data: times } = useFlowTimes(orgId);
  const [dismissed, dismiss] = useRailDismissed("artistFirstOffer", orgId);

  const offers = useQuery({
    queryKey: ["bookings", "my-open-offers", artist?.id],
    enabled: !!artist?.id,
    queryFn: () => fetchMyOpenOffersCount(supabase, artist!.id),
  });

  if (dismissed) return null;
  if (!offers.data || offers.data < 1) return null;

  const t = times ?? { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };
  const artistRow = inPracticeRows(flow ?? BOOKING_FLOW_DEFAULTS, t).find((r) => r.who === "Artist");

  return (
    <div className="rounded-lg border border-accent-200 bg-accent-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-accent-700">Your first offer</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{artistRow?.text}</p>
        </div>
        <Button variant="ghost" size="sm" className="h-auto shrink-0 p-1" onClick={dismiss} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/bookings/setup/FirstOfferCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount it in the artist branch**

In `src/pages/ShowsBookingsPage.tsx`, gate the artist card on the `booking_flow` entitlement (symmetry) and wrap the artist branch. Replace:

```tsx
  if (hasRole('artist') && !hasRole('producer') && !hasRole('admin')) {
    return <ArtistBookingsView />;
  }
```

with:

```tsx
  if (hasRole('artist') && !hasRole('producer') && !hasRole('admin')) {
    return <ArtistShowsBookings />;
  }
```

and add this component just below `ShowsBookingsPage` (import `FirstOfferCard`, `useFeature`, and `ArtistBookingsView` are already imported):

```tsx
function ArtistShowsBookings() {
  const bookingOn = useFeature('booking_flow');
  return (
    <div className="space-y-6">
      {bookingOn && <FirstOfferCard />}
      <ArtistBookingsView />
    </div>
  );
}
```

Add the import at the top: `import { FirstOfferCard } from '@/components/bookings/setup/FirstOfferCard';`

- [ ] **Step 6: Run the page test and typecheck**

Run: `npx vitest run src/pages/ShowsBookingsPage.test.tsx && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS / clean. (If `ShowsBookingsPage.test.tsx` asserts the artist branch renders `ArtistBookingsView` directly, update it to expect the wrapped output.)

- [ ] **Step 7: Commit**

```bash
git add src/components/bookings/setup/FirstOfferCard.tsx src/components/bookings/setup/FirstOfferCard.test.tsx src/pages/ShowsBookingsPage.tsx
git commit -m "show artists a dismissible first-offer explainer"
```

---

### Task 9: Mount the rail in ShowsBookingsPage

Reserve the grid column only when the rail is visible, so a completed setup leaves no empty 340px track.

**Files:**
- Modify: `src/pages/ShowsBookingsPage.tsx`
- Modify: `src/pages/ShowsBookingsPage.test.tsx` (add the single-column assertion)

**Interfaces:**
- Consumes `useBookingSetupRailVisible`, `BookingSetupRail`, `useFeature`, `cn`.

- [ ] **Step 1: Write the failing layout test**

Add to `src/pages/ShowsBookingsPage.test.tsx` a test that the two-column class is absent when the rail is not visible. Mock `useBookingSetupRailVisible` to `false` and assert no element carries `lg:grid-cols-[1fr_340px]`:

```tsx
// at top with other mocks:
vi.mock("@/components/bookings/setup/useBookingSetupRailVisible", () => ({
  useBookingSetupRailVisible: () => false,
}));

it("keeps a single content column when the setup rail is not visible", async () => {
  // ...render ShowsBookingsPage as the other tests in this file do...
  expect(document.querySelector('[class*="grid-cols-[1fr_340px]"]')).toBeNull();
});
```

(Match the file's existing render/mocks setup; reuse its provider harness.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/pages/ShowsBookingsPage.test.tsx`
Expected: FAIL — the grid class is present (or the mocked module is not yet consumed).

- [ ] **Step 3: Wire the rail in**

In `src/pages/ShowsBookingsPage.tsx`:

Add imports:

```tsx
import { cn } from '@/lib/utils';
import { BookingSetupRail } from '@/components/bookings/setup/BookingSetupRail';
import { useBookingSetupRailVisible } from '@/components/bookings/setup/useBookingSetupRailVisible';
```

(`cn` may already be imported; do not duplicate.)

Inside `ProducerShowsBookings`, after `const bookingOn = useFeature('booking_flow');` (add that line if not present) compute:

```tsx
  const railVisible = useBookingSetupRailVisible(bookingOn ? orgId : null);
```

Then wrap the filter bar + results region in a grid. In the returned JSX, immediately after the `HireOrderReadyBanner` block closes, open the grid and left column, and close them just before the `<ShowDateDetailSheet` block. Concretely:

Insert before the filter bar `<div className="flex flex-wrap items-center gap-3">`:

```tsx
      <div className={cn("grid gap-6", railVisible && "lg:grid-cols-[1fr_340px] lg:items-start")}>
        <div className="min-w-0 space-y-6">
```

Insert after the results region ends (immediately before `<ShowDateDetailSheet`):

```tsx
        </div>
        {railVisible && <BookingSetupRail orgId={orgId} />}
      </div>
```

The dialogs (`ShowDateDetailSheet`, `ShowDateFormDialog`, `NewOrderWizard`) stay at the outer `space-y-6` level, outside the grid.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/pages/ShowsBookingsPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Browser-verify the layout**

Start the dev server and confirm the rail renders beside the table and collapses to one column when dismissed.

```bash
npm run dev
```

Use the preview tools: open `bookings`, check the two-column layout as an admin with incomplete setup, click Hide, confirm the table reflows to full width with no empty right column, and reload to confirm the dismissal persists. Screenshot for the record.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc -p tsconfig.app.json --noEmit && npm run lint
git add src/pages/ShowsBookingsPage.tsx src/pages/ShowsBookingsPage.test.tsx
git commit -m "mount the bookings setup rail beside the table"
```

---

### Task 10: Release notes and version bump

User-facing feature: bump the version in both places, add a changelog block, regenerate the JSON.

**Files:**
- Modify: `package.json` (`version`)
- Modify: `src/config/app.config.ts` (`APP_META.VERSION`)
- Modify: `public/changelog.md`
- Regenerate: `public/changelog.json`

- [ ] **Step 1: Bump the version**

Set `version` in `package.json` and `APP_META.VERSION` in `src/config/app.config.ts` to the next MINOR (read the current value first; if it is `1.8.0`, use `1.9.0` — adjust to whatever is current, MINOR for a new feature).

- [ ] **Step 2: Add the changelog block**

Prepend a newest-first block to `public/changelog.md`, end-user voice, no em-dashes, no super-admin/platform mentions:

```markdown
## X.Y.Z — Aug 7, 2026

*Get bookings running, guided.*

### New
- **Bookings setup checklist** — A checklist beside Shows and bookings walks you through the booking flow, slot counts, cast priorities, eligibility, and timing, and retires itself once the first offer can go out.
- **Rehearsal** — Preview exactly who the next date would offer, and when, without creating a booking or sending an email.

### Improved
- **Clear blockers** — Each outstanding step says whether it stops offers or only stops a date filling, so you know what to fix first.
```

- [ ] **Step 3: Regenerate the JSON**

Run: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
Expected: `public/changelog.json` rewritten. Never hand-edit it.

- [ ] **Step 4: Commit**

```bash
git add package.json src/config/app.config.ts public/changelog.md public/changelog.json
git commit -m "release notes for the bookings guided onboarding"
```

---

## Final verification

- [ ] **Full suite:** `npm run test:coverage`
- [ ] **App typecheck:** `npx tsc -p tsconfig.app.json --noEmit`
- [ ] **Tools typecheck:** `npx tsc -p tsconfig.tools.json --noEmit`
- [ ] **Lint (zero-warning gate):** `npm run lint`
- [ ] **Hire-order rail regression:** `npx vitest run src/components/hireOrders` — confirm the extraction left it green.
- [ ] Confirm no file under `supabase/migrations/`, `supabase/functions/`, or `src/integrations/supabase/types.ts` changed (`git diff --name-only main | grep -E 'supabase/(migrations|functions)|types.ts'` returns nothing).
