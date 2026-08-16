# Calendar Phase 5 — Mobile

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a touch-first mobile presentation layer to the calendar surface below 768px — a scrollable lens-chip row, single-column lens bodies, the desktop day rail replaced by a **bottom sheet**, and a producer **"New date" FAB** — over the **same** data and mutations built in Phases 1–3. No new data, no new actions.

**Architecture:** `CalendarSurface` gains one `const isMobile = useIsMobile()` branch; desktop (≥768px) is untouched and the two consuming pages pass identical props. Reused lens components reflow to a single column via responsive classes; three net-new touch primitives (`CalendarDaySheet` over the unused `vaul` Drawer, `SurfaceFab`, `SeasonStripMobile`) and one extracted shared unit (`DayDetail`, factored out of `DayRail`) supply what CSS can't.

**Tech Stack:** React 18, TypeScript, Tailwind + shadcn (`vaul` Drawer), `@tanstack/react-query` v5, Vitest + jsdom + Testing Library, Playwright (mobile viewport). Design tokens in `src/index.css`.

**Spec:** `docs/superpowers/specs/2026-08-15-calendar-mobile-design.md` — read it alongside this plan. Mock (pixel/copy source): Claude Design project `5ccc0a34-2037-4752-ae2b-74fa8cea5566`, file `Calendar Mobile.dc.html` (re-pull via DesignSync `get_file` for exact values).

**Builds on:** Phase 1 (merged PR #294), **Phase 2** (Needs-you lens), **Phase 3** (Season lens). The Phase-1 lenses reflow independently; the Needs-you and Season mobile slices require Phases 2/3 to be present first.

## Global Constraints

- **Semantic tokens only.** Map the mock's hex (violet `#6E5CF6`, status colors) to DS tokens (`bg-primary`, `text-success`, …) exactly as the desktop surface does. Accent numbered stops take no `/opacity`.
- **Breakpoint = `useIsMobile()` (<768px)** — `src/hooks/use-mobile.tsx`, `MOBILE_BREAKPOINT = 768`. Do NOT introduce a second breakpoint. Tablets (768–1024) keep the desktop surface.
- **Omit call time.** Mobile shows session times only — drop the mock's "call" line and "Call" fact tile.
- **Desktop is untouched.** Every reused component keeps its desktop render identical; mobile behavior is added behind `isMobile` / responsive classes, never by changing desktop markup. Phase-1/2/3 component tests must stay green.
- **No data/mutation/RLS/edge changes.** Mobile is presentation only; it consumes the same `CalendarSurface` props the pages already pass.
- **Test-first (TDD).** Failing test → fail → minimal impl → pass → commit. Co-located tests; plain `render` from `@testing-library/react` with inline fixtures (kit convention). Mock the breakpoint with `vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }))` (or the hook's real export name) per test file.
- **No `any`** (CI `--max-warnings 0`).
- **i18n:** reuse existing `bookings`/`availability` keys; any genuinely new mobile-only copy via `t(...)`, EN + DE key-for-key, informal "Du", no dashes.
- **Type-check** `tsconfig.app.json` + `tsconfig.tools.json`; lint; `npx vitest run`; Playwright for the smoke flow.

---

## Facts (locked from research)

- `src/hooks/use-mobile.tsx` exports `useIsMobile(): boolean` (matchMedia `max-width:767px`); `MOBILE_BREAKPOINT = 768` is module-private. Consumers today: `ui/sidebar.tsx`, `SettingsPage.tsx` (not the calendar).
- `src/components/ui/drawer.tsx` = the `vaul` bottom sheet (content `fixed inset-x-0 bottom-0 rounded-t-[10px] …`, drag handle), **zero consumers** — this is the `CalendarDaySheet` vehicle. `sheet.tsx` supports `side="bottom"` but the vaul Drawer is the chosen bottom-sheet (decision 5).
- The surface is **desktop-fixed** (no responsive classes; hardcoded widths). `CalendarSurface` Month layout is `flex items-start gap-4` + `DayRail w-[280px] shrink-0` (overflows <768). `MonthGrid` = `grid grid-cols-7 min-h-[104px]`. `DayRail` internally fluid, pinned to 280px by parent.
- `DayRail` (`src/components/calendar/surface/DayRail.tsx`) already takes `producerEntries?`/`artistEntries?` + `onPrimary/primaryLabel/onSecondary/secondaryLabel` + `stats`/`legend`; producer primary label/gate resolved via `resolveProducerPrimary`. The date-card + action portion is what `DayDetail` extracts; stats + legend cards stay in `DayRail`.
- `LensTabs` renders any `LensTabDef[]`; no scroll variant yet. No FAB exists anywhere. AppLayout provides the mobile hamburger drawer (`lg:hidden`) — **do not** add a bottom nav.
- `SeasonLens` + `toSeasonModel`/`seasonKpis` come from Phase 3. `NeedsYouLens` from Phase 2.

---

## File structure (Phase 5)

```
src/components/calendar/surface/
  LensTabs.tsx        LensTabs.test.tsx        # +scrollable variant
  DayDetail.tsx       DayDetail.test.tsx       # NEW (extracted from DayRail)
  DayRail.tsx         DayRail.test.tsx         # render <DayDetail/> + stats + legend (identical output)
  CalendarDaySheet.tsx CalendarDaySheet.test.tsx  # NEW (vaul Drawer)
  SurfaceFab.tsx      SurfaceFab.test.tsx      # NEW
  SeasonStripMobile.tsx SeasonStripMobile.test.tsx # NEW
  MonthGrid.tsx       MonthGrid.test.tsx       # +dense (mobile) variant
  CalendarSurface.tsx CalendarSurface.test.tsx # isMobile branch (shell + day-tap→sheet + FAB + reflows)
e2e/
  calendar-mobile.spec.ts                      # Playwright mobile smoke (both roles)
src/i18n/locales/{en,de}/{bookings,availability}.json  # only if new mobile copy
```

---

## WAVE A — leaf primitives (parallel: 5 concurrent)

### Task 1: LensTabs scrollable variant

**Files:** Modify `src/components/calendar/surface/LensTabs.tsx`; test `LensTabs.test.tsx`.
**Produces:** `scrollable?: boolean` on `LensTabsProps`.

- [ ] **Step 1: Failing test** — with `scrollable`, the tab container has `overflow-x-auto` and renders all tabs in a single non-wrapping row (assert the class + that a 5-tab set all render); without it, behavior unchanged.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — when `scrollable`, apply `flex overflow-x-auto no-scrollbar gap-2 snap-x` (tokens/utilities only; keep active + count-badge styling). Default (`false`) keeps the current layout.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): scrollable LensTabs variant"`

### Task 2: Extract `DayDetail` from `DayRail` (desktop output identical)

**Files:** Create `src/components/calendar/surface/DayDetail.tsx` + test; modify `DayRail.tsx`.
**Produces:**
```ts
interface DayDetailProps {
  role: 'producer' | 'artist';
  day: Date;
  producerEntries?: ProducerDateEntry[];
  artistEntries?: ArtistDateEntry[];
  onPrimary?: () => void; primaryLabel?: string;
  onSecondary?: () => void; secondaryLabel?: string;
  statusLabels?: Partial<Record<ArtistStatus, string>>;
  actionGates?: ActionGates;
  className?: string;
}
```
`DayDetail` = the selected-day date card(s) (fill meter for producer / status note for artist, session-only times) + the primary/secondary action buttons. Producer primary label/gate still via `resolveProducerPrimary` (move that call into `DayDetail` OR keep it in the parent and pass labels — keep the SAME resolution the rail uses so output is identical).

- [ ] **Step 1: Characterization test first** — before extracting, add a `DayRail.test.tsx` assertion capturing the current desktop output (date card text, primary button label/testid `day-rail-primary`) so the refactor is provably non-breaking. Run → PASS (documents current behavior).
- [ ] **Step 2: Failing `DayDetail.test.tsx`** — producer day with `acceptedMain:2` → primary "Confirm holds" fires `onPrimary`; artist `suggested` → primary "Accept offer"; renders the date card + fill meter (producer) / status (artist).
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement `DayDetail`** by lifting the date-card + action JSX out of `DayRail` verbatim; then rewrite `DayRail` to render `<DayDetail role day producerEntries artistEntries onPrimary primaryLabel onSecondary secondaryLabel actionGates statusLabels />` followed by its existing **stats card** + **legend card** (unchanged). The `DayRail` characterization test from Step 1 must still PASS.
- [ ] **Step 5: Run → PASS** (both `DayDetail.test.tsx` and the unchanged `DayRail.test.tsx`).
- [ ] **Step 6: Commit** — `git commit -am "refactor(calendar): extract DayDetail from DayRail (no output change)"`

### Task 3: SurfaceFab

**Files:** Create `src/components/calendar/surface/SurfaceFab.tsx` + test.
**Produces:** `<SurfaceFab label={string} onClick={()=>void} icon?={ReactNode} className?={string} />`.

- [ ] **Step 1: Failing test** — renders a fixed bottom-right button with the label; click fires `onClick`. `data-testid="surface-fab"`.
- [ ] **Step 2–4:** FAIL → implement (`fixed right-4 bottom-12 z-40 h-13 rounded-pill bg-primary text-primary-foreground shadow-elev3 …` + plus icon; tokens only; the CookieConsentBanner fixed-position precedent) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): SurfaceFab"`

### Task 4: MonthGrid dense (mobile) variant

**Files:** Modify `src/components/calendar/surface/MonthGrid.tsx`; test `MonthGrid.test.tsx`.
**Produces:** `dense?: boolean` on `MonthGridProps`.

- [ ] **Step 1: Failing test** — with `dense`, cells use the compact min-height and render a single status-bar chip (assert the reduced-height class + that a cell with 2 chips shows one + the "+N" overflow already handled by cell data). Non-dense unchanged.
- [ ] **Step 2–4:** FAIL → implement (when `dense`: `min-h-[62px]`, tighter padding, cap visible chips to 1 with the existing `moreCount` badge; keep today ring, tap → `onSelectDay`) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): MonthGrid dense variant"`

### Task 5: SeasonStripMobile (requires Phase 3)

**Files:** Create `src/components/calendar/surface/SeasonStripMobile.tsx` + test.
**Consumes:** `toSeasonModel`, `seasonKpis` (Phase 3 `seasonData.ts`), `SeasonModel`. **Produces:**
```ts
interface SeasonStripMobileProps {
  entries: ProducerDateEntry[];
  anchor: Date;
  readyIds: Set<string>;
  onOpenDate: (dateId: string) => void;
  className?: string;
}
```
Frozen 92px left label column (program rows: label + "N dates · −N", + "Open" footer row) beside a horizontally-scrolling day grid (`repeat(N, 20px)` columns from `SeasonModel.days`): date header (today tinted), per-program fill-height bars, bottom load-bar row (`SeasonModel.loadByDay`, amber when heavy). Cell with a `dateId` → `onOpenDate`. Scroll is **contained** to the strip (no page overflow).

- [ ] **Step 1: Failing test** — 2 shows across the window → 2 frozen labels + N day columns + a load-bar row; tapping a populated cell fires `onOpenDate(dateId)`; the scroll container has `overflow-x-auto` and the label column is sticky/frozen.
- [ ] **Step 2–4:** FAIL → implement (build model via `toSeasonModel(entries, anchor)`; frozen column via `sticky left-0 z-10`; bar height `Math.max(12, 32*intensity)`; solid accent stops for intensity per the accent-opacity caveat) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): SeasonStripMobile"`
- [ ] **If Phase 3 not yet merged:** stub `SeasonStripMobile` to a "Season view is desktop-only on this device" placeholder and note the dependency; revisit when Phase 3 lands.

---

## WAVE B — bottom sheet + mobile shell (sequential)

### Task 6: CalendarDaySheet (vaul Drawer)

**Files:** Create `src/components/calendar/surface/CalendarDaySheet.tsx` + test.
**Consumes:** `Drawer` (`src/components/ui/drawer.tsx`), `DayDetail`. **Produces:**
```ts
interface CalendarDaySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: 'producer' | 'artist';
  day: Date | null;
  producerEntries?: ProducerDateEntry[];
  artistEntries?: ArtistDateEntry[];
  onPrimary?: () => void; primaryLabel?: string;
  onSecondary?: () => void; secondaryLabel?: string;
  onOpenDate?: () => void;              // "Open date" text button (both roles)
  onMessageProducer?: () => void;       // artist tertiary
  statusLabels?: Partial<Record<ArtistStatus, string>>;
  actionGates?: ActionGates;
}
```
Renders `<Drawer open onOpenChange>` → `<DrawerContent>` with a grab handle, then `<DayDetail role day producerEntries artistEntries onPrimary primaryLabel onSecondary secondaryLabel .../>`, then the extra text buttons: **Open date** (both), **Message producer** (artist). Dismiss via handle/scrim (vaul default) → `onOpenChange(false)`.

- [ ] **Step 1: Failing test** — `open` with a producer `day` → the sheet shows `DayDetail`'s primary + an "Open date" button that fires `onOpenDate`; artist variant shows "Message producer" firing `onMessageProducer`; `onOpenChange(false)` on dismiss.
- [ ] **Step 2–4:** FAIL → implement (first production consumer of `vaul` Drawer — verify portal/focus-trap/escape work; grab handle `w-10 h-1 rounded-pill bg-muted-foreground/40 mx-auto`) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): CalendarDaySheet (vaul bottom sheet)"`

### Task 7: CalendarSurface — the `isMobile` branch (shell)

**Files:** Modify `src/components/calendar/surface/CalendarSurface.tsx`; test `CalendarSurface.test.tsx`.
**Consumes:** `useIsMobile`, `LensTabs(scrollable)`, `CalendarDaySheet`, `SurfaceFab`, `DayDetail`. **Produces:** an added `onNewDate?: () => void` on `CalendarSurfaceProps` (for the FAB).

- [ ] **Step 1: Failing test** — mock `useIsMobile` → `true`; mount `role="producer"`, producer entries. Assert: the mobile tree renders (`LensTabs` scrollable; no fixed 280px rail); tapping a Month cell opens `CalendarDaySheet` (assert the sheet content); `SurfaceFab` renders on the landing lens and fires `onNewDate`. Second test: `useIsMobile` → `false` renders the unchanged desktop tree (regression: the 280px `DayRail` present).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — add `const isMobile = useIsMobile()`. Wrap the existing desktop return in `if (!isMobile) { …existing… }`. Add a mobile return: `CalendarSurfaceHeader` (compact) with `<LensTabs scrollable …/>`; a full-width period bar (reuse `PeriodNavigator`, threading the active period from Phase 3) for lenses that have one; the active lens body in a single column (no side rail); a `<CalendarDaySheet open={!!selectedDay && isMobile} onOpenChange={o=>!o && setSelectedDay(null)} …/>` wired to the same primary/secondary the desktop rail uses (`resolveProducerPrimary` etc.); and `<SurfaceFab>` when `role==='producer'` and the active lens is the producer landing (Needs-you) — hidden on Season and for artists. On mobile, a day/row/cell tap sets `selectedDay` (opening the sheet) instead of updating a rail.
- [ ] **Step 4: Run → PASS** + `npx tsc -p tsconfig.app.json --noEmit`.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): CalendarSurface mobile shell (sheet + FAB + scrollable tabs)"`

---

## WAVE C — mobile lens bodies + reflow (parallel where noted, then E2E)

### Task 8: Mobile list lenses (Offers · Agenda · Needs-you single column)

**Files:** Modify `OffersLens.tsx`, `AgendaLens.tsx`, `NeedsYouLens.tsx` (add mobile/responsive classes; no logic change); tests updated.

- [ ] **Step 1: Failing tests** — with `useIsMobile` true (or a `dense`/`stacked` prop), each lens renders full-width single-column cards/rows (assert no multi-column grid classes; cards stack). For `NeedsYouLens`, the QueueRail folds **below** the groups as collapsible cards (assert the rail content renders below, not aside).
- [ ] **Step 2–4:** FAIL → implement — prefer responsive Tailwind classes (`flex-col`, `w-full`, `sm:` restoring desktop) so ONE component serves both; where a structural change is needed (Needs-you rail folding), branch on an injected `layout: 'rail' | 'stacked'` prop the surface passes. Keep desktop output identical at ≥768. → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): single-column mobile reflow for Offers/Agenda/Needs-you"`

### Task 9: Reflow — producer Month/Week, artist Month, artist All-dates; wire Season strip

**Files:** Modify `CalendarSurface.tsx` (mobile lens routing), `AllDatesLens.tsx`; use `MonthGrid dense` + `SeasonStripMobile`.

- [ ] **Step 1: Failing test** — mobile producer `lens="month"` renders `MonthGrid dense`; `lens="week"` renders the Agenda day-rows filtered to `periodWindow(anchor,'week')` (assert only the week's dates show); `lens="season"` renders `SeasonStripMobile`; mobile artist `lens="month"` renders dense grid, `lens="all-dates"` renders stacked rows (no fixed table columns).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — in the mobile branch: Month → `<MonthLens>` passing `dense` through to `MonthGrid`; Week → reuse `<AgendaLens entries={entries filtered to the week window}>` (add a `windowStart/windowEnd` filter or pre-filter in the surface); Season → `<SeasonStripMobile entries anchor readyIds onOpenDate={actions.openDate}/>`; All-dates → `AllDatesLens` with a `stacked` responsive variant (rows instead of a table below 768). Tap handlers everywhere set `selectedDay` → sheet.
- [ ] **Step 4: Run → PASS** + typecheck + lint.
- [ ] **Step 5: Commit** — `git commit -am "feat(calendar): mobile reflow for Month/Week/Season/All-dates"`

### Task 10: E2E smoke + i18n/help review

**Files:** Create `e2e/calendar-mobile.spec.ts`; modify `src/i18n/locales/**` only if new copy; assess `PageMini`/help.

- [ ] **Step 1: Write the Playwright smoke** (mobile viewport 402×874, `booking_flow` on): **artist** — open `/availability`, the Offers lens shows, tap an offer → day sheet → Accept. **producer** — open `/bookings`, Needs-you (or Agenda) shows, tap a row → day sheet, tap the "New date" FAB → the new-date dialog opens. Follow the repo's Playwright config + the RTL retry-loop guidance (no `getByRole({name})` inside waits).
- [ ] **Step 2: Run** — `npx playwright test --config=e2e/playwright.config.ts calendar-mobile` (needs the local stack); iterate to green.
- [ ] **Step 3:** Add any new mobile-only strings to `bookings`/`availability` EN + DE (key-for-key, informal "Du", no dashes); run `npx vitest run src/i18n/`. Assess `PageMini`/help impact; state in the PR (likely "no impact" — same flows).
- [ ] **Step 4: Full gate** — `npx vitest run`, `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.tools.json --noEmit`, `npm run lint`.
- [ ] **Step 5: Commit** — `git commit -am "test(e2e): mobile calendar smoke + i18n"`

---

## Phase 5 exit criteria
- Below 768px, `/bookings` and `/availability` render the mobile surface: scrollable lens chips, single-column bodies, the day rail replaced by the `CalendarDaySheet` bottom sheet, and the producer "New date" FAB on the landing lens.
- The 5 mocked screens (artist Offers/Month/Day-sheet, producer Agenda/Season) match the mock; the un-mocked lenses (producer Month/Week, artist All-dates) reflow gracefully.
- Desktop (≥768px) is byte-for-byte unchanged; all Phase-1/2/3 component tests stay green.
- No data/mutation/RLS/edge change. All three tsc projects + lint + `vitest run` + the mobile Playwright smoke green; i18n key-parity green.

## Open risks / verify during build
- **`DayRail` extraction:** the desktop `DayRail` render must be identical post-refactor — the Task 2 characterization test is the guard; do not let `DayDetail`'s resolution diverge from the rail's.
- **vaul Drawer first use:** verify portal, focus-trap, escape, and scrim-dismiss actually work (it has zero prior consumers).
- **`useIsMobile` first paint:** desktop tree renders first, mobile after mount — verify no jarring layout shift on a real device (§10 of the spec).
- **Season strip overflow:** the horizontal scroll must be contained to the strip, never the page body.
- **Phase 2/3 ordering:** Needs-you (Task 8) and Season (Tasks 5/9) require Phases 2/3; if built earlier, stub + note per the Task 5 fallback.
- **Range-select absent on mobile:** confirm the mobile `MonthGrid`/`SeasonStripMobile` render no selection affordances (Phase 4 is desktop-only).

## Self-review notes
- Spec coverage: §3.1 responsive branch → Task 7; §3.2 component inventory → Tasks 1–9; §3.3 day-tap→sheet → Tasks 6/7; §4.1–4.3 artist screens → Tasks 8/9/6; §4.4 Needs-you reflow → Task 8; §4.5 Agenda → Task 8; §4.6 Season → Tasks 5/9; §4.7 producer sheet → Task 6; §4.8 reflows → Task 9; §7 testing → Tasks 2 (characterization) + 10 (E2E); §5 no-data-change honored throughout.
- Type consistency: `DayDetailProps` (Task 2) consumed by `DayRail` + `CalendarDaySheet` (Task 6); `CalendarDaySheetProps` (Task 6) consumed by `CalendarSurface` (Task 7); `SeasonStripMobileProps` (Task 5) consumed by Task 9; `scrollable`/`dense`/`onNewDate` added in Tasks 1/4/7 and used in Task 7.
- Placeholder scan: the `layout: 'rail'|'stacked'` prop (Task 8) and week-window filter (Task 9) are concrete instructions; the Phase-3-absent path has an explicit stub fallback, not a TODO.
