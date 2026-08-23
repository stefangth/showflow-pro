# Wireflow v3 — Phase 3: remaining bookable + Contracts steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the three remaining placeholder steps (`skills` in the "Make it bookable" phase; `fee` and `document` in the "Contracts" phase) into real wizard bodies with real done-signals, so the whole 16-step v3 board renders real content end to end — all behind the off-by-default `getrunning_v3` flag, additive to the untouched v1 board.

**Architecture:** The v3 frame (`WizardShell`, `GetRunningBoardV3`, `composeGetRunningV3`, `useGetRunningV3`, `StepBodyV3`) is built. Phase 1 wired the reuse-only bookable/paperwork steps (artists, coverage, flow, timing, team, letterhead, terms, countersign); Phase 2 wired the five `get_dates` steps. Phase 3 (a) flips `skills`/`fee`/`document` from `placeholder:true` to `placeholder:false` in the pure model, (b) replaces the two hardcoded `feeDone`/`documentDone` inputs with a real "org owns this setting row" read (mirroring how the flow/timing/countersign steps already test "a decision was made"), (c) adds three new step-body components under `src/components/getRunning/v3/steps/` that reuse the existing Settings cards `SkillsTab`, `OrderDefaultsCard`, and `NumberingCard`, and (d) rewires the three `StepBodyV3` branches from `StepComingSoon` to the real bodies. No new backend: the per-(cast×production) fee table and the Google-Sheet importer are Phase 4, so the `fee` body ships org defaults plus a static "per production and cast" shell note only.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind + shadcn/ui, @tanstack/react-query v5, Supabase, react-i18next (EN + DE), Vitest + @testing-library/react (jsdom), the `src/test/` harness (`supabaseFake.ts`, `renderWithProviders.tsx`, `fixtures.ts`).

**Spec:** `docs/superpowers/specs/2026-08-23-wireflow-v3-get-running-settings-design.md` (owner-approved 2026-08-23, commit 2a5f43bb), §4.1 rows 7/13/15, §10 Phase 3. Prior plans (context): `docs/superpowers/plans/2026-08-23-wireflow-v3-phase-1-frame-board-model.md`, `docs/superpowers/plans/2026-08-23-wireflow-v3-phase-2-get-dates-wizard.md`.

## Global Constraints

- **Flag-gated + additive.** All Phase 3 work is reached only through `GETRUNNING_V3` (`src/config/flags.ts`, reads `import.meta.env.VITE_GETRUNNING_V3 === "true"`; on in local `.env.development`, off in prod). v1 board code (`src/lib/getRunning/tasks.ts`, `taskFeature.ts`, `GetRunningPage.tsx` v1 branch, `src/components/getRunning/panels/**`, `src/components/getRunning/TaskPanel*`) stays byte-untouched. **Do not change `src/lib/hireOrders/setupStatus.ts` or `src/hooks/useHireOrderSetup.ts`** — `HireOrderSetupStatus` feeds the v1 hire-orders setup rail (letterhead/terms/countersign only); adding fee/document there would silently grow that live v1 surface. The fee/document readiness for v3 is a **separate** read (Task 2). No v1 file is deleted (that is Phase 5).
- **UI conventions (`docs/ui-conventions.md`), CI-enforced at `--max-warnings 0`.** Reuse `src/components/ui` primitives first; no raw hex/rgba/`text-[13px]`/`rounded-[10px]` outside `src/components/ui`; 13px is the control size (`text-control`); uppercase text is `<Eyebrow>`; status colour from `TONES`/`StatusPill`; numbers are `<Metric>`; tint washes are `bg-hover-tint`/`bg-well-tint`/`bg-accent-tint`. Match the exact class idiom the existing v3 step bodies use (`SourceStep.tsx`): step heading `text-title-sm font-semibold tracking-[-0.2px] text-foreground`, sub `text-xs text-muted-foreground`, read-only note `text-xs text-muted-foreground`, primary `<Button type="button" size="sm">`.
- **No dashes in copy** (em/en dash fails `src/i18n/copyLint.test.ts` in both locales); no exclamation marks, no emoji. German is Du-form. Regular hyphens (`-`) are allowed; only en/em dashes (`–`/`—`) fail. Use a period, colon, or "to" for ranges.
- **i18n from the start.** Every new user-facing string goes through `t()` in the `getRunningV3` namespace (`src/i18n/locales/{en,de}/getRunningV3.json`), EN canonical, DE at full key parity (`src/i18n/keyParity.test.ts` gates this). The `steps.{skills,fee,document}` (rail title + hint) and `guide.{skills,fee,document}` (right-rail how-it-works) subtrees ALREADY EXIST in both locales — do not duplicate them. Only the `body.{skills,fee,document}` subtrees are missing; add them. New domain terms go in `src/i18n/terms.ts` `TERMS`, never inlined. App terminology wins over design copy: production (not "show"), part/Position (not "slot"), Contract (not "hire order"); reuse any existing `TERMS` entry for "contract"/"Engagementvertrag" rather than re-inlining.
- **`any` is banned** (lint error). At a Supabase query boundary use an explicit row interface + a single `as unknown as Row[]` cast in `src/data/**`; in tests use `src/test/castHelpers.ts` (`asSupabase`/`asQueryResult`/`partialMock`).
- **Data access is `fetchX(client, args)` in `src/data/<domain>.ts`; hooks are thin wrappers** that pass the `supabase` singleton. Phase 3 needs no new data-access function — it reuses the existing, tested `fetchOwnedSettingKeys(client, orgId, keys)` in `src/data/settings.ts`.
- **Test-first (TDD).** Write the failing test, run it red, implement minimally, run it green, commit. Do not re-implement production logic in a test — import the real module.
- **Do not commit or push to `main`.** Work on this Phase 3 branch (`claude/phase-three-build-fb3dff`). `main` requires the owner's review approval to merge; the executor never self-merges and never commits outside a plan step that says to.

---

## File Structure

**Model (pure) — modify:**
- `src/lib/getRunning/steps.ts` — flip `placeholder: true` → `placeholder: false` on the `skills`, `fee`, and `document` `StepConfig`s (lines ~199-206, ~264-271, ~280-287). Nothing else in this file changes; `done` still reads `input.skillsDone`/`input.feeDone`/`input.documentDone`. Update the module header comment (lines ~12-18) so it no longer lists skills/fee/document as placeholders.

**Readiness (real fee/document signals) — create + modify:**
- `src/hooks/useHireOrderExtraSetup.ts` (+ `.test.tsx`) — a thin hook over `fetchOwnedSettingKeys` for the two keys `hire_order_defaults` / `hire_order_numbering`, returning `{ status: { feeDone, documentDone }, isLoading }`. Query key sits under `["app-settings", ...]` so the cards' own `invalidateQueries(["app-settings"])` on save refreshes it.
- `src/hooks/useGetRunningV3.ts` — read the new hook (gated on `hireOrgId`), feed `feeDone`/`documentDone` from it, fold its `isLoading` into the hook's gate, and update the header comment (lines ~27-29) that currently says both are hardcoded false.
- `src/hooks/useGetRunningV3.test.tsx` — add cases proving the two signals flow through.

**New step bodies — create + test (all under `src/components/getRunning/v3/steps/`):**
- `SkillsStep.tsx` (+ `.test.tsx`) — reuse `SkillsTab` (org skill catalog) + a Continue that calls `onDone`. Capability `edit_booking_settings`.
- `FeeStep.tsx` (+ `.test.tsx`) — reuse `OrderDefaultsCard` (org default fee/currency/basis, `readOnly` when the viewer cannot edit) + a static "per production and cast" shell note (Phase 4 lands the real per-cast fees) + Continue. Capability `edit_hire_order_settings`.
- `DocumentStep.tsx` (+ `.test.tsx`) — reuse `NumberingCard` (`readOnly` when the viewer cannot edit) + a link to the full document template editor (`ROUTES.HIRE_ORDER_TEMPLATE`) + Continue. Capability `edit_hire_order_settings`.

**Registry — modify:**
- `src/components/getRunning/v3/stepRegistryV3.tsx` — in `StepBodyV3`, replace the `case "skills": case "fee": case "document": return <StepComingSoon step={step} />` block with the three real bodies (`{ orgId, onDone }`), and update the doc comment that lists them as placeholders. `StepComingSoon` itself stays (nothing else references it once these three route away, but it is harmless to keep for Phase 4/5).

**Copy — modify:**
- `src/i18n/locales/en/getRunningV3.json` + `src/i18n/locales/de/getRunningV3.json` — add `body.skills`, `body.fee`, `body.document` subtrees (exact JSON in Tasks 3-5). `steps.*` and `guide.*` for the three already exist; do not touch them.
- `src/i18n/terms.ts` — reuse existing terms for "contract"/"part"; add one only if genuinely new (unlikely).
- `src/lib/help/items.ts` (EN + DE) — add/adjust help items only if Phase 3 changes what an admin/producer asks; otherwise state "No help center impact." in the PR (Task 7).

---

## Task 1: Model — mark `skills`/`fee`/`document` as real (non-placeholder) steps

**Files:**
- Modify: `src/lib/getRunning/steps.ts`
- Test: `src/lib/getRunning/steps.test.ts`

**Interfaces:**
- Consumes: existing `composeGetRunningV3`, `GetRunningInputV3` (unchanged — `skillsDone`/`feeDone`/`documentDone` inputs stay).
- Produces: the `skills`, `fee`, `document` steps have `placeholder === false`; their `done` still equals the matching input boolean; every other field (`block`, `adminOnly`, `capability`) is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/getRunning/steps.test.ts` (reuse the file's existing base-input helper — read it first and match its name/shape; `baseInput` below is illustrative):

```ts
describe("composeGetRunningV3 Phase 3 (skills/fee/document are real steps)", () => {
  it("marks skills, fee, and document as non-placeholder", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true, hireOrdersOn: true }));
    const all = m.phases.flatMap((p) => p.steps);
    for (const key of ["skills", "fee", "document"] as const) {
      expect(all.find((s) => s.key === key)!.placeholder).toBe(false);
    }
  });

  it("no step in the whole model is a placeholder anymore", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true, hireOrdersOn: true }));
    expect(m.phases.flatMap((p) => p.steps).some((s) => s.placeholder)).toBe(false);
  });

  it("fee and document done still track their input signals", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true, hireOrdersOn: true, feeDone: true, documentDone: false }));
    const paper = m.phases.find((p) => p.key === "paperwork")!;
    expect(paper.steps.find((s) => s.key === "fee")!.done).toBe(true);
    expect(paper.steps.find((s) => s.key === "document")!.done).toBe(false);
  });

  it("skills done tracks its input signal", () => {
    const m = composeGetRunningV3(baseInput({ bookingOn: true, skillsDone: true }));
    const bookable = m.phases.find((p) => p.key === "bookable")!;
    expect(bookable.steps.find((s) => s.key === "skills")!.done).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/getRunning/steps.test.ts`
Expected: FAIL — the first two cases fail because `skills`/`fee`/`document` are still `placeholder: true`.

- [ ] **Step 3: Flip the three `placeholder` flags**

In `src/lib/getRunning/steps.ts`, in the `skills` config (bookable phase, ~line 204), the `fee` config (paperwork phase, ~line 269) and the `document` config (paperwork phase, ~line 285), change `placeholder: true,` to `placeholder: false,`. Change nothing else in those three configs.

Then update the module header comment (~lines 12-18) so it no longer names skills/fee/document as remaining placeholders — e.g. replace the sentence listing them with a note that all 16 steps now carry real signals, the get_dates split / skills / fee / document having been wired in Phases 2-3.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/getRunning/steps.test.ts`
Expected: PASS. Then `npx tsc -p tsconfig.app.json --noEmit` — expected clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/getRunning/steps.ts src/lib/getRunning/steps.test.ts
git commit -m "v3 model: skills/fee/document are real steps, not placeholders"
```

---

## Task 2: Real `fee`/`document` done-signals (owned-setting-row read)

**Files:**
- Create: `src/hooks/useHireOrderExtraSetup.ts`
- Test: `src/hooks/useHireOrderExtraSetup.test.tsx`
- Modify: `src/hooks/useGetRunningV3.ts`
- Test: `src/hooks/useGetRunningV3.test.tsx`

**Interfaces:**
- Consumes: `fetchOwnedSettingKeys(client, orgId, keys)` from `@/data/settings` (existing; returns a `Set<string>` of keys the org has its own `app_settings` row for).
- Produces: `useHireOrderExtraSetup(orgId: string | null): { status: { feeDone: boolean; documentDone: boolean }; isLoading: boolean }` — `feeDone = owned.has("hire_order_defaults")`, `documentDone = owned.has("hire_order_numbering")`. `useGetRunningV3` feeds these into `GetRunningInputV3.feeDone`/`.documentDone` (previously hardcoded `false`).

- [ ] **Step 1: Write the failing hook test**

Create `src/hooks/useHireOrderExtraSetup.test.tsx`. Use `renderHook` with the project's query wrapper (read `src/test/renderWithProviders.tsx` for the exported wrapper name; several hook tests already use it — match one, e.g. `src/hooks/useGetRunningV3.test.tsx`) and the call-recording fake client from `src/test/supabaseFake.ts`. The hook reads `app_settings` via `fetchOwnedSettingKeys`, so seed the fake with the org's own rows:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useHireOrderExtraSetup } from "@/hooks/useHireOrderExtraSetup";
// import the query wrapper + supabase fake exactly as useGetRunningV3.test.tsx does

describe("useHireOrderExtraSetup", () => {
  it("reports feeDone/documentDone from the org's own app_settings rows", async () => {
    // Seed the fake so app_settings returns an org-owned row for hire_order_defaults only.
    // (Match the seeding shape used by an existing settings-hook test; fetchOwnedSettingKeys
    //  selects key where org_id = orgId and key IN the two keys.)
    const { result } = renderHook(() => useHireOrderExtraSetup("org-1"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.feeDone).toBe(true);
    expect(result.current.status.documentDone).toBe(false);
  });

  it("is not loading and reports both false for a null org (no fetch)", async () => {
    const { result } = renderHook(() => useHireOrderExtraSetup(null), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status).toEqual({ feeDone: false, documentDone: false });
  });
});
```

Before writing the seed, read `src/data/settings.test.ts` for how `fetchOwnedSettingKeys` is exercised against `supabaseFake.ts`, and copy that seeding shape (this is reading a named file for the exact fake contract, not hidden work).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/useHireOrderExtraSetup.test.tsx`
Expected: FAIL with "Cannot find module '@/hooks/useHireOrderExtraSetup'".

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useHireOrderExtraSetup.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchOwnedSettingKeys } from "@/data/settings";

/** The two org settings whose PRESENCE (an org-owned row, not an inherited platform
 *  default) marks the v3 get-running `fee` and `document` steps done, mirroring how the
 *  flow/timing/countersign steps already test "a decision was made" (see
 *  `hasOrgSettingRow`/`fetchOwnedSettingKeys` in `src/data/settings.ts`).
 *
 *  Kept OUT of `HireOrderSetupStatus` on purpose: that status feeds the v1 hire-orders
 *  setup rail, whose only steps are letterhead/terms/countersign — Phase 3 must not grow
 *  that live v1 surface. The query key sits under `["app-settings", ...]` so the
 *  `OrderDefaultsCard` / `NumberingCard` `invalidateQueries(["app-settings"])` on save
 *  refreshes this read too, and the board reflects the new done state without a reload. */
const HIRE_ORDER_EXTRA_KEYS = ["hire_order_defaults", "hire_order_numbering"] as const;

export interface HireOrderExtraSetup {
  feeDone: boolean;
  documentDone: boolean;
}

export function useHireOrderExtraSetup(
  orgId: string | null,
): { status: HireOrderExtraSetup; isLoading: boolean } {
  const q = useQuery({
    queryKey: ["app-settings", "hire-order-extra", orgId],
    enabled: !!orgId,
    queryFn: () => fetchOwnedSettingKeys(supabase, orgId, HIRE_ORDER_EXTRA_KEYS),
  });
  const owned = q.data;
  return {
    status: {
      feeDone: owned?.has("hire_order_defaults") ?? false,
      documentDone: owned?.has("hire_order_numbering") ?? false,
    },
    isLoading: !!orgId && q.isLoading,
  };
}
```

- [ ] **Step 4: Run the hook test to verify it passes**

Run: `npx vitest run src/hooks/useHireOrderExtraSetup.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing `useGetRunningV3` integration test**

Add a case to `src/hooks/useGetRunningV3.test.tsx` (match the file's existing setup — it already seeds entitlements + settings for the board). Seed a hire-orders-entitled org that owns a `hire_order_defaults` row but not `hire_order_numbering`, and assert the resulting model's `fee` step is done while `document` is not:

```tsx
it("wires real fee/document done from owned hire-order setting rows", async () => {
  // Seed: hire_orders entitlement on; org owns hire_order_defaults, not hire_order_numbering.
  const { result } = renderHook(() => useGetRunningV3(), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  const paper = result.current.model!.phases.find((p) => p.key === "paperwork")!;
  expect(paper.steps.find((s) => s.key === "fee")!.done).toBe(true);
  expect(paper.steps.find((s) => s.key === "document")!.done).toBe(false);
});
```

Run: `npx vitest run src/hooks/useGetRunningV3.test.tsx`
Expected: FAIL — `fee` is `false` because `feeDone` is still hardcoded `false`.

- [ ] **Step 6: Wire the hook into `useGetRunningV3`**

In `src/hooks/useGetRunningV3.ts`:
1. Import: `import { useHireOrderExtraSetup } from "@/hooks/useHireOrderExtraSetup";`
2. After the `hire` read (near line 46), add: `const hireExtra = useHireOrderExtraSetup(hireOrgId);`
3. Fold into the `isLoading` gate (near lines 74-77): add `|| (hireOrdersOn && hireExtra.isLoading)`.
4. Replace the two hardcoded input lines (currently `feeDone: false,` / `documentDone: false,`, ~lines 113-114) with:

```ts
    feeDone: hireOrdersOn ? hireExtra.status.feeDone : false,
    documentDone: hireOrdersOn ? hireExtra.status.documentDone : false,
```

5. Update the header comment (~lines 27-29) that says `feeDone` and `documentDone` are hardcoded false: replace with a note that they now read whether the org owns its `hire_order_defaults` / `hire_order_numbering` row (`useHireOrderExtraSetup`), and that `skillsDone` remains the best-effort non-empty-catalog read.

- [ ] **Step 7: Run the integration test to verify it passes**

Run: `npx vitest run src/hooks/useGetRunningV3.test.tsx`
Expected: PASS. Then `npx tsc -p tsconfig.app.json --noEmit` — clean.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useHireOrderExtraSetup.ts src/hooks/useHireOrderExtraSetup.test.tsx src/hooks/useGetRunningV3.ts src/hooks/useGetRunningV3.test.tsx
git commit -m "v3: real fee/document done from owned hire-order setting rows"
```

---

## Task 3: `SkillsStep` body + copy

**Files:**
- Create: `src/components/getRunning/v3/steps/SkillsStep.tsx`
- Test: `src/components/getRunning/v3/steps/SkillsStep.test.tsx`
- Modify: `src/i18n/locales/en/getRunningV3.json`, `src/i18n/locales/de/getRunningV3.json`

**Interfaces:**
- Consumes: `SkillsTab` (`{ orgId: string }`) from `@/components/settings/skills/SkillsTab`; `WizardFooterContext`; `useCan`.
- Produces: `SkillsStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element` — the `StepBodyV3` body signature (identical to `SourceStep`/`ProductionsStep`).

- [ ] **Step 1: Add the `body.skills` copy (EN then DE)**

In `src/i18n/locales/en/getRunningV3.json`, add to the `body` object (mirror the placement of `body.source`):

```json
"skills": {
  "heading": "Skills for your parts",
  "sub": "Add the skills your parts need, then set them on your artists.",
  "continue": "Continue",
  "readOnly": "Managing skills needs the manage skills right, which this account does not have."
}
```

In `src/i18n/locales/de/getRunningV3.json`, add the matching key (Du-form, no en/em dashes):

```json
"skills": {
  "heading": "Skills für deine Positionen",
  "sub": "Lege die Skills an, die deine Positionen brauchen, und setze sie bei deinen Artists.",
  "continue": "Weiter",
  "readOnly": "Skills zu verwalten braucht das Recht Skills verwalten, das dieses Konto nicht hat."
}
```

- [ ] **Step 2: Write the failing test**

Create `src/components/getRunning/v3/steps/SkillsStep.test.tsx`. Render with the project providers (read `SourceStep.test.tsx` in the same directory for the exact render helper + i18n setup and mirror it). Two behaviours: it renders the reused skills surface, and Continue calls `onDone`.

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { SkillsStep } from "@/components/getRunning/v3/steps/SkillsStep";
// mirror SourceStep.test.tsx for the wrapper + any useCan/auth stubbing it does

describe("SkillsStep", () => {
  it("renders the continue action and calls onDone when a capable viewer clicks it", async () => {
    const onDone = vi.fn();
    // stub useCan -> true (edit_booking_settings), same way SourceStep.test stubs it
    render(<SkillsStep orgId="org-1" onDone={onDone} />, { /* wrapper */ });
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("shows a read-only note instead of continue when the viewer cannot edit", () => {
    // stub useCan -> false
    render(<SkillsStep orgId="org-1" onDone={vi.fn()} />, { /* wrapper */ });
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    expect(screen.getByText(/manage skills right/i)).toBeInTheDocument();
  });
});
```

Note: `SkillsStep` mounts the real `SkillsTab`, which reads skills via `useSkills` (AuthContext org). The project render helper already provides a QueryClient + AuthContext; follow `SourceStep.test.tsx`'s exact wrapper so those reads resolve to empty without extra seeding. Assert only on the step's own chrome (heading, continue/read-only), not on SkillsTab internals.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/components/getRunning/v3/steps/SkillsStep.test.tsx`
Expected: FAIL with "Cannot find module '.../SkillsStep'".

- [ ] **Step 4: Implement `SkillsStep`**

Create `src/components/getRunning/v3/steps/SkillsStep.tsx`:

```tsx
import { useContext } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useCan } from "@/hooks/useCapabilities";
import { SkillsTab } from "@/components/settings/skills/SkillsTab";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";
import { Button } from "@/components/ui/button";

/**
 * The v3 `skills` step body (Phase 3): the org skill catalog, reusing the Settings
 * `SkillsTab`. SkillsTab self-gates its writes on the `manage_skills` capability; the
 * step's OWN actionability is `edit_booking_settings` (the model's `capability` for this
 * step in `composeGetRunningV3`), which decides whether the viewer sees Continue or a
 * read-only note. Continue simply advances the wizard (`onDone`) — done-ness is derived
 * by the model from the catalog being non-empty, same "the dialogs persist, the body
 * advances" pattern as `ProductionsStep`.
 *
 * Portals its Continue into `WizardFooterContext`'s slot when `WizardShell` has mounted
 * it, falling back to an inline button when the context is null (e.g. in this file's tests).
 */
export function SkillsStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const footerSlot = useContext(WizardFooterContext);
  const canEdit = useCan("edit_booking_settings");

  const continueButton = (
    <Button type="button" size="sm" onClick={onDone}>
      {t("body.skills.continue")}
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
          {t("body.skills.heading")}
        </div>
        <p className="text-xs text-muted-foreground">{t("body.skills.sub")}</p>
      </div>

      {orgId ? <SkillsTab orgId={orgId} /> : null}

      {canEdit ? (
        footerSlot ? (
          createPortal(continueButton, footerSlot)
        ) : (
          continueButton
        )
      ) : (
        <p className="text-xs text-muted-foreground">{t("body.skills.readOnly")}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the test + typecheck to verify green**

Run: `npx vitest run src/components/getRunning/v3/steps/SkillsStep.test.tsx`
Then: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS and clean. Run `npx vitest run src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts` — expected green (EN/DE parity + no dashes).

- [ ] **Step 6: Commit**

```bash
git add src/components/getRunning/v3/steps/SkillsStep.tsx src/components/getRunning/v3/steps/SkillsStep.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 SkillsStep: reuse SkillsTab as the bookable skills step"
```

---

## Task 4: `FeeStep` body (org defaults + per-cast shell) + copy

**Files:**
- Create: `src/components/getRunning/v3/steps/FeeStep.tsx`
- Test: `src/components/getRunning/v3/steps/FeeStep.test.tsx`
- Modify: `src/i18n/locales/en/getRunningV3.json`, `src/i18n/locales/de/getRunningV3.json`

**Interfaces:**
- Consumes: `OrderDefaultsCard` (`{ orgId: string | null; readOnly?: boolean }`) from `@/components/settings/hireOrders/OrderDefaultsCard`; `WizardFooterContext`; `useCan`.
- Produces: `FeeStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element`.

- [ ] **Step 1: Add the `body.fee` copy (EN then DE)**

`src/i18n/locales/en/getRunningV3.json` → `body`:

```json
"fee": {
  "heading": "Your default fee",
  "sub": "The fee a new contract starts from. You can change it on any single contract.",
  "shellTitle": "Fees per production and cast",
  "shellBody": "Once you have casts, you can set a fee for each production and cast here. Until then every contract uses the default above.",
  "continue": "Continue",
  "readOnly": "Contract settings are set by an admin. You can read them here."
}
```

`src/i18n/locales/de/getRunningV3.json` → `body` (Du-form, no en/em dashes; reuse the existing `TERMS` term for contract if the file already imports one, else "Vertrag"):

```json
"fee": {
  "heading": "Dein Standardhonorar",
  "sub": "Das Honorar, mit dem ein neuer Vertrag startet. Du kannst es bei jedem einzelnen Vertrag ändern.",
  "shellTitle": "Honorare pro Produktion und Cast",
  "shellBody": "Sobald du Casts hast, kannst du hier ein Honorar pro Produktion und Cast setzen. Bis dahin nutzt jeder Vertrag das Standardhonorar oben.",
  "continue": "Weiter",
  "readOnly": "Vertragseinstellungen legt ein Admin fest. Du kannst sie hier lesen."
}
```

- [ ] **Step 2: Write the failing test**

Create `src/components/getRunning/v3/steps/FeeStep.test.tsx` (mirror `SourceStep.test.tsx`'s wrapper). Behaviours: renders the shell note; Continue calls `onDone` for a capable viewer; read-only note when not capable.

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { FeeStep } from "@/components/getRunning/v3/steps/FeeStep";

describe("FeeStep", () => {
  it("shows the per-cast shell note and advances on continue when capable", async () => {
    const onDone = vi.fn();
    // stub useCan -> true (edit_hire_order_settings)
    render(<FeeStep orgId="org-1" onDone={onDone} />, { /* wrapper */ });
    expect(screen.getByText(/fees per production and cast/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("renders read-only (no continue) when the viewer cannot edit", () => {
    // stub useCan -> false
    render(<FeeStep orgId="org-1" onDone={vi.fn()} />, { /* wrapper */ });
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    expect(screen.getByText(/set by an admin/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/components/getRunning/v3/steps/FeeStep.test.tsx`
Expected: FAIL with "Cannot find module '.../FeeStep'".

- [ ] **Step 4: Implement `FeeStep`**

Create `src/components/getRunning/v3/steps/FeeStep.tsx`:

```tsx
import { useContext } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useCan } from "@/hooks/useCapabilities";
import { OrderDefaultsCard } from "@/components/settings/hireOrders/OrderDefaultsCard";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";

/**
 * The v3 `fee` step body (Phase 3): the org's default fee/currency/basis, reusing the
 * Settings `OrderDefaultsCard` (which owns its own save + `["app-settings"]`
 * invalidation, so saving there flips this step's done state via `useHireOrderExtraSetup`).
 *
 * The per-(cast × production) fee list is Phase 4 (it needs the new `cast_production_fees`
 * table), so this step ships a static shell note in its place rather than a fake list.
 * `document`/`fee` are admin-only in the model (`capability: canEditHire`); a viewer
 * without `edit_hire_order_settings` sees the card read-only and a "set by an admin" note
 * instead of Continue.
 */
export function FeeStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const footerSlot = useContext(WizardFooterContext);
  const canEdit = useCan("edit_hire_order_settings");

  const continueButton = (
    <Button type="button" size="sm" onClick={onDone}>
      {t("body.fee.continue")}
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
          {t("body.fee.heading")}
        </div>
        <p className="text-xs text-muted-foreground">{t("body.fee.sub")}</p>
      </div>

      <OrderDefaultsCard orgId={orgId} readOnly={!canEdit} />

      <div className="flex flex-col items-start gap-1 rounded-l border border-dashed border-border px-4 py-4">
        <Eyebrow>{t("body.fee.shellTitle")}</Eyebrow>
        <p className="text-xs text-muted-foreground">{t("body.fee.shellBody")}</p>
      </div>

      {canEdit ? (
        footerSlot ? (
          createPortal(continueButton, footerSlot)
        ) : (
          continueButton
        )
      ) : (
        <p className="text-xs text-muted-foreground">{t("body.fee.readOnly")}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the test + typecheck + i18n gates**

Run: `npx vitest run src/components/getRunning/v3/steps/FeeStep.test.tsx src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts`
Then: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/getRunning/v3/steps/FeeStep.tsx src/components/getRunning/v3/steps/FeeStep.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 FeeStep: org fee defaults plus per-cast shell (backend in Phase 4)"
```

---

## Task 5: `DocumentStep` body (numbering + template link) + copy

**Files:**
- Create: `src/components/getRunning/v3/steps/DocumentStep.tsx`
- Test: `src/components/getRunning/v3/steps/DocumentStep.test.tsx`
- Modify: `src/i18n/locales/en/getRunningV3.json`, `src/i18n/locales/de/getRunningV3.json`

**Interfaces:**
- Consumes: `NumberingCard` (`{ orgId: string | null; readOnly?: boolean }`) from `@/components/settings/hireOrders/NumberingCard`; `ROUTES.HIRE_ORDER_TEMPLATE` from `@/config/app.config`; `Link` from `react-router-dom`; `WizardFooterContext`; `useCan`.
- Produces: `DocumentStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element`.

- [ ] **Step 1: Add the `body.document` copy (EN then DE)**

`src/i18n/locales/en/getRunningV3.json` → `body`:

```json
"document": {
  "heading": "Your contract document",
  "sub": "Set how contract numbers are built. Style the full layout in the template editor.",
  "templateLink": "Open the document template editor",
  "continue": "Continue",
  "readOnly": "Contract settings are set by an admin. You can read them here."
}
```

`src/i18n/locales/de/getRunningV3.json` → `body`:

```json
"document": {
  "heading": "Dein Vertragsdokument",
  "sub": "Lege fest, wie Vertragsnummern gebildet werden. Das ganze Layout gestaltest du im Vorlageneditor.",
  "templateLink": "Vorlageneditor öffnen",
  "continue": "Weiter",
  "readOnly": "Vertragseinstellungen legt ein Admin fest. Du kannst sie hier lesen."
}
```

- [ ] **Step 2: Write the failing test**

Create `src/components/getRunning/v3/steps/DocumentStep.test.tsx` (mirror `SourceStep.test.tsx`; the template `Link` needs a router — `SourceStep.test.tsx`/the project render helper already wraps in a router, follow it):

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { DocumentStep } from "@/components/getRunning/v3/steps/DocumentStep";

describe("DocumentStep", () => {
  it("links to the template editor and advances on continue when capable", async () => {
    const onDone = vi.fn();
    // stub useCan -> true (edit_hire_order_settings)
    render(<DocumentStep orgId="org-1" onDone={onDone} />, { /* wrapper with router */ });
    expect(screen.getByRole("link", { name: /template editor/i })).toHaveAttribute(
      "href",
      "/settings/contracts/template",
    );
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("renders read-only (no continue) when the viewer cannot edit", () => {
    // stub useCan -> false
    render(<DocumentStep orgId="org-1" onDone={vi.fn()} />, { /* wrapper with router */ });
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    expect(screen.getByText(/set by an admin/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/components/getRunning/v3/steps/DocumentStep.test.tsx`
Expected: FAIL with "Cannot find module '.../DocumentStep'".

- [ ] **Step 4: Implement `DocumentStep`**

Create `src/components/getRunning/v3/steps/DocumentStep.tsx`:

```tsx
import { useContext } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useCan } from "@/hooks/useCapabilities";
import { NumberingCard } from "@/components/settings/hireOrders/NumberingCard";
import { ROUTES } from "@/config/app.config";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";
import { Button } from "@/components/ui/button";

/**
 * The v3 `document` step body (Phase 3): how contract numbers are built (reuse the
 * Settings `NumberingCard`, which owns its save + `["app-settings"]` invalidation, so
 * saving flips this step's done state via `useHireOrderExtraSetup`), plus a link to the
 * full document template editor for the rest of the layout. Admin-only in the model
 * (`capability: canEditHire`); a non-editing viewer sees the card read-only and a note.
 */
export function DocumentStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const footerSlot = useContext(WizardFooterContext);
  const canEdit = useCan("edit_hire_order_settings");

  const continueButton = (
    <Button type="button" size="sm" onClick={onDone}>
      {t("body.document.continue")}
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
          {t("body.document.heading")}
        </div>
        <p className="text-xs text-muted-foreground">{t("body.document.sub")}</p>
      </div>

      <NumberingCard orgId={orgId} readOnly={!canEdit} />

      <Link
        to={ROUTES.HIRE_ORDER_TEMPLATE}
        className="text-xs font-medium text-accent-600 underline-offset-2 hover:underline"
      >
        {t("body.document.templateLink")}
      </Link>

      {canEdit ? (
        footerSlot ? (
          createPortal(continueButton, footerSlot)
        ) : (
          continueButton
        )
      ) : (
        <p className="text-xs text-muted-foreground">{t("body.document.readOnly")}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the test + typecheck + i18n gates**

Run: `npx vitest run src/components/getRunning/v3/steps/DocumentStep.test.tsx src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts`
Then: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/getRunning/v3/steps/DocumentStep.tsx src/components/getRunning/v3/steps/DocumentStep.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 DocumentStep: reuse NumberingCard plus template-editor link"
```

---

## Task 6: Wire the three bodies into `StepBodyV3`

**Files:**
- Modify: `src/components/getRunning/v3/stepRegistryV3.tsx`
- Test: `src/components/getRunning/v3/stepRegistryV3.test.tsx`

**Interfaces:**
- Consumes: `SkillsStep`, `FeeStep`, `DocumentStep` (all `{ orgId, onDone }`) from `@/components/getRunning/v3/steps/*`.
- Produces: `StepBodyV3` routes `skills`/`fee`/`document` to the real bodies; `StepComingSoon` is no longer returned for any step whose `placeholder` is false (all 16 are now false).

- [ ] **Step 1: Write the failing test**

Add to `src/components/getRunning/v3/stepRegistryV3.test.tsx` (read the existing test for its render helper + how it builds a `GetRunningStep` and asserts which body renders — match it). Assert the three keys now render their real body, not `StepComingSoon`. Use a marker each real body renders (e.g. the `body.<key>.heading` text, or the reused card's own heading):

```tsx
it("routes skills/fee/document to their real bodies, not StepComingSoon", () => {
  for (const key of ["skills", "fee", "document"] as const) {
    const step = makeStep({ key, placeholder: false }); // match the file's step factory
    render(<StepBodyV3 step={step} orgId="org-1" onDone={() => {}} />, { /* wrapper */ });
    // StepComingSoon renders comingSoon.title; the real bodies never do.
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  }
});
```

If the existing test already snapshots or asserts specific bodies per key, extend that structure instead of adding a parallel one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/getRunning/v3/stepRegistryV3.test.tsx`
Expected: FAIL — the three still resolve to `StepComingSoon` via the explicit `case` block.

- [ ] **Step 3: Rewire the registry**

In `src/components/getRunning/v3/stepRegistryV3.tsx`:
1. Add imports:

```tsx
import { SkillsStep } from "@/components/getRunning/v3/steps/SkillsStep";
import { FeeStep } from "@/components/getRunning/v3/steps/FeeStep";
import { DocumentStep } from "@/components/getRunning/v3/steps/DocumentStep";
```

2. Replace the fall-through cases (currently `case "skills": case "fee": case "document": return <StepComingSoon step={step} />;`) with:

```tsx
    case "skills":
      return <SkillsStep orgId={orgId} onDone={onDone} />;
    case "fee":
      return <FeeStep orgId={orgId} onDone={onDone} />;
    case "document":
      return <DocumentStep orgId={orgId} onDone={onDone} />;
```

3. Update the `StepBodyV3` doc comment: it currently says `skills`/`fee`/`document` render `StepComingSoon`. Change it to note all 16 steps now have real bodies (skills reuses `SkillsTab`, fee reuses `OrderDefaultsCard`, document reuses `NumberingCard`), and that the `step.placeholder` early-return + `StepComingSoon` remain only as a safety net for any future not-yet-built step.

Note: the `step.placeholder` early-return at the top of `StepBodyV3` still exists and is now dead for these three (their `placeholder` is false after Task 1) — leave it; it is the generic guard for future additions. The `BOOKING_DOMAIN_STEP_KEYS` set (`{artists, coverage}`) is unaffected: `skills` reads its own catalog via `SkillsTab`/`useSkills`, not `useBookingSetupStatus`, so do not add it there.

- [ ] **Step 4: Run the test + typecheck to verify green**

Run: `npx vitest run src/components/getRunning/v3/stepRegistryV3.test.tsx`
Then: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/getRunning/v3/stepRegistryV3.tsx src/components/getRunning/v3/stepRegistryV3.test.tsx
git commit -m "v3: route skills/fee/document to real step bodies"
```

---

## Task 7: Help center + terms + full verification gate

**Files:**
- Modify (if needed): `src/lib/help/items.ts`, `src/i18n/terms.ts`
- No new code; this task is the consolidated verification before the PR.

- [ ] **Step 1: Help center + terms impact**

Review `src/lib/help/items.ts` (EN + DE): does Phase 3 change what an admin/producer asks or how the app answers? The three steps surface existing capabilities (skills catalog, default fee, contract numbering) that already have Settings homes and likely existing help items. If an item needs adjusting, do it here (Du, no dashes); otherwise record "No help center impact." for the PR. If any new shared domain term was introduced in the body copy (e.g. a contract term), move it into `src/i18n/terms.ts` `TERMS` and reference it rather than inlining. There is no page mini for the get-running board (it is not in `src/lib/minis/index.ts`'s `MINIS`), so state "No page mini (get-running board has none)." in the PR.

- [ ] **Step 2: Run the fast verification suite**

Run: `npm run verify:fast`
Expected: all green — lint (`--max-warnings 0`), the three typecheck projects, build, unit + coverage, Deno. Fix any raw-value / dash / key-parity / coverage-threshold failures (new component files may need their tests to clear the coverage gate — Tasks 3-6 already add them).

- [ ] **Step 3: Live visual verification against the design (dev harness)**

Boot the local stack + dev server (`npm run local:up` then `npm run dev`; the harness route is `/dev/get-running`, `import.meta.env.DEV` only, flag on in `.env.development`). Using the Browser preview tools, open the **Make it bookable** phase and the **Contracts** phase and walk the three new steps in BOTH light and dark:
  - `skills`: the skill catalog renders inside the wizard body; Continue advances.
  - `fee`: `OrderDefaultsCard` (default fee / currency / basis) renders; save it, confirm the board marks `fee` done (via `["app-settings"]` invalidation) without a reload; the "Fees per production and cast" shell note is present and static; Continue advances.
  - `document`: `NumberingCard` (prefix / pattern + live preview) renders; save it, confirm `document` flips done; the "Open the document template editor" link points at `/settings/contracts/template`; Continue advances.
  - Producer view: the Contracts phase steps render read-only with the "set by an admin" note and no Continue.
Compare against the design screens `Contracts` and `Run3Steps` (Claude Design project `02c15575-91a6-4acd-92fc-e006a5cf1b88`). Capture screenshots. Interaction/layout must match the design; copy follows the app-terminology rule. Fix divergences, re-run step 2.

- [ ] **Step 4: Commit any copy/help changes**

```bash
git add src/lib/help/items.ts src/i18n/terms.ts
git commit -m "help + terms for v3 skills/fee/document steps (or: no help impact)"
```

---

## Self-Review (run before handing off to execution)

**1. Spec coverage** — Phase 3 scope from spec §10 = "Remaining bookable + Contracts steps. skills, fee (org defaults + UI shell), document. Contracts phase faithful.":
- `skills` step (spec §4.1 row 7, "NEW step over existing SkillsTab logic") → Tasks 1, 3, 6 ✓
- `fee` step, org defaults + UI shell only, per-(cast×production) backend deferred to Phase 4 (spec §4.1 row 13, §10) → Tasks 1, 2, 4, 6 ✓ (shell = static note; no `cast_production_fees` touched)
- `document` step (spec §4.1 row 15, "NEW step over hire-order numbering/layout (NumberingCard)") → Tasks 1, 2, 5, 6 ✓
- Contracts phase faithful (all five paperwork steps now real bodies: letterhead/terms/countersign from Phase 1 + fee/document here) → Tasks 4, 5, 6 ✓
- Real done-signals, not placeholders (spec §5.3 "Later phases replace the remaining placeholder signals with real reads") → Tasks 1, 2 ✓
- Role/module gating unchanged (§4.2: Contracts admin-only, producers read-only) → the model's `adminOnly`/`capability` are untouched; the bodies render `readOnly`/read-only note off `useCan` (Tasks 4, 5) ✓
- Flag-gated + additive, v1 + `HireOrderSetupStatus` untouched → Global Constraints, Task 2 note ✓
- i18n EN+DE, no dashes, `body.*` added, `steps.*`/`guide.*` reused → every UI task + Task 7 ✓
- No Sheet importer, no `cast_production_fees` (Phase 4) → out of scope, stated in Architecture + Task 4 ✓

**2. Placeholder scan** — no "TBD"/"handle edge cases"/"similar to Task N"; each task carries real code. The three test skeletons say "mirror `SourceStep.test.tsx` for the wrapper" and Task 2's seed says "read `src/data/settings.test.ts` for the fake contract" — these are explicit instructions to copy an exact, named existing pattern (the test render wrapper and the `supabaseFake` seeding shape are project harness details that live in those files), not hidden design work.

**3. Type consistency** — every body is `({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element`, matching `StepBodyV3`'s call site `<StepBodyV3 step onDone orgId>` and the existing `SourceStep`/`ProductionsStep` signatures (Tasks 3-6). `useHireOrderExtraSetup` returns `{ status: { feeDone, documentDone }; isLoading }`; `useGetRunningV3` reads `hireExtra.status.feeDone`/`.documentDone` (Task 2). Capability strings: `edit_booking_settings` (skills), `edit_hire_order_settings` (fee, document) match the model's `capability: input.canEditBooking`/`input.canEditHire` for those steps. Setting keys `hire_order_defaults` / `hire_order_numbering` match `OrderDefaultsCard`'s and `NumberingCard`'s own `upsertOrgSetting` keys exactly (so the presence read and the cards' writes agree).

## Execution notes

- Tasks 1 and 2 (model + real signals) are independent of each other and can run in parallel. Tasks 3, 4, 5 (the three bodies) are independent of each other and depend only on Task 1's placeholder flip being either done or pending (they render fine either way; the registry only routes to them in Task 6). Task 6 depends on 3-5. Task 7 is last.
- After each task: the executor runs that task's tests + `npx tsc -p tsconfig.app.json --noEmit`; a two-stage review (correctness + convention) gates each commit.
- Do not flip the flag on, do not touch v1 files or `HireOrderSetupStatus`/`useHireOrderSetup`, and do not open the PR until Task 7's `verify:fast` + live visual verification are green. The owner opens/approves the PR.
