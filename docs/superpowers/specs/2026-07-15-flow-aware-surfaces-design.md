# Flow-Aware Surfaces (Booking Flow Phase 3) — Design

Approved 2026-07-15. Follows the configurable booking flow shipped as v1.9.0 (PRs #161-163). Prior art: `docs/superpowers/specs/2026-07-14-booking-flow-editor-design.md`; handoff `docs/superpowers/plans/2026-07-14-booking-flow-followups.md` (Tier 3, item 8).

## Goal

Dashboards, artist surfaces, and notifications speak the organization's configured booking flow. A direct-booking org's artist is notified when booked; no surface claims "offers" where none exist; producers see flow-relevant work on their dashboard.

## Non-goals

- Phase 4 (configurable eligibility: tiering axis, skills filters).
- New or changed email templates; email stays on the existing confirmation digest.
- Notification-preferences UI changes (the reused `booking_confirmed` type inherits existing category gating).
- Response-rate history/trends; the meter stays a single current percentage.
- The unreachable combination `artist_acceptance=false AND producer_confirmation=false` (normalizeBookingFlow forbids it).

## Design decisions (user-approved)

1. Scope: all four areas (notification gap, artist copy/meter, producer dashboard, delivery hints).
2. Direct-booking notification: in-app immediately via DB trigger; email remains digest-only.
3. Meter: swap metric per mode (offer orgs keep "Response rate"; direct orgs get "Booked dates").
4. Producer dashboard: attention card (offer orgs) + direct-mode framing card + immediate-delivery hint.
5. Structure: central flow-copy module (Approach A), not per-surface inline branching.

## 1. `src/lib/flowCopy.ts` (new, pure)

No React imports. Every function takes a normalized `BookingFlow` (callers normalize via `useBookingFlow`, which already returns normalized data; the module itself does not re-normalize). Copy derives from the switches (`artist_acceptance`, `offer_delivery`), never from preset names, so custom configs work. No em- or en-dashes in any string; middot and arrows allowed.

```ts
export interface PageCopy { title: string; subtitle: string }

// AvailabilityPage header
export function availabilityPageCopy(flow: BookingFlow): PageCopy
// acceptance on:  { title: "My Offers",
//                   subtitle: "View your offers and block dates you're unavailable for." }
// acceptance off: { title: "My Dates",
//                   subtitle: "Your bookings and availability. Block dates you can't perform." }

// Shared status labels for AvailabilityPage.BOOKING_STATUS_LABEL and
// ArtistBookingsView.STATUS_LABEL (both currently hardcode their own copies).
export function bookingStatusLabels(flow: BookingFlow): Record<string, string>
// acceptance on:  { suggested: "Offer pending", soft_booked: "Hold placed",
//                   confirmed: "Confirmed", unanswered: "No offer yet" }
// acceptance off: { suggested: "Offer pending", soft_booked: "Hold placed",   // unreachable, sane fallback
//                   confirmed: "Booked", unanswered: "Not booked" }

// ArtistBookingsView header subtitle
export function bookingsViewCopy(flow: BookingFlow): PageCopy
// acceptance on:  { title: "My Bookings", subtitle: "Dates you've been offered for, based on your cast eligibility." }
// acceptance off: { title: "My Bookings", subtitle: "Dates you're booked for, based on your cast eligibility." }

// ArtistDashboard meter + header
export interface MeterSpec {
  title: string;                    // "Response rate" | "Booked dates"
  headerSentence: string;           // dashboard header subtitle
  countStatuses: string[];          // which booking statuses count as "responded"/"booked"
}
export function artistMeter(flow: BookingFlow): MeterSpec
// acceptance on:  { title: "Response rate",
//                   headerSentence: "Your response rate on dates you've been offered.",
//                   countStatuses: ["confirmed", "soft_booked"] }
// acceptance off: { title: "Booked dates",
//                   headerSentence: "Your booked share of the dates you're eligible for.",
//                   countStatuses: ["confirmed"] }

// Producer dashboard immediate-delivery hint (empty string when not applicable)
export function deliveryHint(flow: BookingFlow): string
// acceptance on + delivery immediate: "Offers email artists immediately when a tier opens."
// otherwise: ""
```

Meter sub-label stays "`{n} of {total} dates`" in both modes; the "View" link keeps pointing at the Availability page (`?filter=unanswered` only when acceptance is on; plain link when off).

## 2. Direct-booking notification (DB migration)

Extend `notify_booking_transition()` (currently `AFTER UPDATE`-only, last touched in `20260714182625`) and its trigger to also fire `AFTER INSERT`:

- INSERT branch: when `NEW.status = 'confirmed'` and the booking's artist has `artists.user_id IS NOT NULL`, insert a `notifications` row: `type = 'booking_confirmed'`, title `Booking confirmed`, message in the same show/date format the UPDATE branch builds, `related_entity_id = NEW.id`, `related_entity_type = 'booking'`.
- INSERTs with any other status (offers land as `suggested`) do nothing. The UPDATE branches are unchanged, so fast-track accepts keep their existing notification; no double-fire is possible (a direct booking never transitions after insert, and an offer insert is not confirmed).
- Reusing `booking_confirmed` means `category_of()` and notification preferences work unchanged; the confirmation digest email path is untouched and already covers direct bookings.
- This is an automation change: update `docs/system-map.md` AND `src/data/systemMap.ts` in the same PR (cite the new migration).
- pgTAP: INSERT confirmed booking with linked user → exactly one notification; INSERT suggested → none; INSERT confirmed with unlinked artist → none.
- Production apply (project epweartpzwvcasrzyueh) only with the user's explicit approval, versions aligned to the filename afterwards, per the established procedure.

## 3. Artist surfaces

- `ArtistDashboard.tsx`: add `useBookingFlow`; header sentence and meter from `artistMeter(flow)`; `responded` counts `countStatuses`. "Awaiting your response" card is gated off entirely in direct mode (correction during implementation: it renders an offer-worded empty state rather than self-hiding).
- `AvailabilityPage.tsx`: title/subtitle from `availabilityPageCopy`; replace local `BOOKING_STATUS_LABEL` with `bookingStatusLabels(flow)`.
- `ArtistBookingsView.tsx`: subtitle from `bookingsViewCopy`; replace local `STATUS_LABEL` with `bookingStatusLabels(flow)`.
- `OfferResponseButtons` is already flow-aware; untouched.
- While the flow query resolves, `useBookingFlow` consumers fall back to `BOOKING_FLOW_DEFAULTS` (classic), matching every existing consumer; brief classic-copy flash in a direct org is acceptable and consistent.

## 4. Producer dashboard (`DashboardPage.tsx` + new components)

Two new self-hiding cards in `src/components/dashboard/`, both rendered between the stat cards and Ready-to-Confirm:

**`TierAttentionCard`** — rendered only when `flow.artist_acceptance` and there are items.
- Data: new `fetchTierAttention(client, { orgId })` in `src/data/bookings.ts`, query key `['bookings', 'tier-attention', orgId]`: open tiers (`show_date_offer_tiers.closed_at IS NULL`) on upcoming non-cancelled `show_dates`, with that date's active bookings (status, offer_tier, offer_expires_at, is_understudy) and the date's slot config.
- Pure derivation `computeTierAttention(rows)` (in `src/lib/bookingCockpit.ts`, unit-tested): per date+tier → `{ filled, required, atRisk, expiresSoon }` where `filled` = pending + accepted in tier, `required` from the existing slot logic (`effectiveSlots`), `atRisk` = filled < required, `expiresSoon` = any pending offer expiring within 24h. Only rows with `atRisk || expiresSoon` surface.
- Render: up to 5 rows sorted by date: reference label · date · "Tier N · x of y" with `At risk` / `Expires soon` badges; row links to the bookings page. Card subtitle appends `deliveryHint(flow)` when non-empty.

**`DirectBookingCard`** — rendered only when `!flow.artist_acceptance` and there are items.
- Upcoming non-cancelled dates where confirmed main-cast count < required slots (same slot logic the stat cards already use; reuse/extend the page's existing upcoming-dates query rather than adding a duplicate fetch if its data suffices).
- Render: "Dates needing artists" with up to 5 rows (reference label · date · "x of y booked"), linking to the bookings page.

Both use the `['bookings', ...]` query-key domain so existing mutation invalidation keeps them fresh.

## 5. Testing

- `flowCopy.test.ts`: every export in both modes, plus a no-dash regex assertion over all produced strings.
- Component tests: meter swap (both modes), AvailabilityPage/ArtistBookingsView copy per mode, both new dashboard cards (visibility gating + content), using the existing harness patterns.
- Unit tests for `computeTierAttention`.
- pgTAP for the trigger INSERT branch (three cases in section 2).
- e2e: extend the existing direct-mode test in `booking-flow-presets.spec.ts` with one admin-client assertion that the booked artist received a `booking_confirmed` notification.
- Full suites (vitest, Deno, tsc, lint) green as usual; pgTAP and e2e in CI.

## Release

Ships as a MINOR release (new user-facing behavior). Same-day changes fold into one changelog entry per the repo convention.
