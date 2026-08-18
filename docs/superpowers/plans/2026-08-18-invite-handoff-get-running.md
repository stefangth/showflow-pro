# Invite Handoff → Get Running (Screen 07) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the `AcceptInvitePage` success card so it names the Get running board instead of promising a setup list on the dashboard: admin/producer get a live board summary ("N tasks stand between this workspace and its first offer. Get running walks them in order. About M minutes.") with an **Open Get running** CTA; artists go straight to Availability.

**Architecture:** The success card's "what to do next" region becomes role-routed. A new pure helper `resolveHandoffPrimary(role, boardHasTasks)` decides the primary destination (`board` | `availability` | `dashboard`). For admin/producer with a board, the page mounts the existing `useGetRunning()` model and renders a live summary derived from it (reusing a new pure `firstOfferBlockingCount` shared with `GetRunningHeader`). The old admin-only next-step machinery (`ADMIN_SETUP_COMPLETE_LINE`, `PRODUCER_OFFERS_CONFIRM_LINE`, the five-query booking-setup-status loading gates, `useCan('confirm_bookings')`) is removed — the board summary replaces it. Artist keeps its existing booking-flow-aware next-step lines; only its CTA destination changes to Availability. `PostAcceptanceHandoff` is generalized from a dashboard-only button to a parameterized primary action.

**Tech Stack:** React 18 + TypeScript, react-i18next (auth namespace, EN canonical + DE), react-router-dom v6, `@tanstack/react-query` (via the existing domain hooks), Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-17-setup-settings-design/SPEC.md` (§5.5 screen 07) and its rendered design `screens/07_07_Invite_handoff.html`. Owner decisions for this phase (2026-08-18, AskUserQuestion): **live count + minutes** (mount the board model, match the design exactly) and **route artist → Availability now** (ahead of the fuller 08 redesign).

## Global Constraints

- **i18n:** Every new string via `t()` in the `auth` namespace, **EN and DE in the same change**. German is informal "Du", **no em/en dashes** anywhere (EN or DE). `src/i18n/keyParity.test.ts` fails CI on any EN/DE key gap; `src/i18n/copyLint.test.ts` fails on a dash or a "Sie". Reuse `src/i18n/terms.ts` `TERMS` for domain terms (Availability = `Verfügbarkeit`; the board name "Get running" stays English in DE, matching the existing `getRunning` namespace and help copy).
- **Styling:** Semantic tokens only (`text-foreground`, `text-muted-foreground`, `bg-card`, `Skeleton`). No hardcoded colors.
- **Roles:** `producer` displays as "Production Team" via `roleLabel()`; compare the literal `'producer'` only. Artists are gated out of the board by `useGetRunning` itself (returns `null` for a non-admin/non-producer).
- **Testing:** Pure helpers are TDD (test first, watch it fail, implement). Tests import the real module — never re-implement production logic in a test. Mock `useGetRunning` at the page boundary in the integration test (the file already mocks `useBookingFlow`, `useEntitlements`, `useCapabilities`, `AuthContext` the same way); do not let the board's five sub-queries run under the accept-page test.
- **Branch/PR:** New branch off `main` (e.g. `claude/invite-handoff-get-running-<suffix>`), its own PR. `main` requires a review approval — open the PR, do not self-merge. Run `npm run verify:fast` before pushing (the pre-push hook requires it).
- **Help center:** Update `src/lib/help/items.ts` if the change alters an invited user's question/answer, or state "No help center impact." in the PR (see Task 6).

---

### Task 1: Extract `firstOfferBlockingCount` (shared, pure)

`GetRunningHeader` currently derives its blocking count inline. The accept page needs the identical number, so lift it into the pure composer module and reuse it in both places (DRY, single source of truth for "what blocks the first offer").

**Files:**
- Modify: `src/lib/getRunning/tasks.ts` (add exported helper near the bottom, after `composeGetRunning`)
- Modify: `src/components/getRunning/GetRunningHeader.tsx:5-9,33-34` (replace the local `isFirstOfferBlocker` + inline `blockingCount`)
- Test: `src/lib/getRunning/tasks.test.ts` (append a describe block)

**Interfaces:**
- Produces: `export function firstOfferBlockingCount(model: GetRunningModel): number` — count of not-done tasks whose `block` is `"offers"` or `"booking"` (the exact set `canFirstOffer` is derived from).

- [ ] **Step 1: Write the failing test**

Append to `src/lib/getRunning/tasks.test.ts` (it already imports `composeGetRunning` and the `EMPTY_BOOKING_INPUT`/`baseInput` helpers; add `firstOfferBlockingCount` to the existing import from `./tasks`):

```ts
import { composeGetRunning, firstOfferBlockingCount, type GetRunningInput /* ...existing... */ } from "./tasks";

describe("firstOfferBlockingCount", () => {
  it("counts only not-done offers/booking blockers", () => {
    const model = composeGetRunning(
      baseInput({
        booking: computeBookingSetupStatus(EMPTY_BOOKING_INPUT),
        hire: computeSetupStatus(EMPTY_HIRE_INPUT),
        datesDone: false,
        producerCount: 0,
      }),
    );
    // people (block "booking") and ladder (block "offers") are the first-offer blockers in
    // a blank org; slots is "filling" and letterhead/terms are "issuing" -- excluded.
    expect(firstOfferBlockingCount(model)).toBe(model.phases
      .flatMap((p) => p.tasks)
      .filter((t) => !t.done && (t.block === "offers" || t.block === "booking")).length);
    expect(firstOfferBlockingCount(model)).toBeGreaterThan(0);
  });

  it("is zero for a fully-done board", () => {
    expect(firstOfferBlockingCount(composeGetRunning(baseInput()))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/getRunning/tasks.test.ts`
Expected: FAIL — `firstOfferBlockingCount is not a function` / not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/lib/getRunning/tasks.ts`:

```ts
/** Count of not-done tasks that hold up the org's first offer (the offers/booking
 *  blockers `canFirstOffer` is derived from). Shared by GetRunningHeader and the
 *  accept-invite handoff so both report the same number. */
export function firstOfferBlockingCount(model: GetRunningModel): number {
  return model.phases
    .flatMap((p) => p.tasks)
    .filter((t) => !t.done && (t.block === "offers" || t.block === "booking")).length;
}
```

- [ ] **Step 4: Reuse it in `GetRunningHeader`**

In `src/components/getRunning/GetRunningHeader.tsx`: import `firstOfferBlockingCount` from `@/lib/getRunning/tasks` (add to the existing type import line, making it a value+type import), delete the local `isFirstOfferBlocker` function (lines 5-9), and replace:

```ts
  const allTasks = model.phases.flatMap((p) => p.tasks);
  const blockingCount = allTasks.filter((task) => isFirstOfferBlocker(task) && !task.done).length;
```

with:

```ts
  const allTasks = model.phases.flatMap((p) => p.tasks);
  const blockingCount = firstOfferBlockingCount(model);
```

(`allTasks` is still used just below for `yoursCount`/`waitsCount`, so keep it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/getRunning/tasks.test.ts src/components/getRunning/GetRunningHeader.test.tsx`
Expected: PASS (GetRunningHeader's existing tests still green — the number is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/lib/getRunning/tasks.ts src/lib/getRunning/tasks.test.ts src/components/getRunning/GetRunningHeader.tsx
git commit -m "extract firstOfferBlockingCount for reuse in the invite handoff"
```

---

### Task 2: Pure handoff resolvers on `AcceptInvitePage`

Add the two pure functions the render will branch on. TDD, colocated and exported like the page's existing `resolveBookingRunState`/`resolveNextStepLine` (the test file imports these directly).

**Files:**
- Modify: `src/pages/AcceptInvitePage.tsx` (add near the other exported pure helpers, ~line 96-204)
- Test: `src/pages/AcceptInvitePage.test.tsx` (append a `describe` in the pure-logic area near the existing `resolveBookingRunState`/`resolveNextStepLine` unit tests)

**Interfaces:**
- Consumes: `GetRunningModel` from `@/lib/getRunning/tasks`; `AppRole` from `@/config/app.config`.
- Produces:
  - `export type HandoffPrimary = 'board' | 'availability' | 'dashboard';`
  - `export function resolveHandoffPrimary(role: AppRole | null, boardHasTasks: boolean): HandoffPrimary`
  - `export type BoardHandoffState = 'blocking' | 'ready' | 'complete';`
  - `export function resolveBoardHandoffState(model: GetRunningModel): BoardHandoffState`

- [ ] **Step 1: Write the failing tests**

Append to `src/pages/AcceptInvitePage.test.tsx` (add `resolveHandoffPrimary`, `resolveBoardHandoffState` to the existing import from `./AcceptInvitePage`; import `type GetRunningModel` from `@/lib/getRunning/tasks`):

```ts
describe("resolveHandoffPrimary", () => {
  it("sends an artist to availability regardless of the board", () => {
    expect(resolveHandoffPrimary("artist", false)).toBe("availability");
    expect(resolveHandoffPrimary("artist", true)).toBe("availability");
  });
  it("sends an admin/producer with a board to the board", () => {
    expect(resolveHandoffPrimary("admin", true)).toBe("board");
    expect(resolveHandoffPrimary("producer", true)).toBe("board");
  });
  it("falls back to the dashboard for an admin/producer with no board (nothing on)", () => {
    expect(resolveHandoffPrimary("admin", false)).toBe("dashboard");
    expect(resolveHandoffPrimary("producer", false)).toBe("dashboard");
  });
  it("falls back to the dashboard when the role is unknown", () => {
    expect(resolveHandoffPrimary(null, false)).toBe("dashboard");
  });
});

describe("resolveBoardHandoffState", () => {
  const model = (over: Partial<GetRunningModel>): GetRunningModel => ({
    phases: [], doneCount: 0, totalCount: 1, canFirstOffer: false, complete: false,
    bookingOn: true, hireOrdersOn: false, ...over,
  });
  it("is blocking while the first offer is held up", () => {
    expect(resolveBoardHandoffState(model({ canFirstOffer: false, complete: false }))).toBe("blocking");
  });
  it("is ready once the first offer can go out but tasks remain", () => {
    expect(resolveBoardHandoffState(model({ canFirstOffer: true, complete: false }))).toBe("ready");
  });
  it("is complete once every task is done", () => {
    expect(resolveBoardHandoffState(model({ canFirstOffer: true, complete: true }))).toBe("complete");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/AcceptInvitePage.test.tsx -t "resolveHandoffPrimary"`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the resolvers**

In `src/pages/AcceptInvitePage.tsx`, add an import for the model + blocking-count helper and the two functions (place them beside `resolveBookingRunState`, keeping the `// eslint-disable-next-line react-refresh/only-export-components` line before each exported function, matching the file's existing pattern):

```ts
import { useGetRunning } from '@/hooks/useGetRunning';
import { firstOfferBlockingCount, type GetRunningModel } from '@/lib/getRunning/tasks';

export type HandoffPrimary = 'board' | 'availability' | 'dashboard';

/** Where the success card's primary CTA points, and which summary it shows. Artists have
 *  no Get running board (screen 08), so they go straight to Availability. An admin/producer
 *  whose org has at least one module on gets the board; with no module on there is nothing
 *  to set up, so they fall back to the dashboard. */
// eslint-disable-next-line react-refresh/only-export-components
export function resolveHandoffPrimary(role: AppRole | null, boardHasTasks: boolean): HandoffPrimary {
  if (role === 'artist') return 'availability';
  if (boardHasTasks) return 'board';
  return 'dashboard';
}

export type BoardHandoffState = 'blocking' | 'ready' | 'complete';

/** The board-summary variant, mirroring GetRunningHeader's own state derivation so the
 *  handoff and the board it leads to never disagree. */
// eslint-disable-next-line react-refresh/only-export-components
export function resolveBoardHandoffState(model: GetRunningModel): BoardHandoffState {
  return model.complete ? 'complete' : model.canFirstOffer ? 'ready' : 'blocking';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/AcceptInvitePage.test.tsx -t "resolveHandoffPrimary"` then `-t "resolveBoardHandoffState"`
Expected: PASS. (The rest of the file will not compile yet if you imported `useGetRunning`/`GetRunningModel` unused — that is fine until Task 4 wires them; if the test runner complains about an unused import, proceed straight into Task 4 in the same working session rather than committing a broken build. To keep this task independently committable, defer the `useGetRunning` import to Task 4 and import only `firstOfferBlockingCount, type GetRunningModel` here.)

- [ ] **Step 5: Commit**

```bash
git add src/pages/AcceptInvitePage.tsx src/pages/AcceptInvitePage.test.tsx
git commit -m "add pure handoff-destination resolvers to AcceptInvitePage"
```

---

### Task 3: Copy — board summary + availability CTA (EN + DE)

**Files:**
- Modify: `src/i18n/locales/en/auth.json` (under `acceptInvite`)
- Modify: `src/i18n/locales/de/auth.json` (under `acceptInvite`, same keys)
- Test: `src/i18n/keyParity.test.ts` + `src/i18n/copyLint.test.ts` (existing gates — no new test authored, just kept green)

**Interfaces:**
- Produces (translation keys, `auth` namespace):
  - `acceptInvite.goToAvailability`
  - `acceptInvite.board.blocking_one` / `acceptInvite.board.blocking_other` (interpolates `{{count}}`)
  - `acceptInvite.board.blockingSub` (interpolates `{{minutes}}`)
  - `acceptInvite.board.ready` / `acceptInvite.board.readySub`
  - `acceptInvite.board.complete` / `acceptInvite.board.completeSub`
  - `acceptInvite.board.open`

- [ ] **Step 1: Add the EN keys**

In `src/i18n/locales/en/auth.json`, inside `acceptInvite`, add `goToAvailability` next to `goToDashboard`, and a new `board` object:

```json
"goToAvailability": "Go to availability",
"board": {
  "blocking_one": "One task stands between this workspace and its first offer",
  "blocking_other": "{{count}} tasks stand between this workspace and its first offer",
  "blockingSub": "Get running walks them in order. About {{minutes}} minutes.",
  "ready": "This workspace can send its first offer",
  "readySub": "A few optional tasks are left. Get running keeps them in order.",
  "complete": "This workspace is set up",
  "completeSub": "Get running keeps the whole picture, any time you need it.",
  "open": "Open Get running"
}
```

- [ ] **Step 2: Add the DE keys (same shape, informal Du, no dashes)**

In `src/i18n/locales/de/auth.json`, inside `acceptInvite`:

```json
"goToAvailability": "Zur Verfügbarkeit",
"board": {
  "blocking_one": "Eine Aufgabe steht zwischen diesem Arbeitsbereich und seinem ersten Angebot",
  "blocking_other": "{{count}} Aufgaben stehen zwischen diesem Arbeitsbereich und seinem ersten Angebot",
  "blockingSub": "Get running führt dich der Reihe nach durch. Etwa {{minutes}} Minuten.",
  "ready": "Dieser Arbeitsbereich kann sein erstes Angebot senden",
  "readySub": "Ein paar optionale Aufgaben sind noch offen. Get running hat sie der Reihe nach.",
  "complete": "Dieser Arbeitsbereich ist eingerichtet",
  "completeSub": "Get running behält das ganze Bild, wann immer du es brauchst.",
  "open": "Get running öffnen"
}
```

- [ ] **Step 3: Run the i18n gates**

Run: `npx vitest run src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts`
Expected: PASS. If keyParity fails, an EN key has no DE twin (or vice versa) — diff the two `acceptInvite` blocks. If copyLint fails, remove the em/en dash it names.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/auth.json src/i18n/locales/de/auth.json
git commit -m "add invite-handoff board summary + availability copy (EN + DE)"
```

---

### Task 4a: Generalize `PostAcceptanceHandoff` to a parameterized primary action

`PostAcceptanceHandoff` hardcodes "Go to dashboard" + `onDashboard` in four internal branches. Parameterize it so the parent can point it at the board, availability, or the dashboard.

**Files:**
- Modify: `src/pages/AcceptInvitePage.tsx:218-324` (the `PostAcceptanceHandoff` component) and its one call site (`:599-602`)
- Test: `src/pages/AcceptInvitePage.test.tsx` (the "calm sign-in handoff" describe, ~397-503)

**Interfaces:**
- Produces: `PostAcceptanceHandoff` now takes `{ primaryLabel: string; primaryIsDeadEnd: boolean; onPrimary: () => void }` instead of `{ dashboardIsDeadEnd: boolean; onDashboard: () => void }`.

- [ ] **Step 1: Rename the props and internal usages**

In `PostAcceptanceHandoff`:
- Change the prop type to `{ primaryLabel: string; primaryIsDeadEnd: boolean; onPrimary: () => void }` and destructure `{ primaryLabel, primaryIsDeadEnd, onPrimary }`.
- Replace every `dashboardIsDeadEnd` → `primaryIsDeadEnd` (3 occurrences at the button `variant`).
- Replace every `onClick={onDashboard}` → `onClick={onPrimary}` (lines 244-ish, 261, 271, 301).
- Replace every `{t('acceptInvite.goToDashboard')}` **inside this component** → `{primaryLabel}` (3 occurrences at lines 245, 262, 272). Leave the `acceptInvite.goToDashboard` usages OUTSIDE this component (error card `:635`, different-account card `:520`) untouched — those are unrelated escape hatches.

- [ ] **Step 2: Update the call site (temporary dashboard wiring)**

At `:599-602`, temporarily keep dashboard behavior so this task builds and tests on its own (Task 4b swaps in the role-routed destination):

```tsx
<PostAcceptanceHandoff
  primaryLabel={t('acceptInvite.goToDashboard')}
  primaryIsDeadEnd={dashboardIsDeadEnd}
  onPrimary={() => navigate(ROUTES.DASHBOARD, { replace: true })}
/>
```

- [ ] **Step 3: Run the handoff tests**

Run: `npx vitest run src/pages/AcceptInvitePage.test.tsx -t "calm sign-in handoff"`
Expected: PASS unchanged — the label/route are still dashboard, only the prop names moved. (These tests assert on the rendered "Go to dashboard" text and `navigate(ROUTES.DASHBOARD)`, both still true here.)

- [ ] **Step 4: Commit**

```bash
git add src/pages/AcceptInvitePage.tsx
git commit -m "parameterize PostAcceptanceHandoff primary action"
```

---

### Task 4b: Route the success card by role, render the board summary, remove the dead admin machinery

This is the core change. For admin/producer with a board, render the live board summary and point the CTA at Get running. For an artist, point the CTA at Availability. Remove the now-unreachable admin next-step machinery.

**Files:**
- Modify: `src/pages/AcceptInvitePage.tsx` (the `AcceptInvitePage` component body `:341-607`, plus delete `ADMIN_SETUP_COMPLETE_LINE` `:161-167` and `PRODUCER_OFFERS_CONFIRM_LINE` `:135-148`, and simplify `resolveNextStepLine` `:169-204`)
- Test: `src/pages/AcceptInvitePage.test.tsx` (large rewrite — see Task 5)

**Interfaces:**
- Consumes: `resolveHandoffPrimary`, `resolveBoardHandoffState`, `firstOfferBlockingCount`, `useGetRunning`, `ROUTES.GET_RUNNING`, `ROUTES.AVAILABILITY`.
- Produces: `resolveNextStepLine(role: AppRole, bookingState: BookingRunState, artistLinked?: boolean): string` (dropped the `bookingSetupComplete` and `canConfirmBookings` params).

- [ ] **Step 1: Simplify `resolveNextStepLine` and delete the two special-case lines**

Delete the `PRODUCER_OFFERS_CONFIRM_LINE` const (`:135-148`) and the `ADMIN_SETUP_COMPLETE_LINE` const (`:161-167`). Replace `resolveNextStepLine` (`:169-204`) with:

```ts
/**
 * The one next-step sentence for the non-board path: artists (all booking states), and
 * admin/producer only at a nothing-on org (both modules off -> bookingState 'off'). The
 * board summary replaces this for any admin/producer whose org has a module on.
 *
 * 1. `!artistLinked` (artist only): no `artists` row exists yet, so neither the offers nor
 *    the direct-booking promise can come true -- see ARTIST_NOT_LINKED_NEXT_STEP_LINE.
 * 2. Otherwise the plain NEXT_STEP_LINES entry for the role and booking state.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function resolveNextStepLine(
  role: AppRole,
  bookingState: BookingRunState,
  artistLinked = true,
): string {
  if (role === 'artist' && !artistLinked) return ARTIST_NOT_LINKED_NEXT_STEP_LINE;
  return NEXT_STEP_LINES[role][bookingState];
}
```

Keep `NEXT_STEP_LINES` (all roles/states) and `ARTIST_NOT_LINKED_NEXT_STEP_LINE` as-is: artist reads offers/direct/off, admin/producer read off. (The admin/producer offers/direct entries stay as data — `resolveNextStepLine` remains a total resolver; the page's routing decides when the board summary supersedes it.)

- [ ] **Step 2: Remove the admin setup-status + confirm machinery from the component body**

In `AcceptInvitePage`:
- Delete the `useBookingSetupStatus` import (`:15`) and the `useCan` import if now unused (`:14` — it is only used for `confirm_bookings`, so remove it).
- Delete `canConfirmBookings` (`:399`), `setupStatusOrgId` (`:407-408`), the `useBookingSetupStatus(...)` call (`:409`), and `bookingSetupLoading` usage.
- Add `const getRunning = useGetRunning();` alongside the other unconditional hooks (after `useBookingFlow`). It reads `useAuth().currentOrg` internally, which is the joined org by the time `joined` is set (same reasoning as `useFeature('booking_flow')` — `switchOrg(orgId)` ran in the same batched `.then`). Note: before `joined` exists, `currentOrg` is typically `null` for a fresh invitee, so `useGetRunning` fires no board reads; a multi-org accepter may trigger one cache-warming read for their prior org, which is harmless.
- Keep `useFeature('booking_flow')` (`bookingModuleOn`), `useEntitlements().isLoading` (`entitlementsLoading`), and `useBookingFlow` (`bookingFlow`, `bookingFlowLoading`) — the artist line still needs `resolveBookingRunState`.

- [ ] **Step 3: Compute routing + summary inputs in the `if (joined)` block**

Inside `if (joined)` (after `const bookingState = ...` at ~`:531`), replace `dashboardIsDeadEnd` and add:

```tsx
const boardHasTasks = role !== 'artist' && !!getRunning.model && getRunning.model.totalCount > 0;
const primary = resolveHandoffPrimary(role, boardHasTasks);
const boardState = getRunning.model ? resolveBoardHandoffState(getRunning.model) : 'blocking';
const blockingCount = getRunning.model ? firstOfferBlockingCount(getRunning.model) : 0;
// The artist's availability target is a dead end while their profile is unlinked (it can
// only say an admin still has to link it), matching the prior dashboard-dead-end demotion.
const primaryIsDeadEnd = role === 'artist' && !joined.artistLinked;
const primaryCta = {
  board: { label: t('acceptInvite.board.open'), route: ROUTES.GET_RUNNING },
  availability: { label: t('acceptInvite.goToAvailability'), route: ROUTES.AVAILABILITY },
  dashboard: { label: t('acceptInvite.goToDashboard'), route: ROUTES.DASHBOARD },
}[primary];
```

- [ ] **Step 4: Render the board summary vs the next-step line**

Replace the existing `{role && ( nextStepReady ? ... : <Skeleton .../> )}` block (`:580-598`) with:

```tsx
{primary === 'board' ? (
  getRunning.model && !getRunning.isLoading ? (
    <div className="space-y-1 text-center" data-testid="board-handoff-summary">
      <p className="text-sm font-medium text-foreground">
        {boardState === 'blocking'
          ? t('acceptInvite.board.blocking', { count: blockingCount })
          : t(`acceptInvite.board.${boardState}`)}
      </p>
      <p className="text-sm text-muted-foreground">
        {boardState === 'blocking'
          ? t('acceptInvite.board.blockingSub', { minutes: blockingCount * 3 })
          : t(`acceptInvite.board.${boardState}Sub`)}
      </p>
    </div>
  ) : (
    <Skeleton data-testid="board-summary-loading" className="mx-auto h-8 w-3/4" />
  )
) : role ? (
  !entitlementsLoading && !bookingFlowLoading ? (
    <p className="text-sm text-muted-foreground">
      {resolveNextStepLine(role, bookingState, joined.artistLinked)}
    </p>
  ) : (
    <Skeleton data-testid="next-step-line-loading" className="mx-auto h-4 w-3/4" />
  )
) : null}
```

Delete the now-unused `nextStepReady` const (it referenced `bookingSetupLoading`).

- [ ] **Step 5: Wire the parameterized handoff**

Replace the temporary call site from Task 4a:

```tsx
<PostAcceptanceHandoff
  primaryLabel={primaryCta.label}
  primaryIsDeadEnd={primaryIsDeadEnd}
  onPrimary={() => navigate(primaryCta.route, { replace: true })}
/>
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS. If it flags an unused `BookingRunState`/`useCan`/`useBookingSetupStatus` import, delete it. If it flags `resolveNextStepLine` call arity in the test file, that is expected — Task 5 fixes the tests.

- [ ] **Step 7: Commit** (tests come in Task 5; commit the source so the diff is reviewable in two halves)

```bash
git add src/pages/AcceptInvitePage.tsx
git commit -m "route invite handoff by role: board summary, Open Get running, artist to Availability"
```

---

### Task 5: Migrate the `AcceptInvitePage` integration tests

The success-screen suite currently asserts the old admin next-step machinery. Mock `useGetRunning` at the boundary, retarget the admin/producer success tests to the board summary + Open Get running, retarget the artist test to Availability, and delete the setup-status blocks.

**Files:**
- Modify: `src/pages/AcceptInvitePage.test.tsx`

- [ ] **Step 1: Add the `useGetRunning` mock + a model factory**

Near the other `vi.mock` blocks (after the `useCapabilities` mock, ~`:122`), add:

```ts
import type { GetRunningModel } from "@/lib/getRunning/tasks";

// A minimal board model. Default: an admin org with two first-offer blockers still open,
// so the default (admin) success test renders "2 tasks stand between..." + "About 6 minutes".
function boardModel(over: Partial<GetRunningModel> = {}): GetRunningModel {
  return {
    phases: [
      { key: "bookable", tasks: [
        { key: "people", phase: "bookable", done: false, block: "booking", adminOnly: false, actionableByViewer: true },
        { key: "ladder", phase: "bookable", done: false, block: "offers", adminOnly: false, actionableByViewer: true },
      ] },
    ],
    doneCount: 0, totalCount: 8, canFirstOffer: false, complete: false,
    bookingOn: true, hireOrdersOn: false, ...over,
  };
}
const getRunningHolder: { model: GetRunningModel | null; isLoading: boolean } = { model: boardModel(), isLoading: false };
vi.mock("@/hooks/useGetRunning", () => ({
  useGetRunning: () => getRunningHolder,
}));
```

Remove the now-unused `useBookingSetup` mock (`:142-153`) and its `bookingSetupHolder`/`bookingSetupLoadingHolder`/`bookingSetupStatusMock` (the page no longer calls `useBookingSetupStatus` directly — `useGetRunning` is mocked wholesale). Remove the `useCapabilities` mock's `confirm_bookings` branch only if nothing else needs it (the page no longer calls `useCan`; you can drop the whole `useCapabilities` mock). Remove the imports of `ADMIN_SETUP_COMPLETE_LINE` and `PRODUCER_OFFERS_CONFIRM_LINE` (`:7-8`) and `canConfirmHolder`.

- [ ] **Step 2: Reset the holder in `beforeEach`**

In `beforeEach` (~`:207`), add `getRunningHolder.model = boardModel(); getRunningHolder.isLoading = false;` and remove the deleted holders' resets (`bookingSetupHolder`, `bookingSetupLoadingHolder`, `bookingSetupStatusMock.mockClear()`, `canConfirmHolder`).

- [ ] **Step 3: Delete the obsolete describe blocks**

Delete these whole blocks (they tested machinery that no longer exists):
- `describe("next-step line waits for its data instead of rendering a claim that then swaps", ...)` (~`:661-767`) — the admin setup-status + entitlements loading gates.
- `describe("the five-query booking setup status read is admin-only, ...", ...)` (~`:770-812`).
- `describe("admin next-step line does not promise a setup list an already-configured org does not have", ...)` (~`:814-...`) — everything asserting `ADMIN_SETUP_COMPLETE_LINE`/`PRODUCER_OFFERS_CONFIRM_LINE`.

Keep: the error-path suite, the "calm sign-in handoff" suite (already retargeted in 4a), role-label/precedence tests, and the artist branch of the booking-flow-aware suite (retarget in Step 5).

- [ ] **Step 4: Add board-summary success tests (admin + producer)**

Add a new describe:

```ts
describe("admin/producer handoff names the Get running board", () => {
  it("shows the live blocking summary and an Open Get running CTA for an admin", async () => {
    getRunningHolder.model = boardModel(); // 2 blockers -> 6 minutes
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
    expect(await screen.findByTestId("board-handoff-summary")).toHaveTextContent(
      "2 tasks stand between this workspace and its first offer",
    );
    expect(screen.getByTestId("board-handoff-summary")).toHaveTextContent("About 6 minutes.");
    fireEvent.click(screen.getByRole("button", { name: "Open Get running" }));
    expect(navigateSpy).toHaveBeenCalledWith(ROUTES.GET_RUNNING, { replace: true });
  });

  it("shows the ready line once the first offer can go out", async () => {
    getRunningHolder.model = boardModel({ canFirstOffer: true });
    authState.memberships = [membershipFor("producer")];
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
    expect(await screen.findByText("This workspace can send its first offer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Get running" })).toBeInTheDocument();
  });

  it("holds a skeleton until the board model settles", async () => {
    getRunningHolder.model = null;
    getRunningHolder.isLoading = true;
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
    expect(await screen.findByTestId("board-summary-loading")).toBeInTheDocument();
  });

  it("falls back to the dashboard line + CTA for an admin at a nothing-on org", async () => {
    getRunningHolder.model = boardModel({ phases: [], totalCount: 0, complete: true, bookingOn: false });
    featureHolder.bookingFlowOn = false; // artist/off line source
    acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
    renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
    expect(await screen.findByText(NEXT_STEP_LINES.admin.off)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to dashboard" }));
    expect(navigateSpy).toHaveBeenCalledWith(ROUTES.DASHBOARD, { replace: true });
  });
});
```

- [ ] **Step 5: Retarget the artist branch to Availability**

In the booking-flow-aware suite (~`:587-660`), keep the artist case and assert its CTA now goes to Availability. Add/adjust:

```ts
it("sends an artist to Availability, not the board", async () => {
  authState.memberships = [membershipFor("artist")];
  flowHolder.flow = applyPreset(BOOKING_FLOW_DEFAULTS, "classic"); // offers-running
  acceptInvitationMock.mockResolvedValueOnce({ orgId: org1.id, artistLinked: true });
  renderAt(`${ROUTES.ACCEPT_INVITE}?token=abc123`);
  expect(await screen.findByText(NEXT_STEP_LINES.artist.offers)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Go to availability" }));
  expect(navigateSpy).toHaveBeenCalledWith(ROUTES.AVAILABILITY, { replace: true });
});
```

For any existing admin/producer case in that suite that asserted `NEXT_STEP_LINES.admin.offers`/`.producer.direct` etc., either delete it (covered by the board tests now) or convert it to an artist case — an admin/producer with `bookingFlowOn` true now renders the board summary, not those lines.

- [ ] **Step 6: Fix the pure `resolveNextStepLine` unit tests**

Any direct `resolveNextStepLine(role, state, complete, canConfirm, linked)` call must drop to `resolveNextStepLine(role, state, linked)`. Delete assertions that expected `ADMIN_SETUP_COMPLETE_LINE` / `PRODUCER_OFFERS_CONFIRM_LINE` (those consts are gone). Keep the artist not-linked assertion.

- [ ] **Step 7: Run the whole file**

Run: `npx vitest run src/pages/AcceptInvitePage.test.tsx`
Expected: PASS. Iterate on any leftover reference to a deleted const/holder.

- [ ] **Step 8: Commit**

```bash
git add src/pages/AcceptInvitePage.test.tsx
git commit -m "migrate AcceptInvitePage tests to the board-summary handoff"
```

---

### Task 6: Help center, full verification, PR

**Files:**
- Possibly modify: `src/lib/help/items.ts` (EN + DE)
- No new test authored; run the full gate.

- [ ] **Step 1: Help center check**

The invited producer/artist now land differently. Review `src/lib/help/items.ts` items with `surface: 'Invitation email'` / `'Get running board · Help center'` (e.g. `P0.1`, `P0.2`) and the admin `A2.*` items. If any answer implies the handoff sends people to the dashboard, update it (EN + DE, Du, no dashes) to say the handoff opens Get running (admin/producer) or Availability (artist). If nothing needs to change, note "No help center impact." in the PR body with that reasoning.

- [ ] **Step 2: Run the full fast gate**

Run: `npm run verify:fast`
Expected: all layers PASS (lint, typecheck:app, typecheck:tools, build, unit+coverage, deno). Coverage note: this task net-deletes code (`ADMIN_SETUP_COMPLETE_LINE`, `PRODUCER_OFFERS_CONFIRM_LINE`, setup-status wiring) and its tests together, so thresholds should hold; if `unit+coverage` dips below a threshold on a file, add a focused test rather than lowering the threshold.

- [ ] **Step 3: Manual smoke (optional but recommended)**

`npm run local:up && npm run dev`, accept an invite as a seeded admin against a fresh org, and confirm the card reads "N tasks stand between this workspace and its first offer" + "Open Get running" routes to `/get-running`. Switch the seed to an artist and confirm "Go to availability" routes to `/availability`.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin claude/invite-handoff-get-running-<suffix>
gh pr create --base main --title "invite handoff names the Get running board (screen 07)" --body-file <path>
```

PR body should cover: the screen-07 design link, the two owner decisions (live count + minutes; artist → Availability now), the removal of the admin next-step machinery, the test migration, and the help-center outcome. Do not self-merge — `main` requires a review approval.

---

## Self-Review

**Spec coverage (§5.5 screen 07):**
- "reworded to name the board ('Open Get running')" → Task 3 copy + Task 4b CTA/summary. ✓
- "Per-role next-step lines already exist" → artist lines kept (Task 4b Step 1), admin/producer replaced by board summary. ✓
- Design per-role matrix (Admin: all 11 tasks board; Production Team: scoped board; Artist: no board, straight to Availability; nothing-on: nothing to set up) → `resolveHandoffPrimary` (Task 2) covers all four; the board itself already scopes producer vs admin via `actionableByViewer`. ✓
- Owner decision "live count + minutes" → `firstOfferBlockingCount` + `useGetRunning` mount (Tasks 1, 4b). ✓
- Owner decision "artist → Availability now" → Task 4b Step 3 `primaryCta.availability`. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N" — every code step carries real code. The one soft spot (Task 5's "any existing admin/producer case … delete or convert") is inherent to migrating a pre-existing suite; the rule given (admin/producer + bookingFlowOn ⇒ board summary, so those old lines are unreachable) is deterministic.

**Type consistency:** `HandoffPrimary`/`BoardHandoffState`/`resolveHandoffPrimary`/`resolveBoardHandoffState`/`firstOfferBlockingCount` names are used identically in Tasks 1, 2, 4b, 5. `resolveNextStepLine`'s new 3-arg signature (Task 4b Step 1) matches its call in Task 4b Step 4 and the unit-test fix in Task 5 Step 6. `PostAcceptanceHandoff`'s new props (`primaryLabel`/`primaryIsDeadEnd`/`onPrimary`, Task 4a) match the call site in Task 4b Step 5.

**Known trade-off (documented, not a gap):** `NEXT_STEP_LINES.admin.offers/.direct` and `.producer.offers/.direct` become unreachable via the page's routing (admin/producer with a module on always get the board summary). They are kept as data so `resolveNextStepLine` stays a total resolver with its own unit coverage; a reviewer may reasonably ask to prune them to `off`-only — a follow-up, not required for this phase.
