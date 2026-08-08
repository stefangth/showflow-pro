# Fresh-org module picker + booking-flow "off" state + honest onboarding

Date: 2026-08-08
Branch: `claude/fresh-org-module-setup-3aec16`
Status: design (awaiting review)

## Problem

Two related rough edges when a super-admin provisions a fresh org:

1. **No module choice at creation.** The New-organization modal collects only
   name / slug / admin email / role. Entitlements are seeded from the platform
   `default_entitlements` setting (falling back to `FEATURE_REGISTRY` defaults:
   `booking_flow` ON, `hire_orders` OFF). The super-admin cannot decide, per org,
   which modules the org gets.

2. **Booking flow starts as "classic", which is misleading in two ways.**
   - `BOOKING_FLOW_DEFAULTS` (`src/lib/bookingFlow.ts`) is byte-identical to the
     `classic` preset, so an org that has **never chosen a flow** shows *Classic*
     highlighted in Settings, and — because `auto_open_tier1` defaults `true` —
     the engine **auto-opens tier-1 offers the moment dates sync**
     (`supabase/functions/airtable-poll/index.ts:430`), before the admin has
     configured anything.
   - The dashboard first-run rail shows **~3 of 5 steps already done** on a brand
     new, empty org. Verified cause: `flowChosen` correctly reads *not done*
     (it requires an owned `booking_flow` row, and inheriting the classic default
     is explicitly not a choice — `setupStatus.ts:45`), but `slots`, `ladder` and
     `eligibility` read *done* because `.every()` over an **empty** shows/coverage
     set is vacuously true (`setupStatus.ts:91-96`). So the misleading count is
     driven by empty collections, **not** by the classic preset.

## Goals

- The super-admin explicitly chooses which modules a new org gets, in the creation
  modal. Picker defaults **both modules off** (opt-in).
- When `booking_flow` is enabled for a fresh org, it lands in an explicit
  **off / not-configured** state: inert at runtime, unhighlighted in Settings,
  and read as "not chosen" by onboarding.
- A truly empty fresh org reads as a **clean slate: 0 of 5** in the onboarding rail.
- **Zero behavior change for existing / legacy orgs.** No migration that rewrites
  live tenants' flow behavior.

## Non-goals

- Redesigning the onboarding rail's step set or its progressive disclosure.
- Changing `FEATURE_REGISTRY.defaultEnabled` (it remains the fallback for legacy
  orgs with no `org_entitlements` row).
- Per-org module toggling after creation (already exists via the Organizations
  tab → `setOrgEntitlement`).

## Design

### Part 1 — Module picker in the creation modal

**UI.** `src/components/platform/NewOrgDialog.tsx` gains an "Modules" section: one
switch per `FEATURE_REGISTRY` entry (label + description from the registry), so it
stays data-driven as modules are added. Both switches default **off**. Form state
adds a `features: Record<FeatureKey, boolean>` field.

**Data path.**
- `provisionOrg(client, args)` in `src/data/platform.ts` gains
  `features: Record<FeatureKey, boolean>` and forwards it as `entitlements` in the
  edge-function body.
- `supabase/functions/provision-org/index.ts` accepts an optional
  `entitlements: Record<FeatureKey, boolean>`. When present, it seeds
  `org_entitlements` from it (validated against `FEATURE_KEYS`, unknown keys
  dropped, missing keys fall back to the existing `default_entitlements` →
  registry-default resolution). When absent, behavior is exactly as today
  (back-compat for any other caller / older client).

**Why not change the registry default.** `enabledFeatures()` uses
`FEATURE_REGISTRY[k].defaultEnabled` as the fallback for orgs with **no**
`org_entitlements` row (legacy orgs). Flipping `booking_flow` to `false` there
would silently disable booking for those orgs. The picker's "off by default" is a
**UI** default only; it does not touch the registry fallback.

### Part 2 — Explicit "off / not configured" booking-flow state ("do both")

Represent "off" as **both** a first-class model field *and* a preset tile, unified
so the tile is backed by the field (no fragile field-combination).

**Model (`src/lib/bookingFlow.ts` + hand-kept mirror
`supabase/functions/_shared/bookingFlow.ts`).**
- Add `active: boolean` to `BookingFlow` as a **master switch, not a preset field**.
  `FlowFields` stays `Omit<BookingFlow, "reference_field" | "active">`, so the three
  real presets keep their 9 automation fields and `BOOKING_FLOW_PRESETS` is
  unchanged. `active` is orthogonal.
- `normalizeBookingFlow`: `active` defaults to **`true`** when the key is absent.
  This is the critical back-compat lever — every existing saved row and every
  legacy no-row org (which normalizes from "no value") stays active/classic,
  unchanged.
- `PresetName` gains `"off"` (a UI/selection state; **no** `BOOKING_FLOW_PRESETS.off`
  entry).
- `applyPreset(flow, "off")` ⇒ `{ ...flow, active:false }` — preserves the
  underlying fields (they are inert while inactive, so a later toggle back On
  restores the org's real config). `applyPreset(flow, <real preset>)` ⇒
  `{ ...flow, ...BOOKING_FLOW_PRESETS[preset], active:true }`.
- `matchPreset(flow)`: **if `!flow.active` return `"off"` first** (deterministic,
  independent of the field values); else the existing field-match → preset | custom.

**Settings UI.**
- `FlowPresets.tsx`: add an **Off** tile (a real button) as the first option.
  `active === "off"` highlights it. Selecting it calls `onSelect("off")`.
- `BookingFlowTab.tsx`: when `matchPreset(flow) === "off"`, render an info banner
  ("Booking flow is off — no offers, reminders or confirmations run. Pick a flow
  to turn it on.") and disable the timeline/rail editing below (same
  `stepsDisabled` treatment used for `locked`, but with off-specific copy). This is
  distinct from the existing `locked` (module-not-entitled) alert.

**Runtime gates.** Anywhere the engine acts on flow automation, add `flow.active`:
- `airtable-poll/index.ts` tier-1 auto-open condition (`:430`).
- `expire-offers/index.ts` auto-escalation (`:321`) and any reminder/digest paths
  that presuppose an active flow.
  (These already gate on the `booking_flow` entitlement; `active` is the org-admin's
  in-module on/off, orthogonal to the super-admin's licensing.)

**Provisioning.** When `provision-org` seeds `booking_flow = enabled`, it also
upserts the org's `booking_flow` app_setting to the **off** policy
(`applyPreset(normalizeBookingFlow(null), "off")`). This is the "lands in off,
not classic" behavior, and it is the only path that ever writes `active:false`
implicitly — existing orgs are never written.

### Part 3 — Honest 0-of-N onboarding

**Flow step.** `flowChosen` must mean "owns a `booking_flow` row **and** it is
active". `useBookingSetup.ts` already reads owned keys; it will additionally read
the flow value (via the existing `useBookingFlow` / settings read) and compute
`flowChosen = ownedSet.has("booking_flow") && normalizeBookingFlow(flowValue).active`.
A fresh org (seeded off) → `flowChosen:false`.

**Empty-collection steps (chosen: "not done until real data").** In
`computeBookingSetupStatus` (`src/lib/bookings/setupStatus.ts`):
- `slots` done ⇒ `Array.isArray(shows) && shows.length > 0 && shows.every(has slots)`.
- `ladder` done ⇒ `coverage && coverage.futurePairs.length > 0 &&
  uncoveredPairs.length === 0`.
- `eligibility` done ⇒ `coverage && coverage.futurePairs.length > 0 &&
  uncoveredPairs.length === 0 && !hasNullCity`.

Result on a fresh empty org: flow / slots / ladder / eligibility / timing all
**not done → 0 of 5**.

**Accepted trade-off.** With this rule the rail's `complete` (all steps done →
"This workspace is already set up") is only reached once the org actually has
active flow + timing + a slotted show + a covered future date. An org with no
dates yet keeps reading "setup in progress" — which for a booking product is the
honest state, and the rail remains dismissible ("Later").

## Data / mirror / test obligations

- `src/lib/bookingFlow.ts` and `supabase/functions/_shared/bookingFlow.ts` are
  **hand-mirrored** (per the file header + CLAUDE.md; not in
  `mirrors.manifest.json`). Every model change lands in both in the same PR.
- No DB schema change: `active` lives inside the existing `booking_flow` JSONB
  app_setting; `org_entitlements` rows are already seeded by `provision-org`.
- Tests (test-first):
  - `bookingFlow.test.ts`: `normalizeBookingFlow` defaults `active:true` when
    absent and round-trips `false`; `matchPreset` returns `"off"` iff `!active`;
    `applyPreset("off")` / real-preset set `active` correctly.
  - `setupStatus.ts` tests: empty org → 0/5; a slotted show / covered date flip the
    respective steps; `flowChosen` requires `active`.
  - `provision-org` DI test: `entitlements` body seeds the exact rows; omitted →
    legacy resolution; enabling `booking_flow` seeds the off flow policy.
  - `NewOrgDialog` test: toggles default off; submit forwards `features`.
  - Runtime: `airtable-poll` does not auto-open when `active:false`
    (extend the existing DI suite).

## Risks

- **Overloaded "enabled" wording.** Entitlement `enabled` (super-admin licensing)
  vs flow `active` (org-admin on/off). Keep the field named `active`, never
  `enabled`, to avoid confusion in code and copy.
- **Mirror drift** between the two `bookingFlow` files — covered by the same-PR
  rule and the shared test intent, but there is no generator guard; call it out in
  review.
- **Legacy no-row orgs.** They rely on `normalizeBookingFlow(null).active === true`.
  The default-true rule is load-bearing; a test pins it.
