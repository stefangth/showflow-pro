# Wireflow v3 — Phase 2: "Get dates in" wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the five placeholder steps of the `get_dates` phase (`source`, `connect`, `map`, `cities`, `productions`) into real wizard bodies, plus a new PartsEditor sheet, so an admin/producer can get show dates in by Airtable or by hand — all behind the off-by-default `getrunning_v3` flag, additive to the untouched v1 board.

**Architecture:** The Phase 1 v3 frame already exists: `composeGetRunningV3` (pure model), `useGetRunningV3` (integration hook), `WizardShell` (three-column frame + footer portal), and `StepBodyV3` (a `switch` that dispatches a step key to a body; placeholder steps render `StepComingSoon`). Phase 2 (a) adds real done/block signals + a source-conditional `hidden` flag to the model, (b) feeds those signals from `useGetRunningV3`, (c) adds five new step-body components under `src/components/getRunning/v3/steps/` plus a `PartsEditorSheet`, and (d) rewires the five `StepBodyV3` branches from `StepComingSoon` to the real bodies. Every new body reuses the existing Airtable console (`useAirtableConsole` + `MappingTab` + `CatalogTab`), the slots data layer (`saveShowSlots`/`fetchShowSlots`), and the catalog dialogs (`ShowFormDialog`/`ShowDateFormDialog`). No Google-Sheet backend and no `cast_production_fees` — those are Phase 4; the Sheet source appears in the picker as a disabled "coming soon" card.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind + shadcn/ui, @tanstack/react-query v5, Supabase, react-i18next (EN + DE), Vitest + @testing-library/react (jsdom), the `src/test/` harness (`supabaseFake.ts`, `renderWithProviders.tsx`, `fixtures.ts`).

**Spec:** `docs/superpowers/specs/2026-08-23-wireflow-v3-get-running-settings-design.md` (owner-approved 2026-08-23, commit 2a5f43bb). Phase 1 plan (context): `docs/superpowers/plans/2026-08-23-wireflow-v3-phase-1-frame-board-model.md`.

## Global Constraints

- **Flag-gated + additive.** All Phase 2 work is reached only through `GETRUNNING_V3` (`src/config/flags.ts`, reads `import.meta.env.VITE_GETRUNNING_V3 === "true"`; on in local `.env.development`, off in prod). v1 board code (`src/lib/getRunning/tasks.ts`, `taskFeature.ts`, `GetRunningPage.tsx` v1 branch, `src/components/getRunning/panels/**`) stays byte-untouched. No v1 file is deleted (that is Phase 5).
- **UI conventions (`docs/ui-conventions.md`), CI-enforced at `--max-warnings 0`.** Reuse `src/components/ui` primitives first; no raw hex/rgba/`text-[13px]`/`rounded-[10px]` outside `src/components/ui`; 13px is the control size (`text-control`); uppercase text is `<Eyebrow>`; status colour from `TONES`/`StatusPill`; numbers are `<Metric>`; tint washes are `bg-hover-tint`/`bg-well-tint`/`bg-accent-tint` (no ad-hoc `bg-muted`/`bg-foreground/N`).
- **No dashes in copy** (em/en dash fails `src/i18n/copyLint.test.ts` in both locales); no exclamation marks, no emoji. German is Du-form. Use a period, colon, or "to" for ranges.
- **i18n from the start.** Every new user-facing string goes through `t()` in the `getRunningV3` namespace (`src/i18n/locales/{en,de}/getRunningV3.json`), EN canonical, DE at full key parity (`src/i18n/keyParity.test.ts` gates this). New domain terms go in `src/i18n/terms.ts` `TERMS`, never inlined. App terminology wins over design copy: production (not "show"), part/Position (not "parts"), Casting breakdown (not "PartsEditor"), parts / people-per-part (not "slots"), Contract (not "hire order").
- **`any` is banned** (lint error). At a Supabase query boundary use an explicit row interface + a single `as unknown as Row[]` cast in `src/data/**`; in tests use `src/test/castHelpers.ts` (`asSupabase`/`asQueryResult`/`partialMock`).
- **Data access is `fetchX(client, args)` / `mutateX(client, args)` in `src/data/<domain>.ts`; hooks are thin wrappers** that pass the `supabase` singleton. Test data-access functions with `supabaseFake.ts` (never `vi.mock` the client).
- **Test-first (TDD).** Write the failing test, run it red, implement minimally, run it green, commit. Do not re-implement production logic in a test — import the real module.
- **Do not commit or push to `main`.** Work on the Phase 2 branch. `main` requires the owner's review approval to merge; the executor never self-merges and never commits unless the plan step says to.
- **Slots naming reality:** the helper is `showSlots(show)` in `src/lib/settings.ts` (there is no `effectiveSlots`). "Parts / people-per-part" are stored as `show_slots` rows + `show_slot_required_skills`, written by `saveShowSlots(client, {showId, orgId, slots})` in `src/data/slots.ts`. There is no `parts`/`positions` table and no existing `PartsEditor` component.

---

## File Structure

**Model (pure) — modify:**
- `src/lib/getRunning/steps.ts` — add `hidden?: boolean` to `GetRunningStep`; add new fields to `GetRunningInputV3` (`datesSource`, `datesConnectDone`, `datesMapDone`, `datesCitiesDone`); replace the shared `datesDone` wiring for `source`/`connect`/`map`/`cities` with per-step signals; make `connect`/`map` `hidden` when `datesSource === "manual"`; flip `placeholder:false` for all five `get_dates` steps; ensure `doneCount`/`totalCount`/`nextStep` exclude hidden steps.

**Model integration (hook) — modify:**
- `src/hooks/useGetRunningV3.ts` — read the new dates-source setting + Airtable console readiness + city coverage; feed the new `GetRunningInputV3` fields.

**Data access — create + test:**
- `src/data/datesSource.ts` (+ `.test.ts`) — `fetchDatesSource` / `saveDatesSource` over an org setting `getrunning_dates_source`.
- `src/hooks/useDatesSource.ts` — thin query + mutation wrapper.

**Reused-piece extraction (DRY) — create + modify:**
- `src/components/catalog/CastingBreakdownFields.tsx` (+ `.test.tsx`) — the slot-row repeater + per-slot `SkillPicker` + totals, extracted from `ShowFormDialog` so both the dialog and the new PartsEditor sheet share one implementation.
- `src/components/catalog/ShowFormDialog.tsx` — modify to consume `CastingBreakdownFields` (behaviour unchanged; guarded by its existing tests).
- `src/components/getRunning/panels/airtable/AirtableConnectRail.tsx` — export the currently-local `TokenStep` and `BaseTableStep` (move to `src/components/getRunning/panels/airtable/connectSteps.tsx` and re-import) so `ConnectStep` can reuse the token + base pickers without duplicating the map/catalog steps.

**New step bodies — create + test (all under `src/components/getRunning/v3/steps/`):**
- `SourceStep.tsx` (+ `.test.tsx`) — source picker: Airtable (active), Google Sheet (disabled, "coming soon"), By hand (manual); persists `dates_source`.
- `ConnectStep.tsx` (+ `.test.tsx`) — Airtable token + base/table via extracted `TokenStep`/`BaseTableStep` fed by `useAirtableConsole`; a "not needed for by hand" info body when `source === "manual"`.
- `MapStep.tsx` (+ `.test.tsx`) — `MappingTab` fed by `useAirtableConsole` + a casting-breakdown ("slots fold") confirm callout linking to `productions`.
- `CitiesStep.tsx` (+ `.test.tsx`) — the Cities section of `CatalogTab` fed by `useAirtableConsole` (link / create / reconcile), plus the by-hand cities affordance.
- `ProductionsStep.tsx` (+ `.test.tsx`) — productions list with per-row parts/status; "add a production by hand" (`ShowFormDialog`); "add a date by hand" (`ShowDateFormDialog`); "Set casting breakdown" opens the PartsEditor sheet.
- `PartsEditorSheet.tsx` (+ `.test.tsx`) — a shadcn `Sheet` hosting `CastingBreakdownFields` for one production; saves via `saveShowSlots`.

**Registry — modify:**
- `src/components/getRunning/v3/stepRegistryV3.tsx` — in `StepBodyV3`, route `source`/`connect`/`map`/`cities`/`productions` to the new bodies (remove them from the placeholder fall-through); add the `orgId`/`onDone` wiring each body needs.

**Board icons — verify (likely no change):**
- `src/components/getRunning/v3/board/PhaseIconRail.tsx` — `STEP_ICON` already covers all 16 keys; confirm the five icons read sensibly, adjust only if wrong.

**Copy — modify:**
- `src/i18n/locales/en/getRunningV3.json` + `de/getRunningV3.json` — add body-level sub-trees for the five steps (source options, connect/map/cities/productions body strings, PartsEditor sheet). `steps.<key>` and `guide.<key>` for all five already exist; do not duplicate.
- `src/i18n/terms.ts` — add any new shared terms (e.g. `castingBreakdown`, `part`) if not already present; reuse existing entries.
- `src/lib/help/items.ts` (EN + DE) — add/adjust help items for "get dates in" if the change alters what a user asks; otherwise state "No help center impact." in the PR.

---

## Task 1: Model — `hidden` step flag + per-step `get_dates` signals

**Files:**
- Modify: `src/lib/getRunning/steps.ts`
- Test: `src/lib/getRunning/steps.test.ts`

**Interfaces:**
- Consumes: existing `BookingSetupStatus`, `HireOrderSetupStatus`, `GetRunningInputV3`, `composeGetRunningV3`.
- Produces: `GetRunningStep.hidden?: boolean`; extended `GetRunningInputV3` with `datesSource: "airtable" | "sheet" | "manual" | null`, `datesConnectDone: boolean`, `datesMapDone: boolean`, `datesCitiesDone: boolean`; `composeGetRunningV3` semantics: `source.done = datesSource != null`; `connect.done = datesConnectDone`; `map.done = datesMapDone`; `cities.done = datesCitiesDone`; `productions.done` unchanged (booking `slots`); `connect`/`map` carry `hidden: datesSource === "manual"`; `doneCount`/`totalCount`/`nextStep` skip `hidden` steps; the five `get_dates` steps are `placeholder: false`.

- [ ] **Step 1: Write failing tests for the new model behaviour**

Add to `src/lib/getRunning/steps.test.ts` (reuse the file's existing `makeInput`/base-input helper — read it first and match its shape; the fields below are the deltas):

```ts
describe("composeGetRunningV3 get_dates phase (Phase 2)", () => {
  it("source is done once a source is chosen", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true, datesSource: "airtable" }));
    const dates = m.phases.find((p) => p.key === "get_dates")!;
    expect(dates.steps.find((s) => s.key === "source")!.done).toBe(true);
  });

  it("none of the five get_dates steps are placeholders anymore", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true }));
    const dates = m.phases.find((p) => p.key === "get_dates")!;
    for (const key of ["source", "connect", "map", "cities", "productions"] as const) {
      expect(dates.steps.find((s) => s.key === key)!.placeholder).toBe(false);
    }
  });

  it("hides connect and map when the source is by-hand, and excludes them from counts", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true, datesSource: "manual" }));
    const dates = m.phases.find((p) => p.key === "get_dates")!;
    const connect = dates.steps.find((s) => s.key === "connect")!;
    const map = dates.steps.find((s) => s.key === "map")!;
    expect(connect.hidden).toBe(true);
    expect(map.hidden).toBe(true);
    // 3 visible get_dates steps (source, cities, productions), not 5
    expect(dates.steps.filter((s) => !s.hidden).length).toBe(3);
  });

  it("shows connect and map when the source is airtable", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true, datesSource: "airtable" }));
    const dates = m.phases.find((p) => p.key === "get_dates")!;
    expect(dates.steps.find((s) => s.key === "connect")!.hidden).toBeFalsy();
    expect(dates.steps.find((s) => s.key === "map")!.hidden).toBeFalsy();
  });

  it("maps per-step done signals (connect/map/cities) independently", () => {
    const m = composeGetRunningV3(
      baseInput({ bookingOn: true, datesSource: "airtable", datesConnectDone: true, datesMapDone: false, datesCitiesDone: true }),
    );
    const dates = m.phases.find((p) => p.key === "get_dates")!;
    expect(dates.steps.find((s) => s.key === "connect")!.done).toBe(true);
    expect(dates.steps.find((s) => s.key === "map")!.done).toBe(false);
    expect(dates.steps.find((s) => s.key === "cities")!.done).toBe(true);
  });

  it("nextStep and doneCount ignore hidden steps", () => {
    // manual source, source+cities done, productions not: nextStep is productions, not the hidden connect
    const m = composeGetRunningV3(
      baseInput({ bookingOn: true, datesSource: "manual", datesCitiesDone: true }),
    );
    expect(m.nextStep?.key).toBe("productions");
    const dates = m.phases.find((p) => p.key === "get_dates")!;
    expect(dates.totalCount).toBe(3); // hidden connect/map excluded
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/lib/getRunning/steps.test.ts`
Expected: FAIL (`hidden` undefined; `placeholder` still true; new input fields unknown).

- [ ] **Step 3: Implement the model changes in `steps.ts`**

1. Add `hidden?: boolean;` to `GetRunningStep`.
2. Extend `GetRunningInputV3`:
```ts
  datesSource: "airtable" | "sheet" | "manual" | null;
  datesConnectDone: boolean;
  datesMapDone: boolean;
  datesCitiesDone: boolean;
```
   Remove the now-unused `datesDone` field ONLY if nothing else reads it — grep first (`useGetRunningV3` sets it; Task 2 replaces that). If removal is risky, keep `datesDone` in the type and leave it unused for this task; delete in Task 2's commit. (Prefer: keep it this task, remove in Task 2 to keep each task green.)
3. In the `get_dates` phase config, set for `source`/`connect`/`map`/`cities`/`productions`: `placeholder: false`. Give:
   - `source`: `done: input.datesSource != null`.
   - `connect`: `done: input.datesConnectDone`, `hidden: input.datesSource === "manual"`.
   - `map`: `done: input.datesMapDone`, `hidden: input.datesSource === "manual"`.
   - `cities`: `done: input.datesCitiesDone`.
   - `productions`: unchanged (`done` from `bookingStep(input.booking, "slots")?.done`).
   Keep the existing `block`/capability wiring (all four data-in steps keep `block: hardBlock`, capability `canManageShows`; `productions` keeps `canEditScheduling`).
4. Where the phase's `doneCount`/`totalCount` are computed, filter to `!s.hidden`. Where `nextStep` is computed (first not-done step in order), also skip `hidden` steps. Where the model rollups `doneCount`/`totalCount`/`canFirstOffer`/`complete` iterate all steps, treat `hidden` steps as absent (exclude from totals and from the done/complete predicates).

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/lib/getRunning/steps.test.ts`
Expected: PASS (new + all pre-existing model tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors (there will be a type error in `useGetRunningV3.ts` if `datesDone` was removed — if so, defer removal to Task 2 so this task stays green, or accept that Task 2 immediately follows; prefer keeping the field this task).

```bash
git add src/lib/getRunning/steps.ts src/lib/getRunning/steps.test.ts
git commit -m "model: per-step get_dates signals + hidden flag for v3 wizard"
```

---

## Task 2: Data access — the `dates_source` org setting

**Files:**
- Create: `src/data/datesSource.ts`
- Test: `src/data/datesSource.test.ts`
- Create: `src/hooks/useDatesSource.ts`

**Interfaces:**
- Consumes: `resolveOrgSetting<T>(client, orgId, key, fallback)` and `upsertOrgSetting(client, orgId, key, value)` from `src/data/settings.ts` (verify exact signatures in that file before writing — Task assumes `resolveOrgSetting(client, orgId, key, fallback)` returns `Promise<T>` and `upsertOrgSetting(client, orgId, key, value)` returns `Promise<void>`; adapt to the real signatures).
- Produces: `DatesSource = "airtable" | "sheet" | "manual" | null`; `fetchDatesSource(client, orgId): Promise<DatesSource>`; `saveDatesSource(client, orgId, source): Promise<void>`; hook `useDatesSource(orgId)` → `{ source, isLoading, save, saving }`.

- [ ] **Step 1: Write failing data-access test**

`src/data/datesSource.test.ts`, using `makeSupabaseFake` from `src/test/supabaseFake.ts` (match how other `src/data/*.test.ts` files seed `app_settings` rows — read one first, e.g. `src/data/airtableSettings.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { fetchDatesSource, saveDatesSource } from "./datesSource";
import { makeSupabaseFake } from "@/test/supabaseFake";

describe("datesSource data access", () => {
  it("returns null when no setting is stored", async () => {
    const fake = makeSupabaseFake(/* seed: no app_settings row for getrunning_dates_source */);
    expect(await fetchDatesSource(fake.client, "org-1")).toBeNull();
  });

  it("round-trips a chosen source", async () => {
    const fake = makeSupabaseFake();
    await saveDatesSource(fake.client, "org-1", "airtable");
    expect(await fetchDatesSource(fake.client, "org-1")).toBe("airtable");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/data/datesSource.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `datesSource.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";

export type DatesSource = "airtable" | "sheet" | "manual" | null;
const KEY = "getrunning_dates_source";
const VALID = new Set(["airtable", "sheet", "manual"]);

export async function fetchDatesSource(
  client: SupabaseClient,
  orgId: string,
): Promise<DatesSource> {
  const raw = await resolveOrgSetting<string | null>(client, orgId, KEY, null);
  return raw && VALID.has(raw) ? (raw as DatesSource) : null;
}

export async function saveDatesSource(
  client: SupabaseClient,
  orgId: string,
  source: Exclude<DatesSource, null>,
): Promise<void> {
  await upsertOrgSetting(client, orgId, KEY, source);
}
```
(Adjust `resolveOrgSetting`/`upsertOrgSetting` call shape to their real signatures.)

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/data/datesSource.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `useDatesSource` hook**

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchDatesSource, saveDatesSource, type DatesSource } from "@/data/datesSource";

export function useDatesSource(orgId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["getrunning", "dates-source", orgId],
    queryFn: () => fetchDatesSource(supabase, orgId!),
    enabled: !!orgId,
  });
  const mutation = useMutation({
    mutationFn: (source: Exclude<DatesSource, null>) => saveDatesSource(supabase, orgId!, source),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["getrunning", "dates-source", orgId] }),
  });
  return { source: query.data ?? null, isLoading: query.isLoading, save: mutation.mutate, saving: mutation.isPending };
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc -p tsconfig.app.json --noEmit`

```bash
git add src/data/datesSource.ts src/data/datesSource.test.ts src/hooks/useDatesSource.ts
git commit -m "data: getrunning_dates_source org setting + hook"
```

---

## Task 3: Wire real dates signals into `useGetRunningV3`

**Files:**
- Modify: `src/hooks/useGetRunningV3.ts`
- Test: `src/hooks/useGetRunningV3.test.ts` (create if absent; otherwise extend)

**Interfaces:**
- Consumes: `useDatesSource` (Task 2); `useAirtableConsole(orgId, opts)` (returns `connected`/`keyPresent`/`hasBaseTable`, `mapped`/`mappedTotal` or `requiredMappedCount`, `heldCount`, and the city catalog rows — read `src/hooks/useAirtableConsole.ts` for exact field names); `useBookingSetupStatus` (already used; exposes `datesWithoutCity`).
- Produces: `useGetRunningV3` now feeds `datesSource`, `datesConnectDone`, `datesMapDone`, `datesCitiesDone` into `composeGetRunningV3` (replacing the single `datesDone` approximation).

Signal definitions (Phase 2):
- `datesConnectDone` = source is `manual` ? `true` : (source `airtable` ? console `connected` : `false`).
- `datesMapDone` = source `manual` ? `true` : (source `airtable` ? required fields mapped, i.e. `requiredMappedCount >= requiredTotal` or the console's own `mapped`-complete boolean : `false`).
- `datesCitiesDone` = there is at least one date AND every date has a city → reuse booking `datesWithoutCity === 0`. When `bookingOn` is false the whole phase is absent so the value is moot; pass `false` to be safe.
- `datesSource` = `useDatesSource(orgId).source`.

- [ ] **Step 1: Write failing hook test**

Follow the RTL + provider pattern used by other hook tests (`renderWithProviders` / `renderHook` with a `QueryClientProvider`; seed the fake client). Assert that when `dates_source = "airtable"` and the Airtable console reports connected + mapped, `model.phases[get_dates]` shows `connect.done` and `map.done` true; and that with `dates_source = "manual"`, `connect`/`map` are hidden. (Reference: `src/hooks/useGetRunningV3` currently has behaviour parity tests with `useGetRunning` — mirror that harness. **Note memory `rtl-role-name-queries-in-retry-loops`: never put `getByRole({name})` inside `findBy*`/`waitFor`.**)

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/hooks/useGetRunningV3.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the wiring**

Add `const { source } = useDatesSource(orgId);` and `const console = useAirtableConsole(orgId, { readOnly: true, canTriggerSync: false });` (only when `bookingOn` — gate the same way existing reads are gated to avoid needless fetches; if `useAirtableConsole` can't be conditionally called, pass a null orgId when `!bookingOn`). Compute the three booleans above and pass them into `composeGetRunningV3(...)`. Remove the obsolete `datesDone` field from the input object (and from `GetRunningInputV3` in `steps.ts` if not already removed) — grep to confirm no other caller.

- [ ] **Step 4: Run test + full model suite, verify pass**

Run: `npx vitest run src/hooks/useGetRunningV3.test.ts src/lib/getRunning/steps.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -p tsconfig.app.json --noEmit`

```bash
git add src/hooks/useGetRunningV3.ts src/hooks/useGetRunningV3.test.ts src/lib/getRunning/steps.ts
git commit -m "wire real dates-source + airtable readiness into useGetRunningV3"
```

---

## Task 4: Extract `CastingBreakdownFields` from `ShowFormDialog` (DRY)

**Files:**
- Create: `src/components/catalog/CastingBreakdownFields.tsx`
- Test: `src/components/catalog/CastingBreakdownFields.test.tsx`
- Modify: `src/components/catalog/ShowFormDialog.tsx`

**Interfaces:**
- Produces:
```ts
export interface SlotDraftRow { id?: string; name: string; count: number; kind: "main" | "understudy"; skillIds: string[]; }
export interface CastingBreakdownFieldsProps {
  value: SlotDraftRow[];
  onChange: (rows: SlotDraftRow[]) => void;
  skills: SkillOption[];          // from useSkills(); pass in, don't fetch inside
  disabled?: boolean;             // slotsDisabled (capability gate)
}
export function CastingBreakdownFields(props: CastingBreakdownFieldsProps): JSX.Element;
```
- Consumes: `SkillPicker` (`src/components/skills/SkillPicker.tsx`), `showSlots`/`SlotDraft` shapes. The component renders the slot-row repeater (role-name input, count input, main/understudy toggle, remove, per-row `SkillPicker`), live `mainTotal`/`understudyTotal`, and the required-skills union callout — i.e. exactly the block currently inline in `ShowFormDialog`.

- [ ] **Step 1: Write failing component test**

`CastingBreakdownFields.test.tsx` (renderWithProviders): renders N rows for N drafts; typing a role name calls `onChange` with the updated row; "Add part" appends a row with a fresh client id; toggling understudy updates `kind`; the totals reflect the counts. Query by label text / role without name-in-waitFor.

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/components/catalog/CastingBreakdownFields.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement by moving the JSX out of `ShowFormDialog`**

Cut the slot-repeater + totals + required-skills-union JSX and its row-edit handlers from `ShowFormDialog.tsx` into `CastingBreakdownFields.tsx`, converting the dialog's local slot `useState` into the `value`/`onChange` contract. Keep the id-minting rule (`crypto.randomUUID()` for new rows) and the `disabled` gate. Use tokens/`text-control`/`<Metric>` for totals (fix any raw values inherited from the old JSX). Do NOT change what gets saved — `ShowFormDialog` still calls `saveShowSlots` with the resulting rows.

- [ ] **Step 4: Rewire `ShowFormDialog` to use it**

In `ShowFormDialog.tsx`, replace the removed JSX with:
```tsx
<CastingBreakdownFields
  value={slots}
  onChange={setSlots}
  skills={skills.data ?? []}
  disabled={slotsDisabled}
/>
```
Keep the `useShowSlots(open ? show?.id : undefined)` seeding and the save path untouched.

- [ ] **Step 5: Run the new test + the existing ShowFormDialog tests, verify pass**

Run: `npx vitest run src/components/catalog/`
Expected: PASS (new test + `ShowFormDialog` behaviour tests unchanged — this proves the extraction is behaviour-preserving).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc -p tsconfig.app.json --noEmit`

```bash
git add src/components/catalog/CastingBreakdownFields.tsx src/components/catalog/CastingBreakdownFields.test.tsx src/components/catalog/ShowFormDialog.tsx
git commit -m "extract CastingBreakdownFields from ShowFormDialog (DRY for PartsEditor)"
```

---

## Task 5: Export `TokenStep` + `BaseTableStep` for reuse

**Files:**
- Create: `src/components/getRunning/panels/airtable/connectSteps.tsx`
- Modify: `src/components/getRunning/panels/airtable/AirtableConnectRail.tsx`
- Test: `src/components/getRunning/panels/airtable/connectSteps.test.tsx`

**Interfaces:**
- Produces exported `TokenStep` and `BaseTableStep` with the exact props they already receive inside `AirtableConnectRail` (read the file; they are driven by `useAirtableConsole` values — `saveKey`/`keyPresent`/`savingKey` for the token step; `bases`/`tables`/`selectedTable`/`saveSettings`/`schemaState` for the base/table step). Keep the props identical so `AirtableConnectRail` keeps working.

- [ ] **Step 1: Write a failing render test for the extracted components**

`connectSteps.test.tsx`: render `TokenStep` with a fake console object (`partialMock`) and assert the token input + save button render; render `BaseTableStep` with fake bases/tables and assert the base/table selectors render.

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/components/getRunning/panels/airtable/connectSteps.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Move the two sub-components into `connectSteps.tsx` and export them; re-import in `AirtableConnectRail.tsx`**

Cut `TokenStep` and `BaseTableStep` verbatim into `connectSteps.tsx`, export them, and `import { TokenStep, BaseTableStep } from "./connectSteps"` in `AirtableConnectRail.tsx`. No behaviour change.

- [ ] **Step 4: Run the airtable panel tests, verify pass**

Run: `npx vitest run src/components/getRunning/panels/airtable/`
Expected: PASS (rail behaviour unchanged + new render test green).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -p tsconfig.app.json --noEmit`

```bash
git add src/components/getRunning/panels/airtable/connectSteps.tsx src/components/getRunning/panels/airtable/AirtableConnectRail.tsx src/components/getRunning/panels/airtable/connectSteps.test.tsx
git commit -m "export TokenStep + BaseTableStep for v3 connect step reuse"
```

---

## Task 6: `SourceStep` body + copy

**Files:**
- Create: `src/components/getRunning/v3/steps/SourceStep.tsx`
- Test: `src/components/getRunning/v3/steps/SourceStep.test.tsx`
- Modify: `src/i18n/locales/en/getRunningV3.json`, `src/i18n/locales/de/getRunningV3.json`

**Interfaces:**
- Consumes: `useDatesSource(orgId)`; `WizardFooterContext` (portal the primary action into the wizard footer — read the current node from context, `createPortal` when non-null else render inline); `useCan("manage_productions")` for read-only gating.
- Produces: `SourceStep({ orgId, onDone }: { orgId: string | null; onDone: () => void })`.

Body: three selectable cards — **Airtable** (active), **Google Sheet** (disabled, badge "coming soon", tooltip "arrives with a later step"; not selectable in Phase 2), **By hand** (manual). Selecting a card + primary "Continue" persists via `save(source)` then `onDone()`. If a source is already chosen, preselect it. Read-only viewers see the choice but cannot change it (per spec role rules).

- [ ] **Step 1: Add EN copy under `getRunningV3.json` → `body.source`**

```json
"body": {
  "source": {
    "heading": "Where do your dates come from",
    "sub": "Pick one. You can add more later.",
    "airtable": { "title": "Airtable", "desc": "Sync dates from an Airtable base." },
    "sheet": { "title": "Google Sheet", "desc": "Import dates from a published sheet.", "badge": "Coming soon" },
    "manual": { "title": "By hand", "desc": "Add productions and dates yourself." },
    "continue": "Continue",
    "readOnly": "Ask an admin to choose a source."
  }
}
```
Mirror the exact shape in `de/getRunningV3.json` (Du, no dashes), e.g. `"heading": "Woher kommen deine Termine"`, etc.

- [ ] **Step 2: Write failing component test**

`SourceStep.test.tsx` (renderWithProviders, seed fake so `useDatesSource` returns null): the three cards render; the Sheet card is disabled; selecting "By hand" and clicking Continue calls `saveDatesSource` with `"manual"` (assert via the fake's recorded upsert) and calls `onDone`.

- [ ] **Step 3: Run test, verify it fails**

Run: `npx vitest run src/components/getRunning/v3/steps/SourceStep.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `SourceStep`**

Use `Card`/`RadioGroup` primitives from `src/components/ui`, `<Eyebrow>` for any uppercase, `text-control` sizing, tokens only. Portal the "Continue" button through `WizardFooterContext` (guard null). Sheet card `disabled`.

- [ ] **Step 5: Run test + keyParity + copyLint, verify pass**

Run: `npx vitest run src/components/getRunning/v3/steps/SourceStep.test.tsx src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/getRunning/v3/steps/SourceStep.tsx src/components/getRunning/v3/steps/SourceStep.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 SourceStep: pick airtable / sheet(soon) / by hand"
```

---

## Task 7: `ConnectStep` body + copy

**Files:**
- Create: `src/components/getRunning/v3/steps/ConnectStep.tsx`
- Test: `src/components/getRunning/v3/steps/ConnectStep.test.tsx`
- Modify: both `getRunningV3.json` locale files

**Interfaces:**
- Consumes: `useDatesSource` (to know source); `useAirtableConsole(orgId, { canTriggerSync })`; extracted `TokenStep` + `BaseTableStep` (Task 5); `useCan("configure_airtable")`.
- Produces: `ConnectStep({ orgId, onDone })`.

Body: if `source === "manual"`, render an info body ("By hand needs no connection. Continue to add productions.") with a Continue that calls `onDone`. If `source === "airtable"`, render `TokenStep` then `BaseTableStep` fed by the console; when `connected` (keyPresent && hasBaseTable) show a "connected" summary + Continue → `onDone`. Read-only when `!useCan("configure_airtable")`.

- [ ] **Step 1: Add EN + DE copy under `body.connect`** (heading/sub, `manual` info line, `connected` label, `continue`). Match shape in both locales.

- [ ] **Step 2: Write failing test**

`ConnectStep.test.tsx`: with source `manual`, the info body + Continue render and Continue calls `onDone`. With source `airtable` and a fake console reporting `keyPresent:false`, the token step renders.

- [ ] **Step 3: Run test, verify it fails** — `npx vitest run src/components/getRunning/v3/steps/ConnectStep.test.tsx`

- [ ] **Step 4: Implement `ConnectStep`** (reuse extracted steps; footer portal via `WizardFooterContext`).

- [ ] **Step 5: Run test + keyParity + copyLint, verify pass**

- [ ] **Step 6: Commit**

```bash
git add src/components/getRunning/v3/steps/ConnectStep.tsx src/components/getRunning/v3/steps/ConnectStep.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 ConnectStep: airtable token+base or by-hand skip"
```

---

## Task 8: `MapStep` body (mapping + slots-fold confirm) + copy

**Files:**
- Create: `src/components/getRunning/v3/steps/MapStep.tsx`
- Test: `src/components/getRunning/v3/steps/MapStep.test.tsx`
- Modify: both `getRunningV3.json` locale files

**Interfaces:**
- Consumes: `useAirtableConsole` (for `MappingTab` props: `tableName`, `fields`, `fieldMap`, `onSetField`, `mapped`, `total`, `optionNames`, `unboundFields`, `onAddAllCustom`, `canWrite`); `MappingTab` (`src/components/settings/airtable/MappingTab.tsx`); `stepFeatureLink("productions")` for the slots-fold deep link.
- Produces: `MapStep({ orgId, onDone })`.

Body: `MappingTab` fed straight from the console. Below it, the **slots fold** — a short callout: "Each imported production needs its casting breakdown (parts and people per part). Set it on the Productions step." with a link to `productions` (via `stepFeatureLink` / the board's step navigation — pass an `onGoToProductions?` callback from the registry, or use the deep link). Continue (footer) calls `onDone` once required fields are mapped (`mapped >= requiredTotal`); otherwise disabled with a hint. Read-only when `!canWrite`.

- [ ] **Step 1: Add EN + DE copy under `body.map`** (heading/sub, `slotsFold.title`/`.body`/`.link`, `continue`, `mapIncomplete` hint).

- [ ] **Step 2: Write failing test**

`MapStep.test.tsx`: with a fake console exposing 1 unmapped required field, the mapping table renders and Continue is disabled; with all required mapped, Continue enabled and calls `onDone`. The slots-fold callout renders with a link to the productions step.

- [ ] **Step 3: Run test, verify it fails** — `npx vitest run src/components/getRunning/v3/steps/MapStep.test.tsx`

- [ ] **Step 4: Implement `MapStep`**

- [ ] **Step 5: Run test + keyParity + copyLint, verify pass**

- [ ] **Step 6: Commit**

```bash
git add src/components/getRunning/v3/steps/MapStep.tsx src/components/getRunning/v3/steps/MapStep.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 MapStep: airtable field mapping + casting-breakdown fold"
```

---

## Task 9: `CitiesStep` body + copy

**Files:**
- Create: `src/components/getRunning/v3/steps/CitiesStep.tsx`
- Test: `src/components/getRunning/v3/steps/CitiesStep.test.tsx`
- Modify: both `getRunningV3.json` locale files

**Interfaces:**
- Consumes: `useAirtableConsole` (for the Cities half of `CatalogTab`: `citySource`, `cityRows`, `cityExisting`, `onLink`, `onCreate`, `onUnlink`, `onBulkCreate`, `mergeSuggestion`, `catalogBusy`, `canWrite`); `CatalogTab` OR a cities-only subset. Because `CatalogTab` renders both Programs and Cities, prefer a cities-only body: reuse the same `onLink`/`onCreate`/`onBulkCreate` handlers from the console over `cityRows`, rendering the same row UI. If `CatalogTab` can be told to render cities-only via a prop, add that prop (small, guarded change); otherwise build a focused cities list here using the console handlers (do not duplicate data logic — only the presentational rows).
- Produces: `CitiesStep({ orgId, onDone })`.

Body: list unlinked/held cities with link-to-existing / create-new / bulk-create-all, mirroring `CatalogTab`'s Cities section. For a by-hand org with no Airtable cities, show the empty state + a link to add cities where they are managed. "cannot be skipped" — Continue enabled once no city is unresolved (or the org has confirmed there are none), else guides the user.

- [ ] **Step 1: Add EN + DE copy under `body.cities`** (heading/sub, `linkAll`, `createNew`, `empty`, `continue`).

- [ ] **Step 2: Write failing test**

`CitiesStep.test.tsx`: with a fake console exposing 2 unlinked `cityRows`, both render with link/create controls; "Create all" calls `onBulkCreate`. Empty `cityRows` → empty state.

- [ ] **Step 3: Run test, verify it fails** — `npx vitest run src/components/getRunning/v3/steps/CitiesStep.test.tsx`

- [ ] **Step 4: Implement `CitiesStep`** (prefer reusing `CatalogTab`'s cities rendering; if adding a `section="cities"` prop to `CatalogTab`, keep its existing default behaviour and cover it with an added test).

- [ ] **Step 5: Run test + keyParity + copyLint + existing CatalogTab tests, verify pass**

- [ ] **Step 6: Commit**

```bash
git add src/components/getRunning/v3/steps/CitiesStep.tsx src/components/getRunning/v3/steps/CitiesStep.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 CitiesStep: link/create cities (reuse catalog handlers)"
```

---

## Task 10: `PartsEditorSheet` + copy

**Files:**
- Create: `src/components/getRunning/v3/steps/PartsEditorSheet.tsx`
- Test: `src/components/getRunning/v3/steps/PartsEditorSheet.test.tsx`
- Modify: both `getRunningV3.json` locale files

**Interfaces:**
- Consumes: `CastingBreakdownFields` (Task 4); `useShowSlots(showId)` (seed) + `saveShowSlots(supabase, { showId, orgId, slots })` (via a mutation) from `src/data/slots.ts`; `useSkills()` for the skill options.
- Produces:
```ts
export interface PartsEditorSheetProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgId: string;
  showId: string;
  showLabel: string;   // production name for the header
  onSaved?: () => void;
}
export function PartsEditorSheet(props: PartsEditorSheetProps): JSX.Element;
```

Body: a shadcn `Sheet` (side panel) titled with the production name, hosting `CastingBreakdownFields` seeded from `useShowSlots(open ? showId : undefined)`. Save button → `saveShowSlots` → invalidate `["show-slots"]`, `["shows"]`, `["show-dates"]`, `["eligibility"]` (match `ShowFormDialog`'s invalidations) → toast "Casting breakdown saved" → `onSaved?.()` + close.

- [ ] **Step 1: Add EN + DE copy under `body.parts`** (sheet title pattern with production name, `save`, `savedToast`).

- [ ] **Step 2: Write failing test**

`PartsEditorSheet.test.tsx`: open with a fake seeding one existing slot; the row renders; editing + Save calls `saveShowSlots` with the edited rows (assert via the fake) and fires `onSaved`.

- [ ] **Step 3: Run test, verify it fails** — `npx vitest run src/components/getRunning/v3/steps/PartsEditorSheet.test.tsx`

- [ ] **Step 4: Implement `PartsEditorSheet`**

- [ ] **Step 5: Run test + keyParity + copyLint, verify pass**

- [ ] **Step 6: Commit**

```bash
git add src/components/getRunning/v3/steps/PartsEditorSheet.tsx src/components/getRunning/v3/steps/PartsEditorSheet.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 PartsEditorSheet: edit a production's casting breakdown"
```

---

## Task 11: `ProductionsStep` body + copy

**Files:**
- Create: `src/components/getRunning/v3/steps/ProductionsStep.tsx`
- Test: `src/components/getRunning/v3/steps/ProductionsStep.test.tsx`
- Modify: both `getRunningV3.json` locale files

**Interfaces:**
- Consumes: `useShows()` (→ `ShowWithStats[]`) + `showSlots(show)` for per-row parts state; `ShowFormDialog` (add/edit a production by hand); `ShowDateFormDialog` (add a date by hand); `PartsEditorSheet` (Task 10); `useCan("manage_productions")` / `useCan("edit_scheduling")`.
- Produces: `ProductionsStep({ orgId, onDone })`.

Body: a compact productions list. Each row: production name, date count, parts state via `showSlots` (`main + understudies` or an "unconfigured" `StatusPill`), and a "Set casting breakdown" button opening `PartsEditorSheet` for that show. Header actions: "Add a production" (`ShowFormDialog` create) and "Add a date" (`ShowDateFormDialog` create). Continue (footer) is enabled once at least one production has parts configured (`showSlots(s) != null`) — mirrors `productions.done` (booking `slots` step). Empty state prompts adding the first production. Read-only viewers see the list without the edit controls.

- [ ] **Step 1: Add EN + DE copy under `body.productions`** (heading/sub, `addProduction`, `addDate`, `setParts`, `unconfigured`, `continue`, `empty`).

- [ ] **Step 2: Write failing test**

`ProductionsStep.test.tsx`: with a fake returning one show with `main_cast_slots: null`, the row shows the "unconfigured" pill and Continue is disabled; with a show that has slots, Continue is enabled and calls `onDone`; clicking "Set casting breakdown" opens the sheet (assert the sheet title with the production name appears).

- [ ] **Step 3: Run test, verify it fails** — `npx vitest run src/components/getRunning/v3/steps/ProductionsStep.test.tsx`

- [ ] **Step 4: Implement `ProductionsStep`**

- [ ] **Step 5: Run test + keyParity + copyLint, verify pass**

- [ ] **Step 6: Commit**

```bash
git add src/components/getRunning/v3/steps/ProductionsStep.tsx src/components/getRunning/v3/steps/ProductionsStep.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 ProductionsStep: list + by-hand add + PartsEditor launch"
```

---

## Task 12: Wire the five bodies into `StepBodyV3`

**Files:**
- Modify: `src/components/getRunning/v3/stepRegistryV3.tsx`
- Test: `src/components/getRunning/v3/stepRegistryV3.test.tsx`

**Interfaces:**
- Consumes: `SourceStep`, `ConnectStep`, `MapStep`, `CitiesStep`, `ProductionsStep` (Tasks 6-9, 11).
- Produces: `StepBodyV3` now returns the real body for `source`/`connect`/`map`/`cities`/`productions` (no longer `StepComingSoon`), passing `orgId` + `onDone`. `ProductionsStep` also needs its own sheet state (internal) — no extra registry props required beyond `orgId`/`onDone`.

- [ ] **Step 1: Update `stepRegistryV3.test.tsx`**

Change the expectations that currently assert these five keys render `StepComingSoon` to assert they render the real bodies (query a distinguishing string from each, e.g. the source-step heading). Keep the placeholder assertions for the still-stubbed keys (`skills`, `fee`, `document`).

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/components/getRunning/v3/stepRegistryV3.test.tsx`
Expected: FAIL (still rendering StepComingSoon).

- [ ] **Step 3: Rewire the switch**

Remove `source`/`connect`/`map`/`cities`/`productions` from the placeholder fall-through and add real cases:
```tsx
case "source": return <SourceStep orgId={orgId} onDone={onDone} />;
case "connect": return <ConnectStep orgId={orgId} onDone={onDone} />;
case "map": return <MapStep orgId={orgId} onDone={onDone} />;
case "cities": return <CitiesStep orgId={orgId} onDone={onDone} />;
case "productions": return <ProductionsStep orgId={orgId} onDone={onDone} />;
```
Keep the `step.placeholder` early-return for the remaining stubs, and keep the `never` exhaustiveness `default`.

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/components/getRunning/v3/`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -p tsconfig.app.json --noEmit`

```bash
git add src/components/getRunning/v3/stepRegistryV3.tsx src/components/getRunning/v3/stepRegistryV3.test.tsx
git commit -m "v3: route get_dates step keys to real bodies"
```

---

## Task 13: Help center + terms + full verification gate

**Files:**
- Modify (if needed): `src/lib/help/items.ts`, `src/i18n/terms.ts`
- No code beyond copy; this task is the consolidated verification before the PR.

- [ ] **Step 1: Help center impact**

Review `src/lib/help/items.ts` (EN + DE): does "get dates in" change what an admin/producer asks or how the app answers? If yes, add/adjust items (Du, no dashes) in this task. If no, record "No help center impact." for the PR description. Add any new shared term (e.g. `castingBreakdown`) to `src/i18n/terms.ts` if referenced.

- [ ] **Step 2: Run the fast verification suite**

Run: `npm run verify:fast`
Expected: all green — lint (`--max-warnings 0`), the three typecheck projects, build, unit + coverage, Deno. Fix any raw-value / dash / key-parity failures.

- [ ] **Step 3: Live visual verification against the design (dev harness)**

Boot the local stack + dev server (`npm run local:up` then `npm run dev`; the harness route is `/dev/get-running`, `import.meta.env.DEV` only). Using the Browser preview tools, walk the `get_dates` wizard in BOTH light and dark:
  - `source`: three cards, Sheet disabled with "coming soon".
  - Airtable path: `connect` (token + base) → `map` (mapping table + slots fold) → `cities` (link/create).
  - By-hand path: `source=manual` hides `connect`/`map`; `productions` add-by-hand + PartsEditor sheet.
  - `productions`: list, unconfigured pill, PartsEditor sheet saves.
Compare each against the design screens `SourceImport` and `PartsEditor` (Claude Design project `02c15575-91a6-4acd-92fc-e006a5cf1b88`). Capture screenshots. Interaction/layout must match the design; copy follows the app-terminology rule. Fix divergences, re-run step 2.

- [ ] **Step 4: Commit any copy/help changes**

```bash
git add src/lib/help/items.ts src/i18n/terms.ts
git commit -m "help + terms for get-dates wizard (or: no help impact)"
```

---

## Self-Review (run before handing off to execution)

**1. Spec coverage** — Phase 2 scope from spec §10 = "source/connect/map(+slots fold)/cities/productions + PartsEditor, Airtable + by-hand real (no Sheet yet: source shows it disabled/'coming in Phase 4')":
- source picker (airtable/sheet-disabled/manual) → Task 6 ✓
- connect (airtable token+base; manual skip) → Tasks 5, 7 ✓
- map (mapping + slots fold) → Task 8 ✓
- cities (link/create) → Task 9 ✓
- productions list + PartsEditor → Tasks 4, 10, 11 ✓
- model/flag additive, v1 untouched → Tasks 1-3, Global Constraints ✓
- Sheet disabled, no Sheet backend, no cast_production_fees → deferred to Phase 4 (SourceStep sheet card `disabled`) ✓
- i18n EN+DE, no dashes, terms.ts → every UI task + Task 13 ✓
- Help center impact → Task 13 ✓

**2. Placeholder scan** — no "TBD"/"handle edge cases"/"similar to Task N"; each task carries real code or exact prop contracts. The two places that say "adapt to the real signatures" (Task 2 settings resolver, Task 3 console field names) are explicit instructions to read the named file first, not hidden work — acceptable because the exact signatures live in files the executor opens in that step.

**3. Type consistency** — `SlotDraftRow`/`SlotDraft` shape shared (Task 4 ↔ Task 10); `DatesSource` union identical across `datesSource.ts`, `useDatesSource`, and `GetRunningInputV3.datesSource` (Tasks 1-3); `PartsEditorSheetProps` consumed by `ProductionsStep` (Task 11) matches Task 10's export; `StepBodyV3` body signature `({orgId, onDone})` consistent for all five (Tasks 6-9, 11, 12).

## Execution notes

- Tasks 1-3 (model + data + hook) are sequential. Tasks 4 and 5 (extractions) are independent of each other and of 1-3 — can run in parallel. Tasks 6-11 (bodies) depend on 4/5 and the model; 6-11 are largely independent of each other and can run in parallel once 4/5 land. Task 12 depends on 6-11. Task 13 is last.
- After each task: the executor runs that task's tests + `npx tsc -p tsconfig.app.json --noEmit`; a two-stage review (correctness + convention) gates each commit.
- Do not flip the flag on, do not touch v1 files, do not open the PR until Task 13's `verify:fast` + live visual verification are green. The owner opens/approves the PR.
