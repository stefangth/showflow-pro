# Wireflow v3: v1 board cutover (delete v1, v3 unconditional) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the v1 "Get running" board and make the Wireflow v3 board the one and only board for every org, removing the per-org runtime override and its super-admin toggle.

**Architecture:** The runtime cutover already shipped (v3 is the app default; v1 only appears under an explicit `getrunning_v3_enabled = false` app_settings override). This plan removes that override entirely, then deletes the v1 board *UI* and its UI-only plumbing. The pure model layer (`src/lib/getRunning/tasks.ts`) and the `useGetRunning` hook are **kept** as the shared board-summary model for `HomeLanding` and `AcceptInvitePage`; the v1 *panel bodies* (`panels/{People,Ladder,Eligibility,Team}PanelBody`, `panels/airtable/*`) are **kept** because the v3 wizard reuses them. Consumers are migrated off the deleted code first (Tasks 1-5), then the now-orphaned code is deleted (Tasks 6-7).

**Tech Stack:** React 18 + TS, Vitest + @testing-library/react (jsdom), react-i18next (EN/DE key-parity gate), Tailwind. No DB/edge changes.

**Spec:** `docs/superpowers/specs/2026-08-23-wireflow-v3-get-running-settings-design.md` §8 ("Settings mirror, retirement, deep-linking, deprecation") and `docs/superpowers/specs/wireflow-v3-settings-deprecation.md`. This plan is the deferred "v1 deletion + build-flag removal" cutover that §8 and PR #339 left for a later phase.

## Global Constraints

- **Owner decisions (locked, AskUserQuestion 2026-08-25):** (1) Toggle fate = **remove it entirely; v3 unconditional** — delete `getRunningFlag.ts`, `useGetRunningV3Enabled`, `GetRunningV3Toggle`, and all `getrunning_v3_enabled` usage. (2) **Proceed with the destructive deletion now.**
- **KEEP, do not delete:** `src/lib/getRunning/tasks.ts`, `src/hooks/useGetRunning.ts`, `src/lib/getRunning/steps.ts` + `stepFeature.ts` + `stepHeading.ts` + `stepHelp.ts`, `src/components/getRunning/HowThisOrgWorks.tsx`, `src/components/getRunning/panels/{People,Ladder,Eligibility,Team}PanelBody.tsx`, `src/components/getRunning/panels/CastRosterList.tsx`, `src/components/getRunning/panels/UnlocksNote.tsx`, `src/components/getRunning/panels/airtable/*`, and everything under `src/components/getRunning/v3/**` except `GetRunningV3Toggle.*`.
- **npm only.** Type-check spans three projects: `npx tsc -p tsconfig.app.json --noEmit`, `npx tsc -p tsconfig.tools.json --noEmit`, `deno check` (no edge changes here, so app project is the one that matters). Lint gate is `npm run lint` at `--max-warnings 0`.
- **Copy rules:** no em/en dashes, German is Du-form; `src/i18n/copyLint.test.ts` + `keyParity.test.ts` enforce this. Only the `toggle` i18n block is removed; do it in EN **and** DE together so key parity stays green.
- **No changelog entry.** This is internal cleanup plus removal of a super-admin-only toggle; CLAUDE.md excludes refactors and forbids mentioning super-admin actions in `public/changelog.md`. The v3 board already shipped as the default, so there is nothing new for users to announce. Do **not** touch `public/changelog.md` / `public/changelog.json` or bump the version.
- **Every task ends build-green.** After each task: the app type-checks, `npm run lint` is clean, and the touched test suites pass. Run the full `npx vitest run` before the final task (per the P5 lesson: per-file runs missed cross-file fixture breakage).
- **Commit per task** with an imperative, lowercase, <=72-char subject; end the body with the Co-Authored-By trailer.

---

### Task 1: Migrate FlowStep's footer action from the v1 context to `WizardFooterAction`

`FlowStep` is the only non-provider consumer of the soon-deleted `TaskPanelFooterContext`. In v3 today it renders its primary button inline (no v1 provider around it) while the wizard shell also renders a generic Continue — two primaries. Switching to the sanctioned `WizardFooterAction` both removes the dependency and fixes that: it portals into the wizard footer and registers so the shell stands its generic Continue down. Outside a shell it falls back inline, unchanged.

**Files:**
- Modify: `src/components/bookings/setup/FlowStep.tsx` (imports at 1-2,15; footer read at 41; render at 180-184)
- Test: `src/components/bookings/setup/FlowStep.test.tsx` (add/adjust a footer-portal test)

**Interfaces:**
- Consumes: `WizardFooterAction` from `@/components/getRunning/v3/WizardFooterAction` — `({ children }: { children: ReactNode }) => JSX.Element`; portals `children` into `WizardFooterContext.el` and calls `register(true)` when a shell slot is present, else renders inline.
- Produces: `FlowStep` no longer imports `TaskPanelFooterContext`, `useContext`, or `createPortal`.

- [ ] **Step 1: Write the failing test** — assert FlowStep's primary action portals into a provided `WizardFooterContext` slot.

```tsx
// FlowStep.test.tsx — add near the other render tests
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";

it("portals its primary action into the wizard footer slot when one is provided", async () => {
  const slotEl = document.createElement("div");
  slotEl.setAttribute("data-testid", "wizard-footer-slot");
  const register = vi.fn();
  renderWithProviders(
    <WizardFooterContext.Provider value={{ el: slotEl, register }}>
      <FlowStep orgId="org-1" onDone={() => {}} />
    </WizardFooterContext.Provider>,
    { /* existing provider opts used by this file */ },
  );
  // The save button renders inside the provided slot, not loose in the body.
  await waitFor(() => expect(slotEl.querySelector("button")).toBeTruthy());
  expect(register).toHaveBeenCalledWith(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/bookings/setup/FlowStep.test.tsx -t "portals its primary action"`
Expected: FAIL (today FlowStep reads `TaskPanelFooterContext`, so the button is not in the v3 slot and `register` is never called).

- [ ] **Step 3: Implement** — in `FlowStep.tsx`:
  - Remove `useContext` from the React import (line 1) and remove the `createPortal` import (line 2) **if** they become unused (they do).
  - Remove line 15 `import { TaskPanelFooterContext } ...`.
  - Add `import { WizardFooterAction } from "@/components/getRunning/v3/WizardFooterAction";`.
  - Delete the `const footerSlot = useContext(TaskPanelFooterContext);` line (41) and its comment (37-40).
  - Replace the render tail (180-184) with:

```tsx
      <WizardFooterAction>{saveButton}</WizardFooterAction>
```

  - Trim the now-stale portal sentences from the `saveButton` comment (176-179).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/bookings/setup/FlowStep.test.tsx`
Expected: PASS (all cases, including the new portal test and the existing inline-fallback behavior).

- [ ] **Step 5: Commit**

```bash
git add src/components/bookings/setup/FlowStep.tsx src/components/bookings/setup/FlowStep.test.tsx
git commit -m "v3 cutover: move FlowStep footer action to WizardFooterAction"
```

---

### Task 2: Collapse `GetRunningPage` to always render the v3 board

Remove the v1 render path and the runtime flag from the page. An artist reaching the route by direct URL still bounces to Availability; everyone else gets `GetRunningBoardV3`, which already owns its own loading, nothing-to-set-up, and retirement states (it has been the live default for every org).

**Files:**
- Modify: `src/pages/GetRunningPage.tsx` (full rewrite of the component body; drop imports 6,7,9-12,16,17 as they become unused)
- Test: `src/pages/GetRunningPage.test.tsx` (drop v1-branch cases; keep artist-redirect + v3-render cases)

**Interfaces:**
- Consumes: `GetRunningBoardV3` (`context: "page" | "settings"`), `useAuth().hasRole`, `ROUTES.AVAILABILITY`.
- Produces: `GetRunningPage` no longer imports `useGetRunning`, `useGetRunningV3Enabled`, `GetRunningHeader`, `PhaseCard`, `RetiredBoard`, `TaskPanel`, or `@/lib/getRunning/tasks`.

- [ ] **Step 1: Write the failing test** — the page renders the v3 board for a producer and never the v1 header.

```tsx
// GetRunningPage.test.tsx
it("renders the v3 board for an admin/producer and no v1 header", async () => {
  renderWithProviders(<GetRunningPage />, { auth: { roles: ["producer"], org: activeOrg } });
  expect(await screen.findByTestId("get-running-board-v3")).toBeInTheDocument(); // GetRunningBoardV3 root testid
  expect(screen.queryByTestId("get-running-header")).toBeNull(); // v1 GetRunningHeader
});

it("redirects an artist to Availability", () => {
  renderWithProviders(<GetRunningPage />, { auth: { roles: ["artist"], org: activeOrg }, route: ROUTES.GET_RUNNING });
  expect(screen.queryByTestId("get-running-board-v3")).toBeNull();
  // asserted via the router: current location is ROUTES.AVAILABILITY
});
```

> Confirm the exact `data-testid` on `GetRunningBoardV3`'s root and on `GetRunningHeader` before writing the assertions; use whatever those components already expose (grep `data-testid` in each). If `GetRunningBoardV3` has none, add one (`data-testid="get-running-board-v3"`) in this task.

- [ ] **Step 2: Run it to verify it fails** (or that old v1-branch tests still assume the flag) — `npx vitest run src/pages/GetRunningPage.test.tsx`. Expect failures/removals against the current dual-branch page.

- [ ] **Step 3: Implement** — replace the whole component with:

```tsx
import { Navigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { GetRunningBoardV3 } from "@/components/getRunning/v3/GetRunningBoardV3";
import { ROUTES } from "@/config/app.config";

/**
 * The `/get-running` onboarding board. The Wireflow v3 board is the only board; it owns its
 * own loading, "nothing to set up", and retirement states. The route is admin/producer-only
 * (nav item gated the same way), so an artist only reaches here by direct URL and is bounced
 * to Availability before any board markup renders.
 */
export default function GetRunningPage() {
  const { hasRole } = useAuth();
  if (!hasRole("admin") && !hasRole("producer")) {
    return <Navigate to={ROUTES.AVAILABILITY} replace />;
  }
  return <GetRunningBoardV3 context="page" />;
}
```

  Delete the `NothingToSetUp` and `firstBlockingTask` helpers and all now-unused imports.

- [ ] **Step 4: Run tests to verify they pass** — `npx vitest run src/pages/GetRunningPage.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/GetRunningPage.tsx src/pages/GetRunningPage.test.tsx src/components/getRunning/v3/GetRunningBoardV3.tsx
git commit -m "v3 cutover: render only the v3 board on GetRunningPage"
```

---

### Task 3: Drop the enabled-gate from `FinishSetupLink`

With v3 unconditional, the outer `useGetRunningV3Enabled` gate is always "on". Collapse `FinishSetupLink` to render the inner (live-model) component directly. The inner component already returns `null` while loading or when nothing is actionable, so the affordance still self-hides.

**Files:**
- Modify: `src/components/getRunning/v3/FinishSetupLink.tsx` (remove import 5, fold 45-51 + 59)
- Test: `src/components/getRunning/v3/FinishSetupLink.test.tsx` (drop the "hidden when v3 disabled" case; keep pickFinishStep + inner cases)

**Interfaces:**
- Consumes: `useGetRunningV3` (live model), `pickFinishStep` (unchanged pure helper).
- Produces: `FinishSetupLink({ steps })` renders the inner directly; no longer imports `useGetRunningV3Enabled`.

- [ ] **Step 1: Write/adjust the failing test** — `FinishSetupLink` renders a deep-link for the first outstanding step without any enabled-flag setup.

```tsx
it("links to the first outstanding step (no enabled flag involved)", async () => {
  // seed useGetRunningV3 fixture with one not-done, actionable step "skills"
  renderWithProviders(<FinishSetupLink steps={["skills"]} />, { /* v3 model fixture */ });
  const link = await screen.findByRole("link");
  expect(link).toHaveAttribute("href", expect.stringContaining("?step=skills"));
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/components/getRunning/v3/FinishSetupLink.test.tsx`.

- [ ] **Step 3: Implement** — remove `import { useGetRunningV3Enabled } ...` (5). Merge the two components: keep `pickFinishStep`, and make `FinishSetupLink` be the former `FinishSetupLinkInner` body (rename it, keep the exported name `FinishSetupLink`). Delete the outer gate (46-51).

- [ ] **Step 4: Run tests to verify they pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/getRunning/v3/FinishSetupLink.tsx src/components/getRunning/v3/FinishSetupLink.test.tsx
git commit -m "v3 cutover: drop enabled-gate from FinishSetupLink"
```

---

### Task 4: Reduce `useGetRunningNavVisible` to the v3 model only

The hook currently reads both v1 and v3 models and picks by the runtime flag. With v3 unconditional it only needs the v3 model and the per-person `useRailDismissed`. Dropping the v1 read here removes one `useGetRunning` consumer (the hook itself stays, for `HomeLanding`/`AcceptInvitePage`).

**Files:**
- Modify: `src/hooks/useGetRunningNavVisible.ts` (drop imports 2 + 4; remove v1/flag branching 48-67)
- Test: `src/hooks/useGetRunningNavVisible.test.ts` (drop v1-branch + flag-loading cases; keep artist/complete+dismissed/nothing-on cases against the v3 model)

**Interfaces:**
- Consumes: `useGetRunningV3()` → `{ model }` with `{ complete, bookingOn, hireOrdersOn }`; `useRailDismissed("getRunning", orgId)`; `useAuth().hasRole`.
- Produces: same boolean contract as before.

- [ ] **Step 1: Adjust the failing test** — visibility is driven purely by the v3 model.

```ts
it("hides the item once the v3 board is complete and dismissed", () => {
  // v3 model: { complete: true, bookingOn: true, hireOrdersOn: false }; dismissed = true
  expect(result.current).toBe(false);
});
it("stays visible while the v3 model is still loading", () => {
  // useGetRunningV3 returns { model: null }
  expect(result.current).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/hooks/useGetRunningNavVisible.test.ts`.

- [ ] **Step 3: Implement** — new body:

```ts
import { useAuth } from "@/features/auth/AuthContext";
import { useGetRunningV3 } from "@/hooks/useGetRunningV3";
import { useRailDismissed } from "@/components/setup/useRailDismissed";

export function useGetRunningNavVisible(): boolean {
  const { currentOrg, hasRole } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const isNonArtist = hasRole("admin") || hasRole("producer");
  const { model } = useGetRunningV3({ active: true });
  const [dismissed] = useRailDismissed("getRunning", orgId);

  if (!isNonArtist) return true;
  if (!model) return true; // fail open while loading
  if (!model.bookingOn && !model.hireOrdersOn) return false; // nothing to set up
  return !(model.complete && dismissed);
}
```

  Rewrite the docstring to drop the v1/flag paragraphs. Confirm `useGetRunningV3`'s model exposes `complete`/`bookingOn`/`hireOrdersOn` (it did in the dual-model version); if the field names differ on the v3 model, use the v3 names.

- [ ] **Step 4: Run tests to verify they pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGetRunningNavVisible.ts src/hooks/useGetRunningNavVisible.test.ts
git commit -m "v3 cutover: drive nav visibility from the v3 model only"
```

---

### Task 5: Simplify the Settings mirror gating and drop the toggle from the mirror

`SettingsPage` gates the `get-running` mirror tab on `v3Enabled`; the mirror renders `GetRunningV3Toggle` above the board. With v3 unconditional, the tab shows for any admin/producer/super-admin and the toggle is removed.

**Files:**
- Modify: `src/pages/SettingsPage.tsx` (import 40; `v3Enabled` at 83; `showGetRunning` at 149)
- Modify: `src/components/getRunning/v3/GetRunningSettingsMirror.tsx` (remove toggle import + render)
- Modify: `src/components/getRunning/v3/GetRunningSettingsMirror.test.tsx` (assert no toggle)
- Test: `src/pages/SettingsPage.test.tsx` (mirror tab visible for admin/producer without a flag)

**Interfaces:**
- Produces: neither file imports `useGetRunningV3Enabled` or `GetRunningV3Toggle`.

- [ ] **Step 1: Adjust the failing tests**

```tsx
// GetRunningSettingsMirror.test.tsx
it("renders the settings-context board and no v3 toggle", () => {
  renderWithProviders(<GetRunningSettingsMirror />, { /* opts */ });
  expect(screen.getByTestId("get-running-board-v3")).toBeInTheDocument();
  expect(screen.queryByText(/get running v3/i)).toBeNull(); // toggle.title copy
});
```

```tsx
// SettingsPage.test.tsx — the get-running tab is offered to a producer with no override set
it("offers the get-running mirror tab to a producer", async () => {
  renderWithProviders(<SettingsPage />, { auth: { roles: ["producer"], org: activeOrg } });
  expect(await screen.findByRole("tab", { name: /get running/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/components/getRunning/v3/GetRunningSettingsMirror.test.tsx src/pages/SettingsPage.test.tsx`.

- [ ] **Step 3: Implement**
  - `GetRunningSettingsMirror.tsx`: remove `import { GetRunningV3Toggle } ...` and the `<GetRunningV3Toggle />` line; the component becomes just the `context="settings"` board wrapped in the existing `div`.
  - `SettingsPage.tsx`: remove `import { useGetRunningV3Enabled } from "@/hooks/useGetRunningV3Enabled";` (40) and the `const { enabled: v3Enabled } = useGetRunningV3Enabled();` line (83). Change `showGetRunning` (149) to `const showGetRunning = isSuperAdmin || isAdmin || isProducer;`. Leave the `?tab=get-running` deep-link comment (207) but drop its now-stale "resolves asynchronously" clause.

- [ ] **Step 4: Run tests to verify they pass** — PASS. Also `npx vitest run src/pages/SettingsPage.test.tsx` fully (it has multiple describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/pages/SettingsPage.tsx src/components/getRunning/v3/GetRunningSettingsMirror.tsx src/components/getRunning/v3/GetRunningSettingsMirror.test.tsx src/pages/SettingsPage.test.tsx
git commit -m "v3 cutover: always show settings mirror, drop the v3 toggle"
```

---

### Task 6: Delete the runtime override, its hook/toggle, the build flag, and the toggle i18n

All consumers are gone after Tasks 2-5. Delete the override plumbing and remove the `toggle` i18n block from EN and DE together (key-parity gate).

**Files:**
- Delete: `src/data/getRunningFlag.ts`, `src/data/getRunningFlag.test.ts`
- Delete: `src/hooks/useGetRunningV3Enabled.ts`, `src/hooks/useGetRunningV3Enabled.test.tsx`
- Delete: `src/components/getRunning/v3/GetRunningV3Toggle.tsx`, `src/components/getRunning/v3/GetRunningV3Toggle.test.tsx`
- Delete: `src/config/flags.ts`, `src/config/flags.test.ts` (`GETRUNNING_V3` was the only export; its only importers — `getRunningFlag.ts`, `useGetRunningV3Enabled.ts` — are deleted above)
- Modify: `src/i18n/locales/en/getRunningV3.json` and `src/i18n/locales/de/getRunningV3.json` — remove the `"toggle": { ... }` block (5 keys) from each

**Interfaces:**
- Produces: `GETRUNNING_V3_SETTING_KEY`, `fetchGetRunningV3Enabled`, `setGetRunningV3Enabled`, `useGetRunningV3Enabled`, `useSetGetRunningV3Enabled`, `GetRunningV3Toggle`, and `GETRUNNING_V3` no longer exist anywhere in `src`.

- [ ] **Step 1: Verify no remaining consumers**

Run:
```bash
grep -rn "useGetRunningV3Enabled\|GetRunningV3Toggle\|getRunningFlag\|GETRUNNING_V3_SETTING_KEY\|getrunning_v3_enabled\|setGetRunningV3Enabled\|fetchGetRunningV3Enabled\|from \"@/config/flags\"\|GETRUNNING_V3\b" src --include=*.ts --include=*.tsx
```
Expected: only the files being deleted in this task appear. If any KEPT file still matches, fix it here before deleting.

- [ ] **Step 2: Delete the files and trim the i18n**

```bash
git rm src/data/getRunningFlag.ts src/data/getRunningFlag.test.ts \
       src/hooks/useGetRunningV3Enabled.ts src/hooks/useGetRunningV3Enabled.test.tsx \
       src/components/getRunning/v3/GetRunningV3Toggle.tsx src/components/getRunning/v3/GetRunningV3Toggle.test.tsx \
       src/config/flags.ts src/config/flags.test.ts
```
Then edit both `getRunningV3.json` files to remove the `toggle` object (and its trailing comma).

- [ ] **Step 3: Verify types, lint, i18n parity, and the getRunningV3 suite**

Run:
```bash
npx tsc -p tsconfig.app.json --noEmit
npm run lint
npx vitest run src/i18n src/components/getRunning/v3 src/pages/SettingsPage.test.tsx
```
Expected: all green. `keyParity.test.ts` passes because the `toggle` block was removed from EN and DE symmetrically.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "v3 cutover: delete the v3 runtime toggle, override, and build flag"
```

---

### Task 7: Delete the v1 board UI and its UI-only plumbing

Now orphaned (Tasks 1-2 removed the last app consumers; the dev harness is the only other referrer and is deleted here too).

**Files:**
- Delete: `src/components/getRunning/GetRunningHeader.tsx` (+ `.test.tsx`)
- Delete: `src/components/getRunning/PhaseCard.tsx` (+ `.test.tsx`)
- Delete: `src/components/getRunning/TaskRow.tsx`
- Delete: `src/components/getRunning/RetiredBoard.tsx` (+ `.test.tsx`)
- Delete: `src/components/getRunning/TaskPanel.tsx` (+ `.test.tsx`)
- Delete: `src/components/getRunning/TaskPanelFooterContext.ts`
- Delete: `src/components/getRunning/taskPanelRegistry.tsx`
- Delete: `src/components/getRunning/panels/DatesPanelBody.tsx` (+ `.test.tsx`)
- Delete: `src/lib/getRunning/taskFeature.ts`
- Delete: `src/lib/getRunning/taskPanelMeta.ts`
- Delete: `src/pages/DevGetRunningHarness.tsx`
- Modify: `src/App.tsx` (remove the `DevGetRunningHarness` lazy import at 52 and its `/dev/get-running` route at 86-88)

> **Do NOT delete** `panels/{People,Ladder,Eligibility,Team}PanelBody`, `panels/CastRosterList`, `panels/UnlocksNote`, or `panels/airtable/*` — the v3 `stepRegistryV3`/`ConnectStep`/`MapStep`/`useAirtableConsole` reuse them. Do NOT delete `HowThisOrgWorks`, `useGetRunning`, or `lib/getRunning/tasks.ts`.

**Interfaces:**
- Produces: `GetRunningHeader`, `PhaseCard`, `TaskRow`, `RetiredBoard`, `TaskPanel`, `TaskPanelFooterContext`, `taskPanelRegistry`, `DatesPanelBody`, `taskFeature`, `taskPanelMeta`, and `DevGetRunningHarness` no longer exist. `useGetRunning` and `tasks.ts` remain (used by `HomeLanding`, `AcceptInvitePage`).

- [ ] **Step 1: Verify these are orphaned** (only self/tests + the dev harness reference them)

```bash
for f in GetRunningHeader PhaseCard TaskRow RetiredBoard TaskPanel TaskPanelFooterContext taskPanelRegistry DatesPanelBody taskFeature taskPanelMeta DevGetRunningHarness; do
  echo "--- $f ---"; grep -rln "$f" src --include=*.ts --include=*.tsx \
    | grep -vE "getRunning/(GetRunningHeader|PhaseCard|TaskRow|RetiredBoard|TaskPanel|TaskPanelFooterContext|taskPanelRegistry|panels/DatesPanelBody)|lib/getRunning/(taskFeature|taskPanelMeta)|pages/DevGetRunningHarness"
done
```
Expected: only `src/App.tsx` (for `DevGetRunningHarness`) survives the filter. Anything else means a consumer was missed in Tasks 1-5 — stop and fix it there.

- [ ] **Step 2: Remove the App.tsx wiring** — delete line 52 (`const DevGetRunningHarness = ...`) and the guarded `<Route path="/dev/get-running" ...>` block (86-88).

- [ ] **Step 3: Delete the files**

```bash
git rm src/components/getRunning/GetRunningHeader.tsx src/components/getRunning/GetRunningHeader.test.tsx \
       src/components/getRunning/PhaseCard.tsx src/components/getRunning/PhaseCard.test.tsx \
       src/components/getRunning/TaskRow.tsx \
       src/components/getRunning/RetiredBoard.tsx src/components/getRunning/RetiredBoard.test.tsx \
       src/components/getRunning/TaskPanel.tsx src/components/getRunning/TaskPanel.test.tsx \
       src/components/getRunning/TaskPanelFooterContext.ts \
       src/components/getRunning/taskPanelRegistry.tsx \
       src/components/getRunning/panels/DatesPanelBody.tsx src/components/getRunning/panels/DatesPanelBody.test.tsx \
       src/lib/getRunning/taskFeature.ts \
       src/lib/getRunning/taskPanelMeta.ts \
       src/pages/DevGetRunningHarness.tsx
```

- [ ] **Step 4: Verify types + lint + the getRunning suite**

```bash
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.tools.json --noEmit
npm run lint
npx vitest run src/components/getRunning src/lib/getRunning src/pages/AcceptInvitePage.test.tsx src/features/auth/HomeLanding.test.tsx
```
Expected: all green. `AcceptInvitePage` and `HomeLanding` still pass — they use the retained `useGetRunning` + `tasks.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "v3 cutover: delete the v1 get-running board and dev harness"
```

---

### Task 8: Full verify, deprecation-map close-out, and docs

**Files:**
- Modify: `docs/superpowers/specs/wireflow-v3-settings-deprecation.md` (add a short "Cutover done" note)

- [ ] **Step 1: Full local gate**

```bash
npm run verify:fast
```
Expected: lint 0, tsc app+tools 0, full `vitest run` green, Deno check green. If the local edge_runtime container is dead, that only affects e2e (not part of verify:fast); no edge code changed here.

- [ ] **Step 2: Belt-and-braces grep** — confirm the whole v1 surface is gone and nothing dangles.

```bash
grep -rn "useGetRunningV3Enabled\|GetRunningV3Toggle\|getrunning_v3_enabled\|GETRUNNING_V3\|TaskPanelFooterContext\|taskPanelRegistry\|DevGetRunningHarness\|RetiredBoard\|GetRunningHeader\b" src --include=*.ts --include=*.tsx || echo "clean"
```
Expected: `clean` (or only historical mentions inside docstrings, which should also be trimmed).

- [ ] **Step 3: Note the cutover in the deprecation map** — append to `wireflow-v3-settings-deprecation.md`:

```markdown
## Cutover done (2026-08-25)

The v1 board and its per-org `getrunning_v3_enabled` override + super-admin toggle were
deleted; the v3 board is now the only board for every org. The four "redirect into board
(later)" rows above remain untouched — each Settings tab is still the canonical editor.
```

- [ ] **Step 4: Live verify against the local stack (visual + functional)** — prove the v3 board still works after the deletion. This is done by the MAIN session (browser tools), not a subagent.
  - Ensure the local stack is up (`npm run local:up`) and start the dev server via `preview_start { name: <dev server from .claude/launch.json> }` (LOCAL Supabase; autologin as seeded `admin@example.com`).
  - Navigate to `/get-running`. Confirm: the v3 board renders (hero + phase rail + steps), NOT the old v1 header/phase-card layout; `read_console_messages` shows no errors.
  - Open a step (e.g. the flow step) and confirm its primary action sits in the wizard sticky footer (the FlowStep → `WizardFooterAction` migration), with exactly one primary button.
  - Go to `Settings → Get running` mirror tab: confirm the board renders there and there is NO "Get running v3" toggle card above it.
  - Visit `/dev/get-running` and confirm it 404s / renders nothing (harness deleted).
  - Capture a screenshot of the `/get-running` board for the PR.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/wireflow-v3-settings-deprecation.md
git commit -m "v3 cutover: record v1 board deletion in the deprecation map"
```

- [ ] **Step 6: Open the PR** (via `gh pr create`, per the memory note that the GitHub MCP PAT 403s on PR creation). No changelog, no version bump; PR body states this is internal cutover cleanup that deletes the v1 board and the super-admin-only v3 toggle, with v3 already live as the default.

---

## Self-Review

**Spec coverage (§8 deferred cutover):** delete v1 board ✅ (Task 7), remove build flag ✅ (Task 6), v3 unconditional ✅ (Tasks 2-6), keep `tasks.ts` + `useGetRunning` for AcceptInvitePage/HomeLanding ✅ (retained, verified in Tasks 4/7), keep v3-reused panels ✅ (Global Constraints + Task 7 guard). Deprecation map close-out ✅ (Task 8).

**Placeholder scan:** no TBD/TODO; every code step shows the concrete edit. The two spots that say "confirm the exact `data-testid`" (Task 2) are deliberate verification steps against existing components, not deferred implementation — the assertion values come from what those components already expose.

**Type/name consistency:** `WizardFooterAction`, `WizardFooterContext` ({ el, register }) match their source files. `showGetRunning`, `v3Enabled`, `useGetRunningV3Enabled`, `GetRunningV3Toggle`, `GETRUNNING_V3`, `getRunningFlag`, `TaskPanelFooterContext`, `taskFeature`, `taskPanelMeta`, `DevGetRunningHarness` names match the grep-verified current tree. The kept-vs-deleted `panels/*` split is verified against actual v3 imports (`stepRegistryV3`, `ConnectStep`, `MapStep`, `useAirtableConsole`).

**Ordering:** consumers migrated (1-5) before their targets are deleted (6-7); the tree compiles and tests pass at every commit; full `vitest run` at Task 8 catches cross-file fixture breakage (the P5 lesson).
