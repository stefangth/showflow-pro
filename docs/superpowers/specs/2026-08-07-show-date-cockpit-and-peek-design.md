# Show Date Cockpit + Row Peek — Design

**Date:** 2026-08-07
**Branch:** `claude/show-date-cockpit-build-74619f`
**Source design:** Claude Design project "Show Date Detail Sheet Redesign" — `Show Date Cockpit - Prototype.dc.html` (direction **1f**) and the row peek from `Show Date Detail - UX Directions.dc.html` (direction **1d**).

## Context & goal

`ShowDateDetailSheet` today is a `max-w-3xl` right sheet with ~8 equal-weight cards in one scroll (date facts, funnel, up-next, date configuration, date actions, offers/book, assigned artists, hire orders, chat). The job-to-be-done — *fill this date, then get it signed* — competes with season-level setup, and destructive actions sit above the work.

This redesign reorganizes those cards into a **cockpit**: an anchored header, a persistent left facts/activity rail, and a tabbed work surface. Per the UX doc, it **keeps the data model and every flow-aware component exactly as they are** — only *where they sit* and *how you move between dates* changes. It also adds the **row peek** from 1d: a hover/keyboard popover on a bookings-list row for the everyday confirm, without opening the full surface.

The design system is already ported into the app (`src/index.css` mirrors the DS `colors_and_type.css`), so this is a layout + wiring change, not a token or logic rebuild.

## Decisions

1. **Redesign `ShowDateDetailSheet` in place.** All three open sites (`ShowsBookingsPage`, artist `ArtistBookingsView`, `ChatsListPage`) get the cockpit; the artist and `booking_flow`-off views degrade to read-only through the **existing** capability/module gates. One component, no divergence.
2. **Ship the cockpit and the peek together** (one change set / PR), internally phased.
3. **Reflect the org booking flow — no toggle.** The prototype's Classic/Direct switch is a demo device; in the app the flow is a per-org JSON policy (`app_settings.booking_flow.artist_acceptance`) written only from Settings → Booking flow under the *sensitive* `edit_booking_settings` capability. The cockpit reflects the resolved flow and swaps labels (Offers ↔ Book), with a read-only indicator that links to Settings for those who may edit it.

## Non-goals (deferred — see Follow-ups)

Batch prev/next pager ("Date N of M needing attention"); a real persistent activity feed (new backend); expiry-based "at risk" in the peek (needs offer-tier data); peek comment/chase actions; the deep-linkable `/dates/:id` page (1d's other half).

---

## Part A — The Cockpit (`ShowDateDetailSheet` re-layout)

### A.1 Shell & props

Keep the shadcn `Sheet`/`SheetContent` wrapper and the **unchanged props** `{ showDateId, open, onOpenChange }` — the three call sites must not change. Widen `SheetContent` to the cockpit width (`w-full sm:max-w-[1080px]`, right-anchored) so the rail + work columns fit; header and tabs stay sticky, the work surface scrolls. Because the file is already 957 lines, extract the cockpit into a few focused, independently testable pieces:

- `date/CockpitHeader.tsx` — title block, slot meter + status line, primary CTA, tab bar.
- `date/CockpitRail.tsx` — left facts / eligibility / activity / chat teaser.
- `date/CockpitTabs.tsx` (or inline tab-panel switch) — the tabbed work surface.

`ShowDateDetailSheet` keeps ownership of all queries/mutations and passes data + handlers down as props (same pattern it already uses for `BookingCardSection`/`BookingStatusSection`, which stay exported for their existing unit tests).

### A.2 Anchored header

- **Title block:** production eyebrow (`shows.program · sub_program`), weekday + date (`formatDateWithWeekday`), `session_1 / session_2 · venue, city`.
- **Slot meter + status line:** meter segments = `main_cast + understudies` (from `showSlots(show)`); fill order confirmed (`--green-500`) → accepted/soft_booked (`--accent-400`) → open (`--surface-3`). Reuse `computeFunnel` (`src/lib/bookingCockpit.ts`) for counts. Status line reuses the existing funnel/up-next signal (e.g. "Tier N open · offers expire…", "All slots confirmed — ready for the hire order").
- **Primary CTA** — one smart action, new pure helper `computeHeaderCta({ flow, counts, openTier, allConfirmed, hireOrdersOn })` in `bookingCockpit.ts`, mirroring the prototype's `renderVals`:
  - accepted > 0 → **Confirm N accepted** (`confirm_bookings`) → bulk-confirm.
  - else classic & not filled → `openTier < max` ? **Open tier X** (`run_offer_engine`) : **Review open offers** (→ Offers tab).
  - else direct & not filled → **Book from eligibility** (→ Book tab).
  - else filled → `hire_orders` on & `generate_hire_orders` ? **Generate hire order** (draft) : none.
  - The CTA is hidden when the resolved user lacks the capability (e.g. artists) — no disabled dead-ends.
- **Tab bar:** Cast · (Offers | Book artists) · Hire order · Chat · Setup (visibility rules in A.6).
- **Unconfigured-slot dates** (`showSlots` → null): meter/status collapse to the existing "slot configuration missing" warning; header CTA falls back to opening Setup.

### A.3 Left rail (`CockpitRail`)

- **Date facts:** session times, venue, `Airtable · locked` / manual source, notes.
- **Eligibility:** cast chips (inherited vs override, from `show_date_cast_eligibility`) + required-skill chips.
- **Activity (lite):** derived, **no new backend** — new pure `buildActivity(bookings, openedTiers)` synthesizes a newest-first list (cap ~6) from booking status + timestamps (`confirmed_at`/`updated_at`/`created_at`) and opened-tier events already fetched by `fetchOpenedTiers`. If a date has no derivable events, the block is omitted.
- **Chat teaser:** unread count + latest message (from the same `['chat', showDateId]` data the Chat tab uses).

### A.4 Tabbed work surface — section → existing component

| Tab | Renders (existing component) | Notes |
|---|---|---|
| **Cast** | `AssignedArtistsCard` → `BookingRow` (main + understudies) | `showConfirm={canConfirmBookings}`, `canManage={canManage}` — unchanged wiring |
| **Offers** *(classic)* | `TierTimeline` + `DryRunDialog` | `canManage={canRunOfferEngine}` |
| **Book artists** *(direct)* | `EligibilityBookList` | direct-mode only, as today |
| **Hire order** | `HireOrdersCard` | gated by `useFeature('hire_orders')`; splits Artist/Producer via `canManage` |
| **Chat** | `ChatPanel` | participant-gated internally |
| **Setup** | date config (city, extra casts, `RequiredSkillsSection`) + date actions (edit schedule/notes, cancel, delete) | producer/admin only |

The Offers/Book + Cast surface stays wrapped in the existing `ModuleGate feature="booking_flow"` (with its read-only preview fallback). Funnel/up-next data moves into the header/rail but keeps flowing through `BookingStatusSection`'s `useModuleGate('booking_flow')` guard.

### A.5 Flow-awareness (reflect, no toggle)

Single source stays `useBookingFlow()` → `flow.artist_acceptance` (per-org `app_settings.booking_flow`). The cockpit:
- swaps the tab label and body: `artist_acceptance` → **Offers** (`TierTimeline`/`DryRunDialog`); else **Book artists** (`EligibilityBookList`) — identical to the current branch at `ShowDateDetailSheet.tsx:868,872`;
- shows a small read-only flow indicator ("Classic offers" / "Direct booking") in the header;
- links that indicator to Settings → Booking flow **only** when `useCan('edit_booking_settings')`.

No per-date write of the org policy. No engine 409 risk.

### A.6 Gates & degradation (all reuse existing guards)

Guards unchanged from `ShowDateDetailSheet.tsx`: `canManage` (admin|producer), `useCan('manage_show_dates' | 'hard_delete_show_dates' | 'run_offer_engine' | 'confirm_bookings' | 'generate_hire_orders')`, `useFeature('hire_orders')`, `useModuleGate('booking_flow')`.

Tab visibility:
- **Setup** tab renders only when `canManage`; inside, edits gate on `manage_show_dates`, Delete on `hard_delete_show_dates` (+ `canHardDeleteDate`).
- **Offers/Book** management controls gate on `run_offer_engine`; the surface itself stays behind `ModuleGate`.
- **Hire order** tab hidden when `!hire_orders`.
- **Header CTA** hidden when the user lacks the driving capability.

**Artist path (`ArtistBookingsView`):** `canManage=false`, capabilities false → Cast (read-only), Chat, and Hire order (artist variant via `HireOrdersCard`'s `!canManage` split) only; no Setup, no offer/booking controls, no header CTA. This is verified by new tests (A.7 of the test plan).

### A.7 Responsiveness

Desktop: rail (288px) + work surface side-by-side. Below `lg`, the rail stacks above the work surface (or collapses into a "Details" disclosure); tabs and header stay sticky. Verified in the browser at desktop and narrow, light and dark.

---

## Part B — The Row Peek (1d)

### B.1 Trigger & keyboard

On the `ShowsBookingsPage` **list** rows: a single page-level controlled peek popover anchored to the hovered/focused row (columns are admin-configurable, so anchor to the **row**, not a cell). Behaviour:
- **Hover intent** (~250 ms) opens the peek; mouse-leave (with no focus inside) closes it.
- **Focus** a row + **Space** → open the peek; **Enter** or **click** → open the full cockpit (reconcile `openShowDateOnKey` at `ShowsBookingsPage.tsx:149` so Space peeks and Enter opens — today both open). **Escape** closes the peek.
- The peek renders on top via the existing shadcn `Popover` (Radix), anchored to the active row element. Interactive children `stopPropagation()` so they never trigger the row's `onClick`, mirroring the existing per-row "Generate hire order" button.

### B.2 Data (extend the shared counts query)

`fetchBookingCountsByDate` (`src/data/bookings.ts`) currently returns `Map<id, { confirmedMain, confirmedUs, total }>` from a single non-cancelled bookings scan. **Extend the same scan** to bucket by status — add accepted (`soft_booked`) and pending (`suggested`) counts, split main/understudy where available — while keeping the existing fields for current consumers. Query key `['bookings','counts-by-date',orgId]` is unchanged, so the list cells and the peek share one cache entry, and any `['bookings']` invalidation busts it.

### B.3 Contents & actions

New pure `computeDatePeek({ counts, slots, status })` → `{ eyebrow, tone, headline, meterSegs, acceptedWaiting, openSlots }`:
- **eyebrow:** `<weekday> <date> · <tone>` — tone `filled` (green) when confirmed == total; `at risk` (amber) when open slots > 0; else neutral.
- **headline:** e.g. `2 accepted waiting on you · 2 main slots open`, with 0-accepted and all-filled variants.
- **meter:** `main_cast + understudies` segments; confirmed → accepted → open, same tones as the header meter.
- **actions (faithful to the 1d markup):** **Confirm N** (when `acceptedWaiting > 0` && `canConfirmBookings`) → `bulkConfirmSoftBooked(supabase, { ids, now })` (existing; note it takes **booking ids**, not a date), then invalidate `['bookings']` + toast; and **Open date** → `openShowDate(id)`. When nothing is confirmable, only **Open date** shows. The `soft_booked` ids are obtained by lazily fetching the date's bookings when the peek opens, reusing the sheet's `['bookings','for-date',showDateId]` query — so the counts payload can stay counts-only.
- **hint:** "Space to peek · Enter to open".
- **unconfigured-slot dates:** no meter; show status + "Open date" only.

### B.4 Gates

The peek's Confirm action gates on `useCan('confirm_bookings')` (the bookings page is admin+producer already). Everything else is read-only.

---

## Part C — Token mapping

Translate the prototype's inline styles to Tailwind utilities + existing CSS vars; **no new tokens**:
- `var(--font-body|mono|display)` → `font-sans` / `font-mono` / `font-display`.
- `--surface*`, `--line*`, `--text*`, `--radius-*`, `--shadow-*` (`shadow-elev1..4`), `--green/amber/red-*`, `--accent-50..900` — already defined; use the Tailwind mappings (`bg-accent-500`, `rounded-l`, `shadow-elev3`, …) or raw `var()` where no utility exists (`--line`, `--surface-3`, `--accent-400`).
- **Accent-opacity caveat:** `bg-accent-500/20` silently drops the alpha (hex vars, not HSL channels). Use a solid stop, an `rgba()` literal, or a dedicated token.

---

## Part D — Testing plan (test-first)

**Must stay green (behavior preserved, structure changed):**
- `ShowDateDetailSheet.test.tsx` (10 capability-gate tests) and `ShowDateDetailSheet.moduleGate.test.tsx` (7) — keep `BookingCardSection`/`BookingStatusSection` exports, props, and gate semantics identical. Update selectors that now live behind a tab to activate the relevant tab first (the assertion — enabled/disabled/present — is unchanged).
- Sibling tests (`date/TierTimeline`, `date/EligibilityBookList`, `date/DryRunDialog`, `date/BookingFunnel`, `date/RequiredSkillsSection`, `hireOrders/HireOrdersCard`, `hireOrders/GenerateHireOrderDialog`, `BookingRow`) — unchanged components, unchanged tests.

**New tests:**
- Pure fns in `bookingCockpit.ts`: `computeHeaderCta` (state machine), `computeDatePeek`, `buildActivity`.
- Data: `fetchBookingCountsByDate` per-status buckets via `supabaseFake`.
- Cockpit: tab switching; flow-label reflect (Offers↔Book); artist degradation (no Setup / offer controls / header CTA); `hire_orders`-off hides the tab; unconfigured-slot header fallback.
- Peek: renders summary from counts; Confirm calls `bulkConfirmSoftBooked` + invalidates `['bookings']`; Space opens peek / Enter opens sheet; unconfigured handling.

**Full gates:** `npm run lint`, `npx vitest run --coverage`, `npx tsc -p tsconfig.app.json --noEmit`, plus browser verification of the cockpit (producer + artist) and the peek (light/dark, desktop/narrow).

---

## Part E — Files touched (anticipated)

- `src/components/shows/ShowDateDetailSheet.tsx` — re-layout; keep props, exported subcomponents, queries, mutations, gates.
- `src/components/shows/date/CockpitHeader.tsx`, `CockpitRail.tsx` (+ tab-panel switch) — new, extracted.
- `src/lib/bookingCockpit.ts` — add `computeHeaderCta`, `computeDatePeek`, `buildActivity`.
- `src/data/bookings.ts` — extend `fetchBookingCountsByDate`; reuse `bulkConfirmSoftBooked`.
- `src/pages/ShowsBookingsPage.tsx` — peek state, keyboard reconcile, render `RowPeek`.
- `src/components/bookings/RowPeek.tsx` — new peek popover.
- Co-located `*.test.tsx` for all of the above.

## Risks & mitigations

- **17 existing gate tests reference element positions** → preserve exported subcomponents/props; update selectors to tab-activate. Run the full suite continuously.
- **Artist-facing change** (shared sheet) → explicit artist-render tests + browser check via `ArtistBookingsView`.
- **Sheet width / responsiveness** → browser-verify desktop + narrow, light + dark.
- **Peek anchoring across configurable columns** → anchor to the row; verify with a reordered column template.
- **Keyboard change** (Space now peeks) → keep Enter/click opening the cockpit; cover with a test.

## Follow-ups (deferred)

Batch prev/next pager wired to the filtered list order; real per-date activity feed; expiry-based "at risk" (via `fetchTierAttention`-style offer-tier data) in the peek; peek comment/chase; `/dates/:id` deep-linkable page.
