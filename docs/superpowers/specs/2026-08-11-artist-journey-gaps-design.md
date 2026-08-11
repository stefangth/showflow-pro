# Artist journey gaps — design (spec)

**Date:** 2026-08-11
**Branch:** `claude/artist-items-journey-gaps-f181d5`
**Driver:** `docs/research/user-journey-gaps-context.md` (Constraints section)
**Inventory:** `docs/research/2026-08-09-user-type-journey-questions.md` (Artist journey)
**Approved visual spec (the contract):** https://claude.ai/code/artifact/42e2b69d-5d4d-4dc9-b641-a2f70f9c2173
**Precedent:** `docs/superpowers/plans/2026-08-11-producer-journey-gaps.md` (same recipe).

Owner approved all recommendations on 2026-08-11 (R3.1 = A, R4.2 = A, R4.4 = A; proceed on all 15 working items).

## Scope

17 artist items in the inventory. **R0.1 is already covered** (the invitation `productIntro` renders for every invitee — same call as producer P0.1). The remaining **15 items ship this session**. **No database migration** — every fix reuses existing settings and helpers. No version bump (owner packages the release, Constraint 6).

## Constraints (from the driver doc)

- **TDD, superpowers-style.** Failing test first; tests import the real module; use `src/test/supabaseFake.ts` / `renderWithProviders` / `castHelpers`, and `_shared/testing.ts` + `makeFakeDeps` for edge.
- **Extract, don't hardcode.** Read numbers/copy from source: window + digest hours via `useFlowTimes`/`resolveOrgSetting`, flow via `useBookingFlow`, `SOFT_BOOKED_MEANING` reused for tone. New dual-homed email copy goes through `emailCopy.ts` + `npm run sync:mirrors`, never hand-copied to the edge target.
- **Copy rules:** no em/en dashes; user-voice; consequence-first; honest in **every** reachable org state (direct-book, immediate delivery, digest, paused, unentitled, super-admin preview).
- **Styling:** semantic tokens only; accent numbered stops take no opacity modifiers.
- **Entitlement honesty:** a point-of-action promise must gate on the org's REAL entitlement (`useEntitlements()` + `!isLoading`), never `useFeature` (fails open while loading + bypasses for super-admins) or the flow `active` flag. Reuse the `ShowDateDetailSheet.tsx:209-210` pattern where a helper crosses into a super-admin-viewable surface.
- **No hand-applied migrations.** N/A this session (no schema changes).

## Work packages (disjoint files — one parallel wave, no Phase 0)

### WP-R1 — Availability & calendar
Files: `src/pages/AvailabilityPage.tsx`, `src/components/availability/ArtistAvailabilityCalendar.tsx`. Reads (no edits): `useFlowTimes`, `useBookingFlow`, `describeTonightStandalone`.

- **R2.1 + R4.7 — window + digest hour as numbers.** Render `describeTonightStandalone(useFlowTimes(orgId), flow)` as a muted line on the availability page, shown only when non-null. Reuses the producer helper verbatim (no new string): e.g. *"When a tier opens, offers go out in the next 19:00 digest. Artists get 48 hours to answer. That hour is Berlin time."* Silent for direct-book/paused; swaps to "offers email straight away" for immediate delivery. Org-scoped flow read (mirror `FirstOfferCard`'s `orgId ? flowQ.data : null` discipline).
- **R3.4 — ineligible-cell explanation.** In the `if (!isEligible)` branch (`ArtistAvailabilityCalendar.tsx:230-232`) add `title` + `aria-label`: **"This date is not offered to you. Offered dates come from your casts."** Neutral wording because ineligibility can be cast membership OR unmet skill requirements.
- **R3.5 — zero-eligible calendar empty state.** Guard on `eligibleDates.length === 0`; render **"No eligible dates yet. Once you are added to a cast, offered dates appear here."** (matches the list-view copy). Also fixes the super-admin module-off preview path.
- **R3.6 — blocking vs existing bookings.** `AvailabilityPage.tsx:419-421`: **"Mark dates you cannot play so the system will not send you offers for them. Dates you are already booked for are not affected."**

### WP-R2 — The offer moment & dashboard
Files: `src/components/availability/OfferResponseButtons.tsx`, `src/lib/bookings/actionCopy.ts`, `src/components/dashboard/ArtistDashboard.tsx`, `src/lib/flowCopy.ts`.

- **R3.1 — accept toast (Option A).** New `acceptConsequenceNote(flow)` in `actionCopy.ts` reading `flow.producer_confirmation`. Classic/hold: title **"Offer accepted"**, description **"Hold placed. Your producer confirms next."** Auto-confirm: **"Offer accepted. You're booked."** (evolve the current "Booking confirmed."). Reuse `SOFT_BOOKED_MEANING` tone. The offer buttons only mount under `booking_flow`, so no extra entitlement param is required — but keep the helper pure/flow-driven.
- **R3.2 — decline reassurance.** Decline toast gains description **"This just cancels this one offer. It will not affect future offers."**
- **R4.2 — response-rate definition (Option A).** Extend the meter spec (`artistMeter` in `flowCopy.ts`) with a flow-derived explainer rendered under the meter footer. Offer meter: **"Counts dates you accepted or were booked for, out of dates you were offered. It is just for you, no one is scored on it."** Direct-book meter ("Booked dates"): **"Dates you are booked for, out of dates you are eligible for."**
- **R4.6 — hire-orders zero-state.** Render the card inside `hireOrdersEnabled` even when the list is empty; empty branch: **"Your booking paperwork shows up here. When a producer sends you a hire order, it arrives by email and you can review and sign it here."** Keep the `useFeature('hire_orders')` gate (module-off shows nothing). Update `ArtistDashboard.hireOrders.test.tsx` (currently locks in "no empty card").

### WP-R3 — Profile, hire-order signing, cancelling, deletion
Files: `src/pages/ProfilePage.tsx`, `src/components/artists/ArtistProfileSheet.tsx`, `src/components/hireOrders/SignHireOrderDialog.tsx`, `src/components/bookings/ArtistBookingsView.tsx`.

- **R4.4 — contact visibility (Option A).** ProfilePage note (phrased about the artist record, not the account phone) + a matching helper on the producer-facing `ArtistProfileSheet` fields: **"Admins and producers in your organization can see the contact details on your artist record so they can reach you about bookings."** True to RLS (admins/producers/self read `artists.email`/`artists.phone`).
- **R4.5 — hire-order terms summary + after-signing.** In `SignHireOrderDialog`, above the signature pad, add **"You are agreeing to the fee, dates, and terms shown on this order. After you sign, your organization countersigns and emails you the final PDF."** Do NOT touch `CONSENT_TEXT` (hand-mirrored to `generate-hire-orders/index.ts`).
- **R5.1 — cancel-after-confirm signpost.** In `ArtistBookingsView` (booking_flow-gated), add **"Need to cancel a date you confirmed? Message your producer in the date's chat and they will update the booking."** The date sheet's Chat tab is reachable by the booked artist, so this is actionable.
- **R5.4 — deletion disposition.** `ProfilePage` delete card: **"Your personal details are removed. Your shared booking history, including any open offers, is kept but de-identified. This cannot be undone."** + hire_orders-gated clause **"Signed hire orders are kept for the organization's records with your details removed."** Matches `anonymize_user` (artist row de-identified not deleted; bookings/offers persist; hire orders retained with `created_by`/`signer_user_id` nulled).

### WP-R4 — Invitation & digest emails
Files: `src/lib/emailTemplates/emailCopy.ts` (source → `npm run sync:mirrors` regenerates `_shell/emailCopy.ts`), `supabase/functions/_shared/transactional-email-templates/artist-confirmation-digest.tsx`, `.../app-links.test.ts`.

- **R0.2 + R0.3 — artist role lines.** `roleIntroArtist` (flow-neutral): **"You are on the roster. You get booked for shows and can see every confirmed engagement."** `roleIntroArtistOffers` (offers confirmed): **"You are on the roster. You will get booking offers by email, accept or decline each in one tap, then see every confirmed engagement."** The "offers by email / one tap" promise stays only on the gated line. No dashes; org name not repeated.
- **R5.3 — confirmation-digest CTA.** Add an `EmailShell` `cta` → `APP_URL + "/bookings"`, label from new `artist-confirmation-digest.ctaLabel` = **"View your bookings"**. Reuses the `artist-offer-digest` pattern. Move the template into `APP_LINK_TEMPLATES` and flip `hasCta: true` in `app-links.test.ts`.

## Test plan (test-first per item)

- WP-R1: `ArtistAvailabilityCalendar.test.tsx` (ineligible aria/title, zero-eligible empty state), `AvailabilityPage.*.test.tsx` (timing line honest per flow-state, blocking clause). Assert the timing line is absent for direct-book/paused.
- WP-R2: new `actionCopy.test.ts` cases for `acceptConsequenceNote` (both flow branches); `ArtistDashboard.flowCopy.test.tsx` (meter explainer per flow); `ArtistDashboard.hireOrders.test.tsx` updated for the empty-state branch + still nothing when module off. OfferResponseButtons has no co-located test — add one or extend the calendar/pastBookings coverage for the toast strings.
- WP-R3: `ProfilePage.delete.test.tsx` (deletion clauses, hire_orders gate), a new/extended ProfilePage test for the contact note, `SignHireOrderDialog.test.tsx` (terms summary), `ArtistBookingsView.flowCopy.test.tsx` (cancel signpost).
- WP-R4: `org-invitation.test.ts` (artist lines still flow-neutral by default; offers line carries the benefit only when `offersExpected`), `app-links.test.ts` (digest now has a CTA to the app host), `invitations.test.ts` unaffected. Run `npm run sync:mirrors:check`.

## Execution

Subagent-driven development (`superpowers:subagent-driven-development`): the 4 WPs as one wave of disjoint-file implementers, each with a fresh-agent task review + fix loop, then an authoritative full `tsc` + full `vitest` sweep (new required props / new module exports / new `vi.mock`s must not break a consumer outside a WP's file list — the producer session's hard-won lesson), then a whole-branch review. `npm run verify:fast` then `npm run verify:full` green before handoff.

## Non-goals / deferred

- `FirstOfferCard` already carries the window duration via `inPracticeRows`; not re-touched (the toast is the point-of-action surface). Decline reassurance lives in the toast, not the card, to keep blast radius small.
- No change to the shared producer cockpit (`ShowDateDetailSheet.tsx`); R5.1 signpost lives in the artist-only `ArtistBookingsView` to keep WPs disjoint.
- `moduleOnboarding.ts` dashboard rail rules are left as-is; R2.1/R4.7 surface on the always-visible availability page instead of threading `FlowTimes` through the onboarding context.
