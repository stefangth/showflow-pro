# Calendar Phase 3 — Week + Season lenses

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two producer lenses to the calendar surface: a **Week** time-grid (events positioned by session start over Mon–Sun day columns) and a **Season** program×day heatmap (rows per production, day columns, load bars, KPI cards).

**Architecture:** Pure derivation libs (`src/lib/calendar/time.ts` for HH:MM→minutes + band bounds; `src/lib/calendar/weekData.ts` for positioned session blocks; `src/lib/calendar/seasonData.ts` for the program×day grid + KPIs) feed two presentational components (`WeekLens`, `SeasonLens`). `period.ts` already handles the `week`/`season` windows; the only surface change is threading the active period through `PeriodNavigator` instead of the hardcoded `'month'`. One small additive schema-shape change: `showId` on `ProducerDateEntry` (Season rows must key on the real production identity, not the nullable/non-unique `program`).

**Tech Stack:** React 18, TypeScript, Tailwind + shadcn, `@tanstack/react-query` v5, Vitest + jsdom + Testing Library, date-fns. Design tokens in `src/index.css`.

**Spec:** `docs/superpowers/specs/2026-08-15-calendar-integrated-surface-design.md` (§4.3 Week, §4.4 Season, §11 open items on band bounds / program identity) — read alongside this plan.

**Builds on:** Phase 1 (merged PR #294). Kit assumed present.

## Global Constraints

- **Semantic tokens only.** Accent numbered stops (`accent-50`…`900`) do NOT take `/opacity` — for the Season heatmap's intensity ramp use solid accent stops or `rgba()` literals, never `bg-accent-500/30`.
- **Week starts Monday everywhere.** Week columns Mon–Sun; ISO week via `startOfWeek(d,{weekStartsOn:1})`.
- **Call time is omitted** — the only time data is `session_1/2/3`. Never synthesize `session − 90`.
- **Session time wire format is `"HH:MM:SS"`** (Postgres `TIME`, seconds included, no TZ) and it reaches `ProducerDateEntry.session1/2/3` **raw** (unsliced). Parse defensively: `hh = value.slice(0,2)`, `mm = value.slice(3,5)`. All three sessions are **nullable** — a date can have zero sessions (times-TBD); the Week lens must render it as an untimed marker, not crash.
- **Test-first (TDD).** Failing test → watch fail → minimal impl → watch pass → commit. Co-located tests.
- **Tests import the real module.** Component tests use plain `render` from `@testing-library/react` with inline fixture factories (the kit's convention — no `renderWithProviders` for these presentational components).
- **No `any`** (CI `--max-warnings 0`).
- **i18n:** new copy via `t('bookings:…')`; EN canonical + DE key-for-key (`keyParity.test.ts`), informal "Du", **no dashes** (`copyLint.test.ts`).
- **Type-check** `tsconfig.app.json` + `tsconfig.tools.json`; lint; `npx vitest run`.

### Cross-plan coordination (shared file)

This plan adds `showId: string` to `ProducerDateEntry` + `ProducerShowDateRow` + `toProducerEntries` + `SHOW_DATE_LIST_COLS` (`show_id` is already selected in `fetchShowDatesList`, just dropped by `toProducerEntries` today). **Phase 2** independently adds `castNotifiedAt` to the same three files. Both are additive and conflict-free; merge the field lists by hand if the plans run concurrently (Task 1 here vs Phase 2 Task 4/5).

---

## Data facts (locked from research)

- `session_1/2/3` are `TIME` (nullable) added in `20260514140000_show_dates_replace_times_with_sessions.sql`; `session_1` NOT-NULL was later dropped. Wire format `"HH:MM:SS"`; `toProducerEntries` copies them raw (`producerData.ts`).
- `shows` has **no `name`** column; identity/display fields are `program` (nullable), `sub_program` (nullable), `category`. `program` can be `''` and is not unique across shows → **key Season rows on `show_id`**, label them `program · sub_program`. `show_id` is already in `ProducerShowDateRow.show_id` but dropped by `toProducerEntries`.
- `period.ts` already exports working `periodWindow`/`shiftPeriod`/`periodLabel` for `'week'` and `'season'` (`LensPeriod = 'month'|'week'|'season'`). Season = a 3-calendar-month span (in-code placeholder). No period math to add.
- `CalendarSurface` currently hardcodes `'month'` in its `PeriodNavigator` label/shift calls — a real Week/Season lens needs the surface to thread the active period.
- No time-grid, heatmap, or load-bar component exists in the repo; `FillMeter` (`src/components/calendar/surface/FillMeter.tsx`, props `{segments, tone, label?, size?}`) is the reusable density primitive. `src/lib/dates.ts` has **no** time-of-day parser — add one.
- KPI source: `useDatesReadyForHireOrder(orgId)` → `{ readyIds: string[], orderByDate }`; `readyIds` is org-wide `fully_filled` with no active order (intersect with the season window for a period-scoped KPI). Unfilled slots per date = `max(0, mainSlots - confirmedMain)` (both on `ProducerDateEntry`). Copy the KPI-card markup from `src/components/hireOrders/OrdersKpis.tsx` (grid of shadcn `Card` + uppercase muted label + `text-2xl font-semibold tabular-nums`); there is no shared `KpiCard`.

---

## File structure (Phase 3)

```
src/lib/calendar/
  time.ts        time.test.ts        # sessionMinutes(), minutesToLabel(), bandBounds()
  weekData.ts    weekData.test.ts    # toWeekBlocks(entries, window) → WeekBlock[]
  seasonData.ts  seasonData.test.ts  # toSeasonGrid(entries, window) → SeasonGrid; seasonKpis(...)
  types.ts                           # +showId on ProducerDateEntry
  producerData.ts                    # +showId mapping
src/data/showDates.ts                # SHOW_DATE_LIST_COLS already has show_id; confirm mapping
src/components/calendar/surface/
  WeekLens.tsx     WeekLens.test.tsx
  SeasonLens.tsx   SeasonLens.test.tsx
  SeasonKpis.tsx   SeasonKpis.test.tsx    # (or inline in SeasonLens)
  PeriodNavigator usage in CalendarSurface.tsx  # thread active period
  CalendarSurface.tsx                          # +week/+season lens branches
src/pages/ShowsBookingsPage.tsx      # widen ?lens= allowlist; pass readyIds for KPI
src/i18n/locales/{en,de}/bookings.json
```

---

## WAVE A — pure libs (parallel: 3 concurrent)

### Task 1: time parsing + `showId` plumbing

**Files:**
- Create: `src/lib/calendar/time.ts`, `src/lib/calendar/time.test.ts`
- Modify: `src/lib/calendar/types.ts` (+`showId: string` on `ProducerDateEntry`), `src/lib/calendar/producerData.ts` (map `showId: sd.show_id`), confirm `src/data/showDates.ts` `SHOW_DATE_LIST_COLS` includes `show_id` (it does).

**Interfaces — Produces:**
```ts
export function sessionMinutes(value: string): number;      // "14:30:00" | "14:30" → 870
export function minutesToLabel(minutes: number): string;    // 870 → "14:30"
export function bandBounds(
  values: (string | null | undefined)[],
  fallback?: { startHour: number; endHour: number },        // default { startHour: 14, endHour: 23 }
): { startMinutes: number; endMinutes: number };            // padded to whole hours; fallback when no times
```

- [ ] **Step 1: Add `showId`** — in `types.ts` add `showId: string;` to `ProducerDateEntry` (required — every show_date has a `show_id`; but see note). In `producerData.ts` `toProducerEntries`, map `showId: sd.show_id`. Because Phase-1 tests build `ProducerDateEntry` inline, a required new field breaks them — so add `showId` as **required** only if you also update the kit's inline fixtures; the low-churn alternative is `showId?: string` (optional) consumed with a `?? ''` guard in Season. **Choose optional `showId?: string`** to avoid touching every Phase-1 fixture; Season keys on `entry.showId ?? entry.id` (falling back to the date id, which never collides). `npx tsc -p tsconfig.app.json --noEmit` → PASS.
- [ ] **Step 2: Write the failing test** `time.test.ts`:
```ts
import { sessionMinutes, minutesToLabel, bandBounds } from './time';
it('parses HH:MM:SS and HH:MM to minutes', () => {
  expect(sessionMinutes('14:30:00')).toBe(870);
  expect(sessionMinutes('09:05')).toBe(545);
});
it('bandBounds derives padded whole-hour extent, falls back when empty', () => {
  expect(bandBounds(['19:30:00', '14:00:00', null])).toEqual({ startMinutes: 14*60, endMinutes: 20*60 });
  expect(bandBounds([null, undefined])).toEqual({ startMinutes: 14*60, endMinutes: 23*60 });
});
```
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** — `sessionMinutes(v) = (+v.slice(0,2))*60 + (+v.slice(3,5))`; `minutesToLabel` pads `hh`/`mm`; `bandBounds` filters non-null, maps to minutes, takes `Math.floor(min/60)*60` and `Math.ceil(max/60)*60`, returns fallback (in minutes) when the list is empty.
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** — `git commit -am "feat(calendar): session time parsing + showId on ProducerDateEntry"`

### Task 2: `weekData.ts` — positioned session blocks

**Files:**
- Create: `src/lib/calendar/weekData.ts`, `src/lib/calendar/weekData.test.ts`

**Interfaces — Consumes:** `ProducerDateEntry`, `sessionMinutes`/`bandBounds` (time.ts), `PRODUCER_TONES`, `periodWindow` (period.ts). **Produces:**
```ts
export interface WeekBlock {
  entryId: string; date: Date;
  columnIndex: number;         // 0..6 Mon..Sun within the week window
  session: 1 | 2 | 3;
  startMinutes: number;        // for vertical position (null-session dates excluded from blocks)
  title: string; venue: string | null; city: string | null;
  status: ProducerDateEntry['status'];
  meter: MeterSegment[];       // confirmedMain of mainSlots
}
export interface WeekModel {
  weekStart: Date;             // Monday
  columns: Date[];             // 7 days Mon..Sun
  band: { startMinutes: number; endMinutes: number };
  blocks: WeekBlock[];
  untimed: { entryId: string; columnIndex: number; title: string }[];   // all-null-session dates
}
export function toWeekModel(entries: ProducerDateEntry[], anchor: Date): WeekModel;
```

- [ ] **Step 1: Write the failing test** — 2 entries in the anchor week: one with `session1='14:00:00'` + `session2='19:30:00'` (2 blocks, correct `columnIndex` + `startMinutes`), one with all sessions null (→ `untimed`). Assert `band` covers 14:00–20:00. A third entry outside the week is excluded.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — window = `periodWindow(anchor,'week')`; filter entries into `[start,end]`; `columnIndex = differenceInCalendarDays(date, weekStart)`; for each non-null session emit a `WeekBlock` (`meter` built like `monthCellsProducer`'s chip: `Array.from({length:mainSlots},(_,i)=>({filled:i<confirmedMain}))`); collect all-null dates into `untimed`; `band = bandBounds(all session values across the week)`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): week model (positioned session blocks)"`

### Task 3: `seasonData.ts` — program×day grid + KPIs

**Files:**
- Create: `src/lib/calendar/seasonData.ts`, `src/lib/calendar/seasonData.test.ts`

**Interfaces — Consumes:** `ProducerDateEntry`, `periodWindow` (period.ts), `startOfWeek`. **Produces:**
```ts
export interface SeasonRow {
  showId: string; label: string;               // "program · sub_program" (trimmed; '' → program only)
  cells: SeasonCell[];                          // one per day column, in window order
}
export interface SeasonCell {
  date: Date; dateId: string | null;           // null = no date for this show on this day
  filledMain: number; mainSlots: number;
  status: ProducerDateEntry['status'] | null;
  intensity: number;                            // 0..1 = filledMain/mainSlots (0 when mainSlots 0)
}
export interface SeasonModel {
  days: Date[];                                 // the window's day columns
  rows: SeasonRow[];
  loadByDay: { date: Date; openMainSlots: number }[];   // the "Unfilled slots" load-bar row
}
export interface SeasonKpis { unfilledMainSlots: number; heaviestWeekLabel: string; readyForHireOrder: number }
export function toSeasonModel(entries: ProducerDateEntry[], anchor: Date): SeasonModel;
export function seasonKpis(entries: ProducerDateEntry[], anchor: Date, readyIds: Set<string>): SeasonKpis;
```

- [ ] **Step 1: Write the failing test** — 3 entries across 2 shows and 2 weeks in the season window: assert `rows` keyed by `showId` (2 rows) with the right `label`, `cells` aligned to `days`, `loadByDay` open-slot sums, and `seasonKpis` → `unfilledMainSlots` = Σ`max(0, mainSlots-confirmedMain)` over non-cancelled, `readyForHireOrder` = |`readyIds ∩ window date ids`|, `heaviestWeekLabel` = the Mon-week with the most dates. A show with `program=''` labels as sub_program-only or the date's venue fallback (assert the chosen rule).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — window days from `periodWindow(anchor,'season')` (iterate day by day); group entries by `showId ?? id`; build one `SeasonRow` per show with a `cells` array positioned by `differenceInCalendarDays`; `intensity = mainSlots>0 ? filledMain/mainSlots : 0`; `loadByDay` sums open main slots per day across rows; `seasonKpis` as specified (heaviest week via `startOfWeek(date,{weekStartsOn:1})` bucketing → max by date count, label via `periodLabel`/`formatDateDMY` of that week's Monday).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): season model + KPIs (key by show_id)"`

---

## WAVE B — presentational lenses (parallel: 2 concurrent, depend on A)

### Task 4: WeekLens

**Files:**
- Create: `src/components/calendar/surface/WeekLens.tsx`, `WeekLens.test.tsx`

**Interfaces — Consumes:** `WeekModel`, `toWeekModel`, `FillMeter`, `PRODUCER_TONES`, `minutesToLabel`. **Produces:**
```ts
interface WeekLensProps {
  entries: ProducerDateEntry[];
  anchor: Date;
  onOpenEntry: (entryId: string) => void;
  className?: string;
}
```
Renders a time grid: an hour gutter from `band.startMinutes`→`endMinutes` (labels via `minutesToLabel`, whole-hour rows), 7 Mon–Sun day columns (today column tinted), each `WeekBlock` absolutely positioned by `(startMinutes - band.start)` at a **fixed block height** (no durations exist) showing time · title · venue·city · `FillMeter` + `filled/main`; multi-session dates stack their blocks. `untimed` dates render as a chip in an "all day / times TBD" strip at the top of their column. Block click → `onOpenEntry(entryId)`. Full width (no rail).

- [ ] **Step 1: Write the failing test** — entries producing 2 blocks in one column + 1 untimed → 2 positioned blocks (assert `data-testid="week-block-<entryId>-<session>"` present and the untimed strip chip renders); clicking a block fires `onOpenEntry`. Deterministic `anchor`/today.
- [ ] **Step 2–4:** FAIL → implement (`toWeekModel(entries, anchor)`; positions via inline `style={{top, height}}` in px derived from minutes; tokens for colors) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): WeekLens time grid"`

### Task 5: SeasonLens (+ SeasonKpis)

**Files:**
- Create: `src/components/calendar/surface/SeasonLens.tsx`, `SeasonLens.test.tsx`, `SeasonKpis.tsx`, `SeasonKpis.test.tsx`

**Interfaces — Consumes:** `SeasonModel`, `toSeasonModel`, `seasonKpis`, `SeasonKpis` type. **Produces:**
```ts
interface SeasonKpisProps { kpis: SeasonKpis; className?: string }
interface SeasonLensProps {
  entries: ProducerDateEntry[];
  anchor: Date;
  readyIds: Set<string>;
  onOpenDate: (dateId: string) => void;
  rangeKeys?: string[];                 // Phase 4 range-select (inert here)
  onRangeExtend?: (key: string) => void;
  className?: string;
}
```
Renders the program×day heatmap: left label column (row `label`), a cell per day tinted by `intensity` (solid accent stop ramp per the accent-opacity caveat — e.g. bucket `intensity` into 4 solid stops) with a `filledMain/mainSlots` label and Monday gridlines; below the grid the **"Unfilled slots"** load-bar row (per-day `openMainSlots`); then `<SeasonKpis kpis={seasonKpis(entries, anchor, readyIds)} />` (3 cards, `OrdersKpis` markup). Cell click with a `dateId` → `onOpenDate`. Full width. `rangeKeys`/`onRangeExtend` are accepted but inert (Phase 4 wires drag-select across day columns).

- [ ] **Step 1: Write the failing tests** — (a) `SeasonKpis` renders 3 labeled values from a fixture; (b) `SeasonLens` with 2 shows renders 2 rows, the correct number of day columns, the load-bar row, and clicking a populated cell fires `onOpenDate(dateId)`.
- [ ] **Step 2–4:** FAIL → implement (intensity→one of 4 solid accent classes; `tabular-nums` labels; reuse `OrdersKpis` card structure in `SeasonKpis`) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): SeasonLens heatmap + KPIs"`

---

## WAVE C — integration (sequential)

### Task 6: CalendarSurface — thread period + add Week/Season lenses

**Files:**
- Modify: `src/components/calendar/surface/CalendarSurface.tsx`
- Test: `src/components/calendar/surface/CalendarSurface.test.tsx`

- [ ] **Step 1: Write the failing test** — mount `role="producer"`, `lens="week"`, producer entries with sessions → LensTabs includes Week + Season; the WeekLens time grid renders; the `PeriodNavigator` label reads the **week** label (not the month) and clicking next calls `shiftPeriod(anchor,'week',1)` (assert the anchor advanced 7 days via a follow-up render/state check or a `periodLabel` change). Repeat minimal assertion for `lens="season"`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:**
  - Add `{key:'week',label:'Week'}` and `{key:'season',label:'Season'}` to `PRODUCER_LENSES` (order per spec: Needs you · Month · Week · Season · Agenda — insert Week/Season between Month and Agenda; Needs-you comes from Phase 2, tolerate its absence by inserting relative to Month/Agenda).
  - Introduce an `activePeriod: LensPeriod` derived from the lens (`week`→`'week'`, `season`→`'season'`, else `'month'`). Replace the hardcoded `'month'` in the `PeriodNavigator` `label={periodLabel(anchor, activePeriod)}`, `onPrev/onNext = () => setAnchor(a => shiftPeriod(a, activePeriod, ±1))`, `onToday`. Show the toolbar/navigator for month/week/season (not agenda/needs-you).
  - Add branches: `activeLens === 'week'` → `<WeekLens entries={producerEntries} anchor={anchor} onOpenEntry={actions.openDate} />` (full width); `activeLens === 'season'` → `<SeasonLens entries={producerEntries} anchor={anchor} readyIds={seasonReadyIds} onOpenDate={actions.openDate} />` (full width). Add a `seasonReadyIds?: Set<string>` prop (from the page) to `CalendarSurfaceProps`.
- [ ] **Step 4: Run → PASS** + `npx tsc -p tsconfig.app.json --noEmit`.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): Week + Season lenses; thread active period"`

### Task 7: Wire ShowsBookingsPage + i18n

**Files:**
- Modify: `src/pages/ShowsBookingsPage.tsx`, `src/i18n/locales/{en,de}/bookings.json`
- Test: `src/pages/ShowsBookingsPage.calendar.test.tsx` (extend), `src/i18n/keyParity.test.ts`

- [ ] **Step 1: Write the failing test** — `?lens=week` selects the Week lens on `ProducerShowsBookings`; `?lens=season` selects Season and renders the KPI cards from the page's `readyIds`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — widen the producer `lens` state union + the `?lens=` mount-effect allowlist + `updateLens` to include `'week'` and `'season'`. Pass `seasonReadyIds={new Set(hireOrderReady?.readyIds ?? [])}` to `CalendarSurface`. Add all Week/Season copy (lens labels, KPI titles, "Unfilled slots", "times TBD", "all day") to `bookings.json` EN then DE (key-for-key, informal "Du", no dashes); replace literals in Tasks 4–6 with `t('bookings:…')`. Assess `PageMini`/help impact; state in PR.
- [ ] **Step 4: Run** — `npx vitest run`, `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.tools.json --noEmit`, `npm run lint`.
- [ ] **Step 5: Commit** — `git commit -am "feat(bookings): enable Week + Season lenses + i18n"`

---

## Phase 3 exit criteria
- Producer `/bookings` shows Week + Season lenses; `PeriodNavigator` navigates by week/season (not month) on those lenses.
- Week: session blocks positioned by start time over Mon–Sun columns, multi-session stacking, untimed dates surfaced, band derived from data extent (fallback 14:00–23:00), no clipping of early/late shows.
- Season: rows keyed by `show_id` labelled `program · sub_program`, day-column heatmap tinted by fill intensity, "Unfilled slots" load-bar row, KPI cards (Unfilled main slots · Heaviest week · Ready for hire order).
- `?lens=week`/`?lens=season` deep-link; all three tsc projects + lint + `vitest run` green; i18n key-parity green.

## Open risks / verify during build
- **Season span:** `period.ts` season = a fixed 3-calendar-month window (placeholder). If the org models a real "season" (e.g. a run of a production), revisit `periodWindow('season')` — out of scope here; the 3-month span is the agreed placeholder.
- **Program label when `program=''`:** decide and encode one rule in `seasonData.ts` (recommended: `[program, subProgram].filter(Boolean).join(' · ') || (venue ?? 'Untitled')`). Assert it in the Task 3 test so it's explicit.
- **Heatmap intensity + accent-opacity caveat:** bucket `intensity` into a small set of **solid** accent stops; never use `/opacity` on numbered accent stops (renders solid silently).
- **Shared-file merge with Phase 2:** see "Cross-plan coordination".

## Self-review notes
- Spec coverage: §4.3 Week (time band from data, fixed-height blocks, multi-session stacking) → Tasks 1/2/4/6. §4.4 Season (program×day, load bars, KPI cards, day-column span) → Tasks 1/3/5/6. §11 band-bounds + program-identity risks → Tasks 1/3 (bandBounds derives extent; Season keys on showId). §8 i18n → Task 7.
- Type consistency: `WeekModel`/`WeekBlock` (Task 2) consumed by Task 4; `SeasonModel`/`SeasonRow`/`SeasonKpis` (Task 3) consumed by Task 5; `sessionMinutes`/`minutesToLabel`/`bandBounds` (Task 1) consumed by 2/4; `showId` added in Task 1, consumed by Task 3.
- Placeholder scan: the `program=''` label rule is specified with a concrete recommended formula and pinned by a test, not left open.
