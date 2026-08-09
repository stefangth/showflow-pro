# Multi-surface onboarding wizard — design

Date: 2026-08-09
Branch: `claude/onboarding-wizards-multi-module-15ecc4`

## Problem

The booking and hire-order onboarding "wizard" (welcome + guided setup rail) only
renders on `/dashboard`. The module pages (`/bookings`, `/hire-orders`) have a *different*,
older onboarding UI: a dashed "Get X ready" callout that opens an inline setup accordion in
a Sheet. The two look different, retire on different rules, and their step CTAs behave
differently (the dashboard's route the user away to Settings/Productions).

The user wants the **dashboard-style guided rail** to appear on the module pages too, scoped
to that module, reflecting the same state, and wired so a step's button opens the inline
setup Sheet *in place* rather than navigating away — on every surface, including the
dashboard.

## Goals

1. Render the dashboard-style setup rail on `/bookings` (scoped to `booking_flow`) and
   `/hire-orders` (scoped to `hire_orders`), above the page's KPI/content region.
2. Visually identical to the dashboard rail ("same UI color"), including the top-right
   segmented **progress rail** currently shown in `DashboardWelcome`.
3. A step's button opens the **inline setup Sheet at that step** — on the module pages AND
   on the dashboard (drop the route-away behavior for booking/hire steps).
4. Keep the inline setup Sheet as the "do it here" surface.
5. Step-completion is consistent across all surfaces (already true — same DB reads).

## Non-goals

- No change to the artist onboarding path. The artist dashboard's `blockDates` step keeps
  routing to `/availability` (there is no inline panel for blocking dates). This is
  guaranteed by making the new step-action behavior opt-in (see §2).
- No change to the underlying readiness computation (`computeBookingSetupStatus`,
  `computeSetupStatus`) or the edge-side authoritative gates.
- No new sample-preview or welcome-hero on the module pages (Option A: rail only).
- Dismiss state is NOT unified across surfaces (per user decision — see §6).

## Principle

Reuse the dashboard's existing components and its *pure* composition, do not fork them. That
is what makes "same state" and "same UI color" hold by construction:

- `DashboardSetupRail` is the single rail component.
- `composeOnboarding({ enabled, role, moduleStatuses, ctx }, MODULE_ONBOARDING)` already
  filters to whatever `FeatureKey`s are in `enabled`, so a **single-module** `enabled` set
  yields a module-scoped rail from the exact same code the dashboard uses.
- `useBookingSetupStatus` / `useHireOrderSetupStatus` remain the single source of step
  completion; every surface reads them.

## Design

### 1. `DashboardSetupRail` — two additive props

File: `src/components/dashboard/firstRun/DashboardSetupRail.tsx` (+ props in
`src/lib/dashboard/types.ts`).

- **`layout?: "rail" | "banner"`** (default `"rail"`).
  - `"rail"` — today's behavior: `md:w-[340px] md:shrink-0 order-first md:order-none`
    (the dashboard's right/side column). Unchanged.
  - `"banner"` — `w-full` (module pages, full-width above the content). No progress rail
    is shown by the dashboard's own welcome banner on these pages, so the rail header
    carries the progress (see below).
- **`onStepAction?(step: ComposedStep): void`** (optional).
  - When provided, a not-done step renders a `<button>` (label = `step.ctaLabel`) that calls
    `onStepAction(step)` instead of `<Link to={step.ctaRoute}>`.
  - When absent, it keeps the current `<Link to={step.ctaRoute}>` — so the **artist
    dashboard path is untouched**.
  - Capability gating (`useCan(step.ctaCapability)`) is unchanged: a viewer without the
    capability still gets a read-only step (no button).

### 2. Progress rail in the banner header

When `layout === "banner"`, the rail header mirrors `DashboardWelcome`'s header layout:
title/eyebrow/body on the left, a right-aligned progress cluster on the right:

- `progressLabel` (e.g. "Set up · 1 of 3") in `text-muted-foreground/70`.
- A row of `progressTotal` segments, `h-[3px] w-[34px] rounded-full`, filled =
  `bg-accent-500`, empty = `bg-muted` (card-surface adaptation of the welcome banner's
  white-on-accent segments).
- Optional `progressHint` below in `text-muted-foreground` (kept short or omitted for a
  single module — no "About 15 minutes" time estimate).

New optional props on `DashboardSetupRail` to carry this: `progressLabel?`,
`progressFilled?`, `progressTotal?`, `progressHint?`. They render only in `banner` layout.
The `"rail"` layout ignores them (the dashboard keeps showing progress via its welcome
banner, so the rail must not duplicate it).

### 3. `initialStep` on the inline setup rails + a shared Sheet host

The inline rails already exist and already write through the same paths as Settings; they
stay as the "do it here" surface.

- Add **`initialStep?`** to `BookingSetupRail` (`BookingSetupStepKey`) and to the
  hire-orders `SetupRail` (`SetupStepKey`). It seeds the open accordion:
  `useState<StepKey | null>(initialStep ?? <existing default>)` (booking default stays
  `"flow"`; hire default stays `null`).
- Add a shared **`SetupChecklistSheet`** component
  (`src/components/setup/SetupChecklistSheet.tsx`):
  props `{ feature: FeatureKey; orgId: string | null; open: boolean;
  onOpenChange: (o: boolean) => void; initialStep?: string }`. It renders the correct inline
  rail inside the shadcn `Sheet` (right side, `sm:max-w-2xl`), **remounted via
  `key={initialStep ?? "none"}`** so each open re-seeds the accordion. This replaces the
  near-identical Sheet blocks currently duplicated in `ShowsBookingsPage` and
  `HireOrdersPage`.

### 4. `useModuleOnboardingRail(feature)` hook

File: `src/components/setup/useModuleOnboardingRail.ts` (admin/producer surfaces only).

Returns everything a module page needs to render the rail:

```ts
interface ModuleOnboardingRail {
  show: boolean;              // visible (entitled + actionable + not dismissed + not complete + not loading)
  reinvocable: boolean;      // dismissed-but-would-show (drives the header re-invoke button)
  steps: ComposedStep[];
  rules: InheritedRule[];
  offFooters: string[];
  eyebrow: string;
  title: string;             // module-specific ("Get bookings running" / "Get hire orders ready")
  body: string;
  progressFilled: number;
  progressTotal: number;
  progressLabel: string;     // `Set up · ${filled} of ${total}`
  dismiss: () => void;       // Close/Hide -> module dismiss key
}
```

Implementation:
- Role from `useAuth().hasRole` (`admin` | `producer`).
- Status: `useBookingSetupStatus(feature==='booking_flow' ? orgId : null)` /
  `useHireOrderSetupStatus(feature==='hire_orders' ? orgId : null)` — reuse the existing
  hooks; adapt hire-order steps (`blocksIssue` -> block `"issuing"`) exactly as
  `useDashboardFirstRun` does today (extract that mapping into a shared helper to avoid
  drift).
- Compose: `composeOnboarding({ enabled: new Set([feature]), role, moduleStatuses, ctx },
  MODULE_ONBOARDING)`.
- Visibility + dismiss: reuse the existing `useBookingSetupRailVisible` /
  `useSetupRailVisible` (which already own the `bookingSetup` / `hireOrderSetup`
  localStorage keys, the `complete`/`actionable` rules, and `reinvocable`). This keeps the
  module rail's show/hide behavior identical to today's callout and keeps the header
  re-invoke button working.
- Header copy: module-specific, single-sourced by adding a **`railHeader: { title; body }`**
  field to `ModuleOnboardingDef` (populated from the existing module-rail strings). Eyebrow
  = `"Set up"`.

### 5. Per-surface wiring

- **`/hire-orders`** (`HireOrdersPage.tsx`): render
  `<DashboardSetupRail layout="banner" onStepAction={openSheetAtStep} … />` **above
  `<OrdersKpis>`**, gated on the existing `showSetupRail`. Remove the dashed "Get hire
  orders ready" callout. Keep the header "Setup checklist" re-invoke button (now just
  un-dismisses / brings the rail back). Render `SetupChecklistSheet feature="hire_orders"`.
  `openSheetAtStep(step)` sets the sheet step and opens it.
- **`/bookings`** (`ShowsBookingsPage.tsx`): same, placed below the page header and above
  the filters/table. Remove the dashed "Get bookings running" callout. Render
  `SetupChecklistSheet feature="booking_flow"`.
- **`/dashboard`** (`DashboardPage.tsx`, `ProducerDashboard`): keep the existing layout, but
  pass `onStepAction` to `DashboardSetupRail`. The handler routes by `step.moduleKey` to the
  matching module's `SetupChecklistSheet` (the dashboard hosts both) opened at `step.key`.
  This removes the Settings/Productions redirect. `ArtistDashboard` is left as-is (no
  `onStepAction` → keeps the `/availability` Link).

### 6. State semantics

- **Completion / progress**: shared everywhere — same DB reads. A step done anywhere reads
  done everywhere.
- **Dismiss (Close/Hide)**: **per-surface**. The module rail keeps `bookingSetup` /
  `hireOrderSetup`; the dashboard keeps `dashboardWelcome`. Hiding a working page's nudge
  does not remove the dashboard's, and vice versa.
- **On complete**: the module rail retires (existing behavior via the visibility hook); the
  dashboard rail keeps its "rules you inherited" celebration (existing behavior).

## Testing

- `DashboardSetupRail.test`: banner layout renders full-width + progress cluster; a step
  button fires `onStepAction` when provided; falls back to a `Link` when not; capability
  gating unchanged.
- `useModuleOnboardingRail` unit test: single-module compose, done/remaining counts, header
  copy, visibility + dismiss delegation, hire-order `blocksIssue → issuing` mapping.
- `SetupChecklistSheet` test: renders the right inline rail per `feature`; `initialStep`
  seeds the open accordion (remount-by-key).
- `HireOrdersPage` / `ShowsBookingsPage` tests: rail renders above the KPI/content region;
  dashed callout removed; a step button opens the Sheet at that step; re-invoke button
  restores the rail.
- `DashboardPage` test: step button opens the module Sheet (no navigation) for
  booking/hire steps.

All logic tested via the real modules (no re-implementation), using the existing
`renderWithProviders` + `supabaseFake` harness. Test-first per repo convention.

## Files touched (anticipated)

- `src/lib/dashboard/types.ts` — new `DashboardSetupRail` props; `railHeader` on
  `ModuleOnboardingDef`.
- `src/lib/dashboard/moduleOnboarding.ts` — populate `railHeader` for both modules.
- `src/components/dashboard/firstRun/DashboardSetupRail.tsx` — `layout`, `onStepAction`,
  progress props.
- `src/components/setup/useModuleOnboardingRail.ts` — new hook.
- `src/components/setup/SetupChecklistSheet.tsx` — new shared Sheet host.
- `src/components/bookings/setup/BookingSetupRail.tsx` — `initialStep` prop.
- `src/components/hireOrders/setup/SetupRail.tsx` — `initialStep` prop.
- `src/pages/HireOrdersPage.tsx`, `src/pages/ShowsBookingsPage.tsx`,
  `src/pages/DashboardPage.tsx` — wiring.
- Co-located tests for each of the above.

## Open questions

None outstanding. Progress placement (top-right segmented rail) and per-surface dismiss are
resolved.
