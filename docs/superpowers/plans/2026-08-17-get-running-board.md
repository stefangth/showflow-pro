# Get Running Board — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's scattered onboarding (dashboard stage-chain + two module setup rails + the shared SetupChecklistSheet) with one `/get-running` board that holds every setup task in three phases, opens each task in a right-side panel, scopes itself per role, and retires when complete — plus two IA moves (Help → System nav cluster, fold `/admin` into `/settings`).

**Architecture:** A new `/get-running` route composes existing pure readiness modules (`computeBookingSetupStatus`, `computeSetupStatus`, Airtable console status, producer count) into one ordered 11-task model (`getRunningTasks.ts`, pure + TDD). The page renders a board (phase cards + task rows) beside a task panel that reuses the existing step editors (`FlowStep`, `SlotsStep`, `TimingStep`, `LetterheadStep`, `TermsStep`, `CountersignStep`, the Airtable `SetupWizard`, `PeopleStep`). The old onboarding surfaces are deleted and their entry points redirected here. A minimal read-only "How this org works" card gives the retired board a home without the skipped Settings restructure.

**Tech Stack:** React 18 + TS + Vite, Tailwind v3 + shadcn/ui, react-router v6, @tanstack/react-query v5, react-i18next (EN + DE), vitest + @testing-library/react. Data-access via `src/data/*` with the `supabaseFake` test harness. Design tokens in `src/index.css` / `tailwind.config.ts`.

**Spec:** `docs/superpowers/specs/2026-08-17-setup-settings-design/` — the imported design. Screens for this plan: `screens/01_01_Get_running.html` (admin board + task panel), `screens/02_02_Task_panels.html` (the 3 panel shapes), `screens/03_03_Producer_view.html` (role-scoped board), `screens/04_04_Running.html` (retirement + "How this org works"). Open `render-all-screens.html` in a browser to view. Screens 05/06 (Settings restructure) and 10 (Validation coverage map) are OUT OF SCOPE. Screens 07/08/09/11 are LATER phases, not this plan.

## Global Constraints

- **Package manager:** npm only. `npm ci` to install; never create bun/yarn/pnpm lockfiles.
- **Lint gate:** `npm run lint` is zero-warning (`--max-warnings 0`). `any` is banned.
- **Typecheck is three projects:** `npx tsc -p tsconfig.app.json --noEmit` covers `src/`. Run it after each task.
- **Tests:** `npx vitest run <file>` per task; `npm run test:coverage` is what CI runs (thresholds apply only under `--coverage`).
- **Styling / tokens (verified 2026-08-17):** use a semantic Tailwind utility where one exists, else the CSS-var arbitrary form `*-[var(--token)]` (never a raw hex). Verified: `#6E5CF6`→`bg-primary`; `#F6F4EF`→`bg-background`; `#FFFFFF`→`bg-card`; `#FAF8F4`→`bg-muted`; `#EFEDE7`→`bg-[var(--surface-3)]`; `#5B5A57`→`text-muted-foreground`; `#8B8A85`→`text-[var(--text-faint)]`; `#E6E3E0`→`border-border`. Accent stops `bg-accent-50..900` do NOT take opacity modifiers (silently solid). Shadows → `shadow-elev1..4`, never `shadow-[var(--shadow-2)]`.
- **Badges/chips — use the existing `Badge` variants; `amber-*` and `surface` are NOT registered Tailwind colors** (`bg-amber-100`/`bg-surface` render nothing). Amber "Blocks offers/booking/issuing" → `<Badge variant="risk">`; green "All covered / Running / Active" → `variant="confirmed"`; grey "Admin only / Not on" → `variant="neutral"`; violet "Open / Current" → `variant="accent"`. Inline amber fills (non-badge) → `bg-[var(--amber-100)] text-[var(--amber-600)]`.
- **Calendars:** week starts Monday (`weekStartsOn={1}`; manual pads `(getDay()+6)%7`). (No calendar in this plan, but keep in mind for step editors.)
- **i18n:** every new user-facing string goes through `t()` in a domain namespace with EN **and** DE authored in the same task (`src/i18n/keyParity.test.ts` fails CI on any gap). German uses informal "Du"; no em/en dashes anywhere in copy (`copyLint.test.ts` enforces both). Reuse `src/i18n/terms.ts` `TERMS` for domain terms (e.g. Engagementvertrag, Tagesübersicht).
- **Role literals:** the `producer` role displays as "Production Team" via `roleLabel()`; never compare against the display string, always the literal `'producer'`.
- **Query keys:** hierarchical `['domain', 'sub', ...params]`; mutations invalidate the whole domain prefix.
- **Tests import the real module** — never re-implement production logic in a test.
- **Commit frequently** (one per task minimum), imperative lowercase ≤72 chars. Do not push unless asked. Branch is already `claude/setup-settings-design-34a499`.

---

## File Structure

**New files**
- `src/config/app.config.ts` — add `ROUTES.GET_RUNNING = '/get-running'` (modify).
- `src/lib/getRunning/tasks.ts` — pure `composeGetRunning(input): GetRunningModel` (the 11-task / 3-phase model, role scoping, retirement flag).
- `src/lib/getRunning/tasks.test.ts` — unit tests for the composer.
- `src/hooks/useGetRunning.ts` — integration hook: gathers live reads, calls `composeGetRunning`, returns `{ model, isLoading }`.
- `src/pages/GetRunningPage.tsx` — the route: board column + task panel, or artist/no-module/complete states.
- `src/components/getRunning/GetRunningHeader.tsx` — headline + "Set up N of 11" progress card + module on/off list.
- `src/components/getRunning/PhaseCard.tsx` — one phase (Get dates in / Make it bookable / Paperwork) with its task rows.
- `src/components/getRunning/TaskRow.tsx` — one task row (radio/check, title, block chips, value/CTA), admin-vs-producer aware.
- `src/components/getRunning/TaskPanel.tsx` — right-side panel frame (eyebrow, title, body, scrollable content slot, footer with Later / primary), hosting a step editor.
- `src/components/getRunning/taskPanelRegistry.tsx` — maps a task key → the editor component to render in the panel.
- `src/components/getRunning/HowThisOrgWorks.tsx` — the minimal read-only provenance card (retirement home), used on the completed board and as a new admin-only Settings tab.
- `src/i18n/locales/en/getRunning.json`, `src/i18n/locales/de/getRunning.json` — new namespace.
- `src/lib/minis/pages/getRunning.ts` — optional page-mini def (see Task 12; only if `addMini` decision is yes — default: no mini, board is self-describing).

**Modified files**
- `src/components/layout/navItems.ts` — move Help to `system`; add Get running item to `workspace`; remove Admin item.
- `src/App.tsx` — register `/get-running`; redirect `/admin` → `/settings?tab=people`.
- `src/pages/SettingsPage.tsx` — add admin-only People / Activity / Sync tabs (folded from AdminPage); add "How this org works" tab.
- `src/i18n/locales/{en,de}/common.json` — `nav.help` already exists; add `nav.getRunning`; drop `nav.admin` usage (keep key or remove — see Task 1).
- Delete/retire: `src/components/dashboard/firstRun/*`, `src/components/bookings/setup/*` rail hosting, `src/components/hireOrders/setup/*` rail hosting, `src/components/setup/*` (SetupChecklistSheet chrome) — see Task 11. Their step editor leaves (`FlowStep`, `SlotsStep`, `TimingStep`, `LetterheadStep`, `TermsStep`, `CountersignStep`, `PeopleStep`, `LadderStep`, `EligibilityStep`) are KEPT and reused by the panel.
- `src/pages/DashboardPage.tsx`, `src/components/dashboard/ArtistDashboard.tsx`, `src/pages/ShowsBookingsPage.tsx`, `src/pages/HireOrdersPage.tsx` — remove the first-run / rail mounts (Task 11).

---

## Task decomposition & self-review note

Tasks 1–2 are IA/nav (independently shippable). Tasks 3–4 are the pure model (TDD). Tasks 5–10 build the board UI incrementally. Task 11 removes the old surfaces and rewires entry points (the risky sweep — its own review gate). Task 12 is i18n/verification. Each task ends testable. The exact 11-task list is pinned in Task 3 and is the single design-mapping decision; if the reviewer wants a different split, it changes only Task 3's constant and its test.

---

### Task 1: Navigation & IA moves (Help → System, Admin nav retire, Get running item)

**Files:**
- Modify: `src/components/layout/navItems.ts`
- Modify: `src/config/app.config.ts` (add `GET_RUNNING`)
- Test: `src/components/layout/navItems.test.ts` (create if absent)

**Interfaces:**
- Produces: `ROUTES.GET_RUNNING === '/get-running'`; `NAV_ITEMS` contains a Get running item `{ to: ROUTES.GET_RUNNING, section: 'workspace', roles: ['admin','producer'] }` placed first (artists have NO board — screen 08); Help item `section: 'system'`; no Admin item.

- [ ] **Step 1: Write failing test** in `navItems.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, groupNavBySections, visibleNavItems } from './navItems';
import { ROUTES } from '@/config/app.config';

const ctx = { isEditorMode: false, isRealAdmin: false, isSuperAdmin: false,
  hasRole: () => true, enabledFeatures: new Set<string>(), entitlementsLoading: false };

describe('nav IA', () => {
  it('has a Get running item first in workspace', () => {
    const ws = NAV_ITEMS.filter(i => i.section === 'workspace');
    expect(ws[0].to).toBe(ROUTES.GET_RUNNING);
  });
  it('Help lives in the system section', () => {
    const help = NAV_ITEMS.find(i => i.to === ROUTES.HELP);
    expect(help?.section).toBe('system');
  });
  it('has no Admin nav item', () => {
    expect(NAV_ITEMS.some(i => i.to === ROUTES.ADMIN)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`ROUTES.GET_RUNNING` undefined / Help still workspace / Admin present):
`npx vitest run src/components/layout/navItems.test.ts`

- [ ] **Step 3: Implement.** In `app.config.ts` `ROUTES`, add `GET_RUNNING: '/get-running',` next to `DASHBOARD`. In `navItems.ts`: add `Rocket` to the lucide import; add `'nav.getRunning'` to `NavLabelKey`; prepend `{ to: ROUTES.GET_RUNNING, icon: Rocket, label: 'Get running', labelKey: 'nav.getRunning', section: 'workspace', roles: ['admin', 'producer'] }` to `NAV_ITEMS`; change the Help item's `section` to `'system'`; delete the Admin item line. Leave `nav.admin` in `NavLabelKey` union removed only if unused elsewhere (grep first).

- [ ] **Step 4: Run — expect PASS.** Also `npx tsc -p tsconfig.app.json --noEmit` and `npm run lint`.

- [ ] **Step 5: Commit** `feat(nav): add Get running item, move Help to System, retire Admin nav`.

---

### Task 2: Fold Admin into Settings + redirect `/admin`

**Files:**
- Modify: `src/pages/SettingsPage.tsx` (add People / Activity / Sync admin-only tabs, folding `AdminPage`'s content)
- Modify: `src/App.tsx` (`/admin` → `<Navigate to="/settings?tab=people" replace />`; keep the route element admin-gated so a producer hitting `/admin` still resolves through Settings' own gating)
- Modify: `src/i18n/locales/{en,de}/settings.json` (new tab labels + group heading)
- Delete: `src/pages/AdminPage.tsx` (after its content is moved) and drop its import/route in `App.tsx`
- Test: `src/pages/SettingsPage.people.test.tsx` (People tab renders for admin, hidden for producer)

**Interfaces:**
- Consumes: `PeopleTab` from `@/components/admin/people/PeopleTab`; `fetchAdminAuditLogs` / `fetchAdminSyncLogs` / `fetchAdminStats` from `@/data/admin`.
- Produces: Settings `navGroups` gains a `t('nav.groups.people')` group with items `people` (admin), `activity` (admin), `sync-log` (admin); `/admin` no longer renders `AdminPage`.

- [ ] **Step 1: Write failing test** — render `SettingsPage` with `renderWithProviders` as admin, assert a "People" tab exists and shows the invite bar; render as producer, assert no People tab. Use `src/test/renderWithProviders.tsx` + `fixtures.ts`. (Mirror an existing SettingsPage test if present.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** In `SettingsPage.tsx`: add a `people` group to `navGroups` (before `organization` or after — match design screen 06 "People & access" placement, so directly after Organization group): `{ heading: t('nav.groups.people'), items: [ { value:'people', label:t('nav.items.people'), icon:Users, show:isAdmin }, { value:'activity', label:t('nav.items.activity'), icon:Activity, show:isAdmin }, { value:'sync-log', label:t('nav.items.syncLog'), icon:Database, show:isAdmin } ] }`. Add the three `<TabsContent>` bodies: `people` → `<PeopleTab />`; `activity` → the audit-log card lifted verbatim from `AdminPage.tsx:105-133`; `sync-log` → the sync-log card lifted from `AdminPage.tsx:135-165` (move their queries to SettingsPage, gated `enabled: isAdmin && !!currentOrg`). Import `Users, Activity, Database` icons and the `@/data/admin` fetchers. Add EN+DE strings for `nav.groups.people`, `nav.items.people/activity/syncLog`, and reuse admin.json copy for the card titles (or move those keys). In `App.tsx` replace the `/admin` route element with `<Navigate to={`${ROUTES.SETTINGS}?tab=people`} replace />` and remove the `AdminPage` import. Delete `AdminPage.tsx`. (The admin stats trio and `PageMini page="admin"` are dropped; the People pane is the substance. Note this in the commit.)

- [ ] **Step 4: Run tests + tsc + lint + `npm run sync:mirrors:check` (no mirror touched, should pass). Verify `keyParity.test.ts` passes** (`npx vitest run src/i18n/keyParity.test.ts`).

- [ ] **Step 5: Commit** `feat(settings): fold Admin people/activity/sync into Settings, redirect /admin`.

---

### Task 3: The Get running task model (pure, TDD)

**Files:**
- Create: `src/lib/getRunning/tasks.ts`
- Create: `src/lib/getRunning/tasks.test.ts`

**Interfaces:**
- Consumes: `BookingSetupStatus` (`@/lib/bookings/setupStatus`), `HireOrderSetupStatus` (`@/lib/hireOrders/setupStatus`).
- Produces:

```ts
export type GetRunningPhaseKey = 'get_dates' | 'bookable' | 'paperwork';
export type GetRunningTaskKey =
  | 'dates' | 'slots'                                   // phase get_dates
  | 'flow' | 'people' | 'ladder' | 'eligibility' | 'timing' | 'team' // phase bookable
  | 'letterhead' | 'terms' | 'countersign';            // phase paperwork
export type TaskBlock = 'offers' | 'booking' | 'issuing' | 'filling' | null;
export interface GetRunningTask {
  key: GetRunningTaskKey;
  phase: GetRunningPhaseKey;
  done: boolean;
  block: TaskBlock;        // what it holds up, in the org's vocabulary
  adminOnly: boolean;      // producer cannot act (team, and admin-only settings)
  actionableByViewer: boolean; // viewer may open+complete it
}
export interface GetRunningPhase { key: GetRunningPhaseKey; tasks: GetRunningTask[]; }
export interface GetRunningModel {
  phases: GetRunningPhase[];
  doneCount: number;   // out of totalCount
  totalCount: number;  // 11 when both modules on
  canFirstOffer: boolean; // every offers/booking-blocking task done
  complete: boolean;      // every applicable task done → board retires
  bookingOn: boolean;
  hireOrdersOn: boolean;
}
export interface GetRunningInput {
  role: 'admin' | 'producer';
  bookingOn: boolean;
  hireOrdersOn: boolean;
  booking: BookingSetupStatus | null;   // null while unread or module off
  hire: HireOrderSetupStatus | null;
  datesDone: boolean;      // Airtable connected+synced OR shows exist by hand
  producerCount: number | null; // team step done when > 0
  canEditBooking: boolean; // viewer holds edit_booking_settings
  canEditHire: boolean;    // viewer holds edit_hire_order_settings
  canAddArtists: boolean;  // viewer holds add_artists
  canInvite: boolean;      // viewer is admin (invite producers)
}
export function composeGetRunning(input: GetRunningInput): GetRunningModel;
```

Mapping rules (pin these in tests):
- Phase `get_dates`: `dates` (done = `input.datesDone`), `slots` (from booking `slots` step; block `filling`).
- Phase `bookable`: `flow`, `people`, `ladder`, `eligibility`, `timing` (from the matching booking steps, carrying their `block`), `team` (done = `(producerCount ?? 0) > 0`, block `null`, `adminOnly: true`).
- Phase `paperwork`: `letterhead`, `terms` (block `issuing` when not done), `countersign` (block `null`) — from hire steps; whole phase omitted when `hireOrdersOn` is false.
- `adminOnly`: `team` always; a booking/hire task is adminOnly for a producer who lacks the matching edit capability (`!canEditBooking` / `!canEditHire`); `people` needs `canAddArtists`.
- `actionableByViewer = !adminOnly` for a producer; always true for admin (admin holds every capability).
- `totalCount` excludes paperwork tasks when `hireOrdersOn` is false; excludes all booking tasks when `bookingOn` is false (nothing-on org → `totalCount` may be 0).
- `canFirstOffer`: every task whose block is `offers` or `booking` is done.
- `complete`: every task in the model is done.

- [ ] **Step 1: Write failing tests.** Cover: (a) both modules on, fresh org → 11 tasks, `doneCount` reflects done flags, phases in order `get_dates, bookable, paperwork`; (b) producer viewer → `team` and admin-only settings have `actionableByViewer=false`; (c) `hireOrdersOn=false` → no paperwork phase, `totalCount` drops by 3; (d) all done → `complete=true`; (e) `canFirstOffer` false while `people` undone. Build inputs from real `computeBookingSetupStatus`/`computeSetupStatus` outputs (import them; don't hand-fake the shapes).

- [ ] **Step 2: Run — expect FAIL** (`composeGetRunning` not defined): `npx vitest run src/lib/getRunning/tasks.test.ts`

- [ ] **Step 3: Implement `tasks.ts`** per the mapping rules above.

- [ ] **Step 4: Run — expect PASS.** `tsc` + `lint`.

- [ ] **Step 5: Commit** `feat(get-running): pure 11-task model composer`.

---

### Task 4: `useGetRunning` integration hook

**Files:**
- Create: `src/hooks/useGetRunning.ts`
- Test: `src/hooks/useGetRunning.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (role, currentOrg), `useEntitlements`/`useFeature`, `useBookingSetupStatus` (`@/hooks/useBookingSetup`), `useHireOrderSetupStatus` (`@/hooks/useHireOrderSetup`), `useProducerCount` (`@/hooks/useBookingSetup`), `useCan` (`edit_booking_settings`, `edit_hire_order_settings`, `add_artists`), an Airtable/shows "dates done" read (reuse `useBookingSetupStatus().status.steps` `shows` done + Airtable console `healthy` — pass `datesDone = shows.done` for Phase 1; a later phase refines it with real sync state).
- Produces: `export function useGetRunning(): { model: GetRunningModel | null; isLoading: boolean }`.

- [ ] **Step 1: Write failing test** with `renderWithProviders` + `supabaseFake` seeded so booking status resolves; assert `model.totalCount === 11` for an admin in an org with both modules entitled, and `isLoading` true before reads settle.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** the hook: gather the reads (mirror `useDashboardFirstRun.ts`'s gating — read per-module only when `isNonArtist && entitled`), map to `GetRunningInput`, call `composeGetRunning`. Return `{ model, isLoading }`.

- [ ] **Step 4: Run — expect PASS.** `tsc` + `lint`.

- [ ] **Step 5: Commit** `feat(get-running): live data hook`.

---

### Task 5: Board header + progress card (screen 01)

**Files:**
- Create: `src/components/getRunning/GetRunningHeader.tsx`
- Create: `src/pages/GetRunningPage.tsx` (skeleton: renders header only for now)
- Modify: `src/App.tsx` (register `/get-running`, all roles, inside `AppLayout`)
- Modify: `src/i18n/locales/{en,de}/getRunning.json` (create namespace: eyebrow, headline, body, progress "N of 11 done", module on/off labels)
- Test: `src/components/getRunning/GetRunningHeader.test.tsx`

**Interfaces:**
- Consumes: `GetRunningModel`.
- Produces: `<GetRunningHeader model={model} />` — eyebrow "{Org} · get running", headline (from getRunning namespace, chosen by `canFirstOffer`/counts), body, and a 236px card: "Set up · {doneCount} of {totalCount} done", tick segments (`totalCount` segments, first `doneCount` filled `bg-primary`), a module list (Booking engine On/Off, Hire orders On/Off), footer "Modules are switched on by your account manager."

- [ ] **Step 1: Write failing test** — render header with a model of `doneCount:3,totalCount:11,bookingOn:true,hireOrdersOn:true`; assert "3" and "of 11 done" present, 11 tick segments, "Booking engine"/"On" present.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** per `screens/01_01_Get_running.html` (the header block: eyebrow, `h1`, `p`, and the 236px `Set up` card). Translate inline hex per the Global Constraints token table: `#F6F4EF`→`bg-background`, card `#fff`→`bg-card`, `#E6E3E0`→`border-border`, filled tick `#6E5CF6`→`bg-primary`, empty tick `#EFEDE7`→`bg-[var(--surface-3)]`, muted text `#5B5A57`→`text-muted-foreground`, faint text `#8B8A85`→`text-[var(--text-faint)]`, eyebrow violet→`text-primary`. Register the route in `App.tsx`: `<Route path={ROUTES.GET_RUNNING} element={<ProtectedRoute><AppLayout><GetRunningPage /></AppLayout></ProtectedRoute>} />` (all roles; role branching happens inside the page — artist gets a later-phase treatment, for now render the admin/producer board).

- [ ] **Step 4: Run — expect PASS.** `tsc` + `lint` + `keyParity`.

- [ ] **Step 5: Commit** `feat(get-running): route + board header and progress card`.

---

### Task 6: Phase cards + task rows (screen 01 board column)

**Files:**
- Create: `src/components/getRunning/PhaseCard.tsx`
- Create: `src/components/getRunning/TaskRow.tsx`
- Modify: `src/pages/GetRunningPage.tsx` (render the phases under the header)
- Modify: `src/i18n/locales/{en,de}/getRunning.json` (phase titles, per-task titles + one-line descriptions + block-chip labels + phase status badges)
- Test: `src/components/getRunning/PhaseCard.test.tsx`

**Interfaces:**
- Consumes: `GetRunningPhase`, `GetRunningTask`; a `onOpenTask(key: GetRunningTaskKey) => void` callback.
- Produces: `<PhaseCard phase title status tasks onOpenTask viewerRole />`; `<TaskRow task onOpen viewerRole />` — radio/check dot (done → filled check; blocking-open → violet ring; neutral → grey ring), title, block chips (amber "Blocks offers/booking/issuing", grey "Admin only", violet "Open"), and a right-side value or button ("Add here" primary for the blocking-open task, "Open"/"Change" ghost otherwise).

- [ ] **Step 1: Write failing test** — render a `bookable` phase with `flow` done and `people` undone+blocking; assert the phase status badge, the "Blocks booking"/"Blocks offers" chip on `people`, and that clicking its button calls `onOpenTask('people')`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** per `screens/01_01_Get_running.html` phase blocks (PHASE 01 "Get dates in" running row; PHASE 02 "Make it bookable" accent-bordered card with task rows; PHASE 03 "Paperwork" dashed card with the three document tiles). Phase 3 renders its tasks as the 3-tile row from the design. Block chips use the existing `Badge` variants (see Global Constraints): amber → `variant="risk"`, green → `variant="confirmed"`, grey → `variant="neutral"`, violet → `variant="accent"`. Accent-bordered active phase uses `border-accent-200` + `shadow-elev2`.

- [ ] **Step 4: Run — expect PASS.** `tsc` + `lint` + `keyParity`.

- [ ] **Step 5: Commit** `feat(get-running): phase cards and task rows`.

---

### Task 7: Task panel frame + registry + three panel shapes (screen 02)

**Files:**
- Create: `src/components/getRunning/TaskPanel.tsx`
- Create: `src/components/getRunning/taskPanelRegistry.tsx`
- Modify: `src/pages/GetRunningPage.tsx` (open a panel beside the board when a task is selected; default-open the first blocking task, per screen 01)
- Test: `src/components/getRunning/TaskPanel.test.tsx`

**Interfaces:**
- Consumes: the existing step editors — `FlowStep`, `SlotsStep`, `TimingStep`, `LadderStep`, `EligibilityStep` (from `@/components/bookings/setup/*`), `PeopleStep` (`@/components/bookings/setup/*`), `LetterheadStep`, `TermsStep`, `CountersignStep` (`@/components/hireOrders/setup/*`). Verify each editor's current props by reading its file; wrap rather than modify.
- Produces: `<TaskPanel task onClose onNext />` frame (eyebrow by block, title, body, scroll body slot, footer "Saved as you go · Later · {primary}"); `taskPanelRegistry[key]` → the editor element for that task.

- [ ] **Step 1: Write failing test** — render `TaskPanel` for `flow`; assert the eyebrow ("Choice · sets everything downstream"), the title, and that the registry mounts the `FlowStep` editor (mock its module to a probe, or assert a known field it renders).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Build the frame from `screens/02_02_Task_panels.html` (choice/values/document share one frame + footer). The registry maps each task key to its editor; for tasks that were read-only steps (`ladder`, `eligibility`, `people` roster view) render the existing step body which already handles read-only. Panel width 440px on the board; the board column narrows when open (grid `1fr 440px`). Default the selected task to the first `!done && block in (offers,booking)` task on mount.

- [ ] **Step 4: Run — expect PASS.** `tsc` + `lint`.

- [ ] **Step 5: Commit** `feat(get-running): task panel frame + editor registry`.

---

### Task 8: Producer-scoped board (screen 03)

**Files:**
- Modify: `src/components/getRunning/TaskRow.tsx` (producer: adminOnly tasks show "Waits on {admin}" + a disabled/"View" affordance, no primary CTA; **no Nudge** per the confirmed decision)
- Modify: `src/pages/GetRunningPage.tsx` (producer headline/body variant; a role footer "You are on the Production Team…")
- Modify: `src/i18n/locales/{en,de}/getRunning.json` (producer strings, "Waits on {name}", role-cover footer)
- Test: extend `src/components/getRunning/PhaseCard.test.tsx`

**Interfaces:**
- Consumes: admin display names — reuse `useOrgAdminNames` (the booking waiting card already uses it; import from its current location).
- Produces: producer rows render `actionableByViewer=false` tasks as a "Waits on {admins}" grey chip with a ghost "View" button; actionable tasks render exactly as admin.

- [ ] **Step 1: Write failing test** — render the board as `producer` with `team` and `ladder` admin-only; assert "Waits on" appears and there is **no** "Nudge" control (confirming the omission).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** per `screens/03_03_Producer_view.html`, minus the Nudge button and its explainer strip (decision: omit Nudge for now). Keep the "View" affordance and the role-cover footer.

- [ ] **Step 4: Run — expect PASS.** `tsc` + `lint` + `keyParity`.

- [ ] **Step 5: Commit** `feat(get-running): producer-scoped board without nudge`.

---

### Task 9: Retirement state + "How this org works" (screen 04)

**Files:**
- Create: `src/components/getRunning/HowThisOrgWorks.tsx`
- Modify: `src/pages/GetRunningPage.tsx` (when `model.complete`, render the one-row "This workspace is running" state + "Hide from nav" + "How this org works")
- Modify: `src/components/layout/navItems.ts` or `AppLayout` nav filter (hide the Get running item when the board is complete AND dismissed — per-person via `useRailDismissed('getRunning', orgId)`)
- Modify: `src/pages/SettingsPage.tsx` (add an admin/producer "How this org works" tab hosting `<HowThisOrgWorks />`, giving the retired board a durable home)
- Modify: `src/i18n/locales/{en,de}/getRunning.json` + `settings.json`
- Test: `src/components/getRunning/HowThisOrgWorks.test.tsx`

**Interfaces:**
- Consumes: existing provenance — `useBookingFlowProvenance` and `src/data/settingsAudit.ts` (who changed which setting, when). Render read-only rows: current flow, offer timing, cast coverage summary, letterhead/terms/countersign state, each with its "set by {name}, {date}" line where available.
- Produces: `<HowThisOrgWorks />` read-only card; a `getRunning` dismissal namespace; nav hides Get running when `complete && dismissed`.

- [ ] **Step 1: Write failing test** — render `HowThisOrgWorks` with seeded provenance; assert it lists the booking flow value and a "set by" line and renders **no** editable control (no buttons that mutate).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** the retirement row + cards from `screens/04_04_Running.html`. "Hide from nav" calls `dismiss()` from `useRailDismissed('getRunning', orgId)` (per-person, matching every existing rail). The nav item's visibility: in `AppLayout`, filter out the Get running item when its model is `complete` and `dismissed` (read the hook there, or expose a small `useGetRunningNavVisible()` to avoid a heavy read in the layout — prefer the latter, gated to non-artist + entitled). Add the Settings "How this org works" tab in the new People/Workspace group (admin+producer, read-only).

- [ ] **Step 4: Run — expect PASS.** `tsc` + `lint` + `keyParity`.

- [ ] **Step 5: Commit** `feat(get-running): retirement state + How this org works reference`.

---

### Task 10: Edge states (nothing-on org, artist redirect, loading)

**Files:**
- Modify: `src/pages/GetRunningPage.tsx`
- Test: `src/pages/GetRunningPage.test.tsx`

**Interfaces:**
- Produces: `GetRunningPage` handles: (a) `isLoading` → skeleton; (b) `bookingOn=false && hireOrdersOn=false` → a single "nothing to set up" card (no board); (c) `role==='artist'` → redirect to `ROUTES.AVAILABILITY` (the artist board is screen 08, a later phase; the nav item is admin/producer-only, so an artist reaches this route only by direct URL — the page bounces them). Keep this bounce until the artist phase lands.

- [ ] **Step 1: Write failing test** — render as artist → asserts a `<Navigate>` to `/availability`; render nothing-on org → asserts the "nothing to set up" copy and no phase cards.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** the three branches.

- [ ] **Step 4: Run — expect PASS.** `tsc` + `lint`.

- [ ] **Step 5: Commit** `feat(get-running): loading, nothing-on, and artist-redirect states`.

---

### Task 11: Retire the old onboarding surfaces + rewire entry points

**Files (delete):** `src/components/dashboard/firstRun/*`, `src/components/setup/*` (SetupChecklistSheet, useModuleOnboardingRail, setupRailMode, DashboardSetupRail), `src/components/bookings/setup/BookingSetupRail.tsx` + `BookingProducerWaitingCard.tsx`, `src/components/hireOrders/setup/SetupRail.tsx` + `ProducerWaitingCard.tsx`. **KEEP** the step editor leaves the panel now uses (`FlowStep`, `SlotsStep`, `TimingStep`, `LadderStep`, `EligibilityStep`, `PeopleStep`, `LetterheadStep`, `TermsStep`, `CountersignStep`, `RehearsalBlock`, `FirstOfferCard`) and the pure status libs/hooks.
**Files (modify):** `src/pages/DashboardPage.tsx`, `src/components/dashboard/ArtistDashboard.tsx` (drop `<DashboardFirstRun>` mounts + `useDashboardFirstRun`), `src/pages/ShowsBookingsPage.tsx` + `src/pages/HireOrdersPage.tsx` (drop the `useModuleOnboardingRail` / `DashboardSetupRail` / SetupChecklistSheet mounts; keep the page minis). Any component whose CTA called `onOpenSetup(feature, step)` now links to `ROUTES.GET_RUNNING`.

**Interfaces:**
- Produces: no remaining imports of the deleted modules (a successful `tsc` + `lint` is the gate); dashboards and the two module pages render without an onboarding rail; every "set this up" affordance points at `/get-running`.

- [ ] **Step 1: Inventory** — `grep -rn "DashboardFirstRun\|useDashboardFirstRun\|useModuleOnboardingRail\|SetupChecklistSheet\|BookingSetupRail\|hireOrders/setup/SetupRail\|onOpenSetup" src/` and list every consumer.

- [ ] **Step 2: Write/adjust failing tests** — update any existing dashboard/bookings/hire-orders tests that asserted the rail; add a test that `ShowsBookingsPage` renders without throwing and contains no rail testid. Run — expect FAIL where the rail is still mounted.

- [ ] **Step 3: Implement** the deletions and edits. Remove now-dead i18n keys only if `keyParity` stays green (safer to leave orphan keys than break parity mid-sweep; clean up at the end).

- [ ] **Step 4: Run the full suite** `npx vitest run`, `tsc` (all three projects), `npm run lint`. Fix fallout. This is the task most likely to surface hidden consumers — do not skip the full typecheck.

- [ ] **Step 5: Commit** `refactor(onboarding): retire dashboard first-run and module setup rails for Get running`.

---

### Task 12: i18n completeness, mini decision, and verification

**Files:** `src/i18n/locales/{en,de}/getRunning.json`, `src/lib/minis/*` (only if adding a Get running mini), any orphan-key cleanup.

- [ ] **Step 1:** Run `npx vitest run src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts` — fix any EN/DE gap or dash/formal-"Sie" violation in the new namespace.
- [ ] **Step 2:** Decide the Get running page-mini: default **no mini** (the board self-describes; state "No mini — the board is the explainer" in the PR). If the reviewer wants one, add `src/lib/minis/pages/getRunning.ts` (bilingual, 4 role-aware steps) + illustration per the New-page checklist and register it.
- [ ] **Step 3:** Help-center impact — the onboarding flow changed; update `src/lib/help/items.ts` (EN+DE, "Du") to point users at Get running, or state "No help center impact." in the PR with reason.
- [ ] **Step 4:** Full gate: `npm run lint`, all three `tsc` projects, `npx vitest run`, `npm run test:coverage` (thresholds), `npm run sync:mirrors:check`.
- [ ] **Step 5: Commit** `chore(get-running): i18n parity, help center, verification`.

---

## Self-Review

**Spec coverage (screens 01–04):** header/progress (T5), phases+tasks (T6), 3 panel shapes (T7), producer view (T8), retirement + How-this-org-works (T9), edge states (T10). Nav IA asks (Help→System, Admin fold): T1–T2. Old-surface replacement: T11. i18n/mini/help: T12. Screens 05/06/10 excluded by decision; 07/08/09/11 are later phases (noted in header).

**Placeholder scan:** step editors are reused by name — Task 7 Step 1 requires reading each editor's props before wrapping (the one place the plan says "verify current props"; that is a real instruction, not a TODO).

**Type consistency:** `GetRunningTaskKey`/`GetRunningModel` defined in T3 are consumed unchanged by T4–T10. `useRailDismissed('getRunning', orgId)` namespace is used in T9 only. `datesDone` is defined as `shows.done` in T4 and refined in a later phase (noted).

**Open design-mapping to confirm at T3 review:** the 11-task split folds Airtable "dates" + "slots" into Phase 1 and counts `team` as task 8. If the reviewer wants "Get dates in" to be a single task (10 total, not 11), it changes only the `tasks.ts` constant + its test.
