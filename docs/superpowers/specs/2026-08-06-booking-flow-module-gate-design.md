# Make `booking_flow` a real entitlement module

**Date:** 2026-08-06
**Branch:** `claude/booking-flow-disabled-greyed-f8fe16`
**Target version:** 1.14.0

## Problem

`booking_flow` is registered in `FEATURE_REGISTRY` alongside `hire_orders`, and a
super-admin can toggle it per org from the Platform console. But toggling it off changes
almost nothing: the booking UI keeps rendering, and the engine keeps running.

The current semantics are "you don't get to *configure* the flow", not "you don't get the
flow". They are implemented consistently across three layers:

- `get_effective_booking_flow(_org)` (migration `20260716235007`) returns `NULL` when the
  org is unentitled, and every caller `COALESCE`s back to its hard-coded default. The
  migration comment states the intent outright: an unentitled org "silently behaves like
  the pre-booking-flow product (classic defaults)".
- `fetchBookingFlow` (`src/data/settings.ts:67`) checks `is_feature_enabled` and, when
  off, returns `normalizeBookingFlow(null)` — which is `BOOKING_FLOW_DEFAULTS`, i.e. the
  full engine on (`auto_open_tier1`, `artist_acceptance`, `producer_confirmation`,
  `understudy_promotion` all true).
- The only `useFeature("booking_flow")` call site in `src/` is `BookingFlowTab.tsx:50`,
  which renders the settings editor read-only.

So `ShowDateDetailSheet` receives classic-defaults config and draws the classic booking
UI. That is correct under the old design and is why the module "still shows".

There is no `ROUTE_FEATURES` entry for `booking_flow` and no
`requireFeature(deps, org, "booking_flow")` anywhere in `supabase/functions/`.

## Decision

`booking_flow` becomes a real module with the same three-layer enforcement `hire_orders`
has. Four decisions fix its meaning:

1. **Scope: everything booking goes dark.** Off means no bookings at all — both the
   tiered offer engine *and* the direct "Book artists" path. An unentitled org uses
   ShowFlow as a show/date catalog plus artist directory.
2. **Treatment: hybrid.** Dedicated nav items and routes are hidden (the `hire_orders`
   pattern). Booking regions that sit inside a page which stays visible are rendered
   greyed and inert with a short explanation, so producers learn *why* rather than
   wondering where the section went.
3. **Existing data: freeze, cast stays readable.** Disabling touches no rows. Pending
   offers sit un-actioned; the engine stops. The show date keeps a read-only list of who
   is confirmed. Re-enabling resumes exactly where it left off. No draining of pending
   offers — a settings toggle must not have destructive side effects.
4. **Enforcement: full defense in depth, RLS included.**

### Consequence: the artist role empties out

With the module off an artist has no availability page, no offers and no bookings —
they become a directory entry whose dashboard is an explanatory empty state. This follows
from decision 1 and is accepted.

### Rejected: flip the semantics at the source

Have `get_effective_booking_flow` return an all-automation-off flow and let the existing
config-driven UI collapse on its own. Rejected because it does not deliver decision 1:
`artist_acceptance: false` does not hide booking, it switches to the direct-book path,
which is also being gated. It would also change behaviour silently instead of gating it,
which is the ambiguity that caused this bug in the first place.

---

## 1. Database floor

`bookings` currently carries (verified against the live project, not the migration tree):

| Policy | Cmd | Kind |
|---|---|---|
| `Admins manage bookings` | ALL | PERMISSIVE |
| `Producers manage bookings` | ALL | PERMISSIVE |
| `org_isolation` | ALL | RESTRICTIVE |
| `Artists can view own bookings` | SELECT | PERMISSIVE |
| `Artists can respond to own offers` | UPDATE | PERMISSIVE |

**Add new RESTRICTIVE policies for INSERT, UPDATE and DELETE** requiring
`public.is_feature_enabled(org_id, 'booking_flow')`.

RESTRICTIVE policies compose with AND against every permissive policy, so three small
policies close all four write paths at once without touching the existing bodies. This
deliberately avoids the verbatim-copy-the-newest-body pattern that migration
`20260716235007` was forced into for `promote_understudy_on_cancellation` and the artist
policy — that pattern is how a stale body silently reverts behaviour.

`FOR ALL` must **not** be used: it would restrict SELECT too, and readable confirmed cast
(decision 3) depends on SELECT staying open.

Scope of the floor: it binds `authenticated` clients only. Service-role callers (crons,
edge functions) and `SECURITY DEFINER` triggers bypass RLS by design and are gated at
their own layer instead.

**`promote_understudy_on_cancellation` gets an explicit early return** when the org is
unentitled. Today it reads `get_effective_booking_flow`, receives `NULL`, and
`COALESCE`s straight back into promoting — the entitlement is invisible to it.

`get_effective_booking_flow` itself is unchanged. Its NULL-means-classic-defaults contract
still serves entitled orgs whose config is absent.

## 2. Edge functions and crons

| Function | Change |
|---|---|
| `open-offer-tier` | `requireFeature(deps, org_id, "booking_flow")` |
| `close-offer-tier` | `requireFeature(deps, org_id, "booking_flow")` |
| `expire-offers` | `filterEntitledOrgs` over `getActiveOrgs` |
| `send-offer-digest` | `filterEntitledOrgs` over `getActiveOrgs` |
| `send-confirmation-digest` | `filterEntitledOrgs` over `getActiveOrgs` |
| `tier-at-risk-watcher` | `filterEntitledOrgs` over `getActiveOrgs` |
| `airtable-poll` | keeps syncing dates; skips tier-1 auto-open for unentitled orgs |

`filterEntitledOrgs` already exists in `supabase/functions/_shared/entitlements.ts`. Its
docstring describes itself as scaffolding for exactly these fleet-wide cron paths, so this
is finishing existing work, not new infrastructure. It is a single batched
`org_entitlements` read, not an N+1 of per-org RPCs.

`airtable-poll` keeps its date sync because dates are catalog data, not bookings.

### Retained non-change: `checkFeature` fails open for `booking_flow`

`checkFeature` returns `true` for `booking_flow` on an RPC error, with a documented
rationale: the booking engine is live production traffic and must never be silently
disabled by a transient RPC failure. **This is kept.** Failing closed would risk killing
booking for every entitled org during a blip, which is far worse than an unentitled org's
engine running briefly. The DB floor does not share this weakness, so the layers cover
each other. The fail-open branch gets a test so the rationale stays pinned.

## 3. Frontend

### Hidden (existing mechanism, no new code)

- `navItems.ts`: `/availability` gains `feature: 'booking_flow'`. The `feature` field and
  its filtering already exist — `hire_orders` uses it.
- `ROUTE_FEATURES`: `'/availability': 'booking_flow'`, so a direct URL renders
  `FeatureDisabledScreen` via `ProtectedRoute`.

`/bookings` stays visible. It is also the producer's show-date catalog, which decision 1
keeps. Its booking-specific regions are greyed instead.

### New: `<ModuleGate feature="...">`

One small component. Renders children inert (non-interactive, muted) plus a single
standard Alert built from `FEATURE_REGISTRY[feature].label`, so its copy cannot drift from
`FeatureDisabledScreen`. It exists because five surfaces need exactly this treatment;
hand-rolling disabled styling five times is how five slightly different disabled states
get born.

"Inert" means: interactive controls disabled, the region visually muted, and no queries
fired for data the user cannot act on.

Applied to:

- `ShowDateDetailSheet` — the Offers / "Book artists" card. The greyed card retains a
  read-only confirmed-cast list (decision 3).
- `DirectBookingCard`
- `TierAttentionCard`
- `ArtistBookingsView`
- `ArtistDashboard` booking widgets

### Other frontend changes

- Nav badges `openOffers` and `pendingConfirmations` are suppressed when unentitled.
- `BookingFlowTab`'s locked copy currently reads "Your booking pipeline runs the standard
  flow." Under the new semantics the pipeline does not run at all. Rewrite it.

## 4. Testing

| Layer | Coverage |
|---|---|
| Vitest | `ModuleGate` itself; each gated surface entitled → renders, unentitled → inert + note; nav item and `ROUTE_FEATURES` gating; suppressed badges; `BookingFlowTab` copy |
| Deno | `requireFeature` 403 on both offer-tier functions; `filterEntitledOrgs` applied in all four crons; `airtable-poll` auto-open skip; the `checkFeature` fail-open branch |
| pgTAP | Producer INSERT denied while unentitled and allowed while entitled; artist UPDATE denied while unentitled; **SELECT still permitted while unentitled**; understudy trigger no-ops while unentitled |

### Risk to verify explicitly

The new RESTRICTIVE write policies must not catch paths that legitimately write bookings
through `SECURITY DEFINER` RPCs — notably show-date cancellation and the GDPR `delete_org`
/ `anonymize_user` flows. These bypass RLS in principle; pgTAP coverage confirms it in
practice rather than by assumption. This is the highest-risk part of the change.

## 5. Out of scope

- No change to `hire_orders`. If an org has `hire_orders` on and `booking_flow` off,
  existing confirmed bookings can still produce hire orders. The modules stay independent;
  freeze semantics mean prior data keeps working.
- No migration of existing org entitlement rows. `booking_flow` remains `defaultEnabled:
  true`, so no live org changes behaviour on deploy.
- No changes to the offer/booking domain logic itself — only gates around it.
