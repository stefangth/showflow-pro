# Module onboarding collapse-to-bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Hire Orders and Bookings pages, hiding the onboarding wizard collapses it into a compact bar (re-expandable, like `/dashboard`), and the "Setup checklist" header button appears only once that module's setup is complete.

**Architecture:** Replace the two module visibility hooks' `{ visible, reinvocable }` output with a single `SetupRailMode` (`banner | collapsed | button | hidden`). The adapter `useModuleOnboardingRail` passes `mode` through and adds collapsed-bar copy plus an `expand` (undismiss) callback. The two pages render one of three surfaces by `mode`, reusing the dashboard's existing `DashboardWelcomeCollapsed` strip for the bar. Completion stays derived live; the collapsed state stays in localStorage via `useRailDismissed`.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react + jsdom, the repo's `supabaseFake` / `renderWithProviders` test harness.

## Global Constraints

- **Semantic tokens only** in any markup — no hardcoded colors. (The reused `DashboardWelcomeCollapsed` already complies; no new styling is authored.)
- **No em/en dashes in user-facing copy.** Use plain words. Bar copy is `"Set up in progress"` / `"Org setup in progress"`, `"N steps left"`, `"Resume"`.
- **`any` is banned** (lint `--max-warnings 0`). Use the shared `SetupRailMode` type; test mocks type their state as `{ mode: SetupRailMode }`.
- **This is a single cohesive change.** The page tests mock the very visibility hooks whose return shape changes, so hooks, adapter, pages, and all five test files must move together to stay green. Expect the working tree to be red mid-task; it is green only at the final step, which is where the single commit happens.
- **`/dashboard` is out of scope** — it is the reference and already correct. Do not modify `ArtistDashboard`, `useDashboardFirstRun`, or any `dashboard/firstRun/*` file except to *import* `DashboardWelcomeCollapsed` from it.

---

### Task 1: Remap module onboarding to banner / collapsed / button

**Files:**
- Create: `src/components/setup/setupRailMode.ts`
- Modify: `src/components/hireOrders/setup/useSetupRailVisible.ts`
- Modify: `src/components/bookings/setup/useBookingSetupRailVisible.ts`
- Modify: `src/components/setup/useModuleOnboardingRail.ts`
- Modify: `src/pages/HireOrdersPage.tsx`
- Modify: `src/pages/ShowsBookingsPage.tsx`
- Test: `src/components/hireOrders/setup/useSetupRailVisible.test.ts`
- Test: `src/components/bookings/setup/useBookingSetupRailVisible.test.ts`
- Test: `src/components/setup/useModuleOnboardingRail.test.tsx`
- Test: `src/pages/HireOrdersPage.test.tsx`
- Test: `src/pages/ShowsBookingsPage.test.tsx`

**Interfaces:**
- Produces:
  - `SetupRailMode = "banner" | "collapsed" | "button" | "hidden"` (from `src/components/setup/setupRailMode.ts`).
  - `useSetupRailVisible(orgId: string | null): { mode: SetupRailMode }`
  - `useBookingSetupRailVisible(orgId: string | null): { mode: SetupRailMode }`
  - `ModuleOnboardingRail` gains `mode: SetupRailMode`, `collapsedLabel: string`, `collapsedHint: string`, `collapsedCta: string`, `expand: () => void`; and **drops** `show: boolean` and `reinvocable: boolean`. Everything else (`steps`, `rules`, `offFooters`, `eyebrow`, `title`, `body`, `progressFilled`, `progressTotal`, `progressLabel`, `dismiss`) is unchanged.
- Consumes: existing `useRailDismissed(key, orgId): [boolean, () => void, () => void]` (index 2 is undismiss), `useHireOrderSetupStatus`, `useBookingSetupStatus`, `useCan`, `composeOnboarding`, and the existing `DashboardWelcomeCollapsed({ label, hint, ctaLabel, onOpen })`.

State machine (identical for both modules; booking substitutes `edit_booking_settings` / `!status.canOffer`):

```
!orgId || isLoading            -> "hidden"
!(canEditSettings || !canIssue) -> "hidden"   // not actionable
status.complete                 -> "button"    // permanent re-entry (editors; a non-editor is already !actionable here)
dismissed                       -> "collapsed"
otherwise                       -> "banner"
```

---

- [ ] **Step 1: Create the shared mode type**

Create `src/components/setup/setupRailMode.ts`:

```ts
/**
 * The single onboarding surface a module page shows right now.
 * - "banner"    the full setup wizard (incomplete, not collapsed)
 * - "collapsed" the compact progress bar the wizard collapses into (incomplete, hidden)
 * - "button"    the permanent "Setup checklist" header button (setup complete)
 * - "hidden"    nothing (loading, not entitled, or nothing this viewer can act on)
 * See docs/superpowers/specs/2026-08-09-module-onboarding-collapse-to-bar-design.md.
 */
export type SetupRailMode = "banner" | "collapsed" | "button" | "hidden";
```

- [ ] **Step 2: Rewrite the hire-order visibility hook test to the mode enum**

Replace the entire contents of `src/components/hireOrders/setup/useSetupRailVisible.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

const { canRef } = vi.hoisted(() => ({ canRef: { value: true } }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canRef.value }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useSetupRailVisible } from "./useSetupRailVisible";

/** Letterhead + terms set, no countersign: the org can issue but setup is not complete. */
const CAN_ISSUE_SEED: Record<string, TableSeed> = {
  app_settings: [
    { when: { key: "hire_order_letterhead" }, data: [{ key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } }] },
    { when: { key: "hire_order_terms" }, data: [{ key: "hire_order_terms", org_id: "org-1", value: { templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "t1" } }] },
    { when: { key: "hire_order_countersign" }, data: [] },
  ],
};

/** All three steps set: setup is complete. */
const COMPLETE_SEED: Record<string, TableSeed> = {
  app_settings: [
    { when: { key: "hire_order_letterhead" }, data: [{ key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } }] },
    { when: { key: "hire_order_terms" }, data: [{ key: "hire_order_terms", org_id: "org-1", value: { templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "t1" } }] },
    { when: { key: "hire_order_countersign" }, data: [{ key: "hire_order_countersign", org_id: "org-1", value: "manual" }] },
  ],
};

beforeEach(() => {
  localStorage.clear();
  canRef.value = true;
  seedClient({ app_settings: { data: [], error: null } });
});

describe("useSetupRailVisible", () => {
  it("is 'banner' while a blocking step is outstanding (editor, not dismissed)", async () => {
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    await waitFor(() => expect(result.current.mode).toBe("banner"));
  });

  it("is 'collapsed' once dismissed while setup is still incomplete", async () => {
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    await waitFor(() => expect(result.current.mode).toBe("collapsed"));
  });

  it("stays 'banner' for an admin while the non-blocking countersign step is outstanding", async () => {
    seedClient(CAN_ISSUE_SEED);
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    await waitFor(() => expect(result.current.mode).toBe("banner"));
  });

  it("is 'hidden' for a producer once nothing blocks issuing", async () => {
    canRef.value = false;
    seedClient(CAN_ISSUE_SEED);
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    await waitFor(() => expect(result.current.mode).toBe("hidden"));
  });

  it("is 'button' once setup is complete (editor), even if previously dismissed", async () => {
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    seedClient(COMPLETE_SEED);
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    await waitFor(() => expect(result.current.mode).toBe("button"));
  });

  it("is 'hidden' once complete for a non-editor producer", async () => {
    canRef.value = false;
    seedClient(COMPLETE_SEED);
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    // Loading resolves to complete+canIssue -> not actionable for a non-editor.
    await waitFor(() => expect(result.current.mode).toBe("hidden"));
  });

  it("is 'hidden' without an org", () => {
    const { result } = renderHookWithProviders(() => useSetupRailVisible(null));
    expect(result.current).toEqual({ mode: "hidden" });
  });
});
```

- [ ] **Step 3: Run the hire-order visibility test — verify it fails**

Run: `npx vitest run src/components/hireOrders/setup/useSetupRailVisible.test.ts`
Expected: FAIL (`result.current.mode` is `undefined`; the hook still returns `{ visible, reinvocable }`).

- [ ] **Step 4: Rewrite the hire-order visibility hook**

Replace the entire contents of `src/components/hireOrders/setup/useSetupRailVisible.ts` with:

```ts
import { useCan } from "@/hooks/useCapabilities";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import type { SetupRailMode } from "@/components/setup/setupRailMode";

export interface SetupRailVisibility {
  /** Which hire-order onboarding surface the page should show right now. */
  mode: SetupRailMode;
}

const HIDDEN: SetupRailVisibility = { mode: "hidden" };

/**
 * Which hire-order onboarding surface to render: the full "banner" wizard, the
 * "collapsed" progress bar it hides into, the permanent "button" once setup is
 * complete, or "hidden". Completion (`status.complete`) is derived live; the
 * collapsed-vs-expanded choice is the localStorage dismissal from useRailDismissed,
 * a shared store so a Hide/Resume updates every reader at once.
 *
 * `complete` is checked after the actionable gate so the permanent button only
 * reaches viewers who can act on setup: once complete, `canIssue` is true, so
 * `actionable` reduces to `canEditSettings`.
 */
export function useSetupRailVisible(orgId: string | null): SetupRailVisibility {
  const canEditSettings = useCan("edit_hire_order_settings");
  const { status, isLoading } = useHireOrderSetupStatus(orgId);
  const [dismissed] = useRailDismissed("hireOrderSetup", orgId);

  if (!orgId || isLoading) return HIDDEN;
  const actionable = canEditSettings || !status.canIssue;
  if (!actionable) return HIDDEN;
  if (status.complete) return { mode: "button" };
  return { mode: dismissed ? "collapsed" : "banner" };
}
```

- [ ] **Step 5: Run the hire-order visibility test — verify it passes**

Run: `npx vitest run src/components/hireOrders/setup/useSetupRailVisible.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 6: Rewrite the booking visibility hook test to the mode enum**

Replace the entire contents of `src/components/bookings/setup/useBookingSetupRailVisible.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
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
  it("is 'hidden' without an org", () => {
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible(null));
    expect(result.current).toEqual({ mode: "hidden" });
  });

  it("is 'banner' for an editor while setup is incomplete and not dismissed", () => {
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current.mode).toBe("banner");
  });

  it("is 'collapsed' for an editor once dismissed while incomplete", () => {
    localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current.mode).toBe("collapsed");
  });

  it("is 'hidden' for a non-editor once offers are already possible", () => {
    canRef.value = false;
    statusRef.value = { status: { complete: false, canOffer: true } as never, isLoading: false };
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current.mode).toBe("hidden");
  });

  it("is 'button' once complete (editor), even if previously dismissed", () => {
    statusRef.value = { status: { complete: true, canOffer: true } as never, isLoading: false };
    localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current.mode).toBe("button");
  });

  it("is 'hidden' once complete for a non-editor", () => {
    canRef.value = false;
    statusRef.value = { status: { complete: true, canOffer: true } as never, isLoading: false };
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current.mode).toBe("hidden");
  });
});
```

- [ ] **Step 7: Run the booking visibility test — verify it fails**

Run: `npx vitest run src/components/bookings/setup/useBookingSetupRailVisible.test.ts`
Expected: FAIL (`mode` undefined).

- [ ] **Step 8: Rewrite the booking visibility hook**

Replace the entire contents of `src/components/bookings/setup/useBookingSetupRailVisible.ts` with:

```ts
import { useCan } from "@/hooks/useCapabilities";
import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import type { SetupRailMode } from "@/components/setup/setupRailMode";

export interface BookingSetupRailVisibility {
  /** Which booking onboarding surface the page should show right now. */
  mode: SetupRailMode;
}

const HIDDEN: BookingSetupRailVisibility = { mode: "hidden" };

/**
 * Which booking onboarding surface to render. Mirrors
 * `hireOrders/setup/useSetupRailVisible`: "banner" wizard, "collapsed" bar,
 * permanent "button" once complete, or "hidden". `complete` is checked after the
 * actionable gate so the button only reaches viewers who can act on setup.
 */
export function useBookingSetupRailVisible(orgId: string | null): BookingSetupRailVisibility {
  const canEdit = useCan("edit_booking_settings");
  const { status, isLoading } = useBookingSetupStatus(orgId);
  const [dismissed] = useRailDismissed("bookingSetup", orgId);

  if (!orgId || isLoading) return HIDDEN;
  const actionable = canEdit || !status.canOffer;
  if (!actionable) return HIDDEN;
  if (status.complete) return { mode: "button" };
  return { mode: dismissed ? "collapsed" : "banner" };
}
```

- [ ] **Step 9: Run the booking visibility test — verify it passes**

Run: `npx vitest run src/components/bookings/setup/useBookingSetupRailVisible.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 10: Add mode/collapsed/expand cases to the adapter test**

In `src/components/setup/useModuleOnboardingRail.test.tsx`:

Change the testing-library import line (currently `import { renderHook, waitFor } from "@testing-library/react";`) to:

```ts
import { renderHook, waitFor, act } from "@testing-library/react";
```

Then append these tests at the end of the file (keep all existing tests as-is):

```ts
it("is 'banner' by default and passes the mode through", async () => {
  const { result } = renderHook(() => useModuleOnboardingRail("hire_orders", "org-1"), { wrapper });
  await waitFor(() => expect(result.current.mode).toBe("banner"));
});

it("collapses to a bar when dismissed, exposing progress copy and an expand() that re-expands", async () => {
  localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
  const { result } = renderHook(() => useModuleOnboardingRail("hire_orders", "org-1"), { wrapper });
  await waitFor(() => expect(result.current.mode).toBe("collapsed"));
  expect(result.current.collapsedLabel).toBe("Set up in progress");
  expect(result.current.collapsedHint).toBe("3 steps left");
  expect(result.current.collapsedCta).toBe("Resume");
  act(() => result.current.expand());
  await waitFor(() => expect(result.current.mode).toBe("banner"));
});

it("labels the collapsed bar 'Org setup' for a viewer who cannot edit", async () => {
  canRef.value = false;
  localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
  const { result } = renderHook(() => useModuleOnboardingRail("hire_orders", "org-1"), { wrapper });
  await waitFor(() => expect(result.current.mode).toBe("collapsed"));
  expect(result.current.collapsedLabel).toBe("Org setup in progress");
});
```

- [ ] **Step 11: Run the adapter test — verify the new cases fail**

Run: `npx vitest run src/components/setup/useModuleOnboardingRail.test.tsx`
Expected: FAIL on the three new cases (`mode` / `collapsedLabel` / `expand` are `undefined`). The five existing composition tests still pass.

- [ ] **Step 12: Update the adapter to expose mode, collapsed copy, and expand**

In `src/components/setup/useModuleOnboardingRail.ts`:

Add the import near the other type imports:

```ts
import type { SetupRailMode } from "@/components/setup/setupRailMode";
```

In the `ModuleOnboardingRail` interface, **remove** the `show` and `reinvocable` fields and their doc comments, and add these fields (put `mode` first, and the collapsed/expand fields alongside `dismiss`):

```ts
  /** Which onboarding surface to render on the module page. */
  mode: SetupRailMode;
  /** Collapsed-bar copy (used when mode === "collapsed"). Mirrors the dashboard bar. */
  collapsedLabel: string;
  collapsedHint: string;
  collapsedCta: string;
  /** Re-expand the collapsed bar into the full banner (clears the dismissal). */
  expand: () => void;
```

Change the dismissal destructure (currently `const [, dismiss] = useRailDismissed(...)`) to also capture undismiss:

```ts
  const [, dismiss, expand] = useRailDismissed(DISMISS_KEY[feature], orgId);
```

After `const total = composed.steps.length;`, add:

```ts
  const remaining = total - filled;
```

In the returned object, replace the two lines `show: viz.visible,` and `reinvocable: viz.reinvocable,` with `mode: viz.mode,`, and add the collapsed fields plus `expand` (put `expand` next to `dismiss` at the end):

```ts
    mode: viz.mode,
    // ...existing fields unchanged...
    collapsedLabel: `${setupWord} in progress`,
    collapsedHint: `${remaining} step${remaining === 1 ? "" : "s"} left`,
    collapsedCta: "Resume",
    dismiss,
    expand,
```

- [ ] **Step 13: Run the adapter test — verify it passes**

Run: `npx vitest run src/components/setup/useModuleOnboardingRail.test.tsx`
Expected: PASS (all eight cases).

Note: the two pages still reference `rail.show` / `rail.reinvocable`, so `tsc` and the page tests are red right now. That is expected; the next steps fix them within this same task.

- [ ] **Step 14: Switch HireOrdersPage to render by mode**

In `src/pages/HireOrdersPage.tsx`:

Add the import (next to the existing `DashboardSetupRail` import from `@/components/dashboard/firstRun/...`):

```ts
import { DashboardWelcomeCollapsed } from "@/components/dashboard/firstRun/DashboardWelcomeCollapsed";
```

Replace these three lines (around 149-151):

```ts
  const showSetupRail = entitledForWrites && rail.show;
  const showSetupReinvoke = entitledForWrites && rail.reinvocable;
  const [, , undismissSetup] = useRailDismissed("hireOrderSetup", entitledForWrites ? orgId : null);
```

with:

```ts
  const setupMode = entitledForWrites ? rail.mode : "hidden";
```

If `useRailDismissed` is now unused in this file, remove its import. (Verify with a search for `useRailDismissed` in the file; the line above was its only use.)

Replace the header-button block (around 176-185) — change the gate and drop the `undismissSetup()` call:

```tsx
          {setupMode === "button" && (
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => { setSetupStep(undefined); setSetupSheetOpen(true); }}
            >
              <ListChecks className="h-4 w-4" />
              Setup checklist
            </Button>
          )}
```

Change the banner gate (around 200) from `{showSetupRail && (` to `{setupMode === "banner" && (` (leave the `<DashboardSetupRail .../>` props unchanged), and immediately after that block's closing `)}` add the collapsed bar:

```tsx
      {setupMode === "collapsed" && (
        <DashboardWelcomeCollapsed
          label={rail.collapsedLabel}
          hint={rail.collapsedHint}
          ctaLabel={rail.collapsedCta}
          onOpen={rail.expand}
        />
      )}
```

- [ ] **Step 15: Update the HireOrdersPage tests to the mode model**

In `src/pages/HireOrdersPage.test.tsx`:

Add near the top imports:

```ts
import type { SetupRailMode } from "@/components/setup/setupRailMode";
```

Replace the hoisted `railState` block (around 40-42) with:

```ts
const { railState } = vi.hoisted(() => ({
  railState: { value: { mode: "banner" } as { mode: SetupRailMode } },
}));
```

In `beforeEach` (the line around 223), change `railState.value = { visible: true, reinvocable: false };` to:

```ts
    railState.value = { mode: "banner" };
```

Replace the test "hides the setup callout once the rail has retired" (around 575) — change the mode and add a no-bar assertion:

```ts
  it("shows nothing when the rail is hidden", async () => {
    railState.value = { mode: "hidden" };
    renderPage();
    await screen.findByText("Hire orders");
    expect(screen.queryByText(/get hire orders ready/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("setup-rail")).not.toBeInTheDocument();
    expect(screen.queryByText(/set up in progress/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /setup checklist/i })).not.toBeInTheDocument();
  });
```

Replace the test "shows the header re-invoke button once dismissed while setup is still incomplete" (around 589) with:

```ts
  it("collapses to a bar, not the checklist button, when dismissed while setup is incomplete", async () => {
    railState.value = { mode: "collapsed" };
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    renderPage();
    await screen.findByText("Hire orders");
    // Not the completed-state button and not the full wizard:
    expect(screen.queryByRole("button", { name: /setup checklist/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/get hire orders ready/i)).not.toBeInTheDocument();
    // The compact progress bar with a Resume affordance:
    expect(await screen.findByText(/set up in progress/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });
```

Replace the test "re-invokes on click: clears the dismissal and opens the Sheet with the rail" (around 601) with:

```ts
  it("the collapsed bar's Resume clears the dismissal so the wizard re-expands", async () => {
    railState.value = { mode: "collapsed" };
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /resume/i }));
    expect(localStorage.getItem("showflow.hireOrderSetup.hidden.org-1")).toBeNull();
  });
```

Replace the test "hides the re-invoke button once setup is complete, even if previously dismissed" (around 611) with:

```ts
  it("shows the permanent checklist button once setup is complete, and it opens the Sheet", async () => {
    railState.value = { mode: "button" };
    hireOrderSetupStatus.value = makeHireStatus(3, true);
    renderPage();
    const btn = await screen.findByRole("button", { name: /setup checklist/i });
    // No bar and no full wizard in the complete state:
    expect(screen.queryByText(/set up in progress/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/get hire orders ready/i)).not.toBeInTheDocument();
    fireEvent.click(btn);
    expect(await screen.findByTestId("setup-rail")).toBeInTheDocument();
  });
```

Replace the test "never offers the re-invoke button in a state where the rail itself would render nothing actionable" (around 621) with:

```ts
  it("shows neither the bar nor the button in the hidden (not actionable) state", async () => {
    railState.value = { mode: "hidden" };
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    hireOrderSetupStatus.value = makeHireStatus(2, false);
    renderPage();
    await screen.findByText("Hire orders");
    expect(screen.queryByRole("button", { name: /setup checklist/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/set up in progress/i)).not.toBeInTheDocument();
  });
```

Leave the remaining setup tests as-is ("shows no re-invoke button by default" still holds — the default `mode: "banner"` shows a wizard, not a button; the module-off tests rely on the `entitledForWrites` gate and set no `railState`). After editing, search the file for `visible:` and `reinvocable:` and confirm there are no stragglers in `railState` assignments (there should be none left).

- [ ] **Step 16: Run the HireOrdersPage tests — verify they pass**

Run: `npx vitest run src/pages/HireOrdersPage.test.tsx`
Expected: PASS. If a module-off test fails because `railState` defaults to `"banner"`, confirm the surface is gated on `entitledForWrites` (it must be — `setupMode` is `"hidden"` when not entitled).

- [ ] **Step 17: Switch ShowsBookingsPage to render by mode**

In `src/pages/ShowsBookingsPage.tsx`:

Add the import (next to the existing `DashboardSetupRail` import):

```ts
import { DashboardWelcomeCollapsed } from "@/components/dashboard/firstRun/DashboardWelcomeCollapsed";
```

Replace these lines (around 243-246):

```ts
  const rail = useModuleOnboardingRail('booking_flow', bookingEntitledForWrites ? orgId : null);
  const railVisible = bookingEntitledForWrites && rail.show;
  const [, , undismissBookingSetup] = useRailDismissed('bookingSetup', bookingEntitledForWrites ? orgId : null);
  const showSetupReinvoke = bookingEntitledForWrites && rail.reinvocable;
```

with:

```ts
  const rail = useModuleOnboardingRail('booking_flow', bookingEntitledForWrites ? orgId : null);
  const setupMode = bookingEntitledForWrites ? rail.mode : 'hidden';
```

If `useRailDismissed` is now unused in this file, remove its import. (Verify with a search; the line above was its only use.)

Replace the header-button block (around 424-433) — change the gate and drop `undismissBookingSetup()`:

```tsx
          {setupMode === "button" && (
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => { setSetupStep(undefined); setSetupSheetOpen(true); }}
            >
              <ListChecks className="h-4 w-4" />
              Setup checklist
            </Button>
          )}
```

Change the banner gate (around 452) from `{railVisible && (` to `{setupMode === "banner" && (` (leave the `<DashboardSetupRail .../>` props unchanged), and immediately after that block's closing `)}` add the collapsed bar:

```tsx
      {setupMode === "collapsed" && (
        <DashboardWelcomeCollapsed
          label={rail.collapsedLabel}
          hint={rail.collapsedHint}
          ctaLabel={rail.collapsedCta}
          onOpen={rail.expand}
        />
      )}
```

- [ ] **Step 18: Update the ShowsBookingsPage tests to the mode model**

In `src/pages/ShowsBookingsPage.test.tsx`:

Add near the top imports:

```ts
import type { SetupRailMode } from "@/components/setup/setupRailMode";
```

Replace the hoisted `railState` block (around 93-95) with:

```ts
const { railState } = vi.hoisted(() => ({
  railState: { value: { mode: "hidden" } as { mode: SetupRailMode } },
}));
```

In `beforeEach` (around line 176), change `railState.value = { visible: false, reinvocable: false };` to:

```ts
  railState.value = { mode: "hidden" };
```

Update the three "incomplete + visible" tests — change `railState.value = { visible: true, reinvocable: false };` to `railState.value = { mode: "banner" };` in each of:
- "shows a full-width inline callout ... while setup is incomplete and visible" (around 239)
- "does not mount the setup rail while entitlements are still loading" (around 250)
- "opens the checklist Sheet at the clicked step ..." (around 259)

Replace the test "shows the header re-invoke button once dismissed while setup is still incomplete, and hides the callout" (around 268) with:

```ts
  it("collapses to a bar, not the checklist button, when dismissed while setup is incomplete", async () => {
    featureFlags.value = { booking_flow: true };
    railState.value = { mode: "collapsed" };
    localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
    renderWithProviders(<ShowsBookingsPage />);
    await screen.findByText("Future Show");
    expect(screen.queryByRole("button", { name: /setup checklist/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/get bookings running/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/set up in progress/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });
```

Replace the test "re-invokes on click: clears the dismissal and opens the Sheet with the rail" (around 280) with:

```ts
  it("the collapsed bar's Resume clears the dismissal so the wizard re-expands", async () => {
    featureFlags.value = { booking_flow: true };
    railState.value = { mode: "collapsed" };
    localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
    renderWithProviders(<ShowsBookingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /resume/i }));
    expect(localStorage.getItem("showflow.bookingSetup.hidden.org-1")).toBeNull();
  });
```

Replace the test "hides the re-invoke button once setup is complete, even if previously dismissed" (around 291) with:

```ts
  it("shows the permanent checklist button once setup is complete, and it opens the Sheet", async () => {
    featureFlags.value = { booking_flow: true };
    railState.value = { mode: "button" };
    bookingSetupStatus.value = makeBookingStatus(5, true);
    renderWithProviders(<ShowsBookingsPage />);
    const btn = await screen.findByRole("button", { name: /setup checklist/i });
    expect(screen.queryByText(/set up in progress/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/get bookings running/i)).not.toBeInTheDocument();
    fireEvent.click(btn);
    expect(await screen.findByTestId("booking-setup-rail")).toBeInTheDocument();
  });
```

After editing, search the file for `visible:` and `reinvocable:` and convert any remaining `railState` stragglers to the `{ mode: ... }` shape (there should be none left).

- [ ] **Step 19: Run the ShowsBookingsPage tests — verify they pass**

Run: `npx vitest run src/pages/ShowsBookingsPage.test.tsx`
Expected: PASS.

- [ ] **Step 20: Run the full gate**

Run each and confirm clean:

```bash
npx vitest run
npx tsc -p tsconfig.app.json --noEmit
npm run lint
```

Expected: all pass; no TypeScript errors (no lingering `rail.show` / `rail.reinvocable` references); zero lint warnings. If `tsc` flags an unused `useRailDismissed` import in either page, remove it.

- [ ] **Step 21: Commit**

```bash
git add src/components/setup/setupRailMode.ts \
  src/components/hireOrders/setup/useSetupRailVisible.ts \
  src/components/hireOrders/setup/useSetupRailVisible.test.ts \
  src/components/bookings/setup/useBookingSetupRailVisible.ts \
  src/components/bookings/setup/useBookingSetupRailVisible.test.ts \
  src/components/setup/useModuleOnboardingRail.ts \
  src/components/setup/useModuleOnboardingRail.test.tsx \
  src/pages/HireOrdersPage.tsx src/pages/HireOrdersPage.test.tsx \
  src/pages/ShowsBookingsPage.tsx src/pages/ShowsBookingsPage.test.tsx
git commit -m "collapse module onboarding to a bar; checklist button only when complete"
```

---

## Self-Review

**1. Spec coverage:**
- Incomplete + hidden -> collapsed bar (like `/dashboard`): state machine `dismissed -> "collapsed"` (Steps 4, 8); pages render `DashboardWelcomeCollapsed` (Steps 14, 17). ✓
- Bar re-expands the full wizard (not "open steps"): `onOpen={rail.expand}` = undismiss -> `dismissed` false -> `mode "banner"` (adapter Step 12; verified in adapter test Step 10 and page tests Steps 15/18). ✓
- Completed -> permanent "Setup checklist" button in current form: `status.complete -> "button"` (Steps 4, 8); permanent (no dismiss on it); JSX unchanged except gate + dropped `undismiss` (Steps 14, 17). ✓
- `/dashboard` untouched: only imports `DashboardWelcomeCollapsed`; no dashboard files modified. ✓
- Completion stays derived, dismissal stays localStorage: no persistence changes. ✓
- Non-editor honesty: non-editor never reaches `"button"` (actionable false when complete); may reach `"collapsed"` while blocking exists, re-expanding the "only an admin can finish these" banner. Covered by the `"Org setup in progress"` label test (Step 10) and the hidden-once-complete cases (Steps 2, 6). ✓

**2. Placeholder scan:** No TBD/TODO; every code step has literal content; no "similar to Task N" (single task). ✓

**3. Type consistency:** `SetupRailMode` used identically across `setupRailMode.ts`, both visibility hooks, the adapter, and both page test mocks. `expand` named consistently (adapter field, page `onOpen={rail.expand}`, adapter test `result.current.expand()`). `collapsedLabel`/`collapsedHint`/`collapsedCta` consistent between adapter return, adapter test, and page `DashboardWelcomeCollapsed` props (`label`/`hint`/`ctaLabel` map to those values). ✓

## Manual verification (optional, after the gate is green)

`npm run dev` targets the LOCAL Supabase stack (see CLAUDE.md). Sign in as the seeded `admin@example.com`, open Hire Orders (or Shows & Bookings) on an org with the module entitled but not yet fully set up, and confirm: the wizard's Hide collapses it to the bar; the bar's Resume re-expands the wizard; completing all setup steps replaces both with the permanent "Setup checklist" header button that opens the checklist Sheet. Booking's setup is 5 steps, hire orders 3. Do not verify against production data.
```
