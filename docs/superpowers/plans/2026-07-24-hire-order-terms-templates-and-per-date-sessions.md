# Hire orders: variable terms templates + per-date sessions + migration guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let orgs manage a free-form list of named terms templates, give aggregate hire orders a per-date running order pulled from each synced date, and add a CI guard that fails when a merged migration hasn't been applied to production.

**Architecture:** Three independent workstreams in one PR. (A) Terms become `{templates:[{id,name,clauses}],default_id}` resolved by stable id; a dual-homed pure helper normalizes legacy→new. (B) `EngagementDate` gains `sessions`/`duration_min`; the edge draft-batch fills each from its own synced date, the wizard edits per date, the PDF renders per-date. (C) A `push:main` workflow name-compares repo migrations against `schema_migrations`.

**Tech Stack:** React 18 + TS + Vite + shadcn/ui + react-query (frontend), Deno edge functions (Supabase), `@react-pdf/renderer` (PDF), Vitest + Deno test (tests), GitHub Actions (CI).

**Spec:** `docs/superpowers/specs/2026-07-24-hire-order-terms-templates-and-per-date-sessions-design.md`

## Global Constraints

- **Mirror discipline:** `src/lib/hireOrders/*` and `supabase/functions/_shared/hireOrders.ts` are byte-parallel type/logic twins (two runtimes, no shared import). Any change to shared types/logic lands in **both** in the same commit.
- **No `any`:** lint is CI-gated `--max-warnings 0`. Use explicit local row interfaces + a single `as unknown as` at the query boundary, or the typed test helpers.
- **No DB schema change:** `terms_variant` stays `text`; `engagement_dates` stays inside `data` jsonb. Do NOT add migrations for A/B.
- **Semantic tokens only** in components (`bg-background`, `text-muted-foreground`, …); accent numbered stops (`accent-50`–`900`) take no opacity modifier.
- **No em/en dashes** in any user-facing copy (UI strings, changelog). Use period/comma/colon.
- **Test-first (TDD):** every task writes the failing test first, watches it fail, implements minimally, watches it pass, commits.
- **Tests import the real module** — never re-implement production logic in a test.
- **Commands:** frontend tests `npx vitest run <path>`; edge tests `deno test --allow-all --node-modules-dir=none <path>`; lint `npm run lint`; typecheck `npx tsc --noEmit`.
- **Version/changelog:** after A + B land, bump `package.json` + `APP_META.VERSION` in `src/config/app.config.ts` to `1.12.0`, add a newest-first `public/changelog.md` block, regenerate JSON via `deno run --allow-read --allow-write scripts/changelog-to-json.ts`. The CI guard (C) is NOT a customer-facing changelog item.

---

## Phase A — Variable terms templates

### Task A1: Terms setting types + normalize/resolve helpers (dual-home)

**Files:**
- Create: `src/lib/hireOrders/terms.ts`
- Create (test): `src/lib/hireOrders/terms.test.ts`
- Modify: `supabase/functions/_shared/hireOrders.ts` (append the same helpers + types at the end, before the renderer port section)
- Modify (test): `supabase/functions/_shared/hireOrders.test.ts` (append mirror tests)

**Interfaces produced (used by A2–A5):**
```ts
interface HireOrderClause { title: string; body: string }
interface HireOrderTemplate { id: string; name: string; clauses: HireOrderClause[] }
interface HireOrderTermsSetting { templates: HireOrderTemplate[]; default_id: string | null }
// normalize any stored value (legacy {lean,standard,full} | new shape | junk) → HireOrderTermsSetting
function normalizeTermsSetting(raw: unknown): HireOrderTermsSetting
// resolve the clauses to render for an order, with delete→default fallback
function resolveTermsClauses(setting: HireOrderTermsSetting, termsVariantId: string | null): HireOrderClause[]
// the effective default template id (default_id if valid, else first template, else null)
function defaultTemplateId(setting: HireOrderTermsSetting): string | null
```

- [ ] **Step 1: Write the failing test** — `src/lib/hireOrders/terms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  defaultTemplateId,
  normalizeTermsSetting,
  resolveTermsClauses,
} from "./terms";

describe("normalizeTermsSetting", () => {
  it("passes a valid new-shape value through unchanged", () => {
    const v = { templates: [{ id: "a", name: "A", clauses: [{ title: "t", body: "b" }] }], default_id: "a" };
    expect(normalizeTermsSetting(v)).toEqual(v);
  });

  it("converts the legacy lean/standard/full shape to three templates, default standard", () => {
    const legacy = { lean: [], standard: [{ title: "S", body: "sb" }], full: [] };
    expect(normalizeTermsSetting(legacy)).toEqual({
      templates: [
        { id: "lean", name: "Lean", clauses: [] },
        { id: "standard", name: "Standard", clauses: [{ title: "S", body: "sb" }] },
        { id: "full", name: "Full", clauses: [] },
      ],
      default_id: "standard",
    });
  });

  it("returns empty for missing/junk input", () => {
    expect(normalizeTermsSetting(null)).toEqual({ templates: [], default_id: null });
    expect(normalizeTermsSetting({})).toEqual({ templates: [], default_id: null });
    expect(normalizeTermsSetting({ templates: "nope" })).toEqual({ templates: [], default_id: null });
  });

  it("drops malformed templates and clauses", () => {
    const v = { templates: [{ id: "a", name: "A", clauses: [{ title: "t", body: "b" }, { title: 1 }] }, { name: "no id" }], default_id: "a" };
    expect(normalizeTermsSetting(v)).toEqual({ templates: [{ id: "a", name: "A", clauses: [{ title: "t", body: "b" }] }], default_id: "a" });
  });
});

describe("defaultTemplateId", () => {
  it("returns default_id when it points at an existing template", () => {
    expect(defaultTemplateId({ templates: [{ id: "a", name: "A", clauses: [] }], default_id: "a" })).toBe("a");
  });
  it("falls back to the first template when default_id is missing or stale", () => {
    expect(defaultTemplateId({ templates: [{ id: "a", name: "A", clauses: [] }], default_id: "gone" })).toBe("a");
    expect(defaultTemplateId({ templates: [{ id: "a", name: "A", clauses: [] }], default_id: null })).toBe("a");
  });
  it("returns null when there are no templates", () => {
    expect(defaultTemplateId({ templates: [], default_id: null })).toBeNull();
  });
});

describe("resolveTermsClauses", () => {
  const setting = {
    templates: [
      { id: "a", name: "A", clauses: [{ title: "ta", body: "ba" }] },
      { id: "b", name: "B", clauses: [{ title: "tb", body: "bb" }] },
    ],
    default_id: "b",
  };
  it("returns the referenced template's clauses", () => {
    expect(resolveTermsClauses(setting, "a")).toEqual([{ title: "ta", body: "ba" }]);
  });
  it("falls back to the default template when the id is unknown (deleted)", () => {
    expect(resolveTermsClauses(setting, "gone")).toEqual([{ title: "tb", body: "bb" }]);
  });
  it("returns [] when neither the id nor a default resolves", () => {
    expect(resolveTermsClauses({ templates: [], default_id: null }, "x")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/lib/hireOrders/terms.test.ts`
Expected: FAIL (`Cannot find module './terms'`).

- [ ] **Step 3: Implement** `src/lib/hireOrders/terms.ts`:

```ts
// Hire-order terms templates: the org's `hire_order_terms` app-setting.
// MIRROR: supabase/functions/_shared/hireOrders.ts carries byte-identical
// copies of these types + helpers (the two runtimes cannot share an import).
// Change both files in the same commit.

export interface HireOrderClause {
  title: string;
  body: string;
}

export interface HireOrderTemplate {
  id: string;
  name: string;
  clauses: HireOrderClause[];
}

export interface HireOrderTermsSetting {
  templates: HireOrderTemplate[];
  default_id: string | null;
}

const LEGACY_KEYS = ["lean", "standard", "full"] as const;
const LEGACY_NAMES: Record<(typeof LEGACY_KEYS)[number], string> = {
  lean: "Lean",
  standard: "Standard",
  full: "Full",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function coerceClauses(raw: unknown): HireOrderClause[] {
  if (!Array.isArray(raw)) return [];
  const out: HireOrderClause[] = [];
  for (const c of raw) {
    if (isRecord(c) && typeof c.title === "string" && typeof c.body === "string") {
      out.push({ title: c.title, body: c.body });
    }
  }
  return out;
}

/** Normalize any stored `hire_order_terms` value to the new shape, tolerating
 *  the legacy `{lean,standard,full}` shape and junk. */
export function normalizeTermsSetting(raw: unknown): HireOrderTermsSetting {
  if (!isRecord(raw)) return { templates: [], default_id: null };

  // Legacy shape: has at least one of lean/standard/full and no `templates`.
  if (!("templates" in raw) && LEGACY_KEYS.some((k) => k in raw)) {
    return {
      templates: LEGACY_KEYS.map((k) => ({
        id: k,
        name: LEGACY_NAMES[k],
        clauses: coerceClauses(raw[k]),
      })),
      default_id: "standard",
    };
  }

  if (!Array.isArray(raw.templates)) return { templates: [], default_id: null };
  const templates: HireOrderTemplate[] = [];
  for (const t of raw.templates) {
    if (isRecord(t) && typeof t.id === "string" && typeof t.name === "string") {
      templates.push({ id: t.id, name: t.name, clauses: coerceClauses(t.clauses) });
    }
  }
  const default_id = typeof raw.default_id === "string" ? raw.default_id : null;
  return { templates, default_id };
}

/** The effective default template id: `default_id` if it exists, else the first
 *  template, else null. */
export function defaultTemplateId(setting: HireOrderTermsSetting): string | null {
  if (setting.default_id && setting.templates.some((t) => t.id === setting.default_id)) {
    return setting.default_id;
  }
  return setting.templates[0]?.id ?? null;
}

/** Clauses to render for an order: the referenced template, else the default
 *  template (deleted-reference fallback), else []. */
export function resolveTermsClauses(
  setting: HireOrderTermsSetting,
  termsVariantId: string | null,
): HireOrderClause[] {
  const byId = termsVariantId
    ? setting.templates.find((t) => t.id === termsVariantId)
    : undefined;
  if (byId) return byId.clauses;
  const defId = defaultTemplateId(setting);
  return setting.templates.find((t) => t.id === defId)?.clauses ?? [];
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run src/lib/hireOrders/terms.test.ts`
Expected: PASS.

- [ ] **Step 5: Mirror into the edge twin** — append the identical block (with an edge-appropriate header comment) to `supabase/functions/_shared/hireOrders.ts`. Note it already exports `HireOrderTerm {title,body}` — reuse it: define `HireOrderClause = HireOrderTerm` alias, OR export the three functions + `HireOrderTemplate`/`HireOrderTermsSetting` and keep `clauses: HireOrderTerm[]`. Add a mirror test to `supabase/functions/_shared/hireOrders.test.ts` re-using the same cases (Deno `assertEquals`).

- [ ] **Step 6: Run edge test + lint**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/hireOrders.test.ts` → PASS
Run: `npm run lint` → 0 warnings

- [ ] **Step 7: Commit**

```bash
git add src/lib/hireOrders/terms.ts src/lib/hireOrders/terms.test.ts supabase/functions/_shared/hireOrders.ts supabase/functions/_shared/hireOrders.test.ts
git commit -m "add hire-order terms-template normalize/resolve helpers (dual-home)"
```

---

### Task A2: New-shape default in app.config

**Files:**
- Modify: `src/config/app.config.ts:119-142`
- Test: covered by A3 component test (no standalone test — this is a constant swap).

**Interfaces consumed:** `HireOrderTermsSetting`, `HireOrderClause` (Task A1).

- [ ] **Step 1: Replace** the `HireOrderClause` interface + `HIRE_ORDER_DEFAULT_TERMS` const. Re-export the type from the lib module so there is one home:

```ts
// near the other hire-order exports in app.config.ts
export type { HireOrderClause, HireOrderTemplate, HireOrderTermsSetting } from "@/lib/hireOrders/terms";
import type { HireOrderTermsSetting } from "@/lib/hireOrders/terms";

/**
 * Fallback for an org that has never saved terms: three seeded, clause-less
 * templates (Lean / Standard / Full, default Standard). ShowFlow ships NO
 * default clause text (see spec) — the org authors its own before issuing.
 */
export const HIRE_ORDER_DEFAULT_TERMS: HireOrderTermsSetting = {
  templates: [
    { id: "lean", name: "Lean", clauses: [] },
    { id: "standard", name: "Standard", clauses: [] },
    { id: "full", name: "Full", clauses: [] },
  ],
  default_id: "standard",
};
```

- [ ] **Step 2: Fix fallout** — anything importing `HireOrderClause` from `app.config` still works (re-exported). Grep for consumers of the old `HIRE_ORDER_DEFAULT_TERMS` shape (`grep -rn HIRE_ORDER_DEFAULT_TERMS src`) and update them in later tasks (TermsVariantsCard is A3).

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` may report errors in `TermsVariantsCard.tsx` (old shape) — expected; A3 fixes them. Commit is deferred to A3 so the tree stays green per-commit; if you prefer an independent commit here, temporarily keep `TermsVariantsCard` compiling by casting. **Recommended: fold A2's commit into A3.**

---

### Task A3: Settings terms editor becomes a dynamic template list

**Files:**
- Modify: `src/components/settings/hireOrders/TermsVariantsCard.tsx` (full rewrite of the card body; keep `ClauseListEditor` internals)
- Test: `src/components/settings/hireOrders/TermsVariantsCard.test.tsx` (extend existing)

**Interfaces consumed:** `HireOrderTermsSetting`, `normalizeTermsSetting`, `defaultTemplateId` (A1); `HIRE_ORDER_DEFAULT_TERMS` (A2).

Behavior to build:
- Query `hire_order_terms` via `resolveOrgSetting`, run through `normalizeTermsSetting`, seed local form state once (existing `seededRef` pattern).
- Render one block per template: a **name `Input`**, a **"Default" toggle** (a `role="radio"` in a shared `radiogroup`; exactly one default; clicking sets `default_id`), the existing `ClauseListEditor` (retitled to take the template `name` for aria labels), and a **delete `Button`** (trash icon).
- **Add template** button appends `{ id: crypto.randomUUID(), name: "", clauses: [] }`.
- **Delete** removes the template; if it was the default, set `default_id` to the first remaining template's id (or `null`).
- Save writes the whole `HireOrderTermsSetting` via `upsertOrgSetting`.
- Keep the `isError` guard (render the alert instead of the form).
- Respect `readOnly` on every control (disable inputs/buttons).

- [ ] **Step 1: Write failing component tests** (extend the existing test file) covering: renders template names from a normalized legacy value; "Add template" adds a row; renaming updates the field; "Set default" moves the default; delete removes a row and reassigns default; Save calls `upsertOrgSetting` with the new-shape payload. Use `renderWithProviders` + the fake client. Assert on visible text / `aria-checked`.

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/components/settings/hireOrders/TermsVariantsCard.test.tsx`

- [ ] **Step 3: Implement** the dynamic editor (see behavior list). Generate ids with `crypto.randomUUID()`. Keep the `Card`/`Separator`/`Button` structure and copy tone. Ensure exactly one `default` selected; when `default_id` is null and templates exist, treat the first as default in the UI and persist it on save.

- [ ] **Step 4: Run, verify pass**; then `npm run lint` + `npx tsc --noEmit`.

- [ ] **Step 5: Commit** (fold in A2):

```bash
git add src/config/app.config.ts src/components/settings/hireOrders/TermsVariantsCard.tsx src/components/settings/hireOrders/TermsVariantsCard.test.tsx
git commit -m "make hire-order terms an add/rename/delete template list with a default"
```

---

### Task A4: Order pickers read the org's templates

**Files:**
- Modify: `src/components/shows/hireOrders/GenerateHireOrderDialog.tsx:31-36,238-260`
- Modify: `src/pages/HireOrderEditPage.tsx` (the `TERMS_VARIANTS`/variant radiogroup, ~line 541)
- Modify: `src/components/hireOrders/import/HireOrderImportDialog.tsx` (default terms_variant + any picker)
- Test: extend each component's existing test; add a shared query hook test if one is introduced.

**Interfaces consumed:** `normalizeTermsSetting`, `defaultTemplateId` (A1).

New shared hook (create `src/hooks/useHireOrders.ts` addition or a small `useHireOrderTerms(orgId)`):
```ts
// returns { data: HireOrderTermsSetting } via resolveOrgSetting + normalizeTermsSetting,
// queryKey ["app-settings","hire_order_terms", orgId]
```

- [ ] **Step 1: Write failing tests** — GenerateHireOrderDialog: renders one radio per org template (labelled by `name`, checked by matching `order.terms_variant` id); a removed reference shows a disabled "(removed)" chip and does not crash. HireOrderEditPage: same for its picker. Import dialog: new drafts default `terms_variant` to the org's `defaultTemplateId`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — replace the hardcoded `TERMS_VARIANTS` array in each with the fetched templates. In `GenerateHireOrderDialog`, add a `useHireOrderTerms(orgId)` query and map `templates` to the radiogroup buttons (`value=id`, label=`name`); keep `variant` state but initialize to `order.terms_variant || defaultTemplateId(terms)`. If `order.terms_variant` is not among templates, prepend a disabled chip labelled `<name?> (removed)` and treat selection as required before issue. Mirror in `HireOrderEditPage`. In the import dialog, set the row default to `defaultTemplateId`.

- [ ] **Step 4: Run tests + lint + tsc → pass.**

- [ ] **Step 5: Commit**

```bash
git add src/components/shows/hireOrders/GenerateHireOrderDialog.tsx src/pages/HireOrderEditPage.tsx src/components/hireOrders/import/HireOrderImportDialog.tsx src/hooks/useHireOrders.ts src/hooks/useHireOrders.test.ts
git commit -m "order pickers read the org's terms templates dynamically"
```

---

### Task A5: Edge function resolves terms by template id

**Files:**
- Modify: `supabase/functions/generate-hire-orders/index.ts`
  - `TERMS_DEFAULT`/`TermsVariants` (lines ~70-73, 110): replace with the new-shape default + `HireOrderTermsSetting`.
  - `draftOrders` (~498), `draftManual` (~783), `draftBatchArtist` (~1087): `terms_variant: "standard"` → the org's `defaultTemplateId(termsSetting)` (fetch/normalize `hire_order_terms` alongside the existing settings reads; pass into the batch context).
  - `issueOne` (~1250-1257) + `previewOrder` (~1686-1699): replace `terms[variant] ?? []` with `resolveTermsClauses(termsSetting, o.terms_variant)`.
- Test: `supabase/functions/generate-hire-orders/index.di.test.ts` (extend)

**Interfaces consumed:** `normalizeTermsSetting`, `resolveTermsClauses`, `defaultTemplateId`, `HireOrderTermsSetting` (A1, edge twin).

- [ ] **Step 1: Write failing Deno tests** (extend `index.di.test.ts`): (a) a draft created when the org's default is `full` stores `terms_variant: "full"`; (b) issuing an order whose `terms_variant` points at a deleted template renders the **default** template's clauses (assert via the `renderHireOrderPdf` spy's `terms` arg); (c) issuing with an empty resolved clause list still fails `missing_terms`.

- [ ] **Step 2: Run, verify fail** — `deno test --allow-all --node-modules-dir=none supabase/functions/generate-hire-orders/`

- [ ] **Step 3: Implement** — read `hire_order_terms` once per `issueOrders` batch (it already reads `terms` there — change its type + normalize), thread `termsSetting` into `issueOne`; in `resolveFields`-adjacent draft paths fetch+normalize the setting and use `defaultTemplateId`. Replace the `terms[variant]` lookups with `resolveTermsClauses`. Keep `variantTerms.length === 0 → missing_terms`.

- [ ] **Step 4: Run edge suite → pass.**

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-hire-orders/index.ts supabase/functions/generate-hire-orders/index.di.test.ts
git commit -m "resolve hire-order terms by template id with default fallback in the edge fn"
```

---

## Phase B — Per-date sessions

### Task B1: `EngagementDate` gains sessions + duration (dual-home) + override merge

**Files:**
- Modify: `src/lib/hireOrders/types.ts:13-18`
- Modify: `supabase/functions/_shared/hireOrders.ts:19-24`
- Create: `src/lib/hireOrders/engagementDates.ts` (pure merge/resolve helper)
- Create (test): `src/lib/hireOrders/engagementDates.test.ts`
- Mirror the helper into `supabase/functions/_shared/hireOrders.ts` + test.

**Interfaces produced (used by B2–B4):**
```ts
interface EngagementDate {
  show_date_id: string; date: string; venue: string | null; city: string | null;
  sessions: string[]; duration_min: number | null; // NEW
}
interface SessionOverride { sessions?: string[]; duration_min?: number | null }
// synced defaults (from the show_date) merged with an optional wizard override
function resolveEngagementSessions(
  synced: { sessions: string[]; duration_min: number | null },
  override: SessionOverride | undefined,
): { sessions: string[]; duration_min: number | null }
```

- [ ] **Step 1: Failing test** — `src/lib/hireOrders/engagementDates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveEngagementSessions } from "./engagementDates";

describe("resolveEngagementSessions", () => {
  const synced = { sessions: ["19:00", "21:00"], duration_min: 90 };
  it("uses synced values when there is no override", () => {
    expect(resolveEngagementSessions(synced, undefined)).toEqual(synced);
  });
  it("lets an override replace sessions and/or duration", () => {
    expect(resolveEngagementSessions(synced, { sessions: ["20:00"] })).toEqual({ sessions: ["20:00"], duration_min: 90 });
    expect(resolveEngagementSessions(synced, { duration_min: 120 })).toEqual({ sessions: ["19:00", "21:00"], duration_min: 120 });
  });
  it("treats an empty override sessions array as an explicit clear", () => {
    expect(resolveEngagementSessions(synced, { sessions: [] })).toEqual({ sessions: [], duration_min: 90 });
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** `engagementDates.ts`:

```ts
export interface SessionOverride {
  sessions?: string[];
  duration_min?: number | null;
}

/** Merge a show_date's synced running order with an optional wizard override.
 *  `sessions`/`duration_min` are each overridden only when present on the
 *  override (an empty `sessions` array is an explicit clear, not "absent"). */
export function resolveEngagementSessions(
  synced: { sessions: string[]; duration_min: number | null },
  override: SessionOverride | undefined,
): { sessions: string[]; duration_min: number | null } {
  return {
    sessions: override && override.sessions !== undefined ? override.sessions : synced.sessions,
    duration_min: override && override.duration_min !== undefined ? override.duration_min : synced.duration_min,
  };
}
```

- [ ] **Step 4: Extend `EngagementDate`** in both `src/lib/hireOrders/types.ts` and `supabase/functions/_shared/hireOrders.ts` with `sessions: string[]` and `duration_min: number | null`. Update the edge PDF's `engagementDatesOf` validator (Task B3) to accept the richer shape (tolerate legacy rows lacking the fields by defaulting `sessions: []`, `duration_min: null`).

- [ ] **Step 5: Mirror** `resolveEngagementSessions` into the edge twin + a Deno mirror test.

- [ ] **Step 6: Run** `npx vitest run src/lib/hireOrders/engagementDates.test.ts` + the Deno test → pass; `npm run lint`, `npx tsc --noEmit`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/hireOrders/types.ts src/lib/hireOrders/engagementDates.ts src/lib/hireOrders/engagementDates.test.ts supabase/functions/_shared/hireOrders.ts supabase/functions/_shared/hireOrders.test.ts
git commit -m "add per-date sessions/duration to EngagementDate + merge helper (dual-home)"
```

---

### Task B2: `draft-batch` assembles per-date sessions + accepts overrides

**Files:**
- Modify: `supabase/functions/generate-hire-orders/index.ts` — `DraftBatchBody` (~806), `draftBatch` validation (~845), `draftBatchArtist` (~1001-1095).
- Test: `supabase/functions/generate-hire-orders/index.di.test.ts`

**Interfaces consumed:** `resolveEngagementSessions`, `EngagementDate` (B1).

Changes:
- `DraftBatchBody` gains optional `date_overrides?: Record<string, { sessions?: string[]; duration_min?: number | null }>`.
- Validate `date_overrides`: keys are canonical UUIDs of selected dates; each `sessions` an array of ≤3 trimmed non-empty strings; `duration_min` a finite `>= 0` number or null, else `return json({ error: "invalid_date_override" }, 400)` (mirror the `invalid_fee` posture).
- In `draftBatchArtist`, build each `EngagementDate` with `resolveEngagementSessions({ sessions: dateSessions, duration_min: date.duration_minutes }, overrides[date.id])`. `dateSessions` = that date's non-empty `session_1..3`.
- Keep top-level `data.sessions`/`duration_min` = the FIRST date's resolved values (single-date + back-compat).

- [ ] **Step 1: Failing Deno test** — a batch over two dates with different `session_1..3` produces `engagement_dates` whose two entries carry **distinct** `sessions`; a `date_overrides` entry replaces one date's sessions; a malformed override (4 sessions, or a negative duration) returns 400.

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** per the change list.
- [ ] **Step 4: Run edge suite → pass; lint.**
- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-hire-orders/index.ts supabase/functions/generate-hire-orders/index.di.test.ts
git commit -m "assemble per-date sessions in draft-batch with optional overrides"
```

---

### Task B3: PDF renders a per-date running order for aggregates

**Files:**
- Modify: `supabase/functions/_shared/hire-order-pdf/render.tsx` — `engagementDatesOf` (~300-311) to carry `sessions`/`duration_min`; the running-order + engagement-dates JSX (read the section that renders `sessions` rows and the `engagementDateRow` block).
- Test: `supabase/functions/_shared/hire-order-pdf/render.test.ts`

**Rule (from spec):** `isAggregate = engagementDates.length > 1`. When aggregate, render each date's own running order beneath its date/venue/city line from `EngagementDate.sessions`, and **suppress** the shared top-level running-order table. When 0 or 1 engagement date, render exactly as today (single top-level running order).

- [ ] **Step 1: Failing renderer test** — extend `render.test.ts`: an aggregate with two dates whose `sessions` differ produces a PDF containing both dates' distinct times (assert via the existing text-extraction assertion helper the file already uses for "engagement dates render before the running order"); a single-date order still renders the one top-level running order unchanged.

- [ ] **Step 2: Run, verify fail** — `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/hire-order-pdf/render.test.ts`

- [ ] **Step 3: Implement** — update `engagementDatesOf` to read `sessions`/`duration_min` (default `[]`/`null` for legacy rows). In the JSX, when `isAggregate`, for each engagement date render its date/venue/city row followed by its Call/Time rows (reuse `s.tableRow`/`s.colCall`/`s.colTime`/`s.cellLabel`/`s.cellTime`); gate the existing single running-order `View` on `!isAggregate`.

- [ ] **Step 4: Run renderer test → pass.**
- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/hire-order-pdf/render.tsx supabase/functions/_shared/hire-order-pdf/render.test.ts
git commit -m "render a per-date running order for aggregate hire orders"
```

---

### Task B4: Wizard step 3 becomes a per-date running order

**Files:**
- Modify: `src/components/hireOrders/NewOrderWizard.tsx` — the step-3 (`Running order`) block (~729-765), state (`manualSessions`, `batchScheduleSourceDateId`, `syncBatchSchedule`), and `draftBody()` (~389-406).
- Modify: `src/data/hireOrders.ts` — confirm `ShowDateLite` exposes `duration_minutes` (it does) + `sessions` (it does).
- Test: `src/components/hireOrders/NewOrderWizard.test.tsx`

Behavior:
- **Linked mode:** step 3 shows one section per selected date (header = date label), each pre-filled from that date's `sessions` + `duration_min` (from `useShowDatesLite`). Reuse the existing session-row controls (label + `type="time"`, add/remove, max 3) scoped per date. Keep manual-mode's single running order unchanged.
- Track per-date edits in state keyed by `show_date_id`; on submit, include only **edited** dates in `date_overrides` on the `draft-batch` body.
- Step-4 review lists each date with its resolved sessions.

- [ ] **Step 1: Failing component test** — selecting two dates renders two running-order sections pre-filled from each date's synced sessions; editing one date's time and submitting sends a `draft-batch` body whose `date_overrides` contains only that date; untouched dates are absent from `date_overrides`.

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — replace the single `manualSessions`/`batchScheduleSourceDateId` machinery for linked mode with a `Record<showDateId, SessionRow[]>` seeded from `useShowDatesLite`; diff against the synced baseline on submit to build `date_overrides`. Manual mode keeps the current single editor + `draft-manual` path.
- [ ] **Step 4: Run tests + lint + tsc → pass.**
- [ ] **Step 5: Commit**

```bash
git add src/components/hireOrders/NewOrderWizard.tsx src/data/hireOrders.ts src/components/hireOrders/NewOrderWizard.test.tsx
git commit -m "wizard: per-date running order for linked dates, prefilled and editable"
```

---

## Phase C — Migration-drift CI guard

### Task C1: `diffMigrations` pure function

**Files:**
- Create: `scripts/check-migrations.mjs`
- Create (test): `scripts/check-migrations.test.mjs` (Vitest picks up `.mjs`? — use `scripts/check-migrations.test.ts` importing the `.mjs`, or add `include` glob. Simplest: write the pure fn in `scripts/check-migrations.mjs` and test it from `scripts/check-migrations.test.mjs`; confirm `vitest.config` `include` covers `scripts/`.)

- [ ] **Step 1: Confirm test discovery** — check `vitest.config.ts`/`vite.config.ts` `test.include`. If it does not cover `scripts/`, add `"scripts/**/*.test.{ts,mjs}"`.

- [ ] **Step 2: Failing test** — `scripts/check-migrations.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { diffMigrations, repoNameFromFilename } from "./check-migrations.mjs";

describe("repoNameFromFilename", () => {
  it("strips the version prefix and .sql suffix", () => {
    expect(repoNameFromFilename("20260724120000_hire_order_dates_and_delivery.sql")).toBe("hire_order_dates_and_delivery");
    expect(repoNameFromFilename("00000000000000_local_extensions.sql")).toBe("local_extensions");
  });
});

describe("diffMigrations", () => {
  it("returns [] when every repo name is applied (drift-tolerant: version ignored)", () => {
    expect(diffMigrations(["a", "b"], new Set(["a", "b", "extra"]))).toEqual([]);
  });
  it("returns the repo names missing from the applied set", () => {
    expect(diffMigrations(["a", "b", "c"], new Set(["a"]))).toEqual(["b", "c"]);
  });
});
```

- [ ] **Step 3: Run, verify fail.**

- [ ] **Step 4: Implement the pure part** in `scripts/check-migrations.mjs`:

```js
// Detect repo migrations not yet applied to production. Name-based (drift-tolerant):
// production's recorded versions drift from repo filenames by seconds, but names
// are preserved. See docs/superpowers/specs/2026-07-24-*.md, Feature C.

/** `<version>_<name>.sql` -> `<name>`. */
export function repoNameFromFilename(filename) {
  return filename.replace(/^[0-9]+_/, "").replace(/\.sql$/, "");
}

/** Repo migration names absent from the applied-name set, in order. */
export function diffMigrations(repoNames, appliedNames) {
  return repoNames.filter((n) => !appliedNames.has(n));
}
```

- [ ] **Step 5: Run, verify pass.**
- [ ] **Step 6: Commit**

```bash
git add scripts/check-migrations.mjs scripts/check-migrations.test.mjs vitest.config.ts
git commit -m "add pure migration-diff helpers for the CI drift guard"
```

---

### Task C2: Network wrapper (reads applied migrations via the Management API)

**Files:**
- Modify: `scripts/check-migrations.mjs` (add the `main()` runner; keep pure fns exported)

- [ ] **Step 1: Implement the runner** (no unit test — exercised by the workflow; keep it thin so all logic lives in the tested pure fns):

```js
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

async function fetchAppliedNames(ref, token) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "select name from supabase_migrations.schema_migrations" }),
  });
  if (!res.ok) throw new Error(`Management API query failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return new Set(rows.map((r) => r.name).filter((n) => typeof n === "string" && n.length > 0));
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF || "epweartpzwvcasrzyueh";
  if (!token) { console.error("SUPABASE_ACCESS_TOKEN is required"); process.exit(2); }

  const migDir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
  const repoNames = readdirSync(migDir).filter((f) => f.endsWith(".sql")).map(repoNameFromFilename);
  const applied = await fetchAppliedNames(ref, token);
  const missing = diffMigrations(repoNames, applied);

  if (missing.length > 0) {
    console.error(`::error::${missing.length} migration(s) merged but NOT applied to production:`);
    for (const n of missing) console.error(`  - ${n}`);
    console.error("Apply them (Supabase MCP apply_migration or supabase db push), then re-run.");
    process.exit(1);
  }
  console.log(`All ${repoNames.length} repo migrations are applied to production.`);
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
```

- [ ] **Step 2: Manual smoke** (optional, needs a token locally): `SUPABASE_ACCESS_TOKEN=… node scripts/check-migrations.mjs` → prints "All N repo migrations are applied".
- [ ] **Step 3: Run the unit test again** (ensure the `import.meta`/`main` guard didn't break the import) → pass.
- [ ] **Step 4: Commit**

```bash
git add scripts/check-migrations.mjs
git commit -m "add production migration-drift checker runner (Management API, existing token)"
```

---

### Task C3: The workflow

**Files:**
- Create: `.github/workflows/check-migrations.yml`

- [ ] **Step 1: Implement**:

```yaml
name: Check migrations applied

# Fails when a migration merged to main has NOT been applied to production.
# Detect-only (never auto-applies). Name-based, drift-tolerant. Uses the same
# SUPABASE_ACCESS_TOKEN secret as deploy-functions.yml — no new secret.
on:
  push:
    branches: [main]
    paths: ["supabase/migrations/**"]
  workflow_dispatch: {}

jobs:
  check-migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Check every repo migration is applied to production
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_PROJECT_REF: epweartpzwvcasrzyueh
        run: node scripts/check-migrations.mjs
```

- [ ] **Step 2: Validate YAML** — `npx --yes js-yaml .github/workflows/check-migrations.yml >/dev/null` (or rely on the PR's own Actions lint). 
- [ ] **Step 3: Commit**

```bash
git add .github/workflows/check-migrations.yml
git commit -m "add CI guard that fails when a merged migration is unapplied in prod"
```

---

## Phase D — Release

### Task D1: Version bump + changelog

**Files:**
- Modify: `package.json` (`version` → `1.12.0`)
- Modify: `src/config/app.config.ts` (`APP_META.VERSION` → `1.12.0`)
- Modify: `public/changelog.md` (new newest-first block)
- Regenerate: `public/changelog.json`

- [ ] **Step 1: Bump** both version strings to `1.12.0`.
- [ ] **Step 2: Add changelog block** (customer-facing; no em/en dashes; no super-admin mentions):

```markdown
## 1.12.0 — Jul 24, 2026

*Hire orders: your own terms templates and per-date running orders*

### New
- **Name your own terms templates** — Rename, add, and remove the terms templates on your hire orders in Settings > Hire orders. Pick a default that new orders start from.
- **Per-date running orders** — When a hire order covers several dates, each date now carries its own session times, pulled from the synced event and editable in the new-order wizard.
```

- [ ] **Step 3: Regenerate JSON** — `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
- [ ] **Step 4: Commit**

```bash
git add package.json src/config/app.config.ts public/changelog.md public/changelog.json
git commit -m "release 1.12.0: terms templates + per-date sessions"
```

---

## Final verification (before opening the PR)

- [ ] `npm run lint` → 0 warnings
- [ ] `npx tsc --noEmit` → clean
- [ ] `npx vitest run` → all green
- [ ] `deno test --allow-all --node-modules-dir=none supabase/functions/` → all green
- [ ] Manual: create a multi-date linked order in the wizard (now that the prod RPC exists) → distinct per-date sessions on the PDF; rename a terms template in settings → order picker reflects the new name, existing issued orders unchanged.
- [ ] Open the PR against `main` with a summary linking the spec.

## Self-review notes (author)
- Spec coverage: A→A1-A5, B→B1-B4, C→C1-C3, release→D1. All spec sections mapped.
- The dual-home mirror (`src/lib/hireOrders` ↔ `_shared/hireOrders.ts`) is touched in A1 and B1 — both edits in the same commit as required.
- `terms_variant` stays `text`; `engagement_dates` stays in `data` — no migration added (Global Constraints honored).
