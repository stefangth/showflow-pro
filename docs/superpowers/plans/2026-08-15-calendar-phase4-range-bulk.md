# Calendar Phase 4 — Range selection + bulk-action bar (+ Space-peek)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a producer drag/shift-click a **range of dates** in the Month (and Season) lens and act on them in bulk via a fixed-bottom **SelectionBar** — bulk **Confirm holds** and **Generate hire orders** — looping the existing per-date mutations. Also activate the deferred **Space-peek** in `MonthGrid` (reusing the existing `RowPeek`).

**Architecture:** The pure `src/lib/calendar/selection.ts` is already built and unit-tested; the `inRange`/`onRangeExtend`/`rangeKeys` plumbing is already threaded through `MonthGridCell` → `MonthGrid` → `MonthLens` → `monthCellsProducer`. The work is: (1) add drag + shift-click handlers to `MonthGrid` and a `RangeSelection` state to `CalendarSurface`, feeding `rangeKeys` down; (2) a net-new presentational `SelectionBar`; (3) map selected date-keys → producer entry ids and loop the existing `confirmHolds`/`generateHireOrder` callbacks; (4) re-point `MonthGrid`'s Space key from select to a `RowPeek` popover. No backend, no schema.

**Tech Stack:** React 18, TypeScript, Tailwind + shadcn (`Popover`), Vitest + jsdom + Testing Library. Design tokens in `src/index.css`.

**Spec:** `docs/superpowers/specs/2026-08-15-calendar-integrated-surface-design.md` (§3.2 SelectionBar, §4.2 Month range-select, §4.4 Season range-select) — read alongside this plan.

**Builds on:** Phase 1 (merged). **Soft dependency on Phase 3** for the Season range-select (Task 6); Month range-select (Tasks 1–5) is independent of Phase 3. If Phase 3 hasn't shipped, skip Task 6 and enable range-select on Month only.

## Global Constraints

- **Semantic tokens only.** Range highlight uses `bg-accent-50` (already used by `MonthGrid` for `inRange`); accent numbered stops take **no** `/opacity`.
- **Week starts Monday everywhere.**
- **Test-first (TDD).** Failing test → fail → minimal impl → pass → commit. Co-located tests; plain `render` from `@testing-library/react` with inline fixtures (kit convention).
- **Tests import the real module.** Reuse `selectedKeys`/`extendTo`/`clearSelection` from `selection.ts` — never re-implement selection math in a test or component.
- **No `any`** (CI `--max-warnings 0`).
- **i18n:** SelectionBar + peek copy via `t('bookings:…')`; EN + DE key-for-key, informal "Du", no dashes.
- **Idempotent, gated bulk:** bulk actions loop the SAME per-date callbacks the page already gate-checks (`useCan('confirm_bookings')` / `useCan('generate_hire_orders')`) and invalidate `['bookings']` / `['hire-orders']`. Never bypass the gates in the loop.
- **Type-check** `tsconfig.app.json` + `tsconfig.tools.json`; lint; `npx vitest run`.

---

## Facts (locked from research)

- `src/lib/calendar/selection.ts` (built + tested): `RangeSelection {anchor, focus}` (yyyy-MM-dd keys), `selectedKeys(sel)` (inclusive ascending, `[]` for null), `extendTo(sel, key)`, `clearSelection() → null`. **Nothing imports it yet.**
- `MonthGridCell` already carries `inRange` + `isSelected`. `MonthGrid` already: accepts `onRangeExtend?`, calls it on select, renders `data-in-range` + `cell.inRange && 'bg-accent-50'`, and routes **Space → select** with a comment `// peek is deferred to Phase 4`. `MonthLens` forwards `rangeKeys?`/`onRangeExtend?` (producer path passes `rangeKeys` to `monthCellsProducer`; artist path does not). `monthCellsProducer` builds `rangeSet` + sets `inRange`. **Gap:** `CalendarSurface` never passes `rangeKeys`/`onRangeExtend` and owns no `RangeSelection` state; `MonthGrid` has no drag (mousedown/enter/up) or shift-click logic — only plain-click fires `onRangeExtend`.
- Per-date mutation helpers already exist on the page: `confirmHoldsForDate(id)` (`fetchSoftBookedIdsForDate` → `bulkConfirmSoftBooked` → toast → invalidate) and `draftHireOrderForDate(id)` (`hireOrderAction.mutate({action:'draft', ...})`), both gate-checked via `confirmHolds`/`generateHireOrder`. Capability keys: `useCan('confirm_bookings')`, `useCan('generate_hire_orders')`.
- `RowPeek` (`src/components/bookings/RowPeek.tsx`) — a self-contained 320px card: `{ dateLabel, peek: DatePeek|null, canConfirm, confirming, onConfirm, onOpen }`. `DatePeek` built by the pure `computeDatePeek({counts, slots, t})` in `src/lib/bookingCockpit.ts`. Currently imported only by `DevCockpitHarness`. Reusable inside a shadcn `Popover`; 320px is fine in a popover.
- No existing bulk-bar. Fixed-bottom styling precedent: `src/components/consent/CookieConsentBanner.tsx` (`fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background …` + inner `mx-auto flex max-w-5xl …`). Selection idiom across the app: `Set<string>`.
- shadcn `Popover` primitive: `src/components/ui/popover.tsx` (confirm it exists; the app uses Radix popovers elsewhere).

---

## File structure (Phase 4)

```
src/lib/calendar/selection.ts                 # (built) + maybe a keysToEntryIds helper
src/components/calendar/surface/
  MonthGrid.tsx      MonthGrid.test.tsx        # drag + shift-click handlers; Space → peek
  MonthLens.tsx      MonthLens.test.tsx        # accept onCellPeek; forward rangeKeys already present
  SelectionBar.tsx   SelectionBar.test.tsx     # (new) fixed-bottom bulk bar
  CalendarSurface.tsx  CalendarSurface.test.tsx# RangeSelection state; wire SelectionBar + peek
src/pages/ShowsBookingsPage.tsx               # bulk callbacks (loop existing per-date fns)
src/i18n/locales/{en,de}/bookings.json
```

---

## WAVE A — grid interaction (sequential within MonthGrid, then SelectionBar in parallel)

### Task 1: MonthGrid drag + shift-click range selection

**Files:**
- Modify: `src/components/calendar/surface/MonthGrid.tsx`
- Test: `src/components/calendar/surface/MonthGrid.test.tsx`

**Interfaces — Produces (added to `MonthGridProps`):**
```ts
onRangeStart?: (key: string) => void;    // mousedown / shift-click anchor
onRangeExtend?: (key: string) => void;   // (existing) mouseenter-during-drag / shift-click focus
onRangeCommit?: () => void;              // mouseup — end drag
rangeActive?: boolean;                   // true while a selection exists (enables drag visuals)
```

- [ ] **Step 1: Write the failing test** — render a grid; `mouseDown` on cell A fires `onRangeStart(keyA)`, `mouseEnter` on cell C (while down) fires `onRangeExtend(keyC)`, `mouseUp` fires `onRangeCommit`; a `shift+click` on cell E (with an existing anchor) fires `onRangeExtend(keyE)` without starting a new drag. Plain click still fires `onSelectDay`. Use existing `data-testid="month-grid-cell-<yyyy-MM-dd>"`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — add a local `dragging` ref. `onMouseDown(cell)`: if `e.shiftKey` → `onRangeExtend(key)` (extend from current anchor); else `onRangeStart(key)` + set `dragging=true`. `onMouseEnter(cell)`: if `dragging` → `onRangeExtend(key)`. `window`/grid `onMouseUp`: if `dragging` → `onRangeCommit()` + `dragging=false`. Preserve plain click → `onSelectDay` (a click with no drag movement). Keep `inRange` rendering. Do not break keyboard.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): MonthGrid drag + shift-click range selection"`

### Task 2: MonthGrid Space-peek (RowPeek in a Popover)

**Files:**
- Modify: `src/components/calendar/surface/MonthGrid.tsx`, `MonthLens.tsx`
- Test: `MonthGrid.test.tsx`, `MonthLens.test.tsx`

**Interfaces — Produces:** add `onPeekDay?: (day: Date) => void` to `MonthGrid` + `MonthLens`; MonthGrid re-points **Space** to `onPeekDay` (falls back to `onSelectDay` when `onPeekDay` is absent).

- [ ] **Step 1: Write the failing test** — pressing Space on a focused cell fires `onPeekDay(day)` (not `onSelectDay`); with no `onPeekDay`, Space still selects.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — in the keydown handler, `case ' '`/`'Spacebar'`: `e.preventDefault(); (onPeekDay ?? onSelectDay)(cell.day)`. Forward `onPeekDay` through `MonthLens`. (The actual `RowPeek` popover is mounted by `CalendarSurface` in Task 5 — this task only routes the intent.)
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): route MonthGrid Space to peek"`

### Task 3: SelectionBar

**Files:**
- Create: `src/components/calendar/surface/SelectionBar.tsx`, `SelectionBar.test.tsx`

**Interfaces — Produces:**
```ts
interface SelectionBarAction { key: string; label: string; disabled?: boolean; title?: string }
interface SelectionBarProps {
  count: number;                       // selected date count (only counts keys that map to real dates)
  actions: SelectionBarAction[];       // e.g. Confirm holds, Generate hire orders
  onAction: (key: string) => void;
  onClear: () => void;
  className?: string;
}
```
Fixed-bottom bar (CookieConsentBanner token styling: `fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background shadow-elev3 px-4 py-3` + inner `mx-auto flex max-w-5xl items-center justify-between gap-3`). Left: "`{count}` selected" + Clear. Right: one button per action (disabled/title from gates). Renders nothing when `count === 0`.

- [ ] **Step 1: Write the failing test** — `count=3` + 2 actions → shows "3 selected", both buttons; clicking Confirm fires `onAction('confirm')`, Clear fires `onClear`; `count=0` renders nothing. `data-testid="selection-bar"`, `selection-bar-action-<key>`.
- [ ] **Step 2–4:** FAIL → implement (tokens only; disabled button carries `title`) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): SelectionBar (fixed-bottom bulk bar)"`

---

## WAVE B — orchestration (sequential)

### Task 4: CalendarSurface — RangeSelection state + feed rangeKeys

**Files:**
- Modify: `src/components/calendar/surface/CalendarSurface.tsx`
- Test: `CalendarSurface.test.tsx`

**Interfaces — Produces (added to `CalendarSurfaceProps` / actions):**
```ts
// props
onBulkConfirm?: (dateIds: string[]) => void;
onBulkGenerate?: (dateIds: string[]) => void;
bulkGates?: { confirm?: ActionGate; generate?: ActionGate };
// internal state: const [range, setRange] = useState<RangeSelection | null>(null);
```

- [ ] **Step 1: Write the failing test** — mount `role="producer"`, `lens="month"`; simulate a drag across 3 dates (fire the MonthGrid range callbacks) → cells show `inRange` and a `SelectionBar` appears reading "3 selected"; clicking its Confirm fires `onBulkConfirm` with the 3 date ids that map to real producer entries (keys with no entry are excluded); Clear hides the bar.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — add `range` state; pass `rangeKeys={selectedKeys(range)}` + `onRangeStart={k=>setRange({anchor:k,focus:k})}` + `onRangeExtend={k=>setRange(r=>extendTo(r,k))}` + `onRangeCommit={()=>{}}` down through `MonthLens`→`MonthGrid`. Map selected keys → entry ids via a `Map<dateKey, entryId>` built from `producerEntries` (`toDateKey(entry.date)`), dropping keys with no entry → `selectedDateIds`. Render `<SelectionBar count={selectedDateIds.length} actions={[confirm, generate]} onAction={k => k==='confirm' ? onBulkConfirm?.(selectedDateIds) : onBulkGenerate?.(selectedDateIds)} onClear={()=>setRange(clearSelection())} />` for producer month (and season when Phase 3 present — Task 6). Gate action buttons via `bulkGates`. Clear the range on lens change.
- [ ] **Step 4: Run → PASS** + `npx tsc -p tsconfig.app.json --noEmit`.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): range-selection state + SelectionBar wiring"`

### Task 5: CalendarSurface — mount the peek popover

**Files:**
- Modify: `src/components/calendar/surface/CalendarSurface.tsx`
- Test: `CalendarSurface.test.tsx`

**Interfaces — Consumes:** `RowPeek`, `computeDatePeek`, producer entry counts. **Produces:** a `peekDay` state + a popover.

- [ ] **Step 1: Write the failing test** — `onPeekDay` for a producer date opens a `RowPeek` with the date's headline/meter; its "Confirm" fires `actions.confirmHolds(dateId)` and "Open date" fires `actions.openDate(dateId)`. (Artist peek is out of scope; guard `role==='producer'`.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — add `peekDay: Date | null` state set by `onPeekDay`. When set (producer), find that day's `ProducerDateEntry`, build `peek = computeDatePeek({ counts: {confirmedMain, acceptedMain, pendingMain, mainSlots, …}, slots, t })` (adapt the entry to `computeDatePeek`'s input shape — it wants `counts` + `slots`; the entry already carries them), render `<Popover open>` anchored near the grid (a simple positioned `RowPeek` is acceptable; the design's peek is a hover/keyboard card). Wire `onConfirm → actions.confirmHolds`, `onOpen → actions.openDate`, close on escape/blur. Reuse `RowPeek` verbatim.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): Space-peek popover (RowPeek reuse)"`

### Task 6 (optional — requires Phase 3): Season range-select across day columns

**Files:**
- Modify: `src/components/calendar/surface/SeasonLens.tsx` (Phase 3), `CalendarSurface.tsx`
- Test: `SeasonLens.test.tsx`

- [ ] **Step 1: Write the failing test** — drag across 3 Season day columns → those columns highlight and the SelectionBar reads the count of dates in the selected column span.
- [ ] **Step 2–4:** FAIL → implement — SeasonLens accepts `rangeKeys`/`onRangeStart`/`onRangeExtend`/`onRangeCommit` (day-column drag), tints `inRange` columns, and `CalendarSurface` feeds the same `range` state (selection is by day-key, shared with Month). `selectedDateIds` derives from entries whose date-key is in `selectedKeys(range)`. → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): Season range-select across day columns"`
- [ ] **If Phase 3 not yet merged:** skip this task; note "Season range-select deferred until Phase 3" in the PR.

### Task 7: Wire ShowsBookingsPage bulk callbacks + i18n

**Files:**
- Modify: `src/pages/ShowsBookingsPage.tsx`, `src/i18n/locales/{en,de}/bookings.json`
- Test: `src/pages/ShowsBookingsPage.calendar.test.tsx`, `keyParity.test.ts`

- [ ] **Step 1: Write the failing test** — with 2 selectable dates, invoking the surface's bulk Confirm calls the confirm path for each date id; bulk Generate calls draft for each.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — pass `onBulkConfirm={(ids) => ids.forEach((id) => confirmHolds(id))}` and `onBulkGenerate={(ids) => ids.forEach((id) => generateHireOrder(id))}` (the existing gate-checked per-date callbacks — do NOT re-implement the mutations; the loop reuses them). Pass `bulkGates` mirroring the page's `actionGates`. Add SelectionBar + peek copy to `bookings.json` EN + DE (informal "Du", no dashes). Assess `PageMini`/help; state in PR.
- [ ] **Step 4: Run** — `npx vitest run`, `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.tools.json --noEmit`, `npm run lint`.
- [ ] **Step 5: Commit** — `git commit -am "feat(bookings): bulk confirm/generate over selected dates + i18n"`

---

## Phase 4 exit criteria
- Producer can drag or shift-click a date range in Month (and Season, if Phase 3 present); selected cells highlight; a fixed-bottom SelectionBar shows the count + Clear + bulk **Confirm holds** / **Generate hire orders**.
- Bulk actions loop the existing gate-checked per-date mutations (no bypass), invalidate the right domains, and respect `useCan` capability gates.
- Space on a focused Month cell opens a `RowPeek` popover (Confirm / Open date) reusing the existing component.
- All three tsc projects + lint + `vitest run` green; i18n key-parity green.

## Open risks / verify during build
- **Drag vs click disambiguation:** a mousedown-then-mouseup on the same cell with no `mouseenter` on another cell must still register as a plain click (`onSelectDay`), not a 1-cell range. Encode a "moved" flag in Task 1 and test both paths.
- **Artist range-select:** out of scope (the spec limits range-select to producer Month/Season). `monthCellsArtist` gets no `rangeKeys` — leave it as-is.
- **Peek input adaptation:** `computeDatePeek` expects `{counts, slots, t}`; confirm the exact shape in `src/lib/bookingCockpit.ts` and adapt the `ProducerDateEntry` fields to it in Task 5 rather than changing `computeDatePeek`.
- **`Popover` availability:** verify `src/components/ui/popover.tsx` exists; if the app only has `HoverCard`, use that instead (Space-peek is keyboard-driven, so `Popover` with controlled `open` is the better fit).

## Self-review notes
- Spec coverage: §3.2 SelectionBar → Task 3; §4.2 Month range-select → Tasks 1/4; §4.4 Season range-select → Task 6; Space-peek (Phase-1 deferral) → Tasks 2/5. Bulk actions reuse existing mutations → Task 7.
- Type consistency: `RangeSelection`/`selectedKeys`/`extendTo`/`clearSelection` consumed from `selection.ts` unchanged; the new MonthGrid range props (Task 1) are consumed by CalendarSurface (Task 4); `SelectionBarProps` (Task 3) consumed by Task 4.
- Placeholder scan: the peek-input adaptation and `Popover`-vs-`HoverCard` choice are concrete verify-then-pick instructions, not TODOs.
