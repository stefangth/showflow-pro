# Module onboarding: collapse to a bar, checklist button only on completion

**Date:** 2026-08-09
**Status:** Approved design, ready for implementation plan
**Surfaces:** Hire Orders page, Shows & Bookings page (module onboarding rails)

## Problem

The onboarding wizard rendered on module pages (Hire Orders, Bookings) behaves
differently from the one on `/dashboard`, and the difference is wrong:

- On `/dashboard`, hiding the onboarding wizard **collapses it into a compact bar**
  ("Set up in progress · N steps left · Resume") that can be re-expanded. Completion
  is derived live from settings, never persisted.
- On a module page, clicking **Hide** on the wizard instead makes it **jump straight
  to a small "Setup checklist" header button**. And when the module's setup is
  **complete**, the whole surface **retires — nothing is shown at all**.

We want the module pages to match the dashboard's collapse behavior, and we want the
"Setup checklist" button to be the *post-completion* re-entry point rather than the
*hide* affordance.

## Desired behavior

Per-module, for a viewer who can act on setup (`actionable`, see below):

| Situation | Today | Desired |
|---|---|---|
| Incomplete, wizard not hidden | Full banner wizard | Full banner wizard (**unchanged**) |
| Incomplete, wizard **hidden** | "Setup checklist" header button | **Collapsed bar** (like `/dashboard`) |
| **Complete** | Nothing (module retires) | **"Setup checklist" header button** (current form, **permanent**) |

Two confirmed decisions:

1. **Collapse is a true toggle.** Hide collapses the wizard to a bar; clicking the bar
   **re-expands the full wizard** in place (it does *not* jump to the checklist steps).
   The dashboard's own bar opens the steps; ours re-expands the banner, because the user
   explicitly chose collapse/expand semantics.
2. **The completed button is permanent.** Once a module is complete, the "Setup
   checklist" button stays in the header as a quiet way back into the checklist to review
   or change settings. No dismiss on it.

`/dashboard` itself is **out of scope** — it is the reference and already behaves
correctly.

## Current architecture (as-is)

- **Visibility hooks** decide what the module rail shows:
  - `src/components/hireOrders/setup/useSetupRailVisible.ts`
  - `src/components/bookings/setup/useBookingSetupRailVisible.ts`

  Both return `{ visible, reinvocable }` and share this logic:

  ```ts
  if (!orgId || isLoading || status.complete) return HIDDEN;   // { visible:false, reinvocable:false }
  const actionable = canEditSettings || !status.canIssue;      // (booking: !status.canOffer)
  return { visible: actionable && !dismissed, reinvocable: actionable && dismissed };
  ```

  `dismissed` comes from `useRailDismissed(<key>, orgId)` — a localStorage-backed,
  per-org, per-browser flag (`showflow.<namespace>.hidden.<orgId>`). Completion
  (`status.complete`) is derived live on every render and never persisted.

- **Adapter hook** `src/components/setup/useModuleOnboardingRail.ts` wraps a single
  module's status + visibility into the fields the banner needs. It currently exposes
  `show: viz.visible` and `reinvocable: viz.reinvocable`, plus the composed steps,
  header copy, progress counts (`progressFilled`/`progressTotal`), and `dismiss`.
  **It is the only consumer of the two visibility hooks.**

- **Pages** read the adapter and render three things:
  - Banner: `<DashboardSetupRail layout="banner" … onClose={rail.dismiss} onDismiss={rail.dismiss} />`
    when `rail.show`.
  - Header button: `<Button …><ListChecks/> Setup checklist</Button>` when `rail.reinvocable`;
    its onClick does `setSetupStep(undefined); undismiss…(); setSetupSheetOpen(true)`.
  - Both pages also render `<SetupChecklistSheet feature=… open=… initialStep=… />`.

  Files: `src/pages/HireOrdersPage.tsx` (~140–217), `src/pages/ShowsBookingsPage.tsx`
  (~243–469).

- **Checklist content** (`SetupRail` / `BookingSetupRail`) lives *inside*
  `SetupChecklistSheet` and is gated only by the Sheet's `open` prop. It **does not**
  self-hide on `complete` or `dismissed` (see the comment at
  `src/components/hireOrders/setup/SetupRail.tsx:48-53`). This is why the completed-state
  button can open the Sheet and correctly show an all-done checklist.

- **Reusable bar:** `src/components/dashboard/firstRun/DashboardWelcomeCollapsed.tsx` is a
  pure presentational strip: `{ label, hint, ctaLabel, onOpen }`
  (`DashboardWelcomeCollapsedProps` in `src/lib/dashboard/types.ts:118`). Module pages
  already import `DashboardSetupRail` from `dashboard/firstRun`, so importing this sibling
  is consistent with the existing pattern.

## Design (to-be)

### 1. Replace `{ visible, reinvocable }` with a `mode` in both visibility hooks

New shared shape:

```ts
export type SetupRailMode = "banner" | "collapsed" | "button" | "hidden";
export interface SetupRailVisibility { mode: SetupRailMode; }
```

Logic (hire-order variant; booking is identical with `!status.canOffer`):

```ts
const HIDDEN: SetupRailVisibility = { mode: "hidden" };

export function useSetupRailVisible(orgId: string | null): SetupRailVisibility {
  const canEditSettings = useCan("edit_hire_order_settings");
  const { status, isLoading } = useHireOrderSetupStatus(orgId);
  const [dismissed] = useRailDismissed("hireOrderSetup", orgId);

  if (!orgId || isLoading) return HIDDEN;
  const actionable = canEditSettings || !status.canIssue;
  if (!actionable) return HIDDEN;
  if (status.complete) return { mode: "button" };   // was: HIDDEN
  return { mode: dismissed ? "collapsed" : "banner" }; // dismissed was: button
}
```

Why `complete` is now checked *after* the `actionable` gate: the completed button should
only reach viewers who can act on the module (editors, or the narrow pre-issue producer
window). When `complete`, `canIssue`/`canOffer` is true, so `actionable` reduces to
`canEditSettings` — i.e. only settings-editors get the permanent button, which is the
intent. A non-editor whose module is complete sees nothing (there is nothing for them to
revisit). This preserves the current spirit of `actionable` gating the button.

Update the doc comments on both hooks (the "reinvocable = visible minus dismissed" and
"null child does not collapse a grid track" notes are now stale — the rail is a
full-width banner and the enum makes the states explicit).

### 2. `useModuleOnboardingRail`: expose `mode`, collapsed-bar copy, and `expand`

- Read `viz.mode` instead of `viz.visible`/`viz.reinvocable`.
- Add to `ModuleOnboardingRail`:
  - `mode: SetupRailMode`
  - `collapsedLabel: string` — `${setupWord} in progress` (reuses the existing
    `setupWord` = `canEdit ? "Set up" : "Org setup"`), matching the dashboard bar.
  - `collapsedHint: string` — `${remaining} step${remaining === 1 ? "" : "s"} left`,
    where `remaining = progressTotal - progressFilled` (both already computed).
  - `collapsedCta: string` — `"Resume"` (re-expands the banner).
  - `expand: () => void` — the `undismiss` callback (index 2 of `useRailDismissed`), which
    the hook does not currently expose.
- Keep `dismiss` (already present).
- Drop `show`/`reinvocable` from the interface (only the two pages consume them, and both
  are being updated to `mode`). If minimizing diff churn is preferred during
  implementation, they may be retained as derived getters (`mode === "banner"` /
  `mode === "button"`) — decide in the plan; the enum is the source of truth either way.

### 3. Pages: render by `mode`

On both `HireOrdersPage.tsx` and `ShowsBookingsPage.tsx`:

- **Header button** — gate on `rail.mode === "button"` (was `reinvocable`). Simplify its
  onClick to `setSetupStep(undefined); setSetupSheetOpen(true)` (drop the now-pointless
  `undismiss` — dismissal no longer gates this button). Keep the `entitled…ForWrites`
  guard.
- **Banner** — gate on `rail.mode === "banner"` (was `show`). Unchanged otherwise; its
  Hide (`onClose`/`onDismiss={rail.dismiss}`) sets `dismissed = true` → mode becomes
  `"collapsed"`.
- **Collapsed bar** — new, rendered in the **same slot** as the banner:

  ```tsx
  {rail.mode === "collapsed" && (
    <DashboardWelcomeCollapsed
      label={rail.collapsedLabel}
      hint={rail.collapsedHint}
      ctaLabel={rail.collapsedCta}
      onOpen={rail.expand}
    />
  )}
  ```

  `rail.expand` clears `dismissed` → mode becomes `"banner"` → the wizard re-expands.

- The standalone `undismiss` destructures currently in the pages
  (`undismissSetup`/`undismissBookingSetup`) are no longer needed by page JSX once
  `expand` lives on the rail object; remove them (the hook owns undismiss now).

Net per-page states: `hidden` → render nothing; `banner`/`collapsed`/`button` → the three
surfaces above. `SetupChecklistSheet` wiring is unchanged and still opens for step CTAs
and for the completed button.

### 4. Reused component

`DashboardWelcomeCollapsed` is reused as-is (same violet check-circle strip), giving
visual parity with `/dashboard`. No new component. Its check-circle icon reads the same
"in progress" way it already does on the dashboard's own incomplete bar, so this is
consistent, not a regression.

## Edge cases

- **Complete → later incomplete** (settings changed): `complete` is live, so mode
  recomputes to `banner` (if not dismissed) or `collapsed` (if dismissed). Self-correcting.
- **Dismiss persistence:** `dismissed` remains localStorage per-org/per-browser — the
  collapsed state survives reloads, exactly like the dashboard bar.
- **Non-editor producer:** only ever `actionable` while the module still can't
  issue/offer. They can get `banner` → (Hide) `collapsed` → (click) `banner`. They never
  get the completed `button` (once complete, `actionable` is false for them). The
  re-expanded banner already carries the "only an admin can finish these" copy, so the
  bar's "Resume" leads somewhere honest.
- **Sheet content when complete:** unaffected — `SetupRail`/`BookingSetupRail` don't
  self-hide, so the permanent button opens a fully-checked checklist.

## Testing (test-first)

Write/adjust the failing tests before implementation:

- `src/components/hireOrders/setup/useSetupRailVisible.test.ts` and
  `src/components/bookings/setup/useBookingSetupRailVisible.test.ts` — rewrite assertions
  to the `mode` enum:
  - loading / no org → `"hidden"`
  - not actionable → `"hidden"`
  - complete + editor → `"button"`; complete + non-editor → `"hidden"`
  - incomplete + not dismissed → `"banner"`
  - incomplete + dismissed → `"collapsed"`
- `src/components/setup/useModuleOnboardingRail.test.tsx` — assert `mode` passthrough,
  `collapsedLabel`/`collapsedHint` (step count math, singular/plural), `collapsedCta`, and
  that `expand` clears the dismissal (mode flips `collapsed → banner`).
- `src/pages/HireOrdersPage.test.tsx` and `src/pages/ShowsBookingsPage.test.tsx` — update
  to the three render states: banner shows when incomplete/undismissed; collapsed bar
  shows when incomplete/dismissed and its click restores the banner; the "Setup checklist"
  button shows when complete and opens the Sheet.

Then run the full local gate: `npm run lint`, `npx tsc -p tsconfig.app.json --noEmit`,
`npx vitest run`.

## Out of scope

- `/dashboard` onboarding (the reference; unchanged).
- The checklist step content, copy of the steps, and `SetupChecklistSheet` mechanics.
- Any persistence/schema change — dismissal stays in localStorage; completion stays
  derived.
