# Calendar Integrated Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the producer Shows & Bookings table and the artist Availability list with one lens-based calendar surface wired to real booking data.

**Architecture:** A shared component kit under `src/components/calendar/surface/` renders role-specific lenses over merged show-date + booking data. Pure derivation libs under `src/lib/calendar/` feed presentational components; existing data-access functions and mutations do the I/O. The two existing pages (`/bookings`, `/availability`) keep their chrome and swap only their body for `<CalendarSurface role=…>`.

**Tech Stack:** React 18, TypeScript, Tailwind + shadcn, `@tanstack/react-query` v5, Vitest + jsdom + Testing Library, date-fns. Supabase for data (edge functions Deno). Design tokens in `src/index.css`.

**Spec:** `docs/superpowers/specs/2026-08-15-calendar-integrated-surface-design.md` — read it alongside this plan.

## Global Constraints

- **Semantic tokens only** in components: `bg-success/10`, `text-warning`, `border-border`, `text-primary`, etc. Never hardcode hex or `bg-white`/`text-black`. Accent numbered stops (`accent-500`…) do NOT take `/opacity` modifiers.
- **Week starts Monday everywhere.** Manual grids: leading pad `(monthStart.getDay()+6)%7`; weekday headers Mon–Sun.
- **Test-first (TDD).** Write the failing test, watch it fail, implement minimally, watch it pass, commit. Co-locate tests beside the file.
- **Tests import the real module.** Never re-implement production logic in a test.
- **Data-access pattern:** Supabase reads/writes are `fetchX(client, args)`/`mutateX(client, args)` in `src/data/<domain>.ts`; hooks are thin wrappers. Test with `src/test/supabaseFake.ts` — never `vi.mock` the client.
- **No `any`** (CI `--max-warnings 0`). Use explicit row interfaces + single `as unknown as` cast at the query boundary, confined to `src/data/**` / hook `queryFn`s.
- **i18n:** user-facing strings via `t('…')` in `bookings`/`availability` namespaces; EN canonical, DE key-for-key (`keyParity.test.ts`), informal "Du", **no em/en dashes** (`copyLint.test.ts`).
- **Query keys:** `['bookings', …]` for anything reading `bookings`; `['blocked-dates', …]` for `blocked_dates`; `['show-dates', …]` for `show_dates`. Mutations invalidate the whole domain prefix.
- **Call time is omitted** — never compute session − 90; show session times only.
- **Gating:** the whole surface is behind the `booking_flow` entitlement; action buttons additionally gated by `useCan(...)`.
- **Type-check three projects** before declaring done: `npx tsc -p tsconfig.app.json --noEmit`; `npx tsc -p tsconfig.tools.json --noEmit`; `deno check` for any edge function touched. Lint: `npm run lint`. Unit: `npx vitest run`.

---

## Parallelisation map

Tasks are grouped into waves. Within a wave, tasks are independent and can be built by concurrent subagents. A wave starts once its predecessor wave's produced interfaces exist.

```
WAVE A  (pure libs + data merges — no UI, fully parallel: 6 concurrent)
  T1 types.ts        T2 tone.ts        T3 period.ts
  T4 selection.ts    T5 producerData   T6 artistData
        │  (all export types/functions consumed downstream)
        ▼
WAVE B  (presentational kit — parallel: 3 concurrent, depend on A)
  T7 FillMeter       T8 MonthGrid       T9 shell:LensTabs+PeriodNavigator+Toolbar+Header
        ▼
WAVE C  (lenses + rail — parallel: 5 concurrent, depend on A+B)
  T10 DayRail        T11 producer MonthLens   T12 producer AgendaLens
  T13 artist OffersLens   T14 artist AllDatesLens
  (artist MonthLens = T11 reused with artist cells — built in T11)
        ▼
WAVE D  (integration — sequential, depend on C)
  T15 CalendarSurface orchestrator
  T16 wire ShowsBookingsPage (producer)      ← after T15
  T17 wire AvailabilityPage (artist) + refactor ArtistAvailabilityCalendar onto MonthGrid
  T18 custom-field relocation + deep links (?lens=) + i18n sweep
```

**Critical path:** A → B(T8) → C(T11) → D(T15→T16). Everything else fans out around it. A reviewer can accept/reject any single task without blocking its wave-mates.

Phases 2–5 (Needs-you queue + net-new backend, Week, Season, range-select/bulk) are **separate follow-on plans** (see "Roadmap" at the end); they build on this kit and are independently parallelisable.

---

## File structure (Phase 1)

```
src/lib/calendar/
  types.ts        # Tone, ToneSpec, ProducerDateEntry, ArtistDateEntry, ArtistStatus, MonthGridCell, MonthGridChip, MeterSegment
  tone.ts         # PRODUCER_TONES, ARTIST_TONES (label + token classes)
  period.ts       # periodWindow(), monthMatrix(), shiftPeriod(), periodLabel()
  selection.ts    # rangeReducer/toggleRange helpers for multi-date select
  producerData.ts # toProducerEntries(showDates, counts, slotsOf) → ProducerDateEntry[]; monthCellsProducer()
  artistData.ts   # toArtistEntries(eligible, statusMap, hireOrderMap) → ArtistDateEntry[]; monthCellsArtist()
  *.test.ts       # co-located
src/components/calendar/surface/
  FillMeter.tsx
  MonthGrid.tsx
  LensTabs.tsx  PeriodNavigator.tsx  CalendarToolbar.tsx  CalendarSurfaceHeader.tsx
  DayRail.tsx
  MonthLens.tsx  AgendaLens.tsx  OffersLens.tsx  AllDatesLens.tsx
  CalendarSurface.tsx
  *.test.tsx
src/pages/ShowsBookingsPage.tsx   # modify ProducerShowsBookings body
src/pages/AvailabilityPage.tsx    # modify ArtistAvailability body
src/components/availability/ArtistAvailabilityCalendar.tsx  # refactor onto MonthGrid (T17)
```

---

## WAVE A — pure libs + data merges

### Task 1: Shared calendar types

**Files:**
- Create: `src/lib/calendar/types.ts`
- Test: none (types only; consumed/compiled by later tasks)

**Interfaces — Produces:**
```ts
export type Tone = 'success' | 'warning' | 'muted' | 'destructive' | 'accent';
export interface ToneSpec { label: string; badgeClass: string; railClass: string; }

export type ProducerStatus = 'open' | 'partially_filled' | 'fully_filled' | 'cancelled' | 'unconfigured';
export interface ProducerDateEntry {
  id: string; date: Date;
  program: string; subProgram: string | null;
  venue: string | null; city: string | null;
  session1: string | null; session2: string | null; session3: string | null;
  status: ProducerStatus;
  mainSlots: number; confirmedMain: number; acceptedMain: number; pendingMain: number;
  understudySlots: number; confirmedUs: number;
  custom: Record<string, unknown> | null;
}

export type ArtistStatus = 'confirmed' | 'soft_booked' | 'suggested' | 'blocked' | 'unanswered';
export interface ArtistDateEntry {
  id: string; date: Date; bookingId: string | null;
  program: string; subProgram: string | null;
  venue: string | null; city: string | null;
  session1: string | null;
  myStatus: ArtistStatus;
  hireOrderId: string | null;
}

export interface MeterSegment { filled: boolean }
export interface MonthGridChip { title: string; time?: string; tone: Tone; meter?: MeterSegment[] }
export interface MonthGridCell {
  day: Date | null; dayNum: number | null;
  isToday: boolean; isPast: boolean; isSelected: boolean; inRange: boolean;
  flag?: { text: string; tone: Tone };
  chips: MonthGridChip[];
  moreCount: number;
}
```

- [ ] **Step 1: Create the file** with the interfaces above verbatim.
- [ ] **Step 2: Type-check** — Run: `npx tsc -p tsconfig.app.json --noEmit` → Expected: PASS (no consumers yet).
- [ ] **Step 3: Commit** — `git add src/lib/calendar/types.ts && git commit -m "feat(calendar): shared surface types"`

### Task 2: Tone maps

**Files:**
- Create: `src/lib/calendar/tone.ts`
- Test: `src/lib/calendar/tone.test.ts`

**Interfaces — Consumes:** `Tone`, `ToneSpec`, `ProducerStatus`, `ArtistStatus` from `types.ts`.
**Produces:** `PRODUCER_TONES: Record<ProducerStatus, ToneSpec>`, `ARTIST_TONES: Record<ArtistStatus, ToneSpec>`.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest';
import { PRODUCER_TONES, ARTIST_TONES } from './tone';

describe('calendar tones', () => {
  it('maps producer statuses to labels + semantic token classes', () => {
    expect(PRODUCER_TONES.fully_filled.label).toBe('Fully filled');
    expect(PRODUCER_TONES.partially_filled.label).toBe('Casting');
    expect(PRODUCER_TONES.fully_filled.badgeClass).toContain('success');
    expect(PRODUCER_TONES.cancelled.badgeClass).toContain('destructive');
    // no hardcoded hex
    Object.values(PRODUCER_TONES).forEach(t => expect(t.badgeClass).not.toMatch(/#|rgb/));
  });
  it('maps artist statuses, offer uses accent and hold uses warning', () => {
    expect(ARTIST_TONES.suggested.label).toBe('Offer');
    expect(ARTIST_TONES.soft_booked.label).toBe('Hold');
    expect(ARTIST_TONES.suggested.railClass).toContain('primary'); // accent/violet == primary token
    expect(ARTIST_TONES.confirmed.badgeClass).toContain('success');
  });
});
```
- [ ] **Step 2: Run test → FAIL** — Run: `npx vitest run src/lib/calendar/tone.test.ts` → Expected: FAIL (module not found).
- [ ] **Step 3: Implement**
```ts
import type { ToneSpec, ProducerStatus, ArtistStatus } from './types';

export const PRODUCER_TONES: Record<ProducerStatus, ToneSpec> = {
  fully_filled:     { label: 'Fully filled', badgeClass: 'bg-success/10 text-success',           railClass: 'bg-success' },
  partially_filled: { label: 'Casting',      badgeClass: 'bg-warning/10 text-warning',           railClass: 'bg-warning' },
  open:             { label: 'Open',         badgeClass: 'bg-muted text-muted-foreground',       railClass: 'bg-muted-foreground' },
  cancelled:        { label: 'Cancelled',    badgeClass: 'bg-destructive/10 text-destructive',   railClass: 'bg-destructive' },
  unconfigured:     { label: 'Unconfigured', badgeClass: 'bg-destructive/10 text-destructive',   railClass: 'bg-destructive' },
};

export const ARTIST_TONES: Record<ArtistStatus, ToneSpec> = {
  confirmed:   { label: 'Confirmed',   badgeClass: 'bg-success/10 text-success',         railClass: 'bg-success' },
  soft_booked: { label: 'Hold',        badgeClass: 'bg-warning/10 text-warning',         railClass: 'bg-warning' },
  suggested:   { label: 'Offer',       badgeClass: 'bg-primary/10 text-primary',         railClass: 'bg-primary' },
  blocked:     { label: 'Blocked',     badgeClass: 'bg-destructive/10 text-destructive', railClass: 'bg-destructive' },
  unanswered:  { label: 'Not offered', badgeClass: 'bg-muted text-muted-foreground',     railClass: 'bg-muted-foreground' },
};
```
> Labels here are English defaults; T18 replaces literal strings with `t(...)` keys. Keep them centralised so that swap is one file.
- [ ] **Step 4: Run test → PASS** — Run: `npx vitest run src/lib/calendar/tone.test.ts`.
- [ ] **Step 5: Commit** — `git add src/lib/calendar/tone.* && git commit -m "feat(calendar): unified status tone maps"`

### Task 3: Period window math

**Files:**
- Create: `src/lib/calendar/period.ts`
- Test: `src/lib/calendar/period.test.ts`

**Interfaces — Produces:**
```ts
export type LensPeriod = 'month' | 'week' | 'season';
export function periodWindow(anchor: Date, period: LensPeriod): { start: Date; end: Date };
export function monthMatrix(anchor: Date): (Date | null)[]; // 42 cells, Monday-first, null pads
export function shiftPeriod(anchor: Date, period: LensPeriod, dir: -1 | 1): Date;
export function periodLabel(anchor: Date, period: LensPeriod): string;
```

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from 'vitest';
import { monthMatrix, shiftPeriod, periodWindow } from './period';

describe('period', () => {
  it('monthMatrix is Monday-first with correct leading pad', () => {
    // Aug 2026: 1st is a Saturday → Monday-first leading pad = 5 nulls
    const cells = monthMatrix(new Date(2026, 7, 1));
    expect(cells.slice(0, 5).every(c => c === null)).toBe(true);
    expect(cells[5]).toEqual(new Date(2026, 7, 1));
    expect(cells.length % 7).toBe(0);
  });
  it('week window is Monday..Sunday containing the anchor', () => {
    const { start, end } = periodWindow(new Date(2026, 7, 14), 'week'); // Fri 14 Aug
    expect(start.getDay()).toBe(1); // Monday
    expect(end.getDay()).toBe(0);   // Sunday
    expect(start.getDate()).toBe(10);
  });
  it('shiftPeriod month moves by one calendar month', () => {
    const next = shiftPeriod(new Date(2026, 7, 14), 'month', 1);
    expect(next.getMonth()).toBe(8);
  });
});
```
- [ ] **Step 2: Run test → FAIL.**
- [ ] **Step 3: Implement** using `date-fns` (`startOfMonth`, `startOfWeek`/`endOfWeek` with `{ weekStartsOn: 1 }`, `addMonths`, `addWeeks`, `startOfQuarter`/season span per spec §4.4 — for `season`, window = anchor month start through +2 months end unless the org models a season explicitly; keep it a 3-month span for now, documented). `monthMatrix`: leading pad `(getDay(start)+6)%7` nulls, then each day, trailing pad to a multiple of 7.
- [ ] **Step 4: Run test → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): period window + month matrix (Monday-first)"`

### Task 4: Range selection helpers

**Files:**
- Create: `src/lib/calendar/selection.ts`
- Test: `src/lib/calendar/selection.test.ts`

**Interfaces — Produces:**
```ts
export interface RangeSelection { anchor: string; focus: string } // date keys yyyy-MM-dd, inclusive
export function selectedKeys(sel: RangeSelection | null): string[];
export function extendTo(sel: RangeSelection | null, key: string): RangeSelection;
export function clearSelection(): null;
```
> Phase 4 consumes these for the SelectionBar; building them now keeps MonthGrid's cell `inRange` computable and unit-tested early.

- [ ] **Step 1: Write the failing test** — assert `selectedKeys({anchor:'2026-08-18', focus:'2026-08-22'})` returns the 5 inclusive keys ascending regardless of anchor/focus order.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** with `parseDateOnly`/`toDateKey` from `src/lib/dates.ts`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): range selection helpers"`

### Task 5: Producer data merge

**Files:**
- Create: `src/lib/calendar/producerData.ts`
- Test: `src/lib/calendar/producerData.test.ts`

**Interfaces — Consumes:** `ProducerDateEntry`, `MonthGridCell` (types.ts); `DateBookingCounts` (`src/data/bookings.ts`); `showSlots` (`src/lib/settings.ts`); `parseDateOnly` (`src/lib/dates.ts`); `PRODUCER_TONES` (tone.ts).
**Produces:**
```ts
export function toProducerEntries(
  showDates: ShowDateRow[],                       // the ShowsBookingsPage row shape
  counts: Map<string, DateBookingCounts> | undefined,
): ProducerDateEntry[];
export function monthCellsProducer(
  entries: ProducerDateEntry[], anchor: Date, selectedKey: string, rangeKeys: string[], today: Date,
): MonthGridCell[];
```
Derivations: `status` = `displayStatus` logic (open with no slot config → 'unconfigured'); `confirmedMain`/etc from counts; `mainSlots` from `showSlots`. Cell flag: producer `−N` where N = `mainSlots − confirmedMain` (0 → no flag), tone `warning`. Chip: program title + `session1` + meter of `confirmedMain`/`mainSlots`.

- [ ] **Step 1: Write the failing test** — feed 2 fixture show-date rows + a counts Map; assert one entry is `partially_filled` with `mainSlots:6, confirmedMain:4`, and `monthCellsProducer` places its chip on the right matrix cell with `flag.text === '−2'` and a 6-segment meter (4 filled).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Reuse the `ShowDateRow`/`displayStatus`/`showSlots` shapes already in `ShowsBookingsPage.tsx` (extract the row type to `src/types` or import). No `any`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): producer date merge + month cells"`

### Task 6: Artist data merge

**Files:**
- Create: `src/lib/calendar/artistData.ts`
- Test: `src/lib/calendar/artistData.test.ts`

**Interfaces — Produces:**
```ts
export function toArtistEntries(
  eligible: EligibleDate[],                        // useArtistEligibleDates shape
  statusByDateId: Map<string, { bookingId: string; status: string }>,
  blockedKeys: Set<string>,
  hireOrderByDateId: Map<string, string>,
): ArtistDateEntry[];
export function monthCellsArtist(entries: ArtistDateEntry[], anchor: Date, selectedKey: string, today: Date): MonthGridCell[];
```
Derivations: `myStatus` from the booking status, else `blocked` if in `blockedKeys`, else `unanswered`. Artist cells carry **status-only** chips (no meter); flag `answer` (suggested, tone accent) / `blocked` (tone destructive).

- [ ] **Step 1: Write the failing test** — assert a suggested booking → `myStatus:'suggested'`, artist cell chip has `tone` matching `ARTIST_TONES.suggested` and **no** `meter`, and cell `flag.text === 'answer'`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): artist date merge + month cells"`

---

## WAVE B — presentational kit

### Task 7: FillMeter

**Files:**
- Create: `src/components/calendar/surface/FillMeter.tsx`
- Test: `src/components/calendar/surface/FillMeter.test.tsx`

**Interfaces — Consumes:** `MeterSegment`, `Tone`. **Produces:** `<FillMeter segments={MeterSegment[]} tone={Tone} label?={string} />`.

- [ ] **Step 1: Write the failing test** (RTL): render `segments` of 6 with 4 filled + `tone="warning"`; assert 6 segment nodes render and the filled count is reflected (e.g. via `data-filled` attribute) — avoid `getByRole({name})` inside `waitFor`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — a flex row of `<span>` bars; filled → `railClass` for the tone (via `PRODUCER_TONES`/passed class), empty → `bg-foreground/10`. Optional mono label. Tokens only.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): FillMeter"`

### Task 8: MonthGrid (shared, presentational)

**Files:**
- Create: `src/components/calendar/surface/MonthGrid.tsx`
- Test: `src/components/calendar/surface/MonthGrid.test.tsx`

**Interfaces — Consumes:** `MonthGridCell`, `FillMeter`. **Produces:**
```ts
<MonthGrid
  cells={MonthGridCell[]}
  onSelectDay={(day: Date) => void}
  onOpenDay={(day: Date) => void}   // Enter / click-through
  onRangeExtend?={(key: string) => void}
/>
```

- [ ] **Step 1: Write the failing test** — render a 42-cell fixture incl. one today cell, one selected cell with `inRange`, one with 2 chips + `moreCount:1`; assert Mon–Sun header order, the "+1 more" text renders, the today cell has its marker, and clicking a day fires `onSelectDay` with that Date.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — 7-col grid; weekday header Mon–Sun; per cell: day number (mono, tabular), optional flag, up to 2 chips (title + time + optional `<FillMeter>`), `+N more`; today rule, selected ring, `inRange` tint via tokens. Pull exact spacing/type from the canonical `Calendar Integrated.dc.html` month block. Keyboard: Space peek (defer peek to Phase 4 — for now Space = select), Enter = `onOpenDay`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): shared MonthGrid"`

### Task 9: Surface shell (LensTabs, PeriodNavigator, Toolbar, Header)

**Files:**
- Create: `src/components/calendar/surface/LensTabs.tsx`, `PeriodNavigator.tsx`, `CalendarToolbar.tsx`, `CalendarSurfaceHeader.tsx`
- Test: `LensTabs.test.tsx`, `PeriodNavigator.test.tsx`

**Interfaces — Produces:**
```ts
<LensTabs lenses={{key:string;label:string;count?:number}[]} active={string} onChange={(k)=>void} />
<PeriodNavigator label={string} onPrev={()=>void} onNext={()=>void} onToday={()=>void} />
<CalendarToolbar>{children /* chips + PeriodNavigator */}</CalendarToolbar>
<CalendarSurfaceHeader eyebrow={string} eyebrowTone={Tone} title={string} cta?={ReactNode}>{lensTabs}</CalendarSurfaceHeader>
```

- [ ] **Step 1: Write failing tests** — `LensTabs` renders the active tab with the selected style + optional count badge and fires `onChange`; `PeriodNavigator` fires `onPrev/onNext/onToday`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — segmented control styling from the design's header; tokens only.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): surface shell (tabs, navigator, toolbar, header)"`

---

## WAVE C — lenses + rail

### Task 10: DayRail

**Files:**
- Create: `src/components/calendar/surface/DayRail.tsx`
- Test: `src/components/calendar/surface/DayRail.test.tsx`

**Interfaces — Produces:**
```ts
<DayRail
  role={'producer'|'artist'}
  day={Date}
  producerEntries?={ProducerDateEntry[]}
  artistEntries?={ArtistDateEntry[]}
  stats={{label:string;value:string;dotClass:string}[]}
  legend={{label:string;badgeClass:string;railClass:string}[]}
  onPrimary?={()=>void} primaryLabel?={string}
  onSecondary?={()=>void} secondaryLabel?={string}
/>
```
Producer rail primary = Confirm holds (if `acceptedMain>0`) / Generate hire order (if fully filled); secondary = Open date. Artist rail primary = Accept offer (suggested) / Block date (unanswered); secondary = Message producer. Rail derives labels from the day's entries per spec §3.4/§4.

- [ ] **Step 1: Write failing test** — producer day with `acceptedMain:2` → primary label "Confirm holds" fires `onPrimary`; artist day with `myStatus:'suggested'` → primary "Accept offer". Stats + legend render.
- [ ] **Step 2–4:** FAIL → implement (day card with FillMeter for producer, status note for artist; stats card; legend card) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): DayRail"`

### Task 11: MonthLens (producer + artist)

**Files:**
- Create: `src/components/calendar/surface/MonthLens.tsx`
- Test: `src/components/calendar/surface/MonthLens.test.tsx`

**Interfaces — Consumes:** `MonthGrid`, `DayRail`, `monthCellsProducer`/`monthCellsArtist`, `period.ts`. **Produces:**
```ts
<MonthLens role anchor selectedDay onSelectDay onOpenDay
           producerEntries?={ProducerDateEntry[]} artistEntries?={ArtistDateEntry[]}
           rangeKeys?={string[]} onRangeExtend? />
```
Builds cells for the role, renders `<MonthGrid>` + (parent supplies the rail). Range wiring is inert until Phase 4 (accept `rangeKeys=[]`).

- [ ] **Step 1: Write failing test** — producer entries → grid shows the right chips/flags for the anchor month; clicking a day calls `onSelectDay`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): MonthLens (producer + artist)"`

### Task 12: Producer AgendaLens

**Files:**
- Create: `src/components/calendar/surface/AgendaLens.tsx`
- Test: `src/components/calendar/surface/AgendaLens.test.tsx`

**Interfaces — Produces:** `<AgendaLens entries={ProducerDateEntry[]} onOpenDay onAction={(entry, action)=>void} />`. Groups by ISO week (Monday); row = dow/date, session1, title, venue·city, FillMeter + `confirmedMain/mainSlots main`, status badge, contextual action (`fully_filled`→"Generate hire order", `partially_filled`→"Confirm holds", `open`→"Open casting").

- [ ] **Step 1: Write failing test** — 3 entries across 2 weeks → 2 week groups; a fully-filled row shows "Generate hire order" and fires `onAction(entry,'generate')`.
- [ ] **Step 2–4:** FAIL → implement (week grouping via `(getDay+6)%7`) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): producer AgendaLens"`

### Task 13: Artist OffersLens

**Files:**
- Create: `src/components/calendar/surface/OffersLens.tsx`
- Test: `src/components/calendar/surface/OffersLens.test.tsx`

**Interfaces — Produces:**
```ts
<OffersLens
  entries={ArtistDateEntry[]}
  onAccept={(bookingId)=>void} onDecline={(bookingId)=>void} onBlock={(dateId,date)=>void}
  answeredToday={{date:string;title:string;venue:string;label:string;badgeClass:string}[]}
  notOfferedYet={ArtistDateEntry[]}
/>
```
Queue cards for `suggested` + upcoming `soft_booked`; live offers get Accept/Decline/Block; holds show a Hold chip. Progress bar (answered / (answered+offers)). "Answered today" (with Undo — inert stub for now) + "Later this month · not offered yet" with Block buttons.

- [ ] **Step 1: Write failing test** — one suggested + one soft_booked entry → 2 cards; Accept on the offer fires `onAccept(bookingId)`; progress renders.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): artist OffersLens"`

### Task 14: Artist AllDatesLens

**Files:**
- Create: `src/components/calendar/surface/AllDatesLens.tsx`
- Test: `src/components/calendar/surface/AllDatesLens.test.tsx`

**Interfaces — Produces:** `<AllDatesLens entries={ArtistDateEntry[]} onBlock={(dateId,date)=>void} hireOrderHref={(id:string)=>string} />`. Columns: Date · Day · Show·venue · **Session** (not "Call") · My status · action. Confirmed + `hireOrderId` → hire-order link; future unanswered → Block button.

- [ ] **Step 1: Write failing test** — a confirmed entry with `hireOrderId` renders a link to the hire order; an unanswered future entry renders "Block date" and fires `onBlock`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): artist AllDatesLens"`

---

## WAVE D — integration

### Task 15: CalendarSurface orchestrator

**Files:**
- Create: `src/components/calendar/surface/CalendarSurface.tsx`
- Test: `src/components/calendar/surface/CalendarSurface.test.tsx`

**Interfaces — Consumes:** every Wave C lens + shell + data merges + hooks. **Produces:**
```ts
<CalendarSurface
  role={'producer'|'artist'}
  producerEntries?={ProducerDateEntry[]} artistEntries?={ArtistDateEntry[]}
  actions={{ confirmHolds; generateHireOrder; openDate; openCasting;   // producer
             accept; decline; block; }}                                 // artist
  lens={string} onLensChange={(k)=>void}                                // controlled via ?lens=
/>
```
Owns `{ anchor, selectedDay }`. Producer lenses (Phase 1 subset): Month, Agenda. Artist lenses: Offers, Month, All dates. Renders header + toolbar + active lens + rail (Month → DayRail; Agenda/All dates → full width; Offers → inline). Wires lens callbacks to `actions`.

- [ ] **Step 1: Write failing test** — mount with `role="producer"`, `lens="month"`, producer entries → renders LensTabs (Month/Agenda), the month grid, and the DayRail; switching to Agenda calls `onLensChange('agenda')` and renders the agenda list.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): CalendarSurface orchestrator"`

### Task 16: Wire ProducerShowsBookings

**Files:**
- Modify: `src/pages/ShowsBookingsPage.tsx` (the `ProducerShowsBookings` body)
- Test: extend/replace relevant page test if present; otherwise add `src/pages/ShowsBookingsPage.calendar.test.tsx`

**Interfaces — Consumes:** `CalendarSurface`, `toProducerEntries`, existing reads (`fetchShowDatesList`, `fetchBookingCountsByDate`), existing mutations (`bulkConfirmSoftBooked`+`fetchSoftBookedIdsForDate`, `useHireOrderAction`), `openShowDate`.

- [ ] **Step 1: Write failing test** — render `ProducerShowsBookings` with a fake client returning 2 show dates + counts; assert the calendar surface renders (Month lens) and the old `ViewToggle` list/calendar is gone.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — replace the `view === 'list' ? <Table…> : <EntityCalendar…>` block (and its `ViewToggle`, `ColumnLayoutEditor`, `EntityCalendar` import) with `<CalendarSurface role="producer" producerEntries={toProducerEntries(showDates, bookingCounts)} lens={lens} onLensChange={setLens} actions={{ confirmHolds: confirmPeek-equivalent, generateHireOrder: draftHireOrderForDate, openDate: openShowDate, openCasting: openShowDate }} />`. Keep: title, setup rail, `PageMini`, hire-order banner, "New date", dialogs, `ShowDateDetailSheet`, realtime channel, `?status=` handling (mapped to a chip). Preserve the search/status/program/timeframe state as toolbar chips (full chip UI can land in T18; keep them functional here).
- [ ] **Step 4: Run tests + typecheck + lint** — `npx vitest run src/pages/ShowsBookingsPage*`, `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`.
- [ ] **Step 5: Commit** — `git commit -am "feat(bookings): replace producer table with calendar surface"`

### Task 17: Wire ArtistAvailability + refactor ArtistAvailabilityCalendar

**Files:**
- Modify: `src/pages/AvailabilityPage.tsx` (the `ArtistAvailability` body)
- Modify: `src/components/availability/ArtistAvailabilityCalendar.tsx` → build `MonthGridCell[]` and render `<MonthGrid>` (or delete in favour of `MonthLens role="artist"`)
- Test: `src/pages/AvailabilityPage.calendar.test.tsx`

**Interfaces — Consumes:** `CalendarSurface` (role artist), `toArtistEntries`, `useArtistEligibleDates`, the artist-offers status query, `respondToOffer`, `AvailabilityPicker`/`blocked_dates` insert, `useMyHireOrders`.

- [ ] **Step 1: Write failing test** — render `ArtistAvailability` with a fake client (linked artist + one suggested offer); assert the Offers lens renders the offer card and Accept calls the offer-response path; the old list `ViewToggle`/`ColumnLayoutEditor` is gone.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — replace the list/calendar body with `<CalendarSurface role="artist" artistEntries={toArtistEntries(...)} actions={{ accept, decline, block }} lens onLensChange />`. Keep the Blocked-dates management card (move under the Month lens rail or keep below the surface). Refactor `ArtistAvailabilityCalendar` onto `MonthGrid` so there's one grid; keep `UnlinkedArtistCard` fallback. Preserve `?filter=unanswered` deep-link (maps to the Offers lens / an "unanswered" chip).
- [ ] **Step 4: Run tests + typecheck + lint.**
- [ ] **Step 5: Commit** — `git commit -am "feat(availability): calendar surface + MonthGrid refactor"`

### Task 18: Custom-field relocation, deep links, i18n sweep

**Files:**
- Modify: `src/components/shows/ShowDateDetailSheet.tsx` (read-only custom fields section, if not already surfaced) or its rail
- Modify: `CalendarToolbar` usage on both pages — filterable custom fields as "Add filter" chips (reuse `CustomFieldFilter`, `customFilterMatches`)
- Modify: both pages for `?lens=` param; `src/i18n/locales/{en,de}/{bookings,availability}.json`
- Test: `src/i18n/keyParity.test.ts` (already runs), a chip-filter unit test

- [ ] **Step 1: Write failing tests** — (a) `?lens=agenda` selects the Agenda lens on load; (b) a filterable custom field renders as a chip and filters producer entries; (c) key-parity passes with the new keys.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — surface custom-field values read-only in the detail sheet; add custom-field filter chips to the toolbar; wire `?lens=` (read on mount, write on change) alongside existing `?status=`/`?filter=`; replace literal tone labels + surface copy with `t(...)` keys in both namespaces (EN + DE, informal Du, no dashes). Update each page's `PageMini` if the module explanation changed, or note "no change" in the PR. Assess help-center impact (`src/lib/help/items.ts`) and update or state "no impact".
- [ ] **Step 4: Run** — `npx vitest run`, `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.tools.json --noEmit`, `npm run lint`.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): custom-field chips, ?lens= deep link, i18n"`

---

## Phase 1 exit criteria
- `/bookings` (producer) and `/availability` (artist) render the calendar surface; the old table/list + `ViewToggle` + `ColumnLayoutEditor` are gone from these pages.
- Producer: Month + Agenda lenses; Confirm holds, Generate hire order, Open date wired. Artist: Offers + Month + All dates; Accept/Decline/Block wired.
- Custom Airtable fields visible in the detail sheet + filterable via chips.
- Deep links `?status=`, `?filter=unanswered`, `?lens=` all work; realtime intact; `booking_flow`/capability gates intact.
- All three tsc projects + lint + `vitest run` green.

---

## Roadmap — follow-on plans (own docs when reached)

Each is its own plan built on this kit; all internally parallelisable.

- **Phase 2 — Needs-you queue + net-new backend.** `NeedsYouLens` + `QueueRail`; new reads (per-date bookings-with-artist rows; eligible-artists-per-date shortlist); net-new mutations `extendOfferExpiry` (bump `offer_expires_at`, +tests incl. pgTAP) and Notify-cast (verify cancellation doesn't already notify first). Wire Confirm-all / Generate-N bulk. Make Needs-you the producer default lens.
- **Phase 3 — Week + Season.** `WeekLens` (time band from data extent, fixed-height blocks, multi-session stacking) and `SeasonLens` (program×day heatmap + load bars + KPI cards); add both to the producer lens set.
- **Phase 4 — Range selection + bulk bar.** Activate `useRangeSelection` in Month/Season; `SelectionBar` with bulk Confirm holds / Generate hire orders (loops existing per-date mutations). Add Space-peek (`RowPeek` reuse) to MonthGrid.
- **Phase 5 — Mobile.** The 5 screens from `Calendar Mobile.dc.html` (separate spec already noted).

---

## Self-review notes
- Spec coverage: Phase 1 covers spec §3 (kit, routes, MonthGrid), §4.2/§4.5/§4.6/§4.7/§4.8 (Month, Agenda, Offers, artist Month, All dates), §5 reads + existing actions, §6 tones, §7 removals, §8 i18n, §9 testing. Spec §4.1 (Needs you), §4.3 (Week), §4.4 (Season), §5.3 net-new backend, range/bulk → Phases 2–4 (roadmapped, own plans). No Phase-1 spec requirement is unassigned.
- Type consistency: `ProducerDateEntry`/`ArtistDateEntry`/`MonthGridCell` defined once in T1 and consumed by T5/T6/T8/T11/T15 with the same names.
- Placeholder scan: component styling deferred to "the canonical `.dc.html`" is a concrete instruction (the file is the pixel spec), not a TODO.
