# Calendar surface — mobile design spec

Date: 2026-08-15
Branch: `claude/phases-2-5-roadmap-2c1d01`
Status: Draft for review
Design source: Claude Design project **"Calendar UX improvements"** (`5ccc0a34-…`), canonical file **`Calendar Mobile.dc.html`** (5 screens at 402×874, iOS frame). The mock reuses this repo's token system.

> The mock is the visual source of truth. Implementers re-pull `Calendar Mobile.dc.html` for exact pixel/copy values; this spec fixes the architecture, breakpoint, component boundaries, and behavior. This is the follow-up mobile spec that the desktop spec (`2026-08-15-calendar-integrated-surface-design.md` §2, §12) deferred.

---

## 1. Goal

Make the lens-based calendar surface usable on a phone. Add a mobile presentation layer over the **same** show-date + booking data and the **same** mutations built in Phases 1–3 — no new data, no new actions. The surface renders a touch-first layout below a breakpoint: a scrollable lens-chip row, single-column lens bodies, the desktop day rail replaced by a **bottom sheet**, and a producer **"New date" FAB**.

---

## 2. Scope

### In scope
- A responsive branch in `CalendarSurface` at **`useIsMobile()` (<768px)**; desktop (≥768px, incl. tablets) is unchanged.
- **5 bespoke mobile screens** (from the mock): artist **Offers**, artist **Month**, producer **Agenda**, producer **Season** (frozen-label + horizontal-scroll strip), and the shared **day bottom-sheet** (artist + producer variants).
- Producer **Needs-you** reflowed to a single-column card stack (the mobile producer **default**, per decision).
- **Graceful responsive reflow** (usable, not bespoke) for the un-mocked lenses: producer **Month** and **Week** (Week = the Agenda day-list over the week window), artist **All dates** (table → stacked rows).
- Net-new touch primitives: `CalendarDaySheet` (bottom sheet, wraps the existing `vaul` Drawer), `SurfaceFab` (producer New-date FAB), `SeasonStripMobile`.
- A shared `DayDetail` content unit extracted from `DayRail` so the rail (desktop) and the sheet (mobile) never diverge.

### Out of scope
- **Range selection / bulk bar (Phase 4) on mobile** — drag/shift-select is a poor touch fit and the mock omits it. The `SelectionBar` is desktop-only; on mobile the range affordances are not rendered.
- Empty/offline states and swipe-to-accept — the mock's "try next" notes flag these as **not yet designed**; a follow-up.
- Bottom tab/nav bar — the mock deliberately uses the top-left hamburger (AppLayout's existing mobile drawer), not a bottom nav. We keep that.
- Any change to data-access, mutations, RLS, or edge functions.
- Tablet-specific layouts — tablets (768–1024px) intentionally get the desktop surface (decision 3).

### Locked decisions
1. **Producer mobile default = Needs-you** (consistent with desktop), reflowed to one column; Agenda is one chip over.
2. **Scope = 5 mocked screens + graceful reflow** for the rest; no lens disappears on mobile.
3. **Breakpoint = `useIsMobile()` / <768px**; tablets keep the desktop two-column surface.
4. **Omit call time** — the mock shows a "call 17:30" line/tile, but the project omits call time everywhere. Mobile shows **session times only**: drop the call line and the "Call" fact tile. The day sheet's fact tiles become **Session** + **Expires** (live offers) — dropping from the mock's three (Session / Call / Expires) to two; a confirmed date with no expiry shows just **Session**.
5. **Bottom sheet = the existing `vaul` `Drawer`** (`src/components/ui/drawer.tsx`, currently unused), not `Sheet side="bottom"`.
6. **No bottom nav bar**; navigation stays on AppLayout's hamburger drawer.

---

## 3. Architecture

### 3.1 The responsive branch

`CalendarSurface` gains `const isMobile = useIsMobile()` (`src/hooks/use-mobile.tsx`, `MOBILE_BREAKPOINT = 768`). All existing desktop rendering moves behind `!isMobile`; a parallel mobile tree renders behind `isMobile`. State (`anchor`, `selectedDay`, `lens`, range) is shared; only the presentation forks. The two consuming pages (`ShowsBookingsPage`, `AvailabilityPage`) pass the **same** props — they don't branch.

```
CalendarSurface (isMobile ? mobile : desktop)
  desktop:  [unchanged Phase 1–4 tree]
  mobile:
    ├─ CalendarSurfaceHeader (compact)         ← reused, mobile classes
    ├─ LensTabs (scrollable variant)           ← reused + `scrollable` prop
    ├─ MobilePeriodBar (prev · label · next · Today)   ← reused PeriodNavigator, full-width
    ├─ <mobile lens body>                       ← single column, per §4
    ├─ CalendarDaySheet (open on day/row tap)   ← NEW (vaul Drawer)
    └─ SurfaceFab (producer + landing lens)     ← NEW
```

### 3.2 Component inventory

| Component | New/Reuse | Notes |
|---|---|---|
| `CalendarSurface` | modify | add `useIsMobile` branch |
| `LensTabs` | modify | add `scrollable?: boolean` → `overflow-x-auto` chip row, snap, count badges kept |
| `CalendarSurfaceHeader` / `PeriodNavigator` | reuse | mobile spacing via responsive classes |
| `DayRail` | modify | extract its body into `DayDetail`; rail becomes `DayDetail` in a fixed 280px column (desktop) |
| `DayDetail` | **new** | pure content: day facts (session only), fill meter / status note, primary + secondary actions, legend/stats optional. Consumed by `DayRail` (desktop) and `CalendarDaySheet` (mobile) |
| `CalendarDaySheet` | **new** | `vaul` `Drawer` bottom sheet; grab handle; renders `DayDetail`; opened by `selectedDay` on mobile; dismiss via handle/scrim |
| `SurfaceFab` | **new** | fixed bottom-right extended FAB; producer + mobile + landing lens; fires `onNewDate` |
| `SeasonStripMobile` | **new** | frozen 92px label column + horizontal-scroll day-grid heatmap + load-bar row (mock 2e) |
| `MonthGrid` | reuse | mobile cell variant (smaller min-height, single chip, status-bar-per-day) via responsive classes / a `dense` prop |
| `NeedsYouLens`, `OffersLens`, `AgendaLens`, `AllDatesLens`, `MonthLens`, `SeasonLens` | reuse | single-column reflow via responsive classes; Season delegates to `SeasonStripMobile` when `isMobile` |

### 3.3 Day interaction model (mobile)

On desktop, selecting a day updates the side `DayRail`. On mobile there is no side rail: tapping a **Month cell**, an **Agenda/list row**, an **Offers card's date**, or a **Season cell** sets `selectedDay` (and the tapped entry) and **opens `CalendarDaySheet`**. The sheet renders `DayDetail` for that day's entry with the same primary/secondary actions the desktop rail resolves (`resolveProducerPrimary` for producer; artist Accept/Decline/Block/Message). Dismiss closes the sheet and clears `selectedDay`. "Open date" in the sheet still routes to `ShowDateDetailSheet` (unchanged cockpit).

### 3.4 Breakpoint + hydration

`useIsMobile()` returns `false` on the server/first paint until `matchMedia` resolves; guard the mobile tree so the desktop tree is the SSR/first-render default (the app is a Vite SPA, so this is a mount-time flip, acceptable). Rotating a phone or resizing across 768px re-renders the correct tree (the hook subscribes to `matchMedia`).

---

## 4. Per-screen specifications

Common: the header is AppLayout's existing 52px top bar (hamburger + title + role icon: artist = bell, producer = search) — **not** re-implemented here. Each lens body sits below the scrollable chip row. Tones from the Phase-1 `tone.ts` (`PRODUCER_TONES` / `ARTIST_TONES`); numbers mono/tabular.

### 4.1 Artist · Offers (mobile default) — mock 2a
Title block: amber eyebrow ("N offers expire today at HH:MM"), H1 "Availability". Chip row: Offers (active, count) · Month · All dates. Body = single-column `OffersLens` card stack: date block (DOW · day · month) + content (eyebrow, title, venue·city, **session time only**, red countdown for live offers, optional adjacency note) + action block (full-width **Accept**, then **Decline** / **Block date**); hold cards show a Hold status footer. Progress row ("N of M answered" + bar). "Answered today" collapsible. No FAB, no rail.

### 4.2 Artist · Month — mock 2b
Chip row (Month active). Month nav row (prev · "August 2026" · next · Today). `MonthGrid` in **dense/mobile** mode: 7-col, ~62px cells, one status-bar-per-day chip (session time + truncated program, colored left rail), today ring, past muted. Legend row (Confirmed/Hold/Offer/Blocked). "Your August" stat panel. **Tapping a day opens the artist day sheet (§4.3).**

### 4.3 Artist · Day sheet — mock 2c
`CalendarDaySheet` (artist variant of `DayDetail`): grab handle; violet eyebrow ("Fri 14 Aug · offer"); title; venue·city; **two** fact tiles **Session** + **Expires** (Call tile dropped per decision 4); optional adjacency note; action stack full-width **Accept offer**, row **Decline** / **Block date**, text **Message producer**. Dismiss via handle/scrim.

### 4.4 Producer · Needs-you (mobile default) — reflow (not mocked)
Producer landing on mobile. `NeedsYouLens` reflowed to a single column: the four groups stack; each group's items are full-width cards; group bulk buttons ("Confirm all", "Generate N") sit under the group header. The `QueueRail` (progress + shortlist + rules) folds **below** the queue as collapsible cards (not a side rail). Card actions unchanged from Phase 2. FAB present (New date).

### 4.5 Producer · Agenda — mock 2d
Chip row (Agenda active, full producer set Needs-you/Agenda/Month/Week/Season scrollable). Producer eyebrow ("N dates · N slots open"), H1 month. Filter row (active filter pill + "Add filter"). Body = `AgendaLens` week-grouped day rows: 34px date stub, title, venue·time, **fill meter** (7×7px squares) + "filled/main", status badge, chevron. Row tap → producer day sheet (§4.7). **FAB "New date"** bottom-right.

### 4.6 Producer · Season — mock 2e
`SeasonStripMobile`: heading ("Season load · Aug 2026" + "swipe →"). A card with a **frozen 92px left label column** (program rows: name + "N dates · −N", plus an "Open" footer row) and a **horizontally-scrolling grid** (`repeat(N, 20px)` day columns): a date header row (today tinted), per-program fill-height bars, and a bottom **load-bar row** (per-day unfilled slots; amber when heavy). Cell tap (with a date) → producer day sheet. No FAB on Season.

### 4.7 Producer · Day sheet — mock 2e drawer
`CalendarDaySheet` (producer variant of `DayDetail`): grab handle; status eyebrow ("Wed 19 Aug · casting"); title; venue·**session** meta; **fill meter** + "filled/main main"; note ("N main / N understudy still open. N artists hold this date."); action stack full-width primary (`resolveProducerPrimary`: **Confirm N holds** / **Generate hire order**) + **Open date** (outline). Dismiss via handle/scrim.

### 4.8 Graceful reflow (un-mocked)
- **Producer Month:** `MonthGrid` dense mode (as §4.2) with producer cells (meter chip + −N flag); tap → producer day sheet.
- **Producer Week:** "collapses to a day list" — render the `AgendaLens` day rows filtered to the current **week window** (`periodWindow(anchor,'week')`) instead of the desktop time grid. Period nav steps by week.
- **Artist All dates:** the fixed-column table becomes stacked rows (date + show·venue·session + status + action) via responsive classes; hire-order link / Block button preserved.

---

## 5. Data & wiring

**No change.** Mobile consumes the identical props the pages already pass to `CalendarSurface` (Phases 1–3): `producerEntries` / `artistEntries`, `actions`, `needsYouQueue` / `queueShortlist`, `seasonReadyIds`, `actionGates`, `lens` / `onLensChange`. The FAB's `onNewDate` maps to each page's existing "New date" handler (the CTA already in the page chrome). Deep links (`?lens=`) work identically. Realtime, gating (`booking_flow`, `useCan`) unchanged.

---

## 6. Tone / tokens
Reuse `src/lib/calendar/tone.ts` verbatim. No new color maps. Map the mock's hex (violet `#6E5CF6` etc.) to existing DS semantic tokens (`bg-primary`, `text-success`, …) exactly as the desktop surface does; never hardcode hex. Accent numbered stops take no `/opacity` (Season intensity uses solid stops / rgba).

---

## 7. Testing (five-layer, test-first)
- **Component (RTL, `useIsMobile` mocked):** with the hook true, `CalendarSurface` renders the mobile tree — scrollable `LensTabs`, single-column body; tapping a Month cell / Agenda row / Season cell opens `CalendarDaySheet` with the right `DayDetail` actions; `SurfaceFab` shows for producer on the landing lens and fires `onNewDate`; hidden for artist and on Season. `DayDetail` unit test: producer primary = `resolveProducerPrimary`, artist primary by status. `SeasonStripMobile` renders frozen labels + N day columns + load-bar. `LensTabs scrollable` renders overflow-x. With the hook false, the desktop tree is unchanged (regression).
- **Pure:** any new reflow helper (e.g. week→day-list windowing) unit-tested; reuse Phase-1/3 libs otherwise.
- **E2E (Playwright, mobile viewport 402px):** one smoke flow per role — artist opens an offer sheet and Accepts; producer opens Agenda, taps a row, sees the day sheet, taps New-date FAB.
- No DB / edge tests (no backend change).

---

## 8. i18n / minis / help
- No new user-facing **strings** beyond what Phases 1–3 already added — mobile reuses the same `bookings`/`availability` keys. Any genuinely new mobile-only copy (e.g. "swipe" hint) goes through `t(...)`, EN + DE key-for-key, informal "Du", no dashes.
- `PageMini` unaffected (same modules). Help-center: assess in the PR; likely "no impact" (same flows, different layout).

---

## 9. Implementation order (slices)
1. **Responsive shell** — `useIsMobile` branch in `CalendarSurface`; `LensTabs` scrollable variant; header/period-nav reflow; extract `DayDetail` from `DayRail`; `CalendarDaySheet` (vaul) replacing the rail on mobile for Month/Needs-you/Offers.
2. **Mobile list lenses + FAB** — Agenda rows, Needs-you single-column stack (+ folded QueueRail), Offers card stack; `SurfaceFab` (producer landing).
3. **Season strip + reflows** — `SeasonStripMobile`; producer Month dense grid + Week→day-list; artist Month dense grid; artist All-dates stacked rows.

Each slice keeps the app shippable; desktop is untouched throughout.

---

## 10. Dependencies & risks
- **Depends on Phases 2 (Needs-you) + 3 (Season)** for those lenses to exist to reflow. If Phase 5 is built before them, scope the mobile Needs-you/Season slices to follow. Phase-1 lenses (Month/Agenda/Offers/All-dates) reflow independently.
- **`DayRail` refactor risk:** extracting `DayDetail` touches a Phase-1 component with existing tests — keep the desktop `DayRail` render identical (the extraction is internal); the Phase-1 `DayRail` tests must stay green.
- **`useIsMobile` first-paint flip:** the desktop tree is the first render; the mobile tree appears after mount. Acceptable for an SPA; verify no layout-shift jank on a real device.
- **vaul Drawer is unused today:** first production consumer — verify it's wired (styles, portal) and accessible (focus trap, escape/scrim dismiss).
- **Season horizontal scroll:** ensure the frozen label column + scroll container don't cause page-level horizontal overflow (scroll must be contained to the strip).
- **Range-select absent on mobile:** confirmed out of scope; ensure the mobile `MonthGrid`/`SeasonStripMobile` don't render selection affordances.

---

## 11. Open items (flag, not block)
- Empty/offline states + swipe-to-accept: deferred (mock's own "try next"); a later mobile-polish pass.
- Whether the producer Needs-you QueueRail shortlist belongs in the folded section or inside the day sheet — decide during slice 2 from the reflowed feel; default: folded collapsible below the queue.
