# Bookings guided onboarding (design 1a)

**Date:** 2026-08-07
**Source design:** Claude Design project `9c514e8a`, `Bookings Onboarding.dc.html`, approach **1a** — "Setup rail, with a rehearsal at the end".
**Precedent:** the hire-order setup rail shipped in #210.

---

## 1. Problem

An org that has just been provisioned can see its show dates (Airtable sync or the in-app
dialog fills them in) but cannot get an offer out, and nothing on the Shows and bookings
page says why. The gaps live in three different places — Settings → Booking flow, the
Productions page, Settings → Casts and cities — and none of them is reachable from the
page where the absence is felt.

The hire-order rail solved the same shape of problem for issuing. Bookings adds a second
job: the *flow model* has to be taught, not just configured. An admin choosing between
Classic, Fast-track and Direct book is deciding what artists will see and what the app
will call things, and today that choice is made in a Settings tab with no consequence
preview beyond the timeline.

## 2. Goals

- A dismissible checklist beside the working Shows and bookings table that retires itself
  when setup is complete.
- The flow step teaches the model as it is picked: the lifecycle chips and the
  per-audience consequences are rendered from the live policy, not from prose.
- Blocker chips that are true against the engine. A checklist that overstates its
  blockers stops being believed (#210, `SetupStepRow`).
- A rehearsal: resolve the real tier, the real artists and the real send time for a real
  upcoming date, create nothing, send nothing.
- The producer and artist views of the same moment.

## 3. Non-goals

- No schema change, no migration, no edge-function change. Every step reads a table that
  exists and writes a path that already ships.
- No new tutorial surface. The mock's "Walk me through a date" button is dropped.
- No relational editing in the rail for casts, cities and eligibility. Those stay in
  Settings → Casts and cities; the rail names the gaps and links out.
- No cross-device dismissal. Per-browser localStorage, as in #210.

---

## 4. What already exists

The adaptation is mostly wiring. Confirmed against the code:

| 1a element | Existing implementation |
|---|---|
| Rail skeleton | `src/components/hireOrders/setup/` — `SetupRail`, `SetupStepRow`, `ProducerWaitingCard`, `useRailDismissed`, `useSetupRailVisible` |
| Classic / Fast-track / Direct book | `BOOKING_FLOW_PRESETS`, `applyPreset`, `matchPreset` (`src/lib/bookingFlow.ts`); `FlowPresets.tsx` |
| "A booking then goes" chips | `lifecycleChips(flow)` |
| Artist / Producer / Automation rows | `inPracticeRows(flow, times)` |
| Rehearsal | `dryRunOfferTier` (`src/data/bookings.ts`) → `open-offer-tier` with `dry_run: true` |
| Slot write path | `updateShow` (`src/data/shows.ts`) |
| Ladder resolution (server truth) | `resolveTierLadder` / `ladderCastIdsAtTier` (`supabase/functions/_shared/eligibility.ts`) |
| Timing settings | `offer_response_window_hours`, `offer_digest_hour_berlin`, `confirmation_digest_hour_berlin` |
| "Unconfigured" status chip | already rendered by `ShowsBookingsPage` |

The mock's `chipsFor` / `practiceFor` are static reimplementations of `lifecycleChips` /
`inPracticeRows`. They must not be ported; the rail renders the real ones.

## 5. Differences from the mock, and how each is resolved

**5.1 Only one step blocks an offer.** Traced against the engine:

- *Booking flow* — absent row means `normalizeBookingFlow(null)` = Classic. Offers go out.
  Not a blocker.
- *Slots per show* — `open-offer-tier` never reads slots. The mock's "never opens a tier"
  is wrong here. Slots gate escalation (`expire-offers` skips a null `main_cast_slots`),
  the `fully_filled` status, and therefore hire-order auto-draft.
- *Cast priorities per city* — an empty ladder makes `open-offer-tier` return
  `benignExit("No casts configured at tier N for this city")`. The one true blocker.
- *Who is eligible* — `show_cast_eligibility` rows narrow the candidate set. Absent rows
  mean no narrowing, not incomplete setup.
- *Response window and digests* — `BOOKING_ENGINE_DEFAULTS` covers all three.

Resolution: **two chip kinds**. `Blocks offers` (badge tone `risk`, amber) on the ladder
step only; `Blocks filling` (tone `neutral`) on slots. The other three carry no chip and
say what they do in their hint.

**5.2 Steps 3 and 4 are one blocker across two tables.** `resolveTierLadder` takes the
show-scoped `show_cast_eligibility` priorities when any exist, else the org-wide
`cast_city_priority` for the city. Resolution: keep both rail steps, because they edit
two different things, but compute **one** readiness rule (§6.2) that both report. The
chip hangs on the ladder step, which can always fix it.

**5.3 The rail infra is hire-order-typed.** `SetupStepKey = letterhead|terms|countersign`,
capability `edit_hire_order_settings`, storage key `showflow.hireOrderSetup.hidden.*`,
hardcoded "Blocks issue". Resolution: extract a shared primitive (§6.1).

**5.4 The rehearsal has no org-level entry point.** `dryRunOfferTier` needs a
`showDateId` and a `tier`. Resolution: the rail resolves both (§6.5).

**5.5 Digest hours.** The mock draws 09:00 offers / 17:00 confirmations; our defaults are
19:00 / 20:00 Berlin. The rail renders live values.

**5.6 The artist explainer is hardcoded Classic.** "Accepting holds the date, a producer
confirms it" is false under Fast-track (acceptance confirms) and Direct book (no offer at
all). Resolution: derive from `inPracticeRows`.

**5.7 Tokens and copy.** The mock is raw hex and px. Ported to semantic tokens; no
opacity modifier on any numbered accent stop; no em-dashes in user-facing copy.

---

## 6. Design

### 6.1 Shared rail primitive — `src/components/setup/`

Two files move out of `src/components/hireOrders/setup/`, generalised only where the
second rail forces it:

- **`SetupStepRow.tsx`** — `blocksIssue: boolean` becomes
  `block: { label: string; tone: "risk" | "neutral" } | null`. Hire orders passes
  `{ label: "Blocks issue", tone: "risk" }` and renders exactly as before.
- **`useRailDismissed.ts`** — signature becomes `useRailDismissed(namespace, orgId)`.
  The hire-order caller passes `"hireOrderSetup"`, so the existing storage key
  `showflow.hireOrderSetup.hidden.<org>` is unchanged and shipped dismissals survive.
  Bookings uses `"bookingSetup"`.

`useSetupRailVisible` is **not** shared: it reads a domain-specific capability and status
object, and there is nothing left to extract once those are parameterised.

This edits merged #210 code. Behaviour is identical, so `SetupRail.test.tsx`,
`useSetupRailVisible.test.ts` and the step-panel tests should pass with only import and
prop-name updates.

### 6.2 Readiness rule — `src/lib/bookings/setupStatus.ts`

Pure, unit-tested, client-only. Deliberately separate from the engine's own gates, the
same way `setupStatus.ts` is separate from `orderReadyIssues`.

```ts
export type BookingSetupStepKey = "flow" | "slots" | "ladder" | "eligibility" | "timing";
export type BlockKind = "offers" | "filling" | null;

export interface BookingSetupStep {
  key: BookingSetupStepKey;
  done: boolean;
  block: BlockKind;
}

export interface BookingSetupStatus {
  steps: BookingSetupStep[];   // always all five, in rail order
  doneCount: number;
  totalCount: number;
  canOffer: boolean;           // every block === "offers" step is done
  complete: boolean;           // every step is done: the rail retires
}
```

Step rules:

| Key | Done when | `block` |
|---|---|---|
| `flow` | the org has its OWN `booking_flow` row (`hasOrgSettingRow`); inheriting the Classic default is not a decision | `null` |
| `slots` | every active show has both slot columns set, i.e. `showSlots(show) !== null` | `"filling"` |
| `ladder` | the coverage rule below | `"offers"` |
| `eligibility` | the coverage rule below | `null` |
| `timing` | the org has its own row for all three timing keys | `null` |

**Coverage rule (shared by `ladder` and `eligibility`).** For every `(show_id, city_id)`
pair that has at least one future, non-cancelled `show_date`, the effective ladder must
yield at least one cast **at tier 1**, mirroring `resolveTierLadder` precedence:

1. If any `show_cast_eligibility` row exists for `(show_id, city_id)` with a non-null
   `priority`, that set is the ladder outright.
2. Otherwise the ladder is the `cast_city_priority` rows for `city_id`.
3. The pair is covered when that ladder contains a row with `priority === 1`.

Checking tier 1 specifically, rather than "any tier", catches a ladder that starts at
tier 2. That opens to nobody today and is currently invisible in the UI.

A future date with a null `city_id` is reported under `eligibility` as its own gap:
`open-offer-tier` exits with "Show date has no city, cannot resolve priority casts".

**Fail-safe.** Every input is `T | null | undefined`, and `undefined` (read in flight or
failed) reports the step **outstanding**. An unread setting is not an empty one. Over-
reporting is the safe direction for a checklist; never let it drift the other way.

### 6.3 Composition hook — `src/hooks/useBookingSetup.ts`

`useBookingSetupStatus(orgId)` composes the reads and returns
`{ status, isLoading, isError }`:

- resolved `app_settings` rows (for `flow` and `timing` ownership),
- `fetchShowsWithSlots` (already exists),
- future non-cancelled show dates as `(show_id, city_id)` pairs,
- `cast_city_priority` rows for the org,
- `show_cast_eligibility` rows for the org.

The last three are new reads in `src/data/eligibility.ts`:
`fetchLadderCoverageInputs(client, orgId)` returns the raw rows. Resolution happens in
the pure lib so it is testable without a client.

Query keys follow the domain-prefix convention: `["eligibility", "ladder-coverage", orgId]`.

`useBookingSetupRailVisible(orgId)` lives beside the rail at
`src/components/bookings/setup/useBookingSetupRailVisible.ts`, mirroring
`useSetupRailVisible`: its own module rather than a second export from the rail, because
`ShowsBookingsPage` must know the answer before it picks its grid template. Its rule is
§6.8.

### 6.4 Rail — `src/components/bookings/setup/`

`BookingSetupRail.tsx` mirrors `SetupRail`: header with `Set up · N of 5`, a Hide button,
the progress dashes, then five `SetupStepRow`s and the rehearsal block. Header copy:

> **Get bookings running** — Dates keep syncing and you can edit them now. These are what
> the first offer needs.

Panels. Setup happens in the rail, but every panel writes the path its Settings
counterpart already writes:

- **`FlowStep`** — `FlowPresets` for the three cards, then `lifecycleChips(flow)` as the
  "A booking then goes" row and `inPracticeRows(flow, times)` as the Artist / Producer /
  Automation rows. CTA reads `Use Classic` / `Use Fast-track` / `Use Direct book` and
  writes `booking_flow` through `upsertOrgSetting`. Advances the open step to `slots`.
- **`SlotsStep`** — lists only shows with a missing slot count, two number inputs each,
  saves via `updateShow`. Invalidates `["shows"]`.
- **`LadderStep`** — read-only: each city with a future date and its tiers, or "no casts
  ranked". Links to Settings → Casts and cities.
- **`EligibilityStep`** — read-only: each `(show, city)` pair with a future date that has
  no tier-1 cast, plus any date with no city. Links to the same place.
- **`TimingStep`** — window hours and the two digest hours, seeded from
  `BOOKING_ENGINE_DEFAULTS`, written as the three keys. Berlin-time note underneath.

`BookingProducerWaitingCard` replaces the rail when the viewer lacks
`edit_booking_settings`: eyebrow "Waiting on your admin", heading "Plan dates now, offer
later", then one row per outstanding step whose `block !== null`, labelled by kind. Like
the hire-order card it does not name an admin — `list_org_members` is admin-guarded.

### 6.5 Rehearsal — `RehearsalBlock.tsx`

Rendered at the foot of the rail. Picks the soonest future non-cancelled show date that
has a `city_id`, calls `dryRunOfferTier({ showDateId, tier: 1 })`, and renders the
returned candidates with the excluded counts. Footer line derives from the live policy:

- `offer_delivery === "immediate"` → "Would email immediately, window closes +Nh"
- otherwise → `Would email in the ${hh(offerDigestHour)} digest, window closes +Nh`

Nothing is created and no email leaves: `open-offer-tier` returns before any insert when
`dry_run` is set. Hidden entirely when no future date has a city, and when the flow is
Direct book (there are no offers to rehearse; the edge function refuses).

The button is gated on `useCan("run_offer_engine")`, mirroring the
`producer_can_run_offer_engine` capability the edge function enforces for producers.
Admins are unaffected. Each click is a real invocation, so the result is held in
component state and the button relabels to "Run it again" rather than auto-refetching.

### 6.6 Artist — `FirstOfferCard.tsx`

Above `ArtistBookingsView`, shown while the artist has at least one pending offer and has
not dismissed it (`useRailDismissed("artistFirstOffer", orgId)`). Body text is the
`Artist` row of `inPracticeRows(flow, times)`, so it stays true under every preset.

### 6.7 Mount — `ShowsBookingsPage`

A null child does not collapse a grid track, so the page decides the column template
before rendering, exactly as `HireOrdersPage` does:

```tsx
const railVisible = useBookingSetupRailVisible(entitled ? orgId : null);
```

`className={cn("grid gap-5", railVisible && "lg:grid-cols-[1fr_340px] lg:items-start")}`.
The rail sits in the admin/producer branch only; the artist branch gets `FirstOfferCard`.

### 6.8 Gating

- **Entitlement.** `booking_flow` off → no rail, no rehearsal, no artist card. Symmetric
  with the edge `requireFeature`, per the god-mode lesson: a frontend bypass that the
  server does not mirror produces a full UI whose every write 403s.
- **Capability.** `edit_booking_settings` → the rail; without it → the waiting card.
  Note this capability defaults to **false** for producers, so the common producer sees
  the card.
- **Visibility.** `useBookingSetupRailVisible` returns false when there is no org, while
  loading, when dismissed, or when `status.complete`. A viewer without
  `edit_booking_settings` sees the card only while `!status.canOffer`, so an org that can
  already offer never shows a producer a blocker no admin action would clear.

---

## 7. Data flow

```
app_settings ─┐
shows ────────┤
show_dates ───┼─> fetchLadderCoverageInputs ─> computeBookingSetupStatus ─> BookingSetupRail
cast_city_priority ─┤        (pure)                                    ├─> BookingProducerWaitingCard
show_cast_eligibility ─┘                                               └─> useBookingSetupRailVisible
                                                                              │
ShowsBookingsPage ────────────────────────────────────────────────────────────┘ (grid template)

FlowStep    ─> upsertOrgSetting("booking_flow")        ─> invalidate ["app-settings"]
SlotsStep   ─> updateShow(id, { mainCastSlots, ... })  ─> invalidate ["shows"]
TimingStep  ─> upsertOrgSetting(x3)                    ─> invalidate ["app-settings"]
Rehearsal   ─> dryRunOfferTier(dateId, 1)              ─> open-offer-tier (dry_run, no writes)
```

## 8. Error handling

- Reads use React Query `isLoading` / `isError`. A failed read leaves its step
  outstanding (§6.2 fail-safe) rather than claiming done.
- Panel writes surface through `toast.error` on failure and `toast.success` on save,
  matching the hire-order step panels.
- The rehearsal renders `DryRunResult.message` when the edge function benign-exits (for
  example "No casts configured at tier 1 for this city"), which is itself a useful
  diagnosis and is why the block sits below the ladder step.
- No page-level `Alert` is added: the rail is the diagnostic surface.

## 9. Testing

Unit (vitest), co-located:

- `src/lib/bookings/setupStatus.test.ts` — each step rule; the tier-1-specific coverage
  rule; show-scoped priorities overriding the org list; a null-city future date; the
  unread-input fail-safe; `canOffer` vs `complete`.
- `src/components/setup/SetupStepRow.test.tsx` — both chip tones, and no chip when
  `block` is null.
- `src/components/bookings/setup/BookingSetupRail.test.tsx` — five rows, counter, Hide,
  capability swap to the waiting card.
- `RehearsalBlock.test.tsx` — hidden with no eligible date and under Direct book;
  capability gate; message passthrough.
- `FirstOfferCard.test.tsx` — copy changes with the preset.
- `ShowsBookingsPage` — the grid keeps one column when the rail is not visible.
- Updated: `SetupRail.test.tsx`, `useSetupRailVisible.test.ts` and the hire-order step
  tests, for the moved imports and the `block` prop.

No pgTAP and no Deno test change: nothing in the database or the edge runtime moves.

## 10. Release

User-facing feature. Bump `package.json` and `APP_META.VERSION` together, add a
newest-first `public/changelog.md` block, and regenerate `public/changelog.json` with the
Deno script. Same-day changes fold into one version entry.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Extracting shared files churns merged #210 code | Behaviour-preserving move; the hire-order storage namespace and chip label are passed explicitly so nothing observable changes. Its full test suite must stay green. |
| The client coverage rule drifts from `resolveTierLadder` | The rule is documented against the server function by name in the module header, and only ever over-reports. It drives an affordance; the engine remains authoritative. |
| Coverage reads add page load cost | Four small org-scoped reads, cached by React Query, and only fetched while the rail can be visible (entitlement + not dismissed + not complete). |
| A rehearsal click costs a real edge invocation | Manual trigger only, result held in state, no polling or auto-refetch. |
