# Zero Lint Warnings & Any-Boundary Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all 453 ESLint warnings (359 `no-explicit-any`, 55 `no-unused-vars`, 36 `react-refresh/only-export-components`, 3 `react-hooks/exhaustive-deps`), flip the rules to `error`, gate CI with `--max-warnings 0`, and replace the old "`any` is allowed at the boundary" convention with an enforced, narrower boundary rule.

**Architecture:** Work proceeds in three waves that each keep the tree green: (1) scope the ESLint config so rules only apply where they mean something (Deno functions get their own block, generated shadcn files and the test harness drop the fast-refresh rule); (2) burn the warnings to zero — mechanical dead-code and callback-typing fixes first, then explicit row-interfaces + single-cast query boundaries through the data layer and edge functions, then typed test-cast helpers through the test suites; (3) flip severities to `error`, add `--max-warnings 0`, and codify the improved boundary in CLAUDE.md. The Deno runtime gets a mirrored copy of the generated `Database` types (same dual-home pattern as `entitlements.ts`) so `deps.ts` clients become `SupabaseClient<Database>`.

**Tech Stack:** ESLint 9.32 flat config, typescript-eslint 8, React 18 + @tanstack/react-query v5, supabase-js v2 (browser + `npm:` specifier in Deno), Vitest + jsdom, Deno test.

## Global Constraints

- Branch: `claude/preexisting-warnings-analysis-04fwu3`. Never push elsewhere.
- Commit messages: imperative, lowercase, ≤72 chars (CLAUDE.md Git workflow).
- Every commit leaves the tree green: `npx vitest run` (1164 tests), `deno test --allow-all supabase/functions/` and `npx tsc -p tsconfig.app.json --noEmit` must pass at each commit that touches their territory. The total `npm run lint` warning count must never increase.
- **The improved boundary rule** (enforced from Task 15, followed from Task 6 onward):
  - `any` is banned everywhere (production, tests, edge functions).
  - When supabase-js cannot infer a joined-row shape, define an explicit local row `interface` and cast **once** at the query result (`as unknown as Row[]`), immediately after the error check. Confined to `src/data/**`, hook `queryFn`s, and `supabase/functions/**`. Never deep-access an untyped row (`(x as any).foo` is the anti-pattern being removed).
  - Test stubs funnel through the typed helpers (`src/test/castHelpers.ts`, `_shared/testing.ts`) — one `unknown` cast inside the helper, never per-site `as any`.
- Never hand-edit `supabase/migrations/` or `src/integrations/supabase/types.ts`. If a table turns out to be genuinely missing from the generated types, regenerate via the Supabase MCP `generate_typescript_types` tool (project `epweartpzwvcasrzyueh`) and overwrite the file with the tool output verbatim — that is regeneration, not hand-editing.
- Tests import the real module — never re-implement production logic in a test.
- No `public/changelog.md` entry and no version bump: this is refactor/tooling work with no user-facing change (CLAUDE.md changelog policy excludes refactors, tests, CI, docs).
- `docs/system-map.md` / `src/data/systemMap.ts` untouched: no automation behavior changes.
- The full per-site inventory is in **Appendix A** (production `any` sites with current source lines) and **Appendix B** (test-file `any` counts). Tasks reference it as "Appendix A".
- Baseline check before starting: `npm run lint 2>&1 | tail -1` → `✖ 453 problems (0 errors, 453 warnings)`.
- **Local Deno invocation** (this environment): `export PATH="/root/.deno/bin:$PATH" DENO_CERT=/root/.ccr/ca-bundle.crt` then `deno test --allow-all --node-modules-dir=none supabase/functions/...` — the `--node-modules-dir=none` flag matches CI (the root `package.json` otherwise forces node_modules resolution), and `DENO_CERT` trusts the outbound proxy. Same for `deno check`. Baseline: 772 passed / 0 failed / 2 ignored. Wherever a task says `deno test --allow-all`, use this invocation.

## Decisions locked in (approved trade-offs)

- **Context files are exempted, not split (Task 5)** — decision revised at plan approval (2026-07-18): the provider+hook split would touch ~55 importer files plus test mock paths for a dev-experience-only benefit (fast refresh on context edits), which is the wrong risk profile for a cleanup whose success metric is "nothing changed behaviorally". Instead, a three-file ESLint carve-out disables `react-refresh/only-export-components` for the context modules, with the split deferred to a future standalone PR (which would simply delete the carve-out). Hook import paths and test mock paths are therefore UNCHANGED throughout this plan.
- **`ComponentType` in the email registry** takes one explicit `as React.ComponentType<TemplateData>` cast per template registration (10 casts). This is the standard variance workaround; the cast names its target type, which is the boundary style we are standardizing on.
- **Deno `Database` types are a mirrored copy** of `src/integrations/supabase/types.ts` (the two runtimes can't share an import — same reason as `entitlements.ts`). A Vitest sync test enforces byte-equality so drift fails CI.

---

### Task 1: Scope the ESLint config

**Files:**
- Modify: `eslint.config.js` (entire file — replacement below)

**Interfaces:**
- Consumes: nothing.
- Produces: the scoped flat config all later tasks lint against. Rules stay `"warn"` — Task 15 flips them via the shared `strictness` object defined here.

- [x] **Step 1: Replace `eslint.config.js` with the scoped config**

```js
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Severity is "warn" during the cleanup tasks of the zero-warnings plan;
// the final task flips these to "error" and adds --max-warnings 0 to the
// lint script so new violations fail CI.
const strictness = {
  "@typescript-eslint/no-unused-vars": [
    "warn",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
    },
  ],
  "@typescript-eslint/no-explicit-any": "warn",
};

export default tseslint.config(
  { ignores: ["dist"] },
  // App, tests, e2e, scripts — browser runtime, Vite fast refresh.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    ignores: ["supabase/functions/**"],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      ...strictness,
    },
  },
  // shadcn primitives are generated (never hand-edited) and the test harness
  // is never HMR'd — fast-refresh hygiene is meaningless in both.
  {
    files: ["src/components/ui/**", "src/test/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  // Deno edge functions: server runtime. No Vite fast refresh (the React
  // Email templates are rendered server-side, never HMR'd) and no browser
  // globals. rules-of-hooks still applies to the email template components.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["supabase/functions/**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2020, globals: { Deno: "readonly" } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...strictness,
    },
  },
);
```

- [x] **Step 2: Run lint, record the new baseline**

Run: `npm run lint 2>&1 | tail -1`
Expected: `✖ 410 problems (0 errors, 410 warnings)` — 19 react-refresh warnings gone (11 in `supabase/functions/**` templates + render.tsx, 7 in `src/components/ui/**`, 1 in `src/test/renderWithProviders.tsx`) and 24 underscore-prefixed unused-vars gone. If the number differs by ±2, diff the per-rule counts (`npm run lint 2>&1 | grep -oE '[a-z-]+/[a-z-]+$' | sort | uniq -c`) against Task 0 baseline (359/55/36/3) and reconcile before proceeding — do not continue with an unexplained delta.

- [x] **Step 3: Verify tests still pass**

Run: `npx vitest run 2>&1 | tail -3`
Expected: `Test Files  158 passed` / `Tests  1164 passed`

- [x] **Step 4: Commit**

```bash
git add eslint.config.js
git commit -m "scope eslint config per runtime, ignore underscore args"
```

---

### Task 2: Fix the three exhaustive-deps warnings

**Files:**
- Modify: `src/pages/DashboardPage.tsx:96-113`
- Modify: `src/pages/ChatsListPage.tsx:38-46`
- Modify: `src/pages/ArtistsPage.tsx:185-217`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks rely on. Pure behavior-preserving memoization fixes.

- [x] **Step 1: DashboardPage — memoize `confirmedMainByDate`, correct `directItems` deps**

Replace the IIFE at lines 96–102 and the dep array at line 112:

```tsx
const confirmedMainByDate = useMemo(() => {
  const map = new Map<string, number>();
  (confirmedBookings ?? []).forEach(b => {
    if (!b.is_understudy) map.set(b.show_date_id, (map.get(b.show_date_id) ?? 0) + 1);
  });
  return map;
}, [confirmedBookings]);
```

and in `directItems` change `[upcomingDates, confirmedBookings]` → `[upcomingDates, confirmedMainByDate]`. Leave the `confirmedCountByDate` IIFE alone (not flagged; minimal diff).

- [x] **Step 2: ChatsListPage — move `today` inside the memo**

Delete line 38 (`const today = new Date();`) and add it as the first line of the `visible` useMemo body:

```tsx
const visible = useMemo(() => {
  const today = new Date();
  return (chats ?? []).filter(c => {
    const d = c.show_date?.date;
    if (!d) return false;
    return differenceInCalendarDays(today, parseDateOnly(d)) <= CHAT_ARCHIVE_DAYS;
  });
}, [chats]);
```

- [x] **Step 3: ArtistsPage — wrap `nextBookingDate` in `useCallback`, add it to deps**

```tsx
const nextBookingDate = useCallback((artistId: string): Date | null => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dates = (bookingsByArtist.get(artistId) ?? [])
    .map(b => b.show_date?.date ? parseDateOnly(b.show_date.date) : null)
    .filter((d): d is Date => d !== null && d >= today)
    .sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ?? null;
}, [bookingsByArtist]);
```

Add `useCallback` to the React import if absent. Change the `filtered` dep array (line 217) to `[artists, search, programs, timeframe, sort, bookingsByArtist, skillsByArtist, nextBookingDate]`.

- [x] **Step 4: Verify**

Run: `npx eslint src/pages/DashboardPage.tsx src/pages/ChatsListPage.tsx src/pages/ArtistsPage.tsx 2>&1 | grep -c exhaustive-deps || true`
Expected: `0`
Run: `npx vitest run 2>&1 | tail -3` → all pass.

- [x] **Step 5: Commit**

```bash
git add src/pages/DashboardPage.tsx src/pages/ChatsListPage.tsx src/pages/ArtistsPage.tsx
git commit -m "fix stale memo dependencies on dashboard, chats, artists pages"
```

---

### Task 3: Delete dead code (remaining unused vars)

**Files (every remaining `no-unused-vars` site — 31 total):**
- Modify: `e2e/booking-lifecycle.spec.ts:12` — remove `loginAs` from the import list.
- Modify: `e2e/chat-access-control.spec.ts:41` — delete the unused `outsider` assignment (verify with surrounding context that no later line references it; if it documents a fixture, prefix `_outsider` instead).
- Modify: `src/components/admin/MembersTab.test.tsx:5`, `src/components/catalog/ShowFormDialog.test.tsx:6-7`, `src/components/settings/OrganizationTab.test.tsx:5`, `src/components/shows/ShowDateFormDialog.test.tsx:6-9`, `src/pages/ProductionsPage.test.tsx:5-7` — the unused `a` parameters in `vi.mock` factory callbacks: rename each to `_a` (covered by `argsIgnorePattern` from Task 1).
- Modify: `src/pages/ProductionsPage.test.tsx:2` — remove `fireEvent, waitFor` from the testing-library import.
- Modify: `src/components/filters/ProgramFilter.tsx:4` — remove the `Badge` import.
- Modify: `src/features/editor/EditorContext.tsx:13` — remove `DEFAULT_PAGE_ACCESS` from its import.
- Modify: `src/hooks/use-toast.ts:15` — replace the value-only-used-as-type constant:

```ts
// Before (line ~15):
const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const;
// After — delete the const and define the type directly where
// `typeof actionTypes` was used:
type ActionType = {
  ADD_TOAST: "ADD_TOAST";
  UPDATE_TOAST: "UPDATE_TOAST";
  DISMISS_TOAST: "DISMISS_TOAST";
  REMOVE_TOAST: "REMOVE_TOAST";
};
```

(Adjust the one downstream `typeof actionTypes` reference to `ActionType`.)
- Modify: `src/hooks/useEligibleArtists.test.ts:60` — delete the unused `callCount` variable; `:235` — rename unused `dateId` param to `_dateId`.
- Modify: `src/pages/AvailabilityPage.tsx:11,13` — remove the 8 unused date-fns/lucide imports (`format`, `startOfMonth`, `endOfMonth`, `eachDayOfInterval`, `isToday`, `addMonths`, `subMonths`, `ChevronLeft`, `ChevronRight` — keep any member of those import statements that IS used).
- Modify: `src/lib/dates.ts:7` — remove `parse` from the date-fns import.
- Modify: `supabase/functions/expire-offers/index.test.ts:7` — remove `assertExists` from the import.

**Interfaces:** none.

- [x] **Step 1: Apply all deletions/renames above**
- [x] **Step 2: Verify rule is clean**

Run: `npm run lint 2>&1 | grep -c no-unused-vars || true`
Expected: `0`

- [x] **Step 3: Full test + typecheck gate**

Run: `npx vitest run 2>&1 | tail -3` → pass. `npx tsc -p tsconfig.app.json --noEmit` → exit 0. `deno test --allow-all supabase/functions/expire-offers/ 2>&1 | tail -2` → pass.

- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "remove dead imports and variables flagged by no-unused-vars"
```

---

### Task 4: Move non-component exports out of component files

**Files:**
- Create: `src/components/filters/customFilterState.ts` ← move `emptyCustomFilter` (and any types only it needs) from `src/components/filters/CustomFieldFilter.tsx:77`.
- Create: `src/lib/hireOrders/kpis.ts` ← move `computeOrderKpis` + `OrderKpiStats` from `src/components/hireOrders/OrdersKpis.tsx:29`.
- Create: `src/components/settings/bookingFlow/auditKeys.ts` ← move `BOOKING_AUDIT_KEYS` from `BookingFlowTab.tsx:32`.
- Create: `src/components/settings/hireOrders/auditKeys.ts` ← move `HIRE_ORDER_AUDIT_KEYS` from `HireOrdersTab.tsx:21`.
- Create: `src/components/settings/hireOrders/defaults.ts` ← move `COUNTERSIGN_DEFAULT` (CountersignCard.tsx:30), `LETTERHEAD_DEFAULT` (LetterheadCard.tsx:25), `NUMBERING_DEFAULT` (NumberingCard.tsx:20), `ORDER_DEFAULTS_DEFAULT` (OrderDefaultsCard.tsx:20) into one module.
- Create: `src/lib/singleFlight.ts` ← move `createSingleFlightRunner` from `src/pages/HireOrderEditPage.tsx:137`.
- Create: `src/features/auth/realtimeInvalidations.ts` ← move `REALTIME_INVALIDATIONS` from `AuthContext.tsx:16`.
- Modify: each source file (delete the moved export, import it back if the component itself uses it) and every importer.

**Interfaces:**
- Produces: same symbol names at new paths — later tasks and existing code import e.g. `import { computeOrderKpis } from "@/lib/hireOrders/kpis"`.

- [x] **Step 1: For each move, find importers first**

Run for each symbol, e.g.: `grep -rn "computeOrderKpis\|OrderKpiStats" src/ --include="*.ts*" -l`
Move the code verbatim (no logic edits), update every importer path, and if a co-located test imports the symbol from the component file, re-point it at the new module (tests keep importing the real module — never copy logic).

- [x] **Step 2: Verify each moved symbol's tests still pass**

Run: `npx vitest run 2>&1 | tail -3` → 158 files / 1164 tests pass (moves must not change counts).

- [x] **Step 3: Verify rule progress**

Run: `npm run lint 2>&1 | grep -c only-export-components || true`
Expected: `7` (only the context-file hook exports remain, fixed in Task 5: AuthContext 2 — line 16's const moved here, leaving `useAuth` + `useEffectiveUserId` — EditorContext 4, ConsentContext 1).

- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "move constants and pure helpers out of component modules"
```

---

### Task 5: Exempt the context modules from the fast-refresh rule

*(Revised at plan approval — see "Decisions locked in". The provider+hook split is deferred to a future standalone PR; this task is the three-file carve-out.)*

**Files:**
- Modify: `eslint.config.js` — extend the Task-1 exemption block.

**Interfaces:**
- Produces: nothing. Hook import paths (`@/features/auth/AuthContext` etc.) and test mock paths are unchanged everywhere.

- [x] **Step 1: Add the context files to the react-refresh exemption block**

In `eslint.config.js`, change the shadcn/test-harness exemption block to:

```js
  // shadcn primitives are generated (never hand-edited) and the test harness
  // is never HMR'd — fast-refresh hygiene is meaningless in both. The three
  // context modules deliberately co-locate provider + hooks (editing them
  // full-reloads the dev server; accepted). Splitting them for fast refresh
  // is deferred to a standalone PR — that PR deletes this carve-out.
  {
    files: [
      "src/components/ui/**",
      "src/test/**",
      "src/features/auth/AuthContext.tsx",
      "src/features/editor/EditorContext.tsx",
      "src/features/consent/ConsentContext.tsx",
    ],
    rules: { "react-refresh/only-export-components": "off" },
  },
```

- [x] **Step 2: Verify rule is fully clean**

Run: `npm run lint 2>&1 | grep -c only-export-components || true`
Expected: `0`

- [x] **Step 3: Sanity gate: `npx vitest run 2>&1 | tail -3`** → 158 files / 1164 tests pass (config-only change; counts identical).

- [x] **Step 4: Commit**

```bash
git add eslint.config.js
git commit -m "exempt context modules from fast-refresh lint rule"
```

---

### Task 6: Mirror DB types into the Deno runtime (+ sync test)

**Files:**
- Create: `supabase/functions/_shared/database.types.ts` — byte-identical copy of `src/integrations/supabase/types.ts` (`cp src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts`). Do NOT add a header comment — byte-equality is the sync contract (same dual-home rationale as `entitlements.ts`).
- Test: `src/integrations/supabase/typesMirror.test.ts`

**Interfaces:**
- Produces: `import type { Database } from "./database.types.ts"` for all `supabase/functions/**` code (used by Tasks 10–12).

- [x] **Step 1: Write the failing sync test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Deno edge runtime cannot import from src/, so the generated Database
// types are dual-homed (same pattern as entitlements.ts). This test is the
// sync contract: regenerate types.ts -> re-copy the mirror in the same commit.
describe("database types mirror", () => {
  it("supabase/functions/_shared/database.types.ts is byte-identical to the generated types", () => {
    const generated = readFileSync("src/integrations/supabase/types.ts", "utf8");
    const mirror = readFileSync("supabase/functions/_shared/database.types.ts", "utf8");
    expect(mirror).toBe(generated);
  });
});
```

- [x] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/integrations/supabase/typesMirror.test.ts`
Expected: FAIL — `ENOENT ... database.types.ts`

- [x] **Step 3: Create the mirror**

Run: `cp src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts`

- [x] **Step 4: Re-run the test** → PASS. Also `deno check supabase/functions/_shared/database.types.ts` → exit 0.
- [x] **Step 5: Commit**

```bash
git add supabase/functions/_shared/database.types.ts src/integrations/supabase/typesMirror.test.ts
git commit -m "mirror generated database types for the deno runtime"
```

---

### Task 7: De-`any` the frontend data layer

**Files (Appendix A has each site's current line):**
- Modify: `src/data/eligibility.ts` (13 sites) — the tables it queries (`show_required_skills`, `show_date_required_skills`, `show_cast_eligibility`, `artist_skills`) ARE in the generated types now (verified 2026-07-18; the file's header comment claiming otherwise is stale — delete it). Remove every `(client as any)` → `client`; the typed client infers the rows, so the follow-up `as { skill_id: string }[]`-style casts become redundant — delete them where the inferred type already matches, keep the explicit interfaces where a joined select defeats inference (then cast `as unknown as Row[]`).
- Modify: `src/data/bookings.ts:49` — remove `(client as any)`; `:335,346` — replace `as any[]` / `(b: any)` with an explicit local row interface for the joined select feeding them (read the select string at the query above line 335, copy its columns), cast once `as unknown as Row[]`.
- Modify: `src/data/artists.ts:56` — same explicit-interface + single-cast pattern.
- Modify: `src/hooks/useArtistEligibleDates.ts:78-115` (6 sites) — the select at line 65 already enumerates columns. Define at top of the queryFn:

```ts
interface EligibleDateRow {
  id: string; date: string;
  session_1: string | null; session_2: string | null; session_3: string | null;
  status: string; city_id: string | null; show_id: string;
  venue: string | null; custom: Record<string, unknown> | null;
  show: { id: string; program: string | null; sub_program: string | null; status: string } | null;
}
```

then `const allDates = (dates ?? []) as unknown as EligibleDateRow[];` and drop every `(d: any)`. Remove `(supabase as any)` at :97 and :101 (tables are in the types) and the stale "not yet in the generated types" comment; keep the existing `{ show_id: string; skill_id: string }[]` narrowing only if inference fails.
- Modify: `src/hooks/useChatParticipant.ts:24` — type the row: `(data ?? []).some((b: { artist: { user_id: string | null } | null }) => ...)` or interface + single cast, matching its select.
- Modify: `src/components/availability/ArtistAvailabilityCalendar.tsx:61` — remove `(supabase as any)`.
- Modify: `src/components/shows/ShowDateDetailSheet.tsx:88` — replace `return data as any;` with an explicit `ShowDateDetailRow` interface copied from the select at lines 80–84 (`id, date, session_1..3, venue, status, notes, city_id, show_id, cancellation_reason, airtable_record_id, custom`, `show: {...} | null`, `city: { id: string; name: string } | null`) and `return data as unknown as ShowDateDetailRow;`. Check the query's consumers for which fields they read — the interface must cover them.

**Interfaces:**
- Consumes: nothing new (frontend client was already `SupabaseClient<Database>`).
- Produces: `EligibleDateRow`, `ShowDateDetailRow` local interfaces (file-local; nothing external).

- [x] **Step 1: Apply eligibility.ts, run its tests**: `npx vitest run src/data/eligibility.test.ts` (if present — else the data tests folder) → pass.
- [x] **Step 2: Apply bookings.ts + artists.ts, run `npx vitest run src/data` → pass.**
- [x] **Step 3: Apply the two hooks + calendar + sheet, run `npx vitest run src/hooks src/components` → pass.**
- [x] **Step 4: Typecheck is the real gate for this task**: `npx tsc -p tsconfig.app.json --noEmit` → exit 0. If a table is genuinely absent from the types, STOP and regenerate per Global Constraints, re-copy the Task 6 mirror in the same commit.
- [x] **Step 5: Verify these files are any-clean**

Run: `npx eslint src/data src/hooks/useArtistEligibleDates.ts src/hooks/useChatParticipant.ts src/components/availability/ArtistAvailabilityCalendar.tsx src/components/shows/ShowDateDetailSheet.tsx 2>&1 | grep -c no-explicit-any || true`
Expected: `6` (the six remaining `onError` sites in ShowDateDetailSheet — fixed in Task 8; all others `0`).

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "type frontend data layer queries, drop stale any casts"
```

---

### Task 8: De-`any` frontend pages/components (mechanical patterns)

**Files:** every remaining `src/` production site in Appendix A. Three patterns cover all of them:

**Pattern P1 — mutation error callbacks (32 sites):** `onError: (e: any) =>` → `onError: (e: Error) =>`. React Query v5's default `TError` is `Error`; `e.message` / `e?.message` keep compiling. Files: InvitesTab (3), ArtistImportDialog (1), ArtistProfileSheet (3), OfferResponseButtons (1), CastDetailsSheet (4), CastDialog (1), ChatPanel (1), CastsCitiesTab (4), ProductionOwnershipTab (2), ShowDateDetailSheet (6: lines 290,317,356,375,390,402), DashboardPage (2), ArtistsPage (2: 152,166), AvailabilityPage (1: 172), SettingsPage (1: 130).

**Pattern P2 — union-type casts and catches (9 sites):**
- `AppLayout.tsx:85,91` — `r as any` → import the role union the code checks against (`Database["public"]["Enums"]["app_role"]` via the existing `AppRole`-style alias in `src/types` if present, else add `type AppRole = Database["public"]["Enums"]["app_role"]` locally) and cast `r as AppRole`.
- `AvailabilityPage.tsx:64` — `(searchParams.get('filter') as any) === 'unanswered' ? 'unanswered' : 'all'` → drop the cast entirely: `searchParams.get('filter') === 'unanswered' ? 'unanswered' : 'all'` (string comparison needs no cast).
- `ShowsBookingsPage.tsx:288` — `v as any` in `onValueChange` → cast to the status-filter union type used by `statusFilter`'s state (read its `useState` declaration and cast to that exact union).
- `LoginPage.tsx:57` — `catch (err: any)` → `catch (err)` + use `(err as Error).message` at the use site (repo precedent: `expire-offers/index.ts` line 67).
- `AdminPage.tsx:105,135` — `(log: any)` → define local interfaces from the two queries' select strings (audit logs, sync logs), cast the arrays once `as unknown as Row[]`.
- `ArtistsPage.tsx:109`, `ShowsBookingsPage.tsx:170` — `(r: any)` / `(b: any)` forEach params → explicit row interface from the enclosing select, single cast at the data source.

**Pattern P3 — settings plumbing `Record<string, any>` → `unknown` (11 sites):**
- `SettingsPage.tsx:45,89,99,120,181,182` — change every `any` to `unknown` (`value: unknown`, `Record<string, unknown>`, `get = (key: string, fallback: unknown = '')`, `set = (key, value: unknown)`).
- `EmailTemplatesCard.tsx:34 (×3),40,61` — mirror the new signature: `{ get: (key: string, fallback?: unknown) => unknown; set: (key: string, value: unknown) => void }`; `overrides: Record<string, Record<string, string>> = (get('email_template_overrides', {}) ?? {}) as Record<string, Record<string, string>>` (one explicit cast at the read boundary); `catch (e: any)` → `catch (e)` + `(e as Error).message`.
- Where a consumer of `get(...)` now errors on `unknown`, narrow at the use site (`String(get('k', ''))`, `Number(...)`, or a typed cast naming the setting's shape) — never re-widen to `any`.

**Interfaces:** none produced.

- [x] **Step 1: Apply P1 across all 32 sites** (Appendix A lists each line). Run `npx vitest run src/components src/pages 2>&1 | tail -3` → pass.
- [x] **Step 2: Apply P2 (9 sites), typecheck**: `npx tsc -p tsconfig.app.json --noEmit` → exit 0.
- [x] **Step 3: Apply P3 (11 sites), typecheck + run settings tests**: `npx vitest run src/components/settings src/pages 2>&1 | tail -3` → pass.
- [x] **Step 4: Verify `src/` production code is fully any-clean**

Run: `npx eslint 'src/**/*.{ts,tsx}' 2>&1 | grep no-explicit-any | grep -v -E '\.test\.|src/test/' | wc -l`
Expected: `0`

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "replace remaining any in app pages and components with real types"
```

---

### Task 9: Type the email template registry

**Files:**
- Modify: `supabase/functions/_shared/transactional-email-templates/registry.ts` (3 sites)
- Modify: all 10 template files' `export const template` blocks + subject fns (10 sites, one per file — Appendix A)
- Modify: `supabase/functions/preview-transactional-email/index.ts:19`, `supabase/functions/send-transactional-email/index.ts:56,254` (Record→unknown, aligns with `TemplateData`)

**Interfaces:**
- Produces: `export type TemplateData = Record<string, unknown>` from `registry.ts` — Tasks 10/12 reference it for `templateData` payloads.

- [x] **Step 1: Registry**

```ts
export type TemplateData = Record<string, unknown>

export interface TemplateEntry {
  component: React.ComponentType<TemplateData>
  subject: string | ((data: TemplateData) => string)
  to?: string
  displayName?: string
  previewData?: TemplateData
}
```

- [x] **Step 2: Each template registration** — the component keeps its own typed props; the registration takes the one variance cast (worked example, `org-invitation.tsx`):

```ts
export const template = {
  component: OrgInvitationEmail as React.ComponentType<TemplateData>,
  subject: (data: TemplateData) =>
    `You're invited to join ${data?.orgName || 'an organization'} on ${SITE_NAME}`,
  displayName: 'Organization invitation',
  previewData: { /* unchanged */ },
} satisfies TemplateEntry
```

(`unknown` in a template literal is legal TS; where a subject fn passes `data` to a helper like `digestEmailSubject`, change that helper's parameter to `TemplateData` and narrow inside it.) Apply the same shape to: artist-confirmation-digest, artist-offer-digest, cast-escalation-requested, cron-health-alert, hire-order-issued, new-signup-admin-notification, offer-expiry-reminder, offer-immediate, signup-decision.

- [x] **Step 3: `send-transactional-email` + `preview-transactional-email`** — `Record<string, any>` → `TemplateData` (import it) at the three listed lines.
- [x] **Step 4: Gate**

Run: `deno test --allow-all supabase/functions/send-transactional-email/ supabase/functions/preview-transactional-email/ 2>&1 | tail -2` → pass (deno test typechecks the graph, which pulls in every template).
Run: `npx eslint 'supabase/functions/_shared/transactional-email-templates/**' supabase/functions/send-transactional-email supabase/functions/preview-transactional-email 2>&1 | grep -c no-explicit-any || true` → `0`

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "type email template registry with explicit template data"
```

---

### Task 10: De-`any` the booking-engine edge functions

**Files:**
- Create: `supabase/functions/_shared/rows.ts` — row shapes shared by the crons:

```ts
/** Joined-row shapes shared by the booking-engine crons and webhooks.
 *  Fields mirror the select strings at the call sites — if you change a
 *  select, change the interface in the same commit. */
export interface ShowJoin {
  program: string | null
  sub_program: string | null
  main_cast_slots: number | null
  understudy_slots: number | null
}
export interface ShowDateWithShow {
  id: string
  show_id: string
  date: string
  city_id: string | null
  org_id: string
  show: ShowJoin | null
}
export interface ProducerAssignmentRow { producer_user_id: string }
export interface OrgAdminRow { user_id: string }
export interface ArtistJoin {
  id: string
  name: string | null
  email: string | null
  user_id: string | null
}
export interface DueBookingRow {
  id: string
  artist_id: string
  offer_expires_at: string | null
  artists: ArtistJoin | null
  show_dates: {
    date: string
    custom: Record<string, unknown> | null
    show_id: string
    city_id: string | null
    shows: { program: string | null; sub_program: string | null } | null
  } | null
}
```

- Modify: `supabase/functions/expire-offers/index.ts` (20 sites) — worked conversions:
  - `:99,121` — `const dueRows = (due ?? []) as unknown as DueBookingRow[]` right after the error check; both sites then use `dueRows` with no per-site cast.
  - `:200` — `(admin as any).from('show_date_offer_tiers')` → `admin.from('show_date_offer_tiers')` (cast was never needed; the untyped client accepts any table).
  - `:222-231,255,277,302,306,353,376` — `const sdRow = sd as unknown as ShowDateWithShow` once after the `.maybeSingle()`; replace every `(sd as any).X` with `sdRow.X`.
  - `:274` — `(admin as any).rpc(...)` → `admin.rpc(...)`.
  - `:280` — `((producers ?? []) as unknown as ProducerAssignmentRow[]).map((p) => p.producer_user_id)`.
  - `:285` — `((admins ?? []) as unknown as OrgAdminRow[]).map((a) => a.user_id)`.
  - `:315,383` — remove `(admin as any)` → `admin`.
- Modify: `supabase/functions/tier-at-risk-watcher/index.ts` (15 sites) — identical patterns: one `sdRow` cast (:89–164), `ProducerAssignmentRow`/`OrgAdminRow` for :150/:155, bare `admin` for :39.
- Modify: `supabase/functions/_shared/eligibility.ts` (8 sites, lines 21–121) — remove every `(admin as any)` → `admin`; where a downstream property access then fails `deno check`, add a local row interface from that query's select (same single-cast rule).
- Modify: `supabase/functions/open-offer-tier/index.ts` (7 sites) — type at the array source, not the callback: e.g. `:113` `const castIds = ((dateCasts ?? []) as unknown as { cast_id: string }[]).map((r) => r.cast_id)`; same for `:142` (`{ artist_id: string }`), `:154` (`{ id: string }`), `:170` (`{ artist_id: string }`), `:182` (`{ artist_id: string }`); `:177,273` bare `admin`.
- Modify: `supabase/functions/send-offer-digest/index.ts:123,140` — reuse `DueBookingRow` if its select matches (compare field-by-field), else a local `PendingBookingRow` with the exact selected columns; single cast, drop both `as any[]`.
- Modify: `supabase/functions/send-confirmation-digest/index.ts` (7 sites: 113,114,134,141,143,169,204) — local interfaces `ConfirmedBookingRow`, `ChangeBookingRow` (from the two selects near the top of `handle`), `bookingsByDate: Map<string, ConfirmedBookingRow[]>`, `ensureEntry(artistId: string, artist: ArtistJoin | null)`, and `notificationRows: NotificationInsertRow[]` where:

```ts
interface NotificationInsertRow {
  user_id: string
  type: string
  title: string
  message: string
  related_entity_id?: string | null
  related_entity_type?: string | null
}
```

- Modify: `supabase/functions/handle-email-suppression/index.ts:123` — `catch (err: any)` → `catch (err)` + `(err as Error).message`.

**Interfaces:**
- Consumes: `TemplateData` (Task 9) if any `templateData` locals were typed.
- Produces: `_shared/rows.ts` exports above — Task 11 reuses `ProducerAssignmentRow`/`OrgAdminRow`.

- [x] **Step 1: Create `rows.ts`, convert expire-offers, run its tests**: `deno test --allow-all supabase/functions/expire-offers/ 2>&1 | tail -2` → pass.
- [x] **Step 2: Convert tier-at-risk-watcher + _shared/eligibility.ts**: `deno test --allow-all supabase/functions/tier-at-risk-watcher/ supabase/functions/_shared/ 2>&1 | tail -2` → pass.
- [x] **Step 3: Convert open-offer-tier + both digests + suppression**: `deno test --allow-all supabase/functions/ 2>&1 | tail -2` → all pass.
- [x] **Step 4: Verify**: `npx eslint supabase/functions/expire-offers supabase/functions/tier-at-risk-watcher supabase/functions/open-offer-tier supabase/functions/send-offer-digest supabase/functions/send-confirmation-digest supabase/functions/_shared/eligibility.ts supabase/functions/handle-email-suppression 2>&1 | grep no-explicit-any | grep -v test | wc -l` → `0` *(verified via `--format unix` so the path-per-line grep filter works; the stylish default prints 10 remaining warnings that are all in Task-14 test files)*
- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "type booking engine cron row shapes, drop any casts"
```

---

### Task 11: De-`any` documenso-webhook and generate-hire-orders

**Files:**
- Modify: `supabase/functions/documenso-webhook/index.ts` — delete `type Any = any;` (line 26); its 7 uses:
  - `:78,140` (`order as Any`, `order.show_dates as Any`) — define `HireOrderRow` (and its `show_dates` join) by copying the columns of the order select in this file into an interface; cast once where the row is loaded.
  - `:150,156` — `ProducerAssignmentRow` / `OrgAdminRow` from `_shared/rows.ts` (Task 10).
  - `:137` — `notifyProducers(deps: Deps, order: HireOrderRow)`.
- Modify: `supabase/functions/generate-hire-orders/index.ts` — delete `type Any = any;` (line 73); its 15 uses (141, 152, 163, 317, 325, 329, 402, 408, 536, 643, 689, 724, 753 is a comment — skip, 768) follow the same recipe:
  - Row-shaped uses (`sd`, `bookings`, `artistRow`, `sdRow`, `order`/`o`): one interface per distinct select in this file (`HireOrderRow`, `BookingWithArtistRow`, `ShowDateRow` — name them after what the select returns, copy the exact selected columns, type joins as nested object-or-null), cast once at each query result.
  - `(p: Any)`/`(a: Any)`/`(r: Any)` map callbacks: `ProducerAssignmentRow`, `OrgAdminRow`, `{ booking_id: string }` — typed at the array, not the callback.
  - Function params (`:317,643,689`): the new interfaces.

**Interfaces:**
- Consumes: `ProducerAssignmentRow`, `OrgAdminRow` from `_shared/rows.ts`.
- Produces: file-local interfaces only.

- [x] **Step 1: Convert documenso-webhook**: `deno test --allow-all supabase/functions/documenso-webhook/ 2>&1 | tail -2` → pass.
- [x] **Step 2: Convert generate-hire-orders (largest file — go select-by-select, `deno check supabase/functions/generate-hire-orders/index.ts` after each interface lands)**: final `deno test --allow-all supabase/functions/generate-hire-orders/ 2>&1 | tail -2` → pass.
- [x] **Step 3: Verify**: `npx eslint supabase/functions/documenso-webhook supabase/functions/generate-hire-orders 2>&1 | grep no-explicit-any | grep -v test | wc -l` → `0` *(verified via `--format unix` so the test-file grep filter works)*
- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "replace any alias with explicit row types in hire order functions"
```

---

### Task 12: Type the shared Deno Supabase clients

**Files:**
- Modify: `supabase/functions/_shared/deps.ts`
- Modify: `supabase/functions/_shared/testing.ts` (`AnyChain` at :42 + fake-client casts)
- Modify: any function file that newly fails `deno check` once the client is typed.

**Interfaces:**
- Produces: `export type TypedClient = SupabaseClient<Database>` from `deps.ts`; `Deps.admin: TypedClient`, `Deps.userClient: (h: string) => TypedClient`. `asTypedClient(fake: unknown): TypedClient` from `testing.ts` (used by Task 14).

- [x] **Step 1: deps.ts**

```ts
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database } from "./database.types.ts";
import type { RenderHireOrderPdf } from "./hireOrders.ts";

export type TypedClient = SupabaseClient<Database>;
```

`Deps.admin: TypedClient`, `userClient: (authHeader: string) => TypedClient`, `createClient<Database>(...)` at both construction sites. Then try removing the `// eslint-disable-next-line @typescript-eslint/no-explicit-any` + `body as any` at lines 69–70: if `FunctionInvokeOptions.body` rejects `unknown`, use `body: body as never` — no, prefer: keep `invokeFunction`'s param `body: unknown` and pass `{ body }` if it compiles; if not, the narrowest compiling cast that is not `any`.

- [x] **Step 2: testing.ts** — replace `type AnyChain = Record<string, any>` with `Record<string, unknown>` (mirror `src/test/supabaseFake.ts`'s builder pattern: build on a `Record<string, unknown>`, cast the finished object out through `unknown`), delete the `deno-lint-ignore` above it, and add:

```ts
import type { TypedClient } from "./deps.ts";
/** The single sanctioned cast from a fake client to the typed client. */
export function asTypedClient(fake: unknown): TypedClient {
  return fake as TypedClient;
}
```

Wire `makeFakeDeps` so the fake admin/userClient pass through `asTypedClient`.

- [x] **Step 3: Fix the fallout** — run `deno test --allow-all supabase/functions/ 2>&1 | tail -5`. Every new type error is one of: (a) an overlap complaint on an existing `as Row[]` cast → make it `as unknown as Row[]`; (b) a genuine column/table mismatch → fix the name against `database.types.ts` (that's the payoff of this task); (c) an insert payload mismatch → align the object with the table's `Insert` type. Iterate until: `deno test --allow-all supabase/functions/` → all pass.
- [x] **Step 4: Verify**: `npx eslint supabase/functions/_shared/deps.ts supabase/functions/_shared/testing.ts 2>&1 | grep -c no-explicit-any || true` → `0`. Also `grep -rn "eslint-disable.*no-explicit-any\|deno-lint-ignore no-explicit-any" supabase/functions/ | wc -l` → `0`.
- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "type deno supabase clients against mirrored database types"
```

---

### Task 13: Typed test-cast helpers + frontend test sweep

**Files:**
- Create: `src/test/castHelpers.ts`
- Test: `src/test/castHelpers.test.ts`
- Modify: the 137 `src/**` test sites (per-file counts in Appendix B; every site is a variant of three idioms).

**Interfaces:**
- Produces: `asSupabase(fake: unknown): SupabaseClient<Database>`, `asQueryResult<T>(partial): UseQueryResult<T, Error>`, `partialMock<T>(partial: Partial<T>): T` — the only sanctioned test casts from Task 15 onward.

- [x] **Step 1: Write the failing helper test**

```ts
import { describe, expect, it } from "vitest";
import { asQueryResult, asSupabase, partialMock } from "./castHelpers";

describe("castHelpers", () => {
  it("asQueryResult passes fields through", () => {
    const r = asQueryResult<{ id: string }>({ data: { id: "a1" }, isLoading: false });
    expect(r.data).toEqual({ id: "a1" });
  });
  it("partialMock keeps the given keys", () => {
    const m = partialMock<{ a: number; b: number }>({ a: 1 });
    expect(m.a).toBe(1);
  });
  it("asSupabase returns the same object", () => {
    const fake = { from: () => ({}) };
    expect(asSupabase(fake)).toBe(fake);
  });
});
```

- [x] **Step 2: Run it to verify it fails** — `npx vitest run src/test/castHelpers.test.ts` → FAIL (module not found).
- [x] **Step 3: Implement**

```ts
import type { UseQueryResult } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** The single sanctioned cast from a test stub to the app's client type.
 *  Build the whole stub as plain objects, cast ONCE here at the boundary. */
export function asSupabase(fake: unknown): SupabaseClient<Database> {
  return fake as SupabaseClient<Database>;
}

/** Build a UseQueryResult from only the fields the test asserts on. */
export function asQueryResult<T>(
  partial: Partial<UseQueryResult<T, Error>>,
): UseQueryResult<T, Error> {
  return partial as UseQueryResult<T, Error>;
}

/** Cast a partial object to T for module/hook mocks — keys are checked
 *  against T (typos fail), presence is not. */
export function partialMock<T>(partial: Partial<T>): T {
  return partial as T;
}
```

- [x] **Step 4: Run test** → PASS. Commit the helpers alone: `git add src/test/castHelpers.* && git commit -m "add typed cast helpers for test stubs"`.
- [x] **Step 5: Sweep the test files, three idioms:**
  - `vi.mocked(useX).mockReturnValue({ ... } as any)` → `vi.mocked(useX).mockReturnValue(asQueryResult({ ... }))` for query hooks; `partialMock<ReturnType<typeof useAuth>>({ ... })` for context hooks (import the hook from its context module — paths unchanged; Task 5 did not move them).
  - Ad-hoc fake-client chain objects (`useArtistEligibleDates.test.ts`'s `} as any;` blocks, `useEligibleArtists`, `useChatParticipant`): keep the stub object literal exactly as-is, remove the per-object `as any`, funnel the outermost value through `asSupabase(...)` (or `partialMock<...>` when the mock target is a chain fragment — worked example for the dominant idiom:

```ts
// before
vi.mocked(useMyArtist).mockReturnValue({ data: { id: ARTIST_ID } } as any);
// after
vi.mocked(useMyArtist).mockReturnValue(asQueryResult({ data: { id: ARTIST_ID } }));
```

For a `from`-implementation stub whose return chain was `({ ... } as any)`, type the factory's return as `ReturnType<SupabaseClient<Database>["from"]>` via one `asSupabase` on the whole client stub instead of casting each chain — restructure to "build plain object → single boundary cast", same as `supabaseFake.ts`.)
  - Fixture-shape casts (`artists.test.ts` `{ id: "d2" } as any`, `ProtectedRoute.test.tsx` `requiredRoles as any`, `user: { id: "user-1" } as any`) → `partialMock<TheRealType>({ ... })`, importing the real type.
  Work file-by-file in Appendix B order (largest first), running that file's tests after each: `npx vitest run <file>` → pass.
- [x] **Step 6: Verify + full gate**: `npx eslint 'src/**/*.test.*' src/test 2>&1 | grep -c no-explicit-any || true` → `0`; `npx vitest run 2>&1 | tail -3` → 1164 pass (count unchanged — this sweep must not weaken a single assertion).
- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "route frontend test stubs through typed cast helpers"
```

---

### Task 14: Deno test sweep

**Files:** the 66 `supabase/functions/**` test sites (Appendix B): `airtable-poll/index.di.test.ts` (25), `index.test.ts` (18), `index.custom.test.ts` (5), `index.regression.test.ts` (2), `index.org.test.ts` (2), `index.linked.test.ts` (1), `send-confirmation-digest/index.test.ts` (6), `tier-at-risk-watcher/index.di.test.ts` (2), `send-transactional-email/index.di.test.ts` (2), `expire-offers/index.di.test.ts` (2), `admin-list-users/index.di.test.ts` (1).

**Interfaces:**
- Consumes: `asTypedClient` from `_shared/testing.ts` (Task 12), `TypedClient` from `deps.ts`.

- [x] **Step 1: Sweep, same three idioms as Task 13** — fake clients/deps through `asTypedClient` / `makeFakeDeps` options; row fixtures through explicit local interfaces or `Partial<>` casts of the row types the functions now export/declare; never per-site `as any`. Run per function: `deno test --allow-all supabase/functions/airtable-poll/ 2>&1 | tail -2` → pass, then the rest.
- [x] **Step 1b: Also remove the 18 `eslint-disable`-suppressed `any` sites in these files** — they never fired warnings so they are NOT in Appendix B: `airtable-poll/index.di.test.ts:733,888,1312,1319,1368,1375`, `index.custom.test.ts:46,51,55,68,73`, `index.regression.test.ts:66,68`, `index.linked.test.ts:69`, `admin-list-users/index.di.test.ts:34`, `send-transactional-email/index.di.test.ts:633,642` (line numbers as of plan time — re-grep with `grep -rn "eslint-disable.*no-explicit-any" supabase/functions/`). For each: delete the suppression comment AND fix the `any` underneath with the same idioms. Verify: that grep returns 0 matches under `supabase/functions/` test files.
- [x] **Step 2: Verify zero `any` repo-wide**

Run: `npm run lint 2>&1 | tail -1`
Expected: `✖ 0 problems` (nothing left: this is the last warning-producing category).

- [x] **Step 3: Full gate**: `npx vitest run` → 1164 pass; `deno test --allow-all supabase/functions/` → pass; `npx tsc -p tsconfig.app.json --noEmit` → exit 0.
- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "type deno edge function test stubs"
```

---

### Task 15: Flip to error, gate CI, codify the boundary

**Files:**
- Modify: `eslint.config.js` — in the `strictness` object: `"warn"` → `"error"` (both rules, keeping the unused-vars options object), `react-refresh/only-export-components` `"warn"` → `"error"`, and replace the interim severity comment with:

```js
// All three rules are errors and the lint script runs with --max-warnings 0:
// any new violation fails CI. The `any` boundary policy lives in CLAUDE.md
// ("TypeScript" section).
```

- Modify: `package.json` — `"lint": "eslint . --max-warnings 0"`.
- Modify: `CLAUDE.md`:
  1. **Build/test/lint block**: `npm run lint      # eslint (zero-warning gate: --max-warnings 0)`.
  2. **TypeScript section** — replace the bullet "`any` is allowed for Supabase joined-row shapes when typing them is disproportionate, but isolate to the boundary." with:

```markdown
- `any` is banned (lint error, CI-gated). When supabase-js can't infer a joined-row
  shape, define an explicit local row `interface` and cast once at the query result
  (`as unknown as Row[]`) immediately after the error check — confined to `src/data/**`,
  hook `queryFn`s, and `supabase/functions/**`. Never deep-access an untyped row.
  Test stubs go through the typed helpers (`src/test/castHelpers.ts`,
  `_shared/testing.ts` `asTypedClient`) — one cast inside the helper, never `as any`.
```

  3. **Architecture tree + key-files table**: `features/auth/` additionally lists `realtimeInvalidations.ts` (moved in Task 4); mention the moved modules from Task 4 where the tree names their old homes (`lib/` gains `singleFlight.ts`, `hireOrders/kpis.ts`); add `supabase/functions/_shared/database.types.ts` to the key-files table with "mirror of `src/integrations/supabase/types.ts` (dual-home, sync-tested — regenerate both together)". Context file paths are unchanged (Task 5 exemption).
  4. **Things to avoid**: add `- Casting Supabase rows or clients with \`as any\` — use an explicit row interface + single \`as unknown as\` cast at the query boundary, or the typed test helpers.`
- Modify: remove straggler suppression comments: `grep -rn "eslint-disable.*no-explicit-any\|deno-lint-ignore no-explicit-any" src supabase e2e`. For each match, VERIFY it is orphaned (the `any` beneath it was already fixed in Tasks 7–14) before deleting the comment; if a live `any` survives underneath, fix it with the boundary patterns first — never delete a suppression that still guards code. Expected: all matches are orphaned by now (Tasks 10–12 fixed the production sites, Task 14 Step 1b the test sites); end state is 0 matches.

**Interfaces:** none.

- [ ] **Step 1: Apply all edits above.**
- [ ] **Step 2: Prove the gate**: `npm run lint` → exit 0, no output. Then prove it bites: add `const x: any = 1` to any file, `npm run lint` → exit 1 with 1 error; revert.
- [ ] **Step 3: Full final gate**: `npx vitest run` (1164 pass) + `deno test --allow-all supabase/functions/` (pass) + `npx tsc -p tsconfig.app.json --noEmit` (exit 0) + `npm run build` (succeeds — catches any import-path slip from Tasks 4–5).
- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "enforce zero-warning lint gate and codify any boundary"
```

---

## Appendix A: Production `any` inventory (156 sites, file:line → current source)

```
src/components/admin/InvitesTab.tsx:35 | onError: (e: any) => toast.error(e?.message ?? 'Could not send invitation'),
src/components/admin/InvitesTab.tsx:44 | onError: (e: any) => toast.error(e?.message ?? 'Could not revoke invitation'),
src/components/admin/InvitesTab.tsx:50 | onError: (e: any) => toast.error(e?.message ?? 'Could not resend invitation'),
src/components/artists/ArtistImportDialog.tsx:191 | onError: (e: any) => toast({ title: 'Import failed', ... })
src/components/artists/ArtistProfileSheet.tsx:80,96,180 | onError: (e: any) => toast({ title: 'Error', ... })
src/components/availability/ArtistAvailabilityCalendar.tsx:61 | await (supabase as any)
src/components/availability/OfferResponseButtons.tsx:43 | onError: (e: any) => toast(...)
src/components/casts/CastDetailsSheet.tsx:50,134,150,174 | onError: (e: any) => toast.error(...)
src/components/casts/CastDialog.tsx:42 | onError: (err: any) => toast(...)
src/components/chat/ChatPanel.tsx:123 | onError: (e: any) => toast(...)
src/components/layout/AppLayout.tsx:85 | hasRole: (r) => hasRole(r as any)
src/components/layout/AppLayout.tsx:91 | viewAsUser.roles.includes(r as any)
src/components/settings/CastsCitiesTab.tsx:38,46,117,129 | onError: (e: any) => toast.error(...)
src/components/settings/EmailTemplatesCard.tsx:34 (x3) | { get: (key, fallback?: any) => any; set: (key, value: any) => void }
src/components/settings/EmailTemplatesCard.tsx:40 | const overrides: Record<string, any> = get('email_template_overrides', {}) ?? {}
src/components/settings/EmailTemplatesCard.tsx:61 | } catch (e: any) {
src/components/settings/ProductionOwnershipTab.tsx:115,127 | onError: (e: any) => toast.error(...)
src/components/shows/ShowDateDetailSheet.tsx:88 | return data as any;
src/components/shows/ShowDateDetailSheet.tsx:290,317,356,375,390,402 | onError: (err: any) => ...
src/data/artists.ts:56 | return ((data ?? []) as any[])
src/data/bookings.ts:49 | await (client as any)
src/data/bookings.ts:335 | return ((data ?? []) as any[]).map((r) => ...
src/data/bookings.ts:346 | (r.show_date.bookings ?? []).map((b: any) => ...
src/data/eligibility.ts:15,18,33,52,69,76,80,90,100,110,119,128,137 | await (client as any).from(...)
src/hooks/useArtistEligibleDates.ts:78,94,95,115 | (d: any) callbacks
src/hooks/useArtistEligibleDates.ts:97,101 | await (supabase as any).from('show[_date]_required_skills')
src/hooks/useChatParticipant.ts:24 | (data ?? []).some((b: any) => b.artist?.user_id === ...)
src/pages/AdminPage.tsx:105 | auditLogs?.map((log: any) => ...
src/pages/AdminPage.tsx:135 | syncLogs.map((log: any) => ...
src/pages/ArtistsPage.tsx:109 | (data ?? []).forEach((r: any) => ...
src/pages/ArtistsPage.tsx:152,166 | onError: (err: any) => toast(...)
src/pages/AvailabilityPage.tsx:64 | (searchParams.get('filter') as any) === 'unanswered' ...
src/pages/AvailabilityPage.tsx:172 | onError: (e: any) => toast(...)
src/pages/DashboardPage.tsx:150,164 | onError: (e: any) => toast.error(e.message)
src/pages/LoginPage.tsx:57 | } catch (err: any) {
src/pages/SettingsPage.tsx:45,89,99,120,181,182 | value: any / Record<string, any> / fallback: any
src/pages/SettingsPage.tsx:130 | onError: (e: any) => toast.error(...)
src/pages/ShowsBookingsPage.tsx:170 | (data ?? []).forEach((b: any) => ...
src/pages/ShowsBookingsPage.tsx:288 | onValueChange={v => updateStatusFilter(v as any)}
supabase/functions/_shared/eligibility.ts:21,35,66,74,84,97,102,121 | await (admin as any).from(...)
supabase/functions/_shared/testing.ts:42 | type AnyChain = Record<string, any>;
supabase/functions/_shared/transactional-email-templates/registry.ts:5,6,9 | ComponentType<any> / Record<string, any>
supabase/functions/_shared/transactional-email-templates/*.tsx (10 files, 1 each) | subject: (data: Record<string, any>) => ...
supabase/functions/documenso-webhook/index.ts:26 | type Any = any; (7 uses: 78,137,140,150,156)
supabase/functions/expire-offers/index.ts:99,121,200,222,223,226,230,231,255,274,277,280,285,302,306(x2),315,353,376,383
supabase/functions/generate-hire-orders/index.ts:73 | type Any = any; (15 uses: 141,152,163,317,325,329,402,408,536,643,689,724,768)
supabase/functions/handle-email-suppression/index.ts:123 | } catch (err: any) {
supabase/functions/open-offer-tier/index.ts:113,142,154,170,177,182,273
supabase/functions/preview-transactional-email/index.ts:19 | let overrides: Record<string, any> = {}
supabase/functions/send-confirmation-digest/index.ts:113,114,134,141,143,169,204
supabase/functions/send-offer-digest/index.ts:123,140
supabase/functions/send-transactional-email/index.ts:56,254
supabase/functions/tier-at-risk-watcher/index.ts:39,89,107,108,111,115,116,143,146,147,150,154,155,158,164
```

## Appendix B: Test-file `any` counts (203 sites)

Frontend (137 — Task 13): `src/hooks/useArtistEligibleDates.test.ts` 64, `src/features/auth/ProtectedRoute.test.tsx` 33, `src/hooks/useEligibleArtists.test.ts` 16, `src/hooks/useChatParticipant.test.ts` 16, `src/data/artists.test.ts` 4, `src/components/layout/OrgSwitcher.test.tsx` 3, `src/components/layout/ThemeToggle.test.tsx` 1.

Deno (66 — Task 14): `airtable-poll/index.di.test.ts` 25, `airtable-poll/index.test.ts` 18, `airtable-poll/index.custom.test.ts` 5, `airtable-poll/index.regression.test.ts` 2, `airtable-poll/index.org.test.ts` 2, `airtable-poll/index.linked.test.ts` 1, `send-confirmation-digest/index.test.ts` 6, `tier-at-risk-watcher/index.di.test.ts` 2, `send-transactional-email/index.di.test.ts` 2, `expire-offers/index.di.test.ts` 2, `admin-list-users/index.di.test.ts` 1.

(64 + 33 + 16 + 16 + 4 + 3 + 1 = 137; Deno sums to 66; 137 + 66 = 203 ✓)
