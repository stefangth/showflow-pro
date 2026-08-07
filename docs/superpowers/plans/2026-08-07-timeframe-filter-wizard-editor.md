# Plan B — Timeframe (upcoming/past) filter + gray past-date treatment, wizard UX, editor-icon cleanup

Three independent frontend fixes on one branch, executed as sequential tasks. React 18 + Vite + TS, Tailwind v3 + shadcn/ui, React Query v5.

## Global Constraints (bind every task)

- **TDD.** Write the failing test first for each behavioral change; tests import the real module (never re-implement logic in the test). Co-locate tests. Use `src/test/` harness (`renderWithProviders`, `supabaseFake`, fixtures) — never hand-rolled `vi.mock` of the supabase client.
- **Reuse existing filter infra.** Extend `src/components/filters/TimeframeFilter.tsx` + `filterUtils.ts` (`inTimeframe`); do NOT fork a parallel timeframe control.
- **Semantic tokens only.** No hardcoded colors. The past-date tint must use opacity / muted semantic tokens, and past rows must stay **fully clickable** (no `pointer-events-none`).
- **Week starts Monday** everywhere (existing convention) — do not regress calendar rendering.
- **Timezone-safe dates.** Use `parseDateOnly` / `toDateKey` from `src/lib/dates.ts` for all date-only comparisons. `new Date()` at render/call time is fine in app code.
- Gate: `npm run lint` (zero warnings), `npx vitest run`, `npx tsc -p tsconfig.app.json --noEmit`, and `npx tsc -p tsconfig.tools.json --noEmit` must pass. Do not edit generated files (`src/integrations/supabase/types.ts`, `src/components/ui/*` by hand).
- Keep each task's commits scoped to that task.

---

## Task 1 (#2a) — Shared timeframe/past primitives + artist past-booking data

**Problem:** `TimeframeFilter` is a date-range popover whose presets include "Past" and "Any time", but every surface initializes it to `{from:null,to:null}` ("Any time"), and the artist-facing surfaces fetch **upcoming-only** data, so "Past" reveals nothing. There is no shared "is this date past?" helper and no shared past-date visual treatment.

**Build (all with tests-first):**

1. **`TimeframeFilter.tsx`** — add an **"Upcoming"** preset as the first entry: `{ label: 'Upcoming', key: 'upcoming', range: () => ({ from: today, to: addDays(today, 3650) }) }` (today = `startOfDay(new Date())`, matching the existing `presets()`). Export a factory `export function upcomingTimeframe(): TimeframeValue` returning that preset's value (`{ from, to, preset: 'upcoming' }`), computed at call time (not module load). Keep the existing "Past" and "Any time" presets. Label logic must render "Upcoming" when `preset==='upcoming'`.
2. **`src/lib/dates.ts`** — add `export function isPastDate(date: Date, today: Date = new Date()): boolean` — true iff `date` is strictly before `startOfDay(today)`, date-only and timezone-safe (compare via `toDateKey`). Add `export const PAST_DATE_TINT = 'opacity-60'` — the shared "grayed but interactive" class (dimmed; NO pointer-events change). (If a richer gray is wanted later it changes in one place.)
3. **`src/data/bookings.ts`** (or `artists.ts`, matching where `fetchMyCancelledDateBookings` lives) — add `fetchMyActiveBookedDates(client, artistId)` returning the artist's **non-cancelled** bookings joined to `show_dates` (+ show program) for context, shaped like the existing eligible/cancelled date rows (`{ id/show_date_id, date, status, is_understudy, show:{...} }`). This is the row source that makes past (and any out-of-eligible-window) bookings renderable. Model the query + typing on `fetchMyCancelledDateBookings`.

**Tests:** upcoming preset renders + `upcomingTimeframe()` shape; `isPastDate` around the today boundary (yesterday true, today false, tomorrow false); `fetchMyActiveBookedDates` issues the expected `.eq('artist_id').neq('status','cancelled')` query and maps rows (supabaseFake).

**Interfaces exported for Task 2:** `upcomingTimeframe`, `isPastDate`, `PAST_DATE_TINT`, `fetchMyActiveBookedDates`.

---

## Task 2 (#2b) — Default Upcoming + past visibility + gray tint across all date surfaces

Wire Task 1's primitives into every surface. **Default timeframe = `upcomingTimeframe()` on all of them** (past hidden by default, one click away). Apply `PAST_DATE_TINT` to any rendered row/card/cell whose date `isPastDate`, keeping it clickable.

Surfaces (each gets: default Upcoming + past rows tinted + still clickable):
1. **`src/pages/ShowsBookingsPage.tsx`** — default state `useState<TimeframeValue>(() => upcomingTimeframe())`. Tint past date rows in the list AND past day cells in the calendar view. (Data already includes all dates via `fetchShowDatesList`.)
2. **`src/pages/AvailabilityPage.tsx`** — default Upcoming. Merge the artist's past active booked dates (`fetchMyActiveBookedDates`) into the rendered set so "Past"/"All" reveal them (read-only/grayed — past dates are not actionable for availability declaration). Tint past rows.
3. **`src/components/bookings/ArtistBookingsView.tsx`** — default Upcoming. Merge `fetchMyActiveBookedDates` into the row set alongside `eligibleDates`/`cancelledEntries` (dedupe by show_date id; existing "first-seen wins" is fine). **This fixes the original July 31 bug** (a past `soft_booked` booking becomes visible, grayed, when the user selects Past/All). Tint past rows in list + calendar.
4. **`src/pages/HireOrdersPage.tsx`** — ADD a `TimeframeFilter` (default Upcoming) to the filter row, filtering `filteredOrders` client-side by the order's show_date date via `inTimeframe(parseDateOnly(order.date), timeframe)`. Confirm the order row/type carries a date (it is per-show_date); if the field name differs, use it. Tint past order rows in `OrdersTable` (pass an `isPast` flag or apply the class per row); keep rows clickable.
5. **`src/components/calendar/EntityCalendar.tsx`** (shared month grid) — tint past day cells (`PAST_DATE_TINT`) so every calendar view across the app grays past days; keep them clickable. Also apply to `src/components/dashboard/ArtistDashboard.tsx` date cards if it renders dated rows.

**Scope note on "every view":** the above covers the primary date-bearing list/card/calendar surfaces (the user's "bookings, hire orders, availability" plus the shared calendar + artist dashboard/bookings). If you find additional prominent surfaces that render a show_date row/card (e.g. `ShowDateDetailSheet` header), apply the same tint. Peripheral/textual mentions (chat headers, notification list) are out of scope — list any you defer in your report.

**Tests:** for each surface — default timeframe hides past by default; selecting Past/All reveals past rows; past rows carry `PAST_DATE_TINT`; a past row is still clickable (onClick fires). For ArtistBookingsView specifically, a regression test mirroring the July 31 case: an artist with a past `soft_booked` booking sees it (grayed) under Past/All and not under the default.

---

## Task 3 (#3) — Setup-rail: uncramp + re-invoke; enlarge hire-order wizard

Two problems: the onboarding **setup rail** is squeezed into a fixed 340px grid column beside the data table (cramped when bookings exist), and after "Hide" there is **no way to bring it back** (`useRailDismissed` writes a localStorage flag with no un-hide path anywhere).

**Build (tests-first where behavioral):**

1. **Re-invoke (the real bug) — exact:** extend `src/components/setup/useRailDismissed.ts` with an `undismiss()` (or `show()`) that does `localStorage.removeItem(key)` and updates state. On **`ShowsBookingsPage.tsx`** and **`HireOrdersPage.tsx`**, add a persistent header button next to the `<h1>` (ghost/outline, `ListChecks` icon, label "Setup checklist"), rendered **only when the rail is dismissed AND setup is incomplete** (`dismissed && !status.complete`), that calls `undismiss()` to bring the checklist back. Match the existing header-button pattern (New date / New order).
2. **Uncramp / larger (best-in-class):** the setup checklist must not live in a fixed 340px column beside the table. Recommended approach (use judgment, keep onboarding prominence): render the rail's content in a **right-side `Sheet`** (`w-full sm:max-w-2xl`, the `ShowDateDetailSheet` pattern) instead of the inline 340px track, so the list/table gets full width and the checklist has room; the header "Setup checklist" button opens it. Preserve first-run prominence: when setup is incomplete and not dismissed, still surface it prominently (auto-open the Sheet on first mount, or a full-width inline callout above the content that opens it) rather than the cramped side rail. Apply the same treatment to both the bookings `BookingSetupRail` and hire-orders `SetupRail`. Remove the `lg:grid-cols-[1fr_340px]` fixed track once the rail no longer occupies a side column.
3. **`NewOrderWizard.tsx`** — widen `DialogContent` `sm:max-w-3xl` → `sm:max-w-5xl` so step-1's artist×date matrix and step-3's running-order editor aren't cramped. (Re-invoke already works — do not regress it; the `HireOrdersPage.test.tsx` "does not self-disable to a dead-end" test must stay green.)
4. **`GenerateHireOrderDialog.tsx`** — minor: `sm:max-w-lg` → `sm:max-w-xl`.

**Tests:** `undismiss()` clears the flag and re-shows; the header "Setup checklist" button appears only when `dismissed && !complete` and re-invokes on click; the rail content renders in the Sheet and opens/closes; `NewOrderWizard` re-invoke regression test stays green. Keep assertions on width classes light (presence checks).

**Note:** Tasks 2 and 3 both edit `ShowsBookingsPage.tsx` / `HireOrdersPage.tsx`; they run sequentially (this task after Task 2) so there is no conflict — build on Task 2's version.

---

## Task 4 (#4) — Remove the redundant editor-mode Pencil

When editor mode is OFF, two `Pencil` buttons both call only `enableEditorMode()`: the topbar `EditorModeToggle` (keep) and an orphan off-state branch inside the `EditorToolbar` component (remove).

**Build (test-first):**
1. In `src/features/editor/EditorToolbar.tsx`, make the **`EditorToolbar`** component `return null` when `!isEditorMode` (delete the off-state Pencil branch, ~lines 49-64). When `isEditorMode` is true it still renders the full toolbar (org/role/user selectors, Page Settings, X exit) unchanged. Leave `EditorModeToggle` (the topbar control) untouched.
2. Confirm gating is unchanged (`canUseEditor`) and that `EditorModeToggle` remains the single entry point on every screen/role. Search `e2e/` (Playwright) and unit tests for any reference to the removed off-state button; update/remove as needed.

**Tests:** `EditorToolbar` renders nothing when `isEditorMode === false` and `canUseEditor` is true; renders the full toolbar when `isEditorMode === true`; `EditorModeToggle` still enables editor mode. Existing `EditorToolbar.test.tsx` "EditorModeToggle preview indicator" suite must stay green.

## Out of scope (whole plan)
- No backend/RLS changes (that is Plan A on its own branch).
- No new "All past history unbounded" data fetches beyond the artist's own bookings.
