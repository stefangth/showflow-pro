# Calendar Integrated surface — design spec

Date: 2026-08-15
Branch: `claude/calendar-integrated-design-f6a4d2`
Status: Draft for review
Design source: Claude Design project **"Calendar UX improvements"** (`5ccc0a34-…`) — canonical files `Calendar Integrated.dc.html` (desktop, 1440×940) and `Calendar Mobile.dc.html` (402px). The design reuses this repo's own token system (`_ds/…/colors_and_type.css` ≡ `src/index.css`).

> The mock is the visual source of truth. Implementers re-pull the canonical `.dc.html` for exact pixel/copy values; this spec fixes the architecture, data wiring, and behaviour.

---

## 1. Goal

Replace the current producer **Shows & Bookings** table/calendar and the artist **Availability** list/calendar with a single, lens-based **calendar surface** that reads and acts on real booking data. One shared component kit renders role-specific lenses over the same show-date + booking data, with a contextual right rail and in-grid actions wired to existing (and a few net-new) mutations.

This is a redesign of two **existing** routes, not a new route. The mock's Producer/Artist toggle is the existing admin **view-as** simulation; real users see only their role's lenses.

---

## 2. Scope

### In scope (this spec — desktop)
- Producer lenses on `/bookings`: **Needs you · Month · Week · Season · Agenda**.
- Artist lenses on `/availability`: **Offers · Month · All dates**.
- Shared surface shell: header (eyebrow · title · lens tabs · primary CTA), toolbar (period navigator · Today · filter chips · Add filter · key hints), body + contextual right rail.
- Shared, role-parametrized `MonthGrid` (producer and artist both render through it; `ArtistAvailabilityCalendar` is refactored onto it).
- Range selection + bulk-action bar (Month/Season) → bulk Confirm holds / Generate hire orders.
- Wiring to real data + existing mutations; **net-new** backend for Extend-hold-24h and Notify-cast.
- Custom Airtable fields surfaced read-only in `ShowDateDetailSheet` + as filter chips.

### Out of scope (deferred to a follow-up spec)
- **All 5 mobile screens** (artist Offers/Month/Day-sheet, producer Agenda/Season-strip, bottom sheets, FAB). Desktop first, per decision. The desktop kit is to be built mobile-*aware* (responsive-friendly component boundaries) but mobile layouts are a separate spec.
- Alternative producer-queue directions in `Calendar Producer Queue v2.dc.html` (**Triage 3a**, **Risk board 3b**). The Integrated file's **grouped-cards** "Needs you" is canonical. These remain available if we later prefer one.
- `ShowDateDetailSheet` cockpit internals (unchanged — lenses deep-link into it).
- The artist `/bookings` read-only `ArtistBookingsView` (stays on `EntityCalendar`; may be migrated later).

### Locked decisions (from brainstorming)
1. Integrated calendar **replaces** the producer table.
2. Custom Airtable fields → read-only in `ShowDateDetailSheet` + filter chips (no configurable grid on this page).
3. **Desktop first**; mobile deferred.
4. **Omit call time** entirely (session − 90 min is *not* implemented; show session times only, no call line anywhere).
5. Fill meter = the design's **2-tone per-status** fill. The richer confirmed/accepted/open meter stays inside the detail-sheet cockpit, untouched.
6. Net-new Needs-you actions (Extend 24h, Notify cast) are **built in this work**. Release-hold reuses existing `bulkDeclineSoftBooked`.
7. **One shared `MonthGrid`**, role-parametrized.

---

## 3. Architecture

### 3.1 Route / page model

| Route | Component | Renders |
|---|---|---|
| `/bookings` | `ShowsBookingsPage` → `ProducerShowsBookings` | `<CalendarSurface role="producer">` |
| `/availability` | `AvailabilityPage` → `ArtistAvailability` | `<CalendarSurface role="artist">` |

Each page keeps its existing chrome around the surface: page title, module setup rail, `PageMini`, hire-order ready banner, "New date" CTA, dialogs, and the `ShowDateDetailSheet` (with its pager). The **surface replaces only the body** (today's filter bar + `ViewToggle` + list `Table`/`EntityCalendar`).

The admin view-as toggle drives `role`. `hasRole('artist')`/`hasRole('producer')` (which already respect the simulation) select the lens set, exactly as `ShowsBookingsPage` branches today.

### 3.2 Component tree — `src/components/calendar/surface/`

```
CalendarSurface (role)                     ← orchestrator; owns lens + period + selection + selectedDay state
├─ CalendarSurfaceHeader                   ← eyebrow, title, LensTabs, primary CTA
├─ CalendarToolbar                         ← PeriodNavigator, Today, filter chips, Add filter, key hint
├─ <lens body>                             ← one of:
│   Producer: NeedsYouLens | MonthLens | WeekLens | SeasonLens | AgendaLens
│   Artist:   OffersLens   | MonthLens | AllDatesLens
├─ CalendarRail (variant)                  ← DayRail | QueueRail | (Offers has inline side content)
└─ SelectionBar                            ← shown on Month/Season when a range is selected
```

Shared leaf components:
- `MonthGrid` — the role-parametrized 7-col grid (§3.3).
- `FillMeter` — segmented 2-tone meter (`filled` of `total`, tinted by status tone).
- `StatusBadge` / tone helpers (§6).
- `Legend`, `StatList`, `KpiCards`.
- `useRangeSelection` — drag/shift-click multi-date selection over a grid.
- `usePeriodWindow` — current lens's date window (month / week / season span) + prev/next/today.

State lives in `CalendarSurface` (or a small context): `{ lens, period, selectedDay, selection }`. Reads go through React Query hooks; no ad-hoc `useState` loading flags.

### 3.3 Shared `MonthGrid` contract

```ts
interface MonthGridCell {
  day: Date | null;              // null = leading/trailing pad
  isToday: boolean;
  isPast: boolean;
  isSelected: boolean;
  inRange: boolean;              // range-selection highlight
  flag?: { text: string; tone: Tone };   // producer: "−N"; artist: "answer"/"blocked"
  chips: MonthGridChip[];        // ≤2 rendered, "+N more" overflow
}
interface MonthGridChip {
  title: string;
  time?: string;                 // session_1 HH:MM
  tone: Tone;
  meter?: MeterSpec;             // producer only; artist chips carry status only
}
```
- Monday-first (`(monthStart.getDay()+6)%7` leading pad; weekday headers Mon–Sun) per repo convention.
- `MonthGrid` is presentational: the producer `MonthLens` and artist `MonthLens` build the cells from their own data and pass them in. This is the single home for grid mechanics (today rule, selected ring, range highlight, `+N more`), replacing the shadcn-`Calendar`-based `EntityCalendar` on these pages. `ArtistAvailabilityCalendar` is refactored to build `MonthGridCell[]` and render `MonthGrid` (its popover cell actions move into the cell's click → rail/sheet).

### 3.4 Rail variants
- **DayRail** (producer Month/Week; artist Month/Offers): selected-day eyebrow + date card(s) with fill meter (producer) / status note (artist), primary + secondary action, key hint; then a stats card ("This month" / "Your August") and a Legend card.
- **QueueRail** (producer Needs you): "Clear the queue" progress + category breakdown; an eligible-artist **shortlist** for the top at-risk date (each with an "Offer" action); a "What lands here" rules card.
- **Offers** (artist): no separate rail — the queue body includes progress, "Answered today" (with Undo), and "Later this month · not offered yet".

Rail visibility by lens: Month, Week, Offers, Needs you → rail shown; Season, Agenda, All dates → full width.

---

## 4. Lens specifications

Common per-date fixture fields (from data): program, sub_program, venue, city, `session_1..3`, `status`, main slots, filled (confirmed) main, understudy slots, filled understudy.

### 4.1 Producer · Needs you (default)
Grouped action queue. Groups, in order, filtering out empties:
1. **Expires today** — dates with pending offers/holds whose `offer_expires_at` is today. Bulk: **Confirm all**. Card: people chips (held artists), note, primary **Confirm N holds**, secondary **Extend 24h** / **Release**.
2. **At risk · under-cast inside N days** — upcoming, non-cancelled, `main − filled > 0`, within a risk window (default from `tier-at-risk` logic). Card: open-slot count, lead-time countdown, eligible-artists note, primary **Open casting**, secondary **See shortlist** / **Cancel date**.
3. **Ready to issue** — fully filled, no hire order (`useDatesReadyForHireOrder`). Bulk: **Generate N hire orders**. Card primary **Generate hire order**, secondary **Preview** / **Snooze**.
4. **Cancelled · needs a decision** — `status === 'cancelled'`, cast not notified. Primary **Notify cast**, secondary **Re-route date** / **Undo cancel**.

Footer: **Cleared today** receipts (date, show, action label) with **Undo last**. QueueRail as §3.4.

*Derivations to build (pure, unit-tested):* group assignment per date, risk-window membership, eligible-artist count/shortlist, cleared-today reconciliation (a date with an open item cannot also be a receipt).

### 4.2 Producer · Month
`MonthGrid` with producer cells: chip per date (program title, `session_1`, fill meter), `−N` unfilled flag, today rule, selected ring, range highlight, `+N more`. Range-selectable → `SelectionBar`. DayRail shows the selected day. Cell click sets selected day; Enter/click-through opens `ShowDateDetailSheet`.

### 4.3 Producer · Week
Time grid 14:00–23:00 (fixed band; adjust bounds to data extent if needed), 7 day columns (Mon-first), today column tint. Events positioned by `session_1` start; **fixed-height block** (no durations exist) showing time, title, venue·city, fill meter + `filled/main`. Multi-session dates: stack blocks by session time. Prev/next navigates by week. DayRail shown.

### 4.4 Producer · Season
Program × day heatmap. Rows = distinct `program · sub_program`; columns = **the period's days** (computed span, not hardcoded 31). Cell = fill-height bar tinted by status with `filled/main` label; Monday gridlines. A **"Unfilled slots"** load-bar row (per-day open main slots). Below: **KPI cards** (Unfilled main slots · Heaviest week · Ready for hire order). Range-selectable across day columns → `SelectionBar`. Full width (no rail).

### 4.5 Producer · Agenda
Week-grouped rows. Each week: label + meta (dates · slots open). Row: dow/date, `session_1`, title, venue·city, fill meter + `filled/main main`, status badge, and a **contextual action** (`fully` → Generate hire order · `partial` → Confirm holds · `open` → Open casting). Row click opens the date. Full width.

### 4.6 Artist · Offers (default)
Decision queue of the artist's own `suggested` offers + upcoming `soft_booked` holds. Card: date block, eyebrow (Offer · program / Hold placed), countdown for live offers, title, detail (venue, city, session), optional adjacency note; action panel **Accept** / **Decline** / **Block date** (live offers) or a Hold status chip. Then: **progress bar** (answered / total), **Answered today** (with Undo last), **Later this month · not offered yet** (eligible-from-casts dates with Block-date buttons). DayRail as artist variant.

### 4.7 Artist · Month
Shared `MonthGrid`, **artist cells** — status-only chip (no cast fill; cast fill is producer information), flags `answer` (suggested) / `blocked`. Tones from `MY_TONE` (§6). Cell click → DayRail with the day's offer/hold/confirmation and its action (Accept offer / Block date / — ). Refactors `ArtistAvailabilityCalendar`.

### 4.8 Artist · All dates
Fixed-column table: Date · Day · Show·venue · Session · My status · action. `confirmed` rows show a **Hire order** link (when the module is on and an order exists, as `ArtistBookingsView` does today); unanswered future dates show **Block date**. Full width. (Note: the mock's "Call" column is dropped — call time is omitted; the column shows the session time instead, or is removed. Implementer: replace "Call" with "Session".)

---

## 5. Data & wiring

### 5.1 Reads (existing)
- `fetchShowDatesList` (org-scoped show_dates + show + city, incl. `custom`).
- `fetchBookingCountsByDate` → `Map<showDateId, DateBookingCounts>` (`confirmedMain/Us`, `acceptedMain/Us` = soft_booked, `pendingMain/Us` = suggested).
- `showSlots(show)` → `{ main_cast, understudies } | null` (null → "unconfigured").
- `useDatesReadyForHireOrder` (ready-to-issue set + order-by-date).
- Artist status per date: `['bookings','artist-offers', artistId]` map; `useArtistEligibleDates`; `blocked_dates`.
- Offer expiry: `offer_expires_at` on bookings (already selected in offer-tier reads).
- **Needs-you extra reads (not covered by counts):** the people chips and the "who holds this date" list need per-date **bookings-with-artist rows** (`bookings.select('… , artist:artists(id,name)')` for the queue's dates), and the eligible-artist **shortlist** needs producer-side eligibility resolution (which cast artists are eligible + free for the at-risk date — from the cast/eligibility tables, mirroring `useArtistEligibleDates` inverted to "artists per date"). Aggregate `DateBookingCounts` alone is insufficient here — a new focused query/data function is required.

### 5.2 Actions

| Action | Wiring | Status |
|---|---|---|
| Fill meter / status | `DateBookingCounts` + `showSlots` | existing |
| Confirm holds (single) | `bulkConfirmSoftBooked` (via `fetchSoftBookedIdsForDate`) | existing |
| Confirm holds (bulk range) | loop `bulkConfirmSoftBooked` over selected dates | existing (compose) |
| Release hold | `bulkDeclineSoftBooked` | **existing** |
| Open casting | `open-offer-tier` / open cockpit Offers tab | existing |
| Generate hire order (single + bulk) | `useHireOrderAction('draft'/'issue')` | existing |
| Accept / Decline offer (artist) | `respondToOffer` | existing |
| Block date (artist) | `blocked_dates` insert (`AvailabilityPicker` logic) | existing |
| **Extend hold 24h** | bump `offer_expires_at += 24h` for the date's pending offers | **NET-NEW mutation (no schema change)** |
| **Notify cast** (cancelled) | notify held/confirmed artists a date was cancelled | **NET-NEW (mutation/edge + notifications)** |

### 5.3 Net-new backend work
1. **Extend hold 24h** — `src/data/bookings.ts` `extendOfferExpiry(client, { showDateId, by: '24h', now })`: guarded update of `offer_expires_at` for that date's still-`suggested`/`soft_booked` rows. RLS: producer/admin of the date's org. Unit + pgTAP tests.
2. **Notify cast** — an action that inserts `notifications` for artists holding/confirmed on a cancelled date and marks the date "cast notified" (needs a flag or derived-from-notification check to move it out of the Needs-you group). Confirm whether date-cancellation already notifies; if a trigger exists, this becomes "re-notify"/reconcile only. Likely a small edge action or RPC + `notifications` inserts. Tests per layer.

Both are guarded server-side (`requireOrgRole([...])`) and gated by `booking_flow`.

### 5.4 Preserved plumbing
- Deep links: `?status=`, `?filter=unanswered` (dashboard links here); **add `?lens=`** so a lens is linkable. Status/filter map onto the new chip filters.
- Realtime: keep the `bookings` / `show_dates` channel invalidations (`['bookings']`, `['show-dates']`).
- Gating: `booking_flow` entitlement (RLS/edge/UI), `useCan('confirm_bookings' | 'generate_hire_orders' | …)` on the corresponding actions.

---

## 6. Status → tone (unify)

Today the calendar shades and the list badges use **divergent** colour maps for the same status. This spec unifies onto the design's two tone tables, mapped to DS semantic tokens (no hardcoded hex in components — use `bg-success/…`, `text-warning`, etc., matching the token values below):

Producer (`TONE`): `fully` → success · `partial` (Casting) → warning · `open` → muted · `cancelled` → destructive.
Artist (`MY_TONE`): `confirmed` → success · `soft_booked` (Hold) → warning · `suggested` (Offer) → accent/violet · `blocked` → destructive · `unanswered` (Not offered) → muted.

A single `src/lib/calendar/tone.ts` exports both maps (label + tone token) and is the only source for calendar/badge colour. Retire the divergent `bookingStatusBadgeClass` vs calendar-shade split on these surfaces.

---

## 7. Removed / replaced

On `/bookings` and `/availability` only:
- The `list | calendar` `ViewToggle` — removed (replaced by lens tabs).
- `EntityCalendar` usage on `/bookings` — removed (kept for `ArtistBookingsView` and any other consumer).
- `ColumnLayoutEditor` + column templates (`bookings-producer`, `availability`) on these pages — removed. **Custom Airtable fields** move to: read-only display inside `ShowDateDetailSheet`, and filterable ones surface as **"Add filter"** chips on the toolbar. `formatCustomValue` / `customFilterMatches` are reused for that.
- `TimeframeFilter` scope shrinks: the visible period is now driven by the lens's `PeriodNavigator`; `TimeframeFilter`'s custom-range role folds into the Agenda/All-dates windowing or a chip. Sort control removed (lenses are chronological).

---

## 8. i18n / minis / help / compliance (CLAUDE.md)
- All new copy through i18n (`bookings`, `availability` namespaces; EN canonical, DE key-for-key, informal "Du", no dashes). New keys typed.
- `PageMini` for both pages reviewed/updated for the new surface.
- Help-center impact: update `src/lib/help/items.ts` (EN+DE) for the changed producer/artist calendar flows, or state "no impact" in the PR.
- No em/en dashes in copy (`copyLint.test.ts`).

---

## 9. Testing (five-layer, test-first)
- **Unit (pure):** tone mapping; fill-meter builder; Needs-you group assignment + risk window + cleared-today reconciliation; range-selection reducer; period-window math (month/week/season span, Monday-first pad); Season row/column + load-bar derivation; artist status-per-date.
- **Data-access:** `extendOfferExpiry`, Notify-cast data function via `supabaseFake`.
- **DB (pgTAP):** RLS/guards for the two net-new mutations.
- **Component (RTL):** each lens renders from fixtures; key interactions (confirm hold, accept offer, block date, range select → bulk bar, open date → sheet). Follow the RTL retry-loop guidance (no `getByRole({name})` inside `findBy`/`waitFor`).
- **Edge (Deno):** Notify-cast handler if implemented as an edge function.

---

## 10. Implementation order (within desktop)

Ship in reviewable slices behind the existing `booking_flow` gate:

1. **Kit foundation** — `CalendarSurface` shell, `LensTabs`, `PeriodNavigator`, tone lib, `FillMeter`, shared `MonthGrid`. Producer **Month** + **Agenda** + **DayRail** wired to reads + Confirm holds / Generate hire order. Artist **Offers** + **Month** + **All dates** wired to `respondToOffer` / block. Replace both page bodies. `ArtistAvailabilityCalendar` refactored onto `MonthGrid`.
2. **Needs you** lens + QueueRail; net-new **Extend 24h** and **Notify cast**; Release via existing decline.
3. **Week** + **Season** lenses + KPI cards.
4. **Range selection** + `SelectionBar` (Month/Season) bulk actions.
5. Custom-field relocation (detail sheet + filter chips), deep-link (`?lens=`), i18n/minis/help, test hardening.

Each slice keeps the app shippable; the surface degrades gracefully to fewer lenses if a later slice slips.

---

## 11. Open items / risks
- **Notify-cast semantics:** confirm whether date cancellation already notifies cast (trigger/edge). If so, reduce scope to reconcile/re-notify. Verify before building §5.3.2.
- **Week band bounds:** 14:00–23:00 is the mock's fixture range; derive from actual session times so early/late shows aren't clipped.
- **Multi-session dates:** Month chip and Week block show `session_1`; confirm whether producers need session_2/3 surfaced beyond the detail sheet.
- **Season program identity:** rows keyed by `program · sub_program`; confirm this matches how the org models "program" (vs `show_id`).
- **Risk window source:** align the Needs-you "inside N days" with the `tier-at-risk-watcher` definition rather than a new constant.
- **Needs-you artist resolution:** the "artists per eligible+free date" query for the shortlist is producer-facing eligibility (inverse of `useArtistEligibleDates`); confirm the cast/eligibility tables expose this efficiently or add a focused RPC/data function.

---

## 12. Mobile (future spec — not built here)
`Calendar Mobile.dc.html` defines 5 screens (artist Offers / Month / Day-sheet; producer Agenda default + Season strip; bottom sheets; FAB) at 402px, following `AppLayout`'s `lg:hidden` top bar. The desktop kit should keep component boundaries that a mobile spec can reuse (lens bodies, day rail → bottom sheet, FillMeter, tone lib). Tracked separately.
