# Hire Order Setup Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an org that has just switched the hire-orders module on a persistent readiness rail beside the working `/hire-orders` page, so letterhead, terms and the countersign decision are set from there, through the same write path as the Settings cards, and the org reaches its first issuable order without opening Settings.

**Architecture:** Three settings cards are split into a shared presentational field component plus a thin shell, so the Settings card and the rail step render the same fields over the same `upsertOrgSetting` call. A new pure module derives org-level setup status from the resolved settings; it is deliberately separate from the per-order `orderReadyIssues` rule, which is unchanged and stays authoritative. Starter terms ship as a code constant behind a platform-only `app_settings` key, and an org imports a copy rather than inheriting, so a later platform edit can never change contract text an org is already issuing.

**Tech Stack:** React 18 + TypeScript, Vite 5, TanStack Query v5, Tailwind + shadcn/ui, Vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-06-hire-order-onboarding-design.md` sections 1, 2, 3, 4, 6, 7.

**Follow-on:** `docs/superpowers/plans/2026-08-06-hire-order-issue-preflight.md` covers spec sections 5 and 8 (per-order blockers, artist signing surface). It depends on Task 4 and Task 7 of this plan and should land after it.

## Global Constraints

- **`any` is banned.** Lint runs `--max-warnings 0`. Where supabase-js cannot infer a joined-row shape, declare a local row `interface` and cast once at the query result with `as unknown as Row[]`, immediately after the error check. Never per-site `as any`.
- **No em dashes or en dashes in product copy** (UI strings, changelog, the starter terms text). Use a period, comma, colon or middot. Arrows are fine.
- **Semantic design tokens only.** `bg-background`, `text-foreground`, `border-border`. Never `bg-white`. Accent numbered stops (`accent-50` to `accent-900`) are plain hex and **do not support Tailwind opacity modifiers** such as `bg-accent-500/20`, which silently yields a solid colour.
- **Test-first.** Write the failing test, run it, watch it fail, then implement.
- **Tests import the real module.** Never re-implement production logic inside a test file.
- **No `vi.mock('@/integrations/supabase/client')` chains.** Use `createFakeSupabase` from `src/test/supabaseFake.ts` and the `vi.hoisted` client-swap idiom already used in `src/components/settings/hireOrders/LetterheadCard.test.tsx`.
- **No migration, no edge-function change, no mirror change in this plan.** If a task appears to need one, stop and re-read the spec: §2.4 explains why none is required. In particular do **not** add functions to `src/lib/hireOrders/terms.ts`, which is a hand-maintained mirror of `supabase/functions/_shared/hireOrders.ts`.
- **Ships dark.** Everything sits behind the `hire_orders` entitlement, which defaults off.
- Run all commands from the repo root: `/Users/stefanschaal/Claude Code/showflow-pro/.claude/worktrees/booking-engine-ui-ux-09cbf4`.

### Command reference

| Purpose | Command |
|---|---|
| One vitest file | `npx vitest run <path>` |
| All vitest | `npx vitest run` |
| Type check (app) | `npx tsc -p tsconfig.app.json --noEmit` |
| Lint gate | `npm run lint` |
| Dev server | Use the `preview_start` browser tool, never `npm run dev` in a shell |

---

## File Structure

### New pure modules (`src/lib/hireOrders/`)

| File | Responsibility |
|---|---|
| `starterTerms.ts` | `HIRE_ORDER_STARTER_TERMS`, the code fallback for the platform terms library |
| `setupStatus.ts` | `computeSetupStatus`: org-level readiness from resolved settings |
| `termsImport.ts` | `mergeTermsTemplates`: append library templates to an org's terms, never replace |
| `letterhead.ts` | `linesFromText` / `serializeLines`, moved out of `LetterheadCard.tsx` |

### Changed data layer

| File | Change |
|---|---|
| `src/data/settings.ts` | add `hasOrgSettingRow` |
| `src/data/hireOrders.ts` | add `fetchTermsLibrary`, `importTermsTemplates` |

### Settings extraction (`src/components/settings/hireOrders/`)

| File | Responsibility |
|---|---|
| `fields/LetterheadFields.tsx` | NEW. The three shared letterhead fields, fully controlled, with a `children` slot for the Settings-only agent block |
| `fields/CountersignFields.tsx` | NEW. The mode radio group, fully controlled |
| `fields/TermsLibraryPicker.tsx` | NEW. Multi-select over the platform library |
| `LetterheadCard.tsx` | MOD. Shell over `LetterheadFields` + its agent block as children |
| `CountersignCard.tsx` | MOD. Shell over `CountersignFields`, new labels |
| `TermsVariantsCard.tsx` | MOD. Gains an "Import from library" section |

### Rail (`src/components/hireOrders/setup/`)

| File | Responsibility |
|---|---|
| `SetupRail.tsx` | The rail card: header, progress, three step rows, one expanded panel |
| `SetupStepRow.tsx` | One collapsed row: number or tick, title, hint, optional "Blocks issue" chip |
| `LetterheadStep.tsx` | Expanded panel: `LetterheadFields` + Confirm, with the merge-on-save rule |
| `TermsStep.tsx` | Expanded panel: `TermsLibraryPicker` + Import |
| `CountersignStep.tsx` | Expanded panel: `CountersignFields` + Save |
| `ProducerWaitingCard.tsx` | The no-capability variant |
| `useRailDismissed.ts` | localStorage dismissal, keyed per org |

### Hooks and pages

| File | Change |
|---|---|
| `src/hooks/useHireOrderSetup.ts` | NEW. `useHireOrderSetupStatus`, `useTermsLibrary`, `useImportTermsTemplates` |
| `src/components/platform/PlatformDefaultsTab.tsx` | MOD. Adds `HireOrderTermsLibraryCard` |
| `src/pages/HireOrdersPage.tsx` | MOD. Two-column layout, mounts the rail, empty-state pointer |

---

## Task 1: Starter terms library constant

**Files:**
- Create: `src/lib/hireOrders/starterTerms.ts`
- Test: `src/lib/hireOrders/starterTerms.test.ts`

**Interfaces:**
- Consumes: `HireOrderTemplate` from `src/lib/hireOrders/terms.ts`
- Produces: `HIRE_ORDER_STARTER_TERMS: HireOrderTemplate[]`, two templates with ids `platform-standard-engagement` and `platform-guest-per-session`

- [ ] **Step 1: Write the failing test**

Create `src/lib/hireOrders/starterTerms.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { HIRE_ORDER_STARTER_TERMS } from "./starterTerms";

describe("HIRE_ORDER_STARTER_TERMS", () => {
  it("ships two templates with platform-prefixed ids", () => {
    expect(HIRE_ORDER_STARTER_TERMS.map((t) => t.id)).toEqual([
      "platform-standard-engagement",
      "platform-guest-per-session",
    ]);
  });

  // The bare ids "lean" / "standard" / "full" are rewritten by the legacy branch in
  // normalizeTermsSetting, so a library id must never collide with them.
  it("uses no legacy template id", () => {
    const legacy = new Set(["lean", "standard", "full"]);
    for (const t of HIRE_ORDER_STARTER_TERMS) expect(legacy.has(t.id)).toBe(false);
  });

  it("gives every template at least one clause, each with a title and a body", () => {
    for (const t of HIRE_ORDER_STARTER_TERMS) {
      expect(t.clauses.length).toBeGreaterThan(0);
      for (const c of t.clauses) {
        expect(c.title.trim()).not.toBe("");
        expect(c.body.trim()).not.toBe("");
      }
    }
  });

  it("uses no em dash or en dash anywhere (house copy rule)", () => {
    const text = HIRE_ORDER_STARTER_TERMS
      .flatMap((t) => [t.name, ...t.clauses.flatMap((c) => [c.title, c.body])])
      .join(" ");
    expect(text).not.toMatch(/[–—]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hireOrders/starterTerms.test.ts`
Expected: FAIL, cannot resolve `./starterTerms`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/hireOrders/starterTerms.ts`:

```ts
import type { HireOrderTemplate } from "./terms";

/**
 * Code fallback for the platform terms library (`hire_order_terms_library`), the
 * catalogue an org imports a COPY of into its own `hire_order_terms`. It is not a
 * platform default on `hire_order_terms`: silent inheritance would let a later
 * platform edit change contract text an org is already issuing (spec §2.1).
 *
 * Ids are `platform-` prefixed on purpose. Orders persist `terms_variant` as a
 * free-form id, and the bare ids "lean" / "standard" / "full" are rewritten by the
 * legacy branch in `normalizeTermsSetting`.
 *
 * The wording below is a product-agnostic drafting starting point and has not had
 * legal review. Treat sign-off as a release gate; no code path depends on it.
 */
export const HIRE_ORDER_STARTER_TERMS: HireOrderTemplate[] = [
  {
    id: "platform-standard-engagement",
    name: "Standard engagement",
    clauses: [
      {
        title: "Engagement",
        body: "The artist is engaged for the dates, venue and sessions set out on this order. Call and performance times may move by up to 60 minutes with reasonable notice. A change of date or venue requires the artist's agreement.",
      },
      {
        title: "Fee and payment",
        body: "The fee stated on this order is gross and covers rehearsal and performance for the dates listed. It is payable within 14 days of the final engagement date, against an invoice where one is required.",
      },
      {
        title: "Cancellation",
        body: "Either party may cancel without fee up to 21 days before the first engagement date. After that point the full fee remains payable, unless the artist is replaced by agreement between the parties.",
      },
      {
        title: "Travel and lodging",
        body: "Travel and lodging are carried by the production unless this order states otherwise.",
      },
      {
        title: "Recording and publicity",
        body: "The production may photograph and record the engagement for archive and promotional use. Commercial exploitation beyond that requires a separate written agreement.",
      },
      {
        title: "Illness and force majeure",
        body: "If the artist cannot appear through illness, or through an event outside the control of either party, the parties will agree a replacement or an adjusted fee in good faith. Notice must be given as soon as the situation is known.",
      },
      {
        title: "Governing law",
        body: "This engagement is governed by the law of the country in which the hiring party is registered.",
      },
    ],
  },
  {
    id: "platform-guest-per-session",
    name: "Guest artist, per session",
    clauses: [
      {
        title: "Engagement",
        body: "The artist is engaged as a guest for the sessions listed on this order. Each session is booked and paid for separately. Sessions added later require a new order.",
      },
      {
        title: "Fee and payment",
        body: "The fee stated is per session and is payable within 14 days of the final session, against an invoice where one is required. A session cancelled by the production inside the notice period below is treated as performed.",
      },
      {
        title: "Cancellation",
        body: "Either party may cancel a session without fee up to 14 days before it takes place. Inside 14 days the session fee remains payable.",
      },
      {
        title: "Travel and lodging",
        body: "Travel and lodging for guest artists are carried by the production, and booked by the production unless agreed otherwise in advance.",
      },
      {
        title: "Recording and publicity",
        body: "The production may photograph and record the sessions for archive and promotional use. Commercial exploitation beyond that requires a separate written agreement.",
      },
      {
        title: "Governing law",
        body: "This engagement is governed by the law of the country in which the hiring party is registered.",
      },
    ],
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hireOrders/starterTerms.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hireOrders/starterTerms.ts src/lib/hireOrders/starterTerms.test.ts
git commit -m "add the platform hire-order terms starter library"
```

---

## Task 2: `hasOrgSettingRow`

`resolveOrgSetting` returns a value but not its provenance, so it cannot tell an explicit countersign choice from an inherited `COUNTERSIGN_DEFAULT`. The rail needs that distinction.

**Files:**
- Modify: `src/data/settings.ts` (append after `upsertOrgSetting`, around line 93)
- Test: `src/data/settings.test.ts`

**Interfaces:**
- Produces: `hasOrgSettingRow(client: SupabaseClient<Database>, orgId: string | null, key: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Append to `src/data/settings.test.ts`:

```ts
import { hasOrgSettingRow } from "./settings";

describe("hasOrgSettingRow", () => {
  it("is true when the org has its own row for the key", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ key: "hire_order_countersign" }], error: null },
    });
    expect(await hasOrgSettingRow(fake as never, "org-1", "hire_order_countersign")).toBe(true);
    expect(fake.calls).toContainEqual({ table: "app_settings", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "app_settings", method: "eq", args: ["key", "hire_order_countersign"] });
  });

  it("is false when only a platform default exists (no org row comes back)", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    expect(await hasOrgSettingRow(fake as never, "org-1", "hire_order_countersign")).toBe(false);
  });

  it("is false without querying when there is no org", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [{ key: "x" }], error: null } });
    expect(await hasOrgSettingRow(fake as never, null, "hire_order_countersign")).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: { message: "boom" } } });
    await expect(hasOrgSettingRow(fake as never, "org-1", "k")).rejects.toBeTruthy();
  });
});
```

If `src/data/settings.test.ts` does not already import `createFakeSupabase` and the vitest globals, add at the top:

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/settings.test.ts`
Expected: FAIL, `hasOrgSettingRow` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/data/settings.ts`:

```ts
/**
 * Whether the org has ITS OWN row for `key`, as opposed to inheriting the platform
 * default or a code fallback. `resolveOrgSetting` deliberately cannot answer this: it
 * returns a value, not its provenance. The setup rail needs the distinction, because
 * inheriting COUNTERSIGN_DEFAULT is not the same as an admin having chosen a mode.
 */
export async function hasOrgSettingRow(
  client: SupabaseClient<Database>,
  orgId: string | null,
  key: string,
): Promise<boolean> {
  if (!orgId) return false;
  const { data, error } = await client
    .from("app_settings")
    .select("key")
    .eq("key", key)
    .eq("org_id", orgId)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/settings.ts src/data/settings.test.ts
git commit -m "add hasOrgSettingRow to distinguish an org row from an inherited default"
```

---

## Task 3: `computeSetupStatus`

**Files:**
- Create: `src/lib/hireOrders/setupStatus.ts`
- Test: `src/lib/hireOrders/setupStatus.test.ts`

**Interfaces:**
- Consumes: `defaultTemplateId`, `resolveTermsClauses`, `HireOrderTermsSetting` from `./terms`
- Produces: `SetupStepKey`, `SetupStep`, `HireOrderSetupStatus`, `SetupStatusInput`, `computeSetupStatus(input: SetupStatusInput): HireOrderSetupStatus`

- [ ] **Step 1: Write the failing test**

Create `src/lib/hireOrders/setupStatus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeSetupStatus } from "./setupStatus";
import type { HireOrderTermsSetting } from "./terms";

const EMPTY_TERMS: HireOrderTermsSetting = { templates: [], default_id: null };
const REAL_TERMS: HireOrderTermsSetting = {
  templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "Payable in 14 days." }] }],
  default_id: "t1",
};

describe("computeSetupStatus", () => {
  it("reports nothing done on a fresh org", () => {
    const s = computeSetupStatus({ letterhead: null, terms: EMPTY_TERMS, countersignChosen: false });
    expect(s.steps.map((x) => x.key)).toEqual(["letterhead", "terms", "countersign"]);
    expect(s.steps.every((x) => !x.done)).toBe(true);
    expect(s.doneCount).toBe(0);
    expect(s.totalCount).toBe(3);
    expect(s.canIssue).toBe(false);
    expect(s.complete).toBe(false);
  });

  it("marks only letterhead and terms as blocking issue", () => {
    const s = computeSetupStatus({ letterhead: null, terms: EMPTY_TERMS, countersignChosen: false });
    expect(s.steps.filter((x) => x.blocksIssue).map((x) => x.key)).toEqual(["letterhead", "terms"]);
  });

  it("can issue once letterhead and terms are set, even with no countersign decision", () => {
    const s = computeSetupStatus({
      letterhead: { legal_name: "Aurora Productions GmbH" },
      terms: REAL_TERMS,
      countersignChosen: false,
    });
    expect(s.canIssue).toBe(true);
    expect(s.complete).toBe(false); // the decision is still outstanding
    expect(s.doneCount).toBe(2);
  });

  it("is complete only when the countersign decision is made too", () => {
    const s = computeSetupStatus({
      letterhead: { legal_name: "Aurora Productions GmbH" },
      terms: REAL_TERMS,
      countersignChosen: true,
    });
    expect(s.complete).toBe(true);
    expect(s.doneCount).toBe(3);
  });

  it("treats a whitespace-only legal name as missing", () => {
    const s = computeSetupStatus({ letterhead: { legal_name: "   " }, terms: REAL_TERMS, countersignChosen: true });
    expect(s.steps.find((x) => x.key === "letterhead")?.done).toBe(false);
    expect(s.canIssue).toBe(false);
  });

  // Matches the edge gate: issueOne pushes missing_terms when the RESOLVED variant has
  // no clauses, so templates that exist but are empty are not "done".
  it("treats templates that exist but have no clauses as missing", () => {
    const empty: HireOrderTermsSetting = {
      templates: [{ id: "t1", name: "Standard", clauses: [] }],
      default_id: "t1",
    };
    const s = computeSetupStatus({ letterhead: { legal_name: "X" }, terms: empty, countersignChosen: true });
    expect(s.steps.find((x) => x.key === "terms")?.done).toBe(false);
    expect(s.canIssue).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hireOrders/setupStatus.test.ts`
Expected: FAIL, cannot resolve `./setupStatus`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/hireOrders/setupStatus.ts`:

```ts
import { defaultTemplateId, resolveTermsClauses, type HireOrderTermsSetting } from "./terms";

export type SetupStepKey = "letterhead" | "terms" | "countersign";

export interface SetupStep {
  key: SetupStepKey;
  done: boolean;
  /** Whether leaving this undone makes the `issue` action fail. */
  blocksIssue: boolean;
}

export interface HireOrderSetupStatus {
  /** Always all three steps, in rail order. */
  steps: SetupStep[];
  doneCount: number;
  totalCount: number;
  /** Every BLOCKING step is done: the org can issue. */
  canIssue: boolean;
  /** Every step is done, blocking or not: the rail can retire. */
  complete: boolean;
}

export interface SetupStatusInput {
  /** The org's resolved `hire_order_letterhead`. */
  letterhead: { legal_name?: string | null } | null | undefined;
  /** The org's resolved and normalized `hire_order_terms`. */
  terms: HireOrderTermsSetting;
  /** Whether the org has its OWN `hire_order_countersign` row (see hasOrgSettingRow).
   *  Inheriting the manual default is not a decision. */
  countersignChosen: boolean;
}

/**
 * Org-level setup readiness, for the hire-order setup rail.
 *
 * Deliberately SEPARATE from `orderReadyIssues` (./validate.ts), which answers a
 * different question about a single order and is mirrored to the edge runtime as the
 * authoritative gate. This module is client-only and drives a UI affordance. The two
 * overlap on letterhead alone, and the letterhead rule below must keep matching
 * `missing_letterhead` there.
 */
const STEP_ORDER: Array<{ key: SetupStepKey; blocksIssue: boolean }> = [
  { key: "letterhead", blocksIssue: true },
  { key: "terms", blocksIssue: true },
  // Manual mode issues perfectly well, so an undecided countersign mode never blocks.
  { key: "countersign", blocksIssue: false },
];

function letterheadDone(letterhead: SetupStatusInput["letterhead"]): boolean {
  const name = letterhead?.legal_name;
  return typeof name === "string" && name.trim() !== "";
}

function termsDone(terms: HireOrderTermsSetting): boolean {
  return resolveTermsClauses(terms, defaultTemplateId(terms)).length > 0;
}

export function computeSetupStatus(input: SetupStatusInput): HireOrderSetupStatus {
  const done: Record<SetupStepKey, boolean> = {
    letterhead: letterheadDone(input.letterhead),
    terms: termsDone(input.terms),
    countersign: input.countersignChosen,
  };
  const steps = STEP_ORDER.map(({ key, blocksIssue }) => ({ key, done: done[key], blocksIssue }));
  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    totalCount: steps.length,
    canIssue: steps.every((s) => !s.blocksIssue || s.done),
    complete: steps.every((s) => s.done),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hireOrders/setupStatus.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hireOrders/setupStatus.ts src/lib/hireOrders/setupStatus.test.ts
git commit -m "derive org-level hire-order setup status"
```

---

## Task 4: Terms import merge and the library data path

**Files:**
- Create: `src/lib/hireOrders/termsImport.ts`
- Test: `src/lib/hireOrders/termsImport.test.ts`
- Modify: `src/data/hireOrders.ts` (append at end of file)
- Test: `src/data/hireOrders.test.ts` (append)

**Interfaces:**
- Consumes: `HIRE_ORDER_STARTER_TERMS` (Task 1), `resolveOrgSetting` / `upsertOrgSetting` from `@/data/settings`
- Produces:
  - `mergeTermsTemplates(current: HireOrderTermsSetting, incoming: HireOrderTemplate[]): HireOrderTermsSetting`
  - `TERMS_LIBRARY_KEY = "hire_order_terms_library"`
  - `fetchTermsLibrary(client): Promise<HireOrderTemplate[]>`
  - `importTermsTemplates(client, args: { orgId: string; current: HireOrderTermsSetting; templates: HireOrderTemplate[] }): Promise<HireOrderTermsSetting>`

- [ ] **Step 1: Write the failing merge test**

Create `src/lib/hireOrders/termsImport.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeTermsTemplates } from "./termsImport";
import type { HireOrderTemplate, HireOrderTermsSetting } from "./terms";

const LIB: HireOrderTemplate[] = [
  { id: "platform-standard-engagement", name: "Standard engagement", clauses: [{ title: "Fee", body: "14 days." }] },
  { id: "platform-guest-per-session", name: "Guest artist, per session", clauses: [{ title: "Fee", body: "Per session." }] },
];

describe("mergeTermsTemplates", () => {
  it("imports into an empty org and adopts the first imported template as default", () => {
    const next = mergeTermsTemplates({ templates: [], default_id: null }, LIB);
    expect(next.templates.map((t) => t.id)).toEqual(["platform-standard-engagement", "platform-guest-per-session"]);
    expect(next.default_id).toBe("platform-standard-engagement");
  });

  it("appends rather than replacing the org's own templates", () => {
    const current: HireOrderTermsSetting = {
      templates: [{ id: "own", name: "House terms", clauses: [{ title: "A", body: "B" }] }],
      default_id: "own",
    };
    const next = mergeTermsTemplates(current, LIB);
    expect(next.templates.map((t) => t.id)).toEqual([
      "own",
      "platform-standard-engagement",
      "platform-guest-per-session",
    ]);
  });

  it("keeps a default that already resolves to real clauses", () => {
    const current: HireOrderTermsSetting = {
      templates: [{ id: "own", name: "House terms", clauses: [{ title: "A", body: "B" }] }],
      default_id: "own",
    };
    expect(mergeTermsTemplates(current, LIB).default_id).toBe("own");
  });

  it("adopts the imported default when the org's own default has no clauses", () => {
    const current: HireOrderTermsSetting = {
      templates: [{ id: "own", name: "Empty", clauses: [] }],
      default_id: "own",
    };
    expect(mergeTermsTemplates(current, LIB).default_id).toBe("platform-standard-engagement");
  });

  it("is a no-op on re-import of an id the org already has", () => {
    const current = mergeTermsTemplates({ templates: [], default_id: null }, LIB);
    const again = mergeTermsTemplates(current, LIB);
    expect(again.templates).toHaveLength(2);
    expect(again).toEqual(current);
  });

  it("does not overwrite an org's edits to an imported template on re-import", () => {
    const edited: HireOrderTermsSetting = {
      templates: [{ id: "platform-standard-engagement", name: "Standard engagement", clauses: [{ title: "Fee", body: "OUR WORDING" }] }],
      default_id: "platform-standard-engagement",
    };
    const next = mergeTermsTemplates(edited, LIB);
    expect(next.templates[0].clauses[0].body).toBe("OUR WORDING");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hireOrders/termsImport.test.ts`
Expected: FAIL, cannot resolve `./termsImport`.

- [ ] **Step 3: Write the merge implementation**

Create `src/lib/hireOrders/termsImport.ts`:

```ts
import {
  defaultTemplateId,
  resolveTermsClauses,
  type HireOrderTemplate,
  type HireOrderTermsSetting,
} from "./terms";

/**
 * Append platform-library templates to an org's `hire_order_terms`.
 *
 * APPENDS, never replaces: an org that already authored its own templates must not
 * lose them by clicking Import. A template whose id the org already holds is skipped
 * entirely, so re-import is a no-op and never overwrites an org's edits to a template
 * it imported earlier.
 *
 * `default_id` is only moved when the org's current default resolves to no clauses,
 * that is, when the org is not yet issue-ready on terms. One import then makes it
 * ready; an org that already had usable terms keeps its own default.
 *
 * Lives here rather than in ./terms.ts, which is a hand-maintained mirror of
 * supabase/functions/_shared/hireOrders.ts. Nothing on the edge needs this.
 */
export function mergeTermsTemplates(
  current: HireOrderTermsSetting,
  incoming: HireOrderTemplate[],
): HireOrderTermsSetting {
  const held = new Set(current.templates.map((t) => t.id));
  const added = incoming.filter((t) => !held.has(t.id));
  const templates = [...current.templates, ...added];

  const currentIsUsable = resolveTermsClauses(current, defaultTemplateId(current)).length > 0;
  const default_id = currentIsUsable
    ? defaultTemplateId(current)
    : added[0]?.id ?? incoming[0]?.id ?? current.default_id;

  return { templates, default_id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hireOrders/termsImport.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing data test**

Append to `src/data/hireOrders.test.ts`:

```ts
import { fetchTermsLibrary, importTermsTemplates, TERMS_LIBRARY_KEY } from "./hireOrders";
import { HIRE_ORDER_STARTER_TERMS } from "@/lib/hireOrders/starterTerms";

describe("fetchTermsLibrary", () => {
  it("falls back to the code starter library when no platform row exists", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    expect(await fetchTermsLibrary(fake as never)).toEqual(HIRE_ORDER_STARTER_TERMS);
    expect(fake.calls).toContainEqual({ table: "app_settings", method: "eq", args: ["key", TERMS_LIBRARY_KEY] });
  });

  it("returns the platform row's templates when one exists", async () => {
    const templates = [{ id: "p1", name: "Custom", clauses: [{ title: "A", body: "B" }] }];
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: null, value: { templates } }], error: null },
    });
    expect(await fetchTermsLibrary(fake as never)).toEqual(templates);
  });

  it("falls back when the platform row is malformed", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: null, value: { templates: "nope" } }], error: null },
    });
    expect(await fetchTermsLibrary(fake as never)).toEqual(HIRE_ORDER_STARTER_TERMS);
  });
});

describe("importTermsTemplates", () => {
  it("upserts the merged setting onto hire_order_terms and returns it", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    const next = await importTermsTemplates(fake as never, {
      orgId: "org-1",
      current: { templates: [], default_id: null },
      templates: HIRE_ORDER_STARTER_TERMS,
    });
    expect(next.default_id).toBe("platform-standard-engagement");
    expect(fake.calls).toContainEqual({
      table: "app_settings",
      method: "upsert",
      args: [
        { org_id: "org-1", key: "hire_order_terms", value: next },
        { onConflict: "org_id,key" },
      ],
    });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/data/hireOrders.test.ts`
Expected: FAIL, `fetchTermsLibrary` is not exported.

- [ ] **Step 7: Write the data implementation**

Append to `src/data/hireOrders.ts`. Add the imports at the top of the file alongside the existing ones:

```ts
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { HIRE_ORDER_STARTER_TERMS } from "@/lib/hireOrders/starterTerms";
import { mergeTermsTemplates } from "@/lib/hireOrders/termsImport";
import type { HireOrderTemplate, HireOrderTermsSetting } from "@/lib/hireOrders/terms";
```

then append:

```ts
/** Platform-only app_settings key holding the terms catalogue orgs import FROM.
 *  Distinct from `hire_order_terms` on purpose (spec §2.1): an org gets a copy it
 *  owns, so a later platform edit never changes contract text already being issued. */
export const TERMS_LIBRARY_KEY = "hire_order_terms_library";

interface TermsLibraryValue {
  templates: HireOrderTemplate[];
}

/**
 * The platform terms library: the super-admin's row if one exists, else the code
 * starter set. Readable by any authenticated member because `org_isolation` on
 * app_settings admits `org_id is null` for SELECT.
 */
export async function fetchTermsLibrary(
  client: SupabaseClient<Database>,
): Promise<HireOrderTemplate[]> {
  const value = await resolveOrgSetting<TermsLibraryValue>(client, null, TERMS_LIBRARY_KEY, {
    templates: HIRE_ORDER_STARTER_TERMS,
  });
  return Array.isArray(value?.templates) ? value.templates : HIRE_ORDER_STARTER_TERMS;
}

/** Copy library templates into the org's own `hire_order_terms` and return the result. */
export async function importTermsTemplates(
  client: SupabaseClient<Database>,
  args: { orgId: string; current: HireOrderTermsSetting; templates: HireOrderTemplate[] },
): Promise<HireOrderTermsSetting> {
  const next = mergeTermsTemplates(args.current, args.templates);
  await upsertOrgSetting(client, args.orgId, "hire_order_terms", next as unknown as Json);
  return next;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/data/hireOrders.test.ts src/lib/hireOrders/termsImport.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/hireOrders/termsImport.ts src/lib/hireOrders/termsImport.test.ts src/data/hireOrders.ts src/data/hireOrders.test.ts
git commit -m "add the platform terms library read and the org import merge"
```

---

## Task 5: Extract `LetterheadFields` and the merge-safe save

The rail's letterhead panel shows a subset of the Settings card's fields. Saving that subset naively would null out `agent_name`, `agent_email` and `agent_signature_path`. This task extracts the shared fields and pins the merge rule with a regression test.

**Files:**
- Create: `src/lib/hireOrders/letterhead.ts`
- Test: `src/lib/hireOrders/letterhead.test.ts`
- Create: `src/components/settings/hireOrders/fields/LetterheadFields.tsx`
- Modify: `src/components/settings/hireOrders/LetterheadCard.tsx`

**Interfaces:**
- Produces: `linesFromText(text: string): string[]`, `serializeLines(lines: string[]): string`, `mergeLetterhead(stored: Letterhead | null, edits: Partial<Letterhead>): Letterhead`
- Produces: `LetterheadFields({ value, addressText, onChange, onAddressTextChange, readOnly, children })`
- Consumes (later tasks): `LetterheadStep` renders `LetterheadFields` with no `children` and saves through `mergeLetterhead`

- [ ] **Step 1: Write the failing merge test**

Create `src/lib/hireOrders/letterhead.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { linesFromText, serializeLines, mergeLetterhead } from "./letterhead";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";

describe("linesFromText", () => {
  it("trims trailing whitespace per line and drops leading and trailing blanks", () => {
    expect(linesFromText("\nStreet 1  \n\n10999 Berlin \n\n")).toEqual(["Street 1", "", "10999 Berlin"]);
  });
  it("round-trips through serializeLines", () => {
    expect(linesFromText(serializeLines(["A", "B"]))).toEqual(["A", "B"]);
  });
});

describe("mergeLetterhead", () => {
  const stored: Letterhead = {
    legal_name: "Aurora Productions GmbH",
    address_lines: ["Street 1"],
    registration_line: "HRB 1",
    agent_name: "Katrin Behrens",
    agent_email: "katrin@example.com",
    agent_signature_path: "org-1/agent-signature.png",
  };

  // The whole point of this module: the rail edits three fields and must not erase the
  // three it never renders.
  it("preserves agent fields the compact form never renders", () => {
    const next = mergeLetterhead(stored, {
      legal_name: "Aurora Productions AG",
      address_lines: ["Street 2"],
      registration_line: "HRB 2",
    });
    expect(next.agent_name).toBe("Katrin Behrens");
    expect(next.agent_email).toBe("katrin@example.com");
    expect(next.agent_signature_path).toBe("org-1/agent-signature.png");
    expect(next.legal_name).toBe("Aurora Productions AG");
    expect(next.address_lines).toEqual(["Street 2"]);
  });

  it("allows an explicit clear of an agent field", () => {
    expect(mergeLetterhead(stored, { agent_signature_path: null }).agent_signature_path).toBeNull();
  });

  it("falls back to the blank default when nothing is stored", () => {
    const next = mergeLetterhead(null, { legal_name: "New GmbH" });
    expect(next.legal_name).toBe("New GmbH");
    expect(next.address_lines).toEqual([]);
    expect(next.agent_signature_path).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hireOrders/letterhead.test.ts`
Expected: FAIL, cannot resolve `./letterhead`.

- [ ] **Step 3: Write the pure module**

Create `src/lib/hireOrders/letterhead.ts`:

```ts
import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";

/** One address line per row. On SAVE only: trim trailing whitespace per line (leading
 *  indentation and interior blanks preserved), then drop empty lines from the top and
 *  bottom so a stray leading or trailing Enter is not stored.
 *  Moved verbatim out of LetterheadCard.tsx so the rail step can reuse it. */
export function linesFromText(text: string): string[] {
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start++;
  while (end > start && lines[end - 1] === "") end--;
  return lines.slice(start, end);
}

export function serializeLines(lines: string[]): string {
  return lines.join("\n");
}

/**
 * Merge partial letterhead edits onto the stored value.
 *
 * The setup rail renders only legal name, address and registration line. Saving that
 * object on its own would erase `agent_name`, `agent_email` and `agent_signature_path`,
 * which only the Settings card renders. Every partial write must go through here.
 */
export function mergeLetterhead(
  stored: Letterhead | null | undefined,
  edits: Partial<Letterhead>,
): Letterhead {
  return { ...LETTERHEAD_DEFAULT, ...(stored ?? {}), ...edits };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hireOrders/letterhead.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Extract the shared fields component**

Create `src/components/settings/hireOrders/fields/LetterheadFields.tsx`:

```tsx
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Letterhead } from "../LetterheadCard";

export interface LetterheadFieldsProps {
  value: Letterhead;
  /** Raw address text, kept verbatim while typing and parsed only on save. */
  addressText: string;
  onChange: (next: Letterhead) => void;
  onAddressTextChange: (next: string) => void;
  readOnly?: boolean;
  /** Rendered after the three shared fields. Settings passes its agent name, agent
   *  email and agent-signature block here; the setup rail passes nothing, which is
   *  what makes it the compact variant. */
  children?: ReactNode;
  /** Disambiguates input ids when both surfaces are mounted in one tree. */
  idPrefix?: string;
}

/** The three letterhead fields shared by Settings and the setup rail. Fully
 *  controlled: it owns no state and performs no writes, so the two callers cannot
 *  drift in what they render, only in what they save. */
export function LetterheadFields({
  value,
  addressText,
  onChange,
  onAddressTextChange,
  readOnly = false,
  children,
  idPrefix = "ho",
}: LetterheadFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-legal-name`}>Legal name</Label>
        <Input
          id={`${idPrefix}-legal-name`}
          value={value.legal_name}
          placeholder="Aurora Productions GmbH"
          disabled={readOnly}
          onChange={(e) => onChange({ ...value, legal_name: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-address`}>Address</Label>
        <Textarea
          id={`${idPrefix}-address`}
          rows={3}
          value={addressText}
          placeholder={"Street and number\nPostal code and city\nCountry"}
          disabled={readOnly}
          onChange={(e) => onAddressTextChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">One line per row.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-registration`}>Registration line</Label>
        <Input
          id={`${idPrefix}-registration`}
          value={value.registration_line}
          placeholder="Registered at Amtsgericht Berlin, HRB 123456"
          disabled={readOnly}
          onChange={(e) => onChange({ ...value, registration_line: e.target.value })}
        />
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 6: Rewire `LetterheadCard` onto it**

In `src/components/settings/hireOrders/LetterheadCard.tsx`:

1. Delete the local `linesFromText` and `serializeLines` definitions (lines 34-44) and import them instead:

```ts
import { linesFromText, serializeLines } from "@/lib/hireOrders/letterhead";
```

2. Replace the three field blocks in the returned JSX (the `Legal name`, `Address` and `Registration line` `div`s) with `LetterheadFields`, moving the agent name, agent email and agent signature blocks inside it as children. The `<CardContent className="space-y-4">` wrapper, the `Save letterhead` button and every mutation stay exactly where they are:

```tsx
<CardContent className="space-y-4">
  <LetterheadFields
    value={form}
    addressText={addressText}
    onChange={setForm}
    onAddressTextChange={setAddressText}
    readOnly={readOnly}
  >
    {/* existing agent name + agent email grid, unchanged */}
    {/* existing agent signature block, unchanged */}
  </LetterheadFields>
  <Button onClick={() => save.mutate()} disabled={readOnly || save.isPending || !orgId}>
    Save letterhead
  </Button>
</CardContent>
```

3. Add the import:

```ts
import { LetterheadFields } from "./fields/LetterheadFields";
```

The existing `LetterheadCard.test.tsx` asserts on `getByLabelText("Legal name")`, `getByLabelText("Address")` and the Save button. All three still resolve, because `LetterheadFields` keeps the same labels and the default `idPrefix` of `"ho"` reproduces the original ids exactly.

- [ ] **Step 7: Run the existing card tests to verify nothing regressed**

Run: `npx vitest run src/components/settings/hireOrders/LetterheadCard.test.tsx`
Expected: PASS, unchanged count.

- [ ] **Step 8: Commit**

```bash
git add src/lib/hireOrders/letterhead.ts src/lib/hireOrders/letterhead.test.ts src/components/settings/hireOrders/fields/LetterheadFields.tsx src/components/settings/hireOrders/LetterheadCard.tsx
git commit -m "extract the shared letterhead fields and a merge-safe partial save"
```

---

## Task 6: Extract `CountersignFields` and align the copy

**Files:**
- Create: `src/components/settings/hireOrders/fields/CountersignFields.tsx`
- Modify: `src/components/settings/hireOrders/CountersignCard.tsx`
- Modify: `src/components/settings/hireOrders/CountersignCard.test.tsx`

**Interfaces:**
- Produces: `CountersignFields({ value, onChange, readOnly, idPrefix })` over the existing `HireOrderCountersign` type. No new mode: the stored values stay `"manual"` and `"electronic"`.

- [ ] **Step 1: Update the existing test to the new copy, and watch it fail**

In `src/components/settings/hireOrders/CountersignCard.test.tsx`, change the assertion at line 18 from `/electronic signature/i` to the new label:

```ts
  it("offers the in-app signing option and no Documenso option", async () => {
    // ...existing render...
    await waitFor(() => expect(screen.getByText(/artist signs in showflow/i)).toBeInTheDocument());
```

Leave the rest of that test's assertions (the absence of a Documenso option) untouched.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/hireOrders/CountersignCard.test.tsx`
Expected: FAIL, "artist signs in showflow" not found.

- [ ] **Step 3: Write the shared fields component**

Create `src/components/settings/hireOrders/fields/CountersignFields.tsx`:

```tsx
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { CountersignMode, HireOrderCountersign } from "../CountersignCard";

export interface CountersignFieldsProps {
  value: HireOrderCountersign;
  onChange: (next: HireOrderCountersign) => void;
  readOnly?: boolean;
  idPrefix?: string;
}

/** The countersign mode choice, shared by Settings and the setup rail.
 *
 *  The design frame offered "draw or type" against "confirm by click only". Click-only
 *  is not an implemented mode and building it would touch the electronic-countersign DB
 *  gate, the issue_snapshot freeze and the consent-text mirror (spec, non-goals). The
 *  stored values are unchanged; only the labels move to describe what actually happens. */
export function CountersignFields({
  value,
  onChange,
  readOnly = false,
  idPrefix = "ho-countersign",
}: CountersignFieldsProps) {
  return (
    <div className="space-y-4">
      <RadioGroup
        value={value.mode}
        onValueChange={(v) => onChange({ ...value, mode: v as CountersignMode })}
        disabled={readOnly}
        className="gap-3"
      >
        <div className="flex items-start gap-3 rounded-lg border border-border p-3">
          <RadioGroupItem value="electronic" id={`${idPrefix}-electronic`} className="mt-0.5" />
          <Label htmlFor={`${idPrefix}-electronic`} className="cursor-pointer font-normal">
            <span className="block text-sm font-medium">Artist signs in ShowFlow</span>
            <span className="block text-xs text-muted-foreground">
              The artist reviews and signs the issued order in the app. Signature, timestamp and IP are stored with it.
            </span>
          </Label>
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-border p-3">
          <RadioGroupItem value="manual" id={`${idPrefix}-manual`} className="mt-0.5" />
          <Label htmlFor={`${idPrefix}-manual`} className="cursor-pointer font-normal">
            <span className="block text-sm font-medium">Signatures handled outside ShowFlow</span>
            <span className="block text-xs text-muted-foreground">
              A producer marks the order countersigned once the artist has signed elsewhere.
            </span>
          </Label>
        </div>
      </RadioGroup>
      {value.mode === "electronic" && (
        <div className="flex items-start gap-3 rounded-lg border border-border p-3">
          <Checkbox
            id={`${idPrefix}-email-producers`}
            className="mt-0.5"
            disabled={readOnly}
            checked={!!value.email_producers_on_countersign}
            onCheckedChange={(c) => onChange({ ...value, email_producers_on_countersign: c === true })}
          />
          <Label htmlFor={`${idPrefix}-email-producers`} className="cursor-pointer font-normal">
            <span className="block text-sm font-medium">Also email producers the signed copy</span>
            <span className="block text-xs text-muted-foreground">
              When the artist signs, email the assigned producers a copy. Producers are notified in-app either way.
            </span>
          </Label>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rewire `CountersignCard`**

In `src/components/settings/hireOrders/CountersignCard.tsx`, replace the `RadioGroup` block and the electronic-only checkbox block inside `<CardContent>` with:

```tsx
<CountersignFields value={form} onChange={setForm} readOnly={readOnly} />
```

keeping the `Save countersign mode` button and every query and mutation exactly as they are. Add:

```ts
import { CountersignFields } from "./fields/CountersignFields";
```

The `manual` radio moves below `electronic`, matching the rail's order. `RadioGroup`'s stored value is unaffected by DOM order.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/settings/hireOrders/CountersignCard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/hireOrders/fields/CountersignFields.tsx src/components/settings/hireOrders/CountersignCard.tsx src/components/settings/hireOrders/CountersignCard.test.tsx
git commit -m "extract the countersign fields and describe the modes by what they do"
```

---

## Task 7: `TermsLibraryPicker` and Import from library in Settings

**Files:**
- Create: `src/components/settings/hireOrders/fields/TermsLibraryPicker.tsx`
- Test: `src/components/settings/hireOrders/fields/TermsLibraryPicker.test.tsx`
- Modify: `src/components/settings/hireOrders/TermsVariantsCard.tsx`

**Interfaces:**
- Produces: `TermsLibraryPicker({ library, selectedIds, alreadyHeldIds, onToggle, readOnly })`
- Consumes (later tasks): `TermsStep` and, in the follow-on plan, `IssuePreflightSheet`

- [ ] **Step 1: Write the failing test**

Create `src/components/settings/hireOrders/fields/TermsLibraryPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TermsLibraryPicker } from "./TermsLibraryPicker";
import type { HireOrderTemplate } from "@/lib/hireOrders/terms";

const LIB: HireOrderTemplate[] = [
  { id: "a", name: "Standard engagement", clauses: [{ title: "Fee", body: "14 days." }, { title: "Cancel", body: "21 days." }] },
  { id: "b", name: "Guest artist, per session", clauses: [{ title: "Fee", body: "Per session." }] },
];

describe("TermsLibraryPicker", () => {
  it("lists every library template with its clause count", () => {
    render(<TermsLibraryPicker library={LIB} selectedIds={[]} alreadyHeldIds={[]} onToggle={vi.fn()} />);
    expect(screen.getByText("Standard engagement")).toBeInTheDocument();
    expect(screen.getByText(/2 clauses/)).toBeInTheDocument();
    expect(screen.getByText(/1 clause\b/)).toBeInTheDocument();
  });

  it("toggles selection", () => {
    const onToggle = vi.fn();
    render(<TermsLibraryPicker library={LIB} selectedIds={[]} alreadyHeldIds={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Standard engagement/ }));
    expect(onToggle).toHaveBeenCalledWith("a");
  });

  it("marks a template the org already holds and disables re-selecting it", () => {
    render(<TermsLibraryPicker library={LIB} selectedIds={[]} alreadyHeldIds={["a"]} onToggle={vi.fn()} />);
    expect(screen.getByText("Already added")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Standard engagement/ })).toBeDisabled();
  });

  it("disables every checkbox when readOnly", () => {
    render(<TermsLibraryPicker library={LIB} selectedIds={[]} alreadyHeldIds={[]} onToggle={vi.fn()} readOnly />);
    for (const cb of screen.getAllByRole("checkbox")) expect(cb).toBeDisabled();
  });

  it("renders an explanatory empty state when the library is empty", () => {
    render(<TermsLibraryPicker library={[]} selectedIds={[]} alreadyHeldIds={[]} onToggle={vi.fn()} />);
    expect(screen.getByText(/No templates in the library/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/hireOrders/fields/TermsLibraryPicker.test.tsx`
Expected: FAIL, cannot resolve `./TermsLibraryPicker`.

- [ ] **Step 3: Write the implementation**

Create `src/components/settings/hireOrders/fields/TermsLibraryPicker.tsx`:

```tsx
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { HireOrderTemplate } from "@/lib/hireOrders/terms";

export interface TermsLibraryPickerProps {
  library: HireOrderTemplate[];
  selectedIds: string[];
  /** Ids the org already holds. Shown as "Already added" and not selectable, because
   *  mergeTermsTemplates skips them anyway. */
  alreadyHeldIds: string[];
  onToggle: (id: string) => void;
  readOnly?: boolean;
  idPrefix?: string;
}

function clauseCount(n: number): string {
  return `${n} ${n === 1 ? "clause" : "clauses"}`;
}

/** Multi-select over the platform terms library. Used by the setup rail, by the
 *  Settings terms card, and by the issue preflight sheet, so the one-click start is
 *  identical wherever an org meets it. */
export function TermsLibraryPicker({
  library,
  selectedIds,
  alreadyHeldIds,
  onToggle,
  readOnly = false,
  idPrefix = "terms-lib",
}: TermsLibraryPickerProps) {
  if (library.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
        No templates in the library yet. Add your clauses below instead.
      </p>
    );
  }
  const held = new Set(alreadyHeldIds);
  const selected = new Set(selectedIds);
  return (
    <div className="space-y-2">
      {library.map((t) => {
        const isHeld = held.has(t.id);
        return (
          <div key={t.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Checkbox
              id={`${idPrefix}-${t.id}`}
              className="mt-0.5"
              aria-label={t.name}
              checked={selected.has(t.id)}
              disabled={readOnly || isHeld}
              onCheckedChange={() => onToggle(t.id)}
            />
            <Label htmlFor={`${idPrefix}-${t.id}`} className="cursor-pointer font-normal">
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium">{t.name}</span>
                {isHeld && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Already added
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {clauseCount(t.clauses.length)} · {t.clauses.map((c) => c.title).join(", ")}
              </span>
            </Label>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/settings/hireOrders/fields/TermsLibraryPicker.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add Import from library to `TermsVariantsCard`**

In `src/components/settings/hireOrders/TermsVariantsCard.tsx`, add a section directly above the existing template list, inside `<CardContent>`. Add the imports:

```ts
import { useTermsLibrary, useImportTermsTemplates } from "@/hooks/useHireOrderSetup";
import { TermsLibraryPicker } from "./fields/TermsLibraryPicker";
```

> **Ordering note:** `useHireOrderSetup` is created in Task 8. If you are executing tasks strictly in order, do Task 8 first and return here, or land this step as part of Task 8's commit. Do not stub the hook.

and the section:

```tsx
{library.data && library.data.length > 0 && (
  <div className="space-y-3 rounded-lg border border-border p-3">
    <div>
      <h5 className="text-sm font-medium">Start from a template</h5>
      <p className="text-xs text-muted-foreground">
        Add a ready-made template to this organization. You own the copy, so editing it here changes nothing for anyone else.
      </p>
    </div>
    <TermsLibraryPicker
      library={library.data}
      selectedIds={picked}
      alreadyHeldIds={setting.templates.map((t) => t.id)}
      onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
      readOnly={readOnly}
    />
    <Button
      size="sm"
      variant="outline"
      disabled={readOnly || picked.length === 0 || importTerms.isPending}
      onClick={() => importTerms.mutate({ templateIds: picked }, { onSuccess: () => setPicked([]) })}
    >
      Add to this organization
    </Button>
  </div>
)}
```

with `const [picked, setPicked] = useState<string[]>([])`, `const library = useTermsLibrary()` and `const importTerms = useImportTermsTemplates(orgId)` alongside the card's existing hooks. `setting` is the card's already-normalized `HireOrderTermsSetting`; use whatever local name it currently carries.

- [ ] **Step 6: Run the terms card tests**

Run: `npx vitest run src/components/settings/hireOrders/TermsVariantsCard.test.tsx`
Expected: PASS. If a test asserts on the card's exact child count, update it to account for the new section.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/hireOrders/fields/TermsLibraryPicker.tsx src/components/settings/hireOrders/fields/TermsLibraryPicker.test.tsx src/components/settings/hireOrders/TermsVariantsCard.tsx
git commit -m "let an org start from a platform terms template"
```

---

## Task 8: Setup hooks

**Files:**
- Create: `src/hooks/useHireOrderSetup.ts`
- Test: `src/hooks/useHireOrderSetup.test.ts`

**Interfaces:**
- Consumes: `computeSetupStatus` (Task 3), `fetchTermsLibrary` / `importTermsTemplates` (Task 4), `hasOrgSettingRow` (Task 2), `normalizeTermsSetting`, `resolveOrgSetting`
- Produces:
  - `useHireOrderSetupStatus(orgId: string | null): { status: HireOrderSetupStatus; isLoading: boolean }`
  - `useTermsLibrary(): UseQueryResult<HireOrderTemplate[]>`
  - `useImportTermsTemplates(orgId: string | null): UseMutationResult<HireOrderTermsSetting, Error, { templateIds: string[] }>`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useHireOrderSetup.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useHireOrderSetupStatus } from "./useHireOrderSetup";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("useHireOrderSetupStatus", () => {
  it("reports nothing done for an org with no settings rows", async () => {
    const { result } = renderHookWithProviders(() => useHireOrderSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.doneCount).toBe(0);
    expect(result.current.status.canIssue).toBe(false);
  });

  it("reports letterhead and terms done, and can issue, from stored rows", async () => {
    seedClient({
      app_settings: {
        data: [
          { key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } },
          {
            key: "hire_order_terms",
            org_id: "org-1",
            value: { templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "t1" },
          },
        ],
        error: null,
      },
    });
    const { result } = renderHookWithProviders(() => useHireOrderSetupStatus("org-1"));
    await waitFor(() => expect(result.current.status.canIssue).toBe(true));
    // No hire_order_countersign row, so the decision is still outstanding.
    expect(result.current.status.complete).toBe(false);
  });

  it("is inert without an org", async () => {
    const { result } = renderHookWithProviders(() => useHireOrderSetupStatus(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.doneCount).toBe(0);
  });
});
```

> The fake returns the same seeded `app_settings` rows to every query, so the
> `hire_order_countersign` presence check sees rows whose `key` is not
> `hire_order_countersign`. `hasOrgSettingRow` returns `true` for any non-empty result,
> which is why the second case asserts `complete === false` only through the absence of
> any seeded rows in the first case. If this proves too loose once the fake's `when`
> matching is in play, seed with the array form:
> `app_settings: [{ when: { key: "hire_order_countersign" }, data: [] }, { data: [...] }]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useHireOrderSetup.test.ts`
Expected: FAIL, cannot resolve `./useHireOrderSetup`.

- [ ] **Step 3: Write the implementation**

Create `src/hooks/useHireOrderSetup.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { hasOrgSettingRow, resolveOrgSetting } from "@/data/settings";
import { fetchTermsLibrary, importTermsTemplates } from "@/data/hireOrders";
import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";
import { normalizeTermsSetting, type HireOrderTermsSetting } from "@/lib/hireOrders/terms";
import { computeSetupStatus, type HireOrderSetupStatus } from "@/lib/hireOrders/setupStatus";

const EMPTY_TERMS: HireOrderTermsSetting = { templates: [], default_id: null };

/** The org's own resolved terms setting, normalized. Shared by the status hook, the
 *  rail's terms step and the import mutation, so all three read one cache entry. */
export function useOrgTerms(orgId: string | null) {
  return useQuery({
    queryKey: ["app-settings", "hire_order_terms", orgId],
    enabled: !!orgId,
    queryFn: async () =>
      normalizeTermsSetting(await resolveOrgSetting<unknown>(supabase, orgId, "hire_order_terms", null)),
  });
}

/**
 * Org-level hire-order setup readiness for the rail. Composes three reads and the pure
 * `computeSetupStatus`. Note the countersign read is a PRESENCE check, not a value
 * read: inheriting the manual default is not a decision (spec §1).
 */
export function useHireOrderSetupStatus(orgId: string | null): {
  status: HireOrderSetupStatus;
  isLoading: boolean;
} {
  const letterhead = useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    enabled: !!orgId,
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
  });
  const terms = useOrgTerms(orgId);
  const countersign = useQuery({
    queryKey: ["app-settings", "hire_order_countersign", "exists", orgId],
    enabled: !!orgId,
    queryFn: () => hasOrgSettingRow(supabase, orgId, "hire_order_countersign"),
  });

  const isLoading = !!orgId && (letterhead.isLoading || terms.isLoading || countersign.isLoading);
  const status = computeSetupStatus({
    letterhead: letterhead.data ?? null,
    terms: terms.data ?? EMPTY_TERMS,
    countersignChosen: countersign.data ?? false,
  });
  return { status, isLoading };
}

/** The platform terms library. Org-independent, so it is cached once per session. */
export function useTermsLibrary() {
  return useQuery({
    queryKey: ["hire-orders", "terms-library"],
    queryFn: () => fetchTermsLibrary(supabase),
    staleTime: 5 * 60_000,
  });
}

/** Copy the chosen library templates into the org's own terms setting. */
export function useImportTermsTemplates(orgId: string | null) {
  const qc = useQueryClient();
  const library = useTermsLibrary();
  const terms = useOrgTerms(orgId);
  return useMutation({
    mutationFn: ({ templateIds }: { templateIds: string[] }) => {
      if (!orgId) throw new Error("No active organization");
      const chosen = (library.data ?? []).filter((t) => templateIds.includes(t.id));
      if (chosen.length === 0) throw new Error("Select a template to add");
      return importTermsTemplates(supabase, {
        orgId,
        current: terms.data ?? EMPTY_TERMS,
        templates: chosen,
      });
    },
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      const name = next.templates.find((t) => t.id === next.default_id)?.name;
      toast.success(name ? `Terms added. Default is now "${name}".` : "Terms added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useHireOrderSetup.test.ts`
Expected: PASS, 3 tests. If the seeded fake makes the countersign presence check too permissive, switch that seed to the array form documented in Step 1.

- [ ] **Step 5: Complete Task 7 Step 5 if it was deferred**

If you skipped the `TermsVariantsCard` edit in Task 7 because this hook did not exist yet, apply it now and run `npx vitest run src/components/settings/hireOrders/TermsVariantsCard.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useHireOrderSetup.ts src/hooks/useHireOrderSetup.test.ts
git commit -m "compose the hire-order setup status and terms-library hooks"
```

---

## Task 9: Platform terms library card

**Files:**
- Modify: `src/components/platform/PlatformDefaultsTab.tsx`

**Interfaces:**
- Consumes: `TERMS_LIBRARY_KEY`, `HIRE_ORDER_STARTER_TERMS`, `savePlatformSetting`, `resolveOrgSetting`

- [ ] **Step 1: Write the card**

Add to `src/components/platform/PlatformDefaultsTab.tsx`, following the shape of the existing `StarterCatalogCard`. Import:

```ts
import { TERMS_LIBRARY_KEY } from "@/data/hireOrders";
import { HIRE_ORDER_STARTER_TERMS } from "@/lib/hireOrders/starterTerms";
import type { HireOrderTemplate } from "@/lib/hireOrders/terms";
```

then:

```tsx
interface TermsLibraryValue {
  templates: HireOrderTemplate[];
}

/**
 * The platform hire-order terms library. Orgs import a COPY of these into their own
 * `hire_order_terms`, so editing here never changes contract text an org is already
 * issuing. Stored as JSON because the shape is nested; the starter set is the fallback
 * when no row exists, so there is nothing to seed in a new environment.
 */
function HireOrderTermsLibraryCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["platform", "terms-library"],
    queryFn: () =>
      resolveOrgSetting<TermsLibraryValue>(supabase, null, TERMS_LIBRARY_KEY, {
        templates: HIRE_ORDER_STARTER_TERMS,
      }),
  });

  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const seededRef = useRef(false);
  useEffect(() => {
    if (!data || seededRef.current) return;
    seededRef.current = true;
    setText(JSON.stringify(data.templates ?? HIRE_ORDER_STARTER_TERMS, null, 2));
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      let templates: HireOrderTemplate[];
      try {
        templates = JSON.parse(text) as HireOrderTemplate[];
      } catch {
        throw new Error("That is not valid JSON");
      }
      if (!Array.isArray(templates)) throw new Error("Expected an array of templates");
      for (const t of templates) {
        if (!t || typeof t.id !== "string" || typeof t.name !== "string" || !Array.isArray(t.clauses)) {
          throw new Error("Every template needs an id, a name and a clauses array");
        }
      }
      return savePlatformSetting(supabase, TERMS_LIBRARY_KEY, { templates } as unknown as Json);
    },
    onSuccess: () => {
      setParseError(null);
      qc.invalidateQueries({ queryKey: ["platform", "terms-library"] });
      qc.invalidateQueries({ queryKey: ["hire-orders", "terms-library"] });
      toast.success("Terms library saved");
    },
    onError: (e: Error) => setParseError(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) return <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>;

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Hire order terms library</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Templates an organization can add to its own hire-order terms in one click. Organizations get a copy they
          own, so changes here never alter terms already in use. Shape:{" "}
          <code>{`[{ "id": "...", "name": "...", "clauses": [{ "title": "...", "body": "..." }] }]`}</code>
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="t-terms-library">Templates (JSON)</Label>
          <Textarea
            id="t-terms-library"
            rows={16}
            className="font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {parseError && <Alert variant="destructive"><AlertDescription>{parseError}</AlertDescription></Alert>}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save library</Button>
      </CardContent>
    </Card>
  );
}
```

Then render `<HireOrderTermsLibraryCard />` inside `PlatformDefaultsTab`'s returned list, after `<DefaultModulesCard />`.

- [ ] **Step 2: Verify the tab type-checks and renders**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors. Add any missing imports (`Label`, `Textarea`, `Alert`, `AlertDescription`, `Json`) that the file does not already carry.

- [ ] **Step 3: Run the platform tests**

Run: `npx vitest run src/components/platform`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/platform/PlatformDefaultsTab.tsx
git commit -m "let super-admins edit the hire-order terms library"
```

---

## Task 10: The rail

**Files:**
- Create: `src/components/hireOrders/setup/useRailDismissed.ts`
- Create: `src/components/hireOrders/setup/SetupStepRow.tsx`
- Create: `src/components/hireOrders/setup/LetterheadStep.tsx`
- Create: `src/components/hireOrders/setup/TermsStep.tsx`
- Create: `src/components/hireOrders/setup/CountersignStep.tsx`
- Create: `src/components/hireOrders/setup/ProducerWaitingCard.tsx`
- Create: `src/components/hireOrders/setup/SetupRail.tsx`
- Test: `src/components/hireOrders/setup/SetupRail.test.tsx`

**Interfaces:**
- Consumes: `useHireOrderSetupStatus`, `useTermsLibrary`, `useImportTermsTemplates`, `useOrgTerms` (Task 8); `LetterheadFields` (Task 5); `CountersignFields` (Task 6); `TermsLibraryPicker` (Task 7); `mergeLetterhead`, `linesFromText`, `serializeLines` (Task 5); `useCan` from `@/hooks/useCapabilities`
- Produces: `SetupRail({ orgId })`, rendering nothing when the org is set up or the rail is dismissed

- [ ] **Step 1: Write the dismissal hook**

Create `src/components/hireOrders/setup/useRailDismissed.ts`:

```ts
import { useCallback, useState } from "react";

/** Per-browser, per-org dismissal of the setup rail.
 *
 *  localStorage rather than app_settings: app_settings is org-scoped, so a dismissal
 *  stored there would hide the rail for every admin at once. It does not follow a user
 *  across devices, which is an accepted limitation for a surface that retires itself
 *  as soon as setup is complete (spec §7). Matches the showflow_editor_mode precedent. */
function storageKey(orgId: string | null): string {
  return `showflow.hireOrderSetup.hidden.${orgId ?? "none"}`;
}

export function useRailDismissed(orgId: string | null): [boolean, () => void] {
  const [dismissed, setDismissed] = useState<boolean>(
    () => localStorage.getItem(storageKey(orgId)) === "true",
  );
  const dismiss = useCallback(() => {
    localStorage.setItem(storageKey(orgId), "true");
    setDismissed(true);
  }, [orgId]);
  return [dismissed, dismiss];
}
```

- [ ] **Step 2: Write the failing rail test**

Create `src/components/hireOrders/setup/SetupRail.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

const { canRef } = vi.hoisted(() => ({ canRef: { value: true } }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canRef.value }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { SetupRail } from "./SetupRail";

beforeEach(() => {
  localStorage.clear();
  canRef.value = true;
  seedClient({ app_settings: { data: [], error: null } });
});

describe("SetupRail", () => {
  it("shows all three steps, with a blocking chip on exactly two", async () => {
    renderWithProviders(<SetupRail orgId="org-1" />);
    expect(await screen.findByText("Letterhead")).toBeInTheDocument();
    expect(screen.getByText("Terms template")).toBeInTheDocument();
    expect(screen.getByText("Countersigning")).toBeInTheDocument();
    expect(screen.getAllByText("Blocks issue")).toHaveLength(2);
  });

  it("reports progress out of three", async () => {
    renderWithProviders(<SetupRail orgId="org-1" />);
    expect(await screen.findByText(/0 of 3/)).toBeInTheDocument();
  });

  it("renders the waiting card instead when the viewer cannot edit settings", async () => {
    canRef.value = false;
    renderWithProviders(<SetupRail orgId="org-1" />);
    expect(await screen.findByText(/An admin needs to finish setup/i)).toBeInTheDocument();
    expect(screen.queryByText("Blocks issue")).not.toBeInTheDocument();
  });

  it("renders nothing once the org is fully set up", async () => {
    seedClient({
      app_settings: {
        data: [
          { key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } },
          { key: "hire_order_terms", org_id: "org-1", value: { templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "t1" } },
          { key: "hire_order_countersign", org_id: "org-1", value: { mode: "electronic" } },
        ],
        error: null,
      },
    });
    const { container } = renderWithProviders(<SetupRail orgId="org-1" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing when previously dismissed for this org", async () => {
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    const { container } = renderWithProviders(<SetupRail orgId="org-1" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/hireOrders/setup/SetupRail.test.tsx`
Expected: FAIL, cannot resolve `./SetupRail`.

- [ ] **Step 4: Write `SetupStepRow`**

Create `src/components/hireOrders/setup/SetupStepRow.tsx`:

```tsx
import type { ReactNode } from "react";
import { Check } from "lucide-react";

export interface SetupStepRowProps {
  /** 1-based position, shown while the step is outstanding. */
  index: number;
  title: string;
  hint: string;
  done: boolean;
  blocksIssue: boolean;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

/** One row of the setup rail: a tick or a number, the title, a one-line hint, and a
 *  "Blocks issue" chip only where leaving the step undone actually fails the issue
 *  action. A checklist that overstates its blockers stops being believed. */
export function SetupStepRow({
  index, title, hint, done, blocksIssue, expanded, onToggle, children,
}: SetupStepRowProps) {
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2.5 p-3 text-left hover:bg-muted/50"
      >
        {done ? (
          <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent-500">
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          </span>
        ) : (
          <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground">
            {index}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="mt-0.5 block text-xs leading-[17px] text-muted-foreground">{hint}</span>
        </span>
        {!done && blocksIssue && (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-600">
            Blocks issue
          </span>
        )}
      </button>
      {expanded && <div className="border-t border-border bg-muted/40 p-3">{children}</div>}
    </div>
  );
}
```

> `bg-amber-100` and `text-amber-600` map to the `--amber-100` / `--amber-600` tokens in
> `src/index.css`. These are plain hex stops, so do not add an opacity modifier to them.

- [ ] **Step 5: Write the three step panels**

Create `src/components/hireOrders/setup/LetterheadStep.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";
import { LetterheadFields } from "@/components/settings/hireOrders/fields/LetterheadFields";
import { linesFromText, mergeLetterhead, serializeLines } from "@/lib/hireOrders/letterhead";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";

/** The rail's letterhead panel. Writes the SAME app_settings key through the SAME
 *  upsertOrgSetting call as the Settings card, so the Settings change-history rail
 *  picks these edits up and the two surfaces cannot drift.
 *
 *  It renders three of the six letterhead fields, so its save merges onto the stored
 *  value. Saving the compact object directly would erase the agent name, agent email
 *  and agent signature that only Settings renders. */
export function LetterheadStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }) {
  const qc = useQueryClient();
  const stored = useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    enabled: !!orgId,
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
  });

  const [form, setForm] = useState<Letterhead>(LETTERHEAD_DEFAULT);
  const [addressText, setAddressText] = useState("");
  const seededRef = useRef(false);
  useEffect(() => {
    if (!stored.data || seededRef.current) return;
    seededRef.current = true;
    setForm(stored.data);
    setAddressText(serializeLines(stored.data.address_lines));
  }, [stored.data]);

  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error("No active organization");
      const payload = mergeLetterhead(stored.data, {
        legal_name: form.legal_name,
        registration_line: form.registration_line,
        address_lines: linesFromText(addressText),
      });
      return upsertOrgSetting(supabase, orgId, "hire_order_letterhead", payload as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Letterhead saved");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Pulled from your organization profile. Check it, then confirm. It prints at the top of every order.
      </p>
      <LetterheadFields
        idPrefix="rail-letterhead"
        value={form}
        addressText={addressText}
        onChange={setForm}
        onAddressTextChange={setAddressText}
      />
      <Button size="sm" disabled={save.isPending || !orgId} onClick={() => save.mutate()}>
        Confirm letterhead
      </Button>
    </div>
  );
}
```

Create `src/components/hireOrders/setup/TermsStep.tsx`:

```tsx
import { useState } from "react";
import { useImportTermsTemplates, useOrgTerms, useTermsLibrary } from "@/hooks/useHireOrderSetup";
import { TermsLibraryPicker } from "@/components/settings/hireOrders/fields/TermsLibraryPicker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** The rail's terms panel: pick one or more platform templates and copy them into this
 *  org. An org owns its copy, so a later platform edit never changes terms it is
 *  already issuing. Editing the wording stays in Settings. */
export function TermsStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }) {
  const library = useTermsLibrary();
  const terms = useOrgTerms(orgId);
  const importTerms = useImportTermsTemplates(orgId);
  const [picked, setPicked] = useState<string[]>([]);

  if (library.isLoading || terms.isLoading) return <Skeleton className="h-24 w-full" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Start from a template. You get your own copy, and you can edit the wording or add more variants later in Settings.
      </p>
      <TermsLibraryPicker
        idPrefix="rail-terms"
        library={library.data ?? []}
        selectedIds={picked}
        alreadyHeldIds={(terms.data?.templates ?? []).map((t) => t.id)}
        onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
      />
      <Button
        size="sm"
        disabled={picked.length === 0 || importTerms.isPending || !orgId}
        onClick={() => importTerms.mutate({ templateIds: picked }, { onSuccess: () => { setPicked([]); onDone(); } })}
      >
        Add to this organization
      </Button>
    </div>
  );
}
```

Create `src/components/hireOrders/setup/CountersignStep.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { COUNTERSIGN_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { HireOrderCountersign } from "@/components/settings/hireOrders/CountersignCard";
import { CountersignFields } from "@/components/settings/hireOrders/fields/CountersignFields";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";

/** The rail's countersign panel. Unlike the other two steps this one is not a blocker:
 *  the inherited manual mode issues perfectly well. Saving is what turns an inherited
 *  default into a decision, which is exactly what hasOrgSettingRow detects. */
export function CountersignStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }) {
  const qc = useQueryClient();
  const stored = useQuery({
    queryKey: ["app-settings", "hire_order_countersign", orgId],
    enabled: !!orgId,
    queryFn: () =>
      resolveOrgSetting<HireOrderCountersign>(supabase, orgId, "hire_order_countersign", COUNTERSIGN_DEFAULT),
  });

  const [form, setForm] = useState<HireOrderCountersign>(COUNTERSIGN_DEFAULT);
  const seededRef = useRef(false);
  useEffect(() => {
    if (!stored.data || seededRef.current) return;
    seededRef.current = true;
    setForm(stored.data);
  }, [stored.data]);

  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error("No active organization");
      return upsertOrgSetting(supabase, orgId, "hire_order_countersign", form as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      qc.invalidateQueries({ queryKey: ["hire-orders"] });
      toast.success("Countersign mode saved");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">How an artist signs the order you send them.</p>
      <CountersignFields idPrefix="rail-countersign" value={form} onChange={setForm} />
      <Button size="sm" disabled={save.isPending || !orgId} onClick={() => save.mutate()}>
        Save
      </Button>
    </div>
  );
}
```

- [ ] **Step 6: Write `ProducerWaitingCard`**

Create `src/components/hireOrders/setup/ProducerWaitingCard.tsx`:

```tsx
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { SetupStep } from "@/lib/hireOrders/setupStatus";

const LABELS: Record<string, string> = {
  letterhead: "Letterhead",
  terms: "Terms template",
  countersign: "Countersigning",
};

/** Shown instead of the rail when the viewer lacks `edit_hire_order_settings`.
 *
 *  Deliberately does not name the admin who could fix it: list_org_members is
 *  admin-guarded and raises 42501 for producers, so naming them needs a new RPC, and a
 *  nudge button needs a new notification type plus rate limiting. Both are a separate
 *  follow-up (spec §5.4). Drafting is unaffected, which is the point of the copy. */
export function ProducerWaitingCard({ steps }: { steps: SetupStep[] }) {
  const outstanding = steps.filter((s) => !s.done && s.blocksIssue);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">Waiting on your admin</p>
          <p className="mt-1.5 font-display text-base font-semibold">Draft now, issue later</p>
          <p className="mt-1 text-xs leading-[19px] text-muted-foreground">
            Nothing stops you building orders. An admin needs to finish setup before anything can be sent.
          </p>
        </div>
        <div className="space-y-2">
          {outstanding.map((s) => (
            <div key={s.key} className="flex items-center gap-2 rounded-md border border-border p-2.5">
              <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{LABELS[s.key] ?? s.key}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Write `SetupRail`**

Create `src/components/hireOrders/setup/SetupRail.tsx`:

```tsx
import { useState } from "react";
import { useCan } from "@/hooks/useCapabilities";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import type { SetupStepKey } from "@/lib/hireOrders/setupStatus";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SetupStepRow } from "./SetupStepRow";
import { LetterheadStep } from "./LetterheadStep";
import { TermsStep } from "./TermsStep";
import { CountersignStep } from "./CountersignStep";
import { ProducerWaitingCard } from "./ProducerWaitingCard";
import { useRailDismissed } from "./useRailDismissed";

const TITLES: Record<SetupStepKey, string> = {
  letterhead: "Letterhead",
  terms: "Terms template",
  countersign: "Countersigning",
};

const HINTS: Record<SetupStepKey, { todo: string; done: string }> = {
  letterhead: {
    todo: "Legal name, address, registration line. Prints on every order.",
    done: "Set. It prints at the top of every order.",
  },
  terms: {
    todo: "The wording on the back page. Start from a template.",
    done: "Set. Edit the wording any time in Settings.",
  },
  countersign: {
    todo: "How artists sign. The default is signing outside ShowFlow.",
    done: "Chosen. Change it any time in Settings.",
  },
};

/**
 * The hire-order setup rail: a persistent checklist beside the working orders page.
 *
 * Renders nothing at all once the org is set up or the viewer has hidden it, so it is a
 * genuinely temporary surface. Setup happens here, not in Settings, but every panel
 * writes through the same data path as the Settings cards.
 */
export function SetupRail({ orgId }: { orgId: string | null }) {
  const canEditSettings = useCan("edit_hire_order_settings");
  const { status, isLoading } = useHireOrderSetupStatus(orgId);
  const [dismissed, dismiss] = useRailDismissed(orgId);
  const [open, setOpen] = useState<SetupStepKey | null>(null);

  if (isLoading || dismissed || status.complete) return null;
  if (!canEditSettings) return <ProducerWaitingCard steps={status.steps} />;

  const toggle = (key: SetupStepKey) => setOpen((cur) => (cur === key ? null : key));

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-accent-600">
              Set up · {status.doneCount} of {status.totalCount}
            </p>
            <Button variant="ghost" size="sm" className="h-auto p-1 text-xs" onClick={dismiss}>
              Hide
            </Button>
          </div>
          <p className="mt-1.5 font-display text-base font-semibold">Get hire orders ready</p>
          <p className="mt-1 text-xs leading-[19px] text-muted-foreground">
            You can draft orders right now. These are only needed before the first one goes out.
          </p>
          <div className="mt-3 flex gap-1">
            {status.steps.map((s) => (
              <span
                key={s.key}
                className={`h-[3px] w-full rounded-full ${s.done ? "bg-accent-500" : "bg-muted"}`}
              />
            ))}
          </div>
        </div>
        <div>
          {status.steps.map((s, i) => (
            <SetupStepRow
              key={s.key}
              index={i + 1}
              title={TITLES[s.key]}
              hint={s.done ? HINTS[s.key].done : HINTS[s.key].todo}
              done={s.done}
              blocksIssue={s.blocksIssue}
              expanded={open === s.key}
              onToggle={() => toggle(s.key)}
            >
              {s.key === "letterhead" && <LetterheadStep orgId={orgId} onDone={() => setOpen(null)} />}
              {s.key === "terms" && <TermsStep orgId={orgId} onDone={() => setOpen(null)} />}
              {s.key === "countersign" && <CountersignStep orgId={orgId} onDone={() => setOpen(null)} />}
            </SetupStepRow>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/components/hireOrders/setup/SetupRail.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 9: Commit**

```bash
git add src/components/hireOrders/setup
git commit -m "add the hire-order setup readiness rail"
```

---

## Task 11: Mount the rail on the orders page

**Files:**
- Modify: `src/pages/HireOrdersPage.tsx`
- Modify: `src/pages/HireOrdersPage.test.tsx`

**Interfaces:**
- Consumes: `SetupRail` (Task 10), `useDatesReadyForHireOrder` (existing)

- [ ] **Step 1: Write the failing test**

`src/pages/HireOrdersPage.test.tsx` already exists and already carries its own `vi.mock`
calls. **Read it first.** A second `vi.mock` for a path it already mocks is an error, so
merge into its existing mocks rather than pasting the block below wholesale: add the
`SetupRail` mock, add `useDatesReadyForHireOrder` to whatever `useHireOrders` mock is
already there, and append only the two `it` blocks. The listing below is the shape the
merged file should end up with, not a file to overwrite with.

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1", name: "Halle Kollektiv" }, hasRole: () => true }),
}));
vi.mock("@/hooks/useEntitlements", () => ({
  useEntitlements: () => ({ features: new Set(["hire_orders"]), isLoading: false }),
  useFeature: () => true,
}));
vi.mock("@/components/hireOrders/setup/SetupRail", () => ({
  SetupRail: () => <div data-testid="setup-rail" />,
}));
vi.mock("@/hooks/useHireOrders", () => ({
  useHireOrders: () => ({ data: [], isLoading: false }),
  useDatesReadyForHireOrder: () => ({ data: { readyIds: ["d1", "d2"], orderByDate: {} } }),
  useHireOrderAction: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkCountersigned: () => ({ mutate: vi.fn(), isPending: false }),
  useVoidHireOrder: () => ({ mutate: vi.fn(), isPending: false }),
  useHireOrderCountersignMode: () => ({ data: { mode: "manual" } }),
  ISSUE_FAILURE_COPY: {},
}));

import HireOrdersPage from "./HireOrdersPage";

beforeEach(() => localStorage.clear());

describe("HireOrdersPage", () => {
  it("mounts the setup rail", () => {
    renderWithProviders(<HireOrdersPage />);
    expect(screen.getByTestId("setup-rail")).toBeInTheDocument();
  });

  it("points at the dates that are ready when there are no orders yet", () => {
    renderWithProviders(<HireOrdersPage />);
    expect(screen.getByText(/2 dates are fully cast and ready/i)).toBeInTheDocument();
  });
});
```

> Extend the `useHireOrders` mock with any other export `HireOrdersPage` and its children
> import at the time you write this. Run the test and let the failures tell you.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/HireOrdersPage.test.tsx`
Expected: FAIL, no `setup-rail` testid.

- [ ] **Step 3: Add the two-column layout and the rail**

In `src/pages/HireOrdersPage.tsx`, add the imports:

```ts
import { Link } from "react-router-dom";
import { SetupRail } from "@/components/hireOrders/setup/SetupRail";
import { useDatesReadyForHireOrder } from "@/hooks/useHireOrders";
import { ROUTES } from "@/config/app.config";
```

add near the other hooks:

```ts
const { data: ready } = useDatesReadyForHireOrder(orgId);
const readyCount = ready?.readyIds.length ?? 0;
const noOrdersYet = allOrders.length === 0;
```

then wrap the chips, table and rail in a two-column grid, replacing the current flat
sequence from the status chips down to `OrdersTable`:

```tsx
<div className="grid gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
  <div className="min-w-0 space-y-4">
    {/* the existing chips + search row, unchanged */}
    {/* the existing !orgId / isLoading / OrdersTable branch, unchanged */}
    {noOrdersYet && readyCount > 0 && (
      <p className="text-xs text-muted-foreground">
        {readyCount} {readyCount === 1 ? "date is" : "dates are"} fully cast and ready for an order.{" "}
        <Link to={ROUTES.BOOKINGS} className="text-accent-600 underline-offset-2 hover:underline">
          Generate from Shows and bookings
        </Link>
        , or use New order above.
      </p>
    )}
  </div>
  <SetupRail orgId={orgId} />
</div>
```

The KPI tiles and the page header stay full width above this grid.

> The ready-dates pointer deliberately links out rather than repeating the per-artist
> generate list. `HireOrderReadyBanner` on Shows and Bookings already owns that CTA and
> is staying (spec §6). Two competing "generate now" surfaces for the same dates is
> worse than one.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/HireOrdersPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify in the browser**

Use `preview_start` with the dev-server entry from `.claude/launch.json`, sign in as an
org admin on an org with `hire_orders` on, and navigate to `/hire-orders`. Confirm:
the rail renders on the right; expanding Letterhead, saving, and reloading shows a tick
and the progress counter at 1 of 3; the "Blocks issue" chip appears on exactly two rows;
`Hide` removes the rail and it stays hidden after a reload.

Take a screenshot with `computer {action: "screenshot"}` for the commit message thread.

- [ ] **Step 6: Commit**

```bash
git add src/pages/HireOrdersPage.tsx src/pages/HireOrdersPage.test.tsx
git commit -m "mount the setup rail beside the hire orders table"
```

---

## Task 12: Full gate and changelog

**Files:**
- Modify: `public/changelog.md`
- Modify: `public/changelog.json` (regenerated, never hand-edited)
- Modify: `package.json`, `src/config/app.config.ts` if the version moves

- [ ] **Step 1: Run the whole gate**

```bash
npm run lint && npx tsc -p tsconfig.app.json --noEmit && npx tsc -p tsconfig.tools.json --noEmit && npx vitest run
```

Expected: all green. Fix anything that is not before continuing. No edge or pgTAP run is
needed: this plan changes neither.

- [ ] **Step 2: Add the changelog entry**

The newest shipped block is `## 1.13.0 — July 25, 2026`. This is user-facing feature
work, so open a `## 1.14.0 — August 6, 2026` block at the top with a one-line `*theme*`,
unless a block for today already exists, in which case append to it. Same-day changes
fold into one version, never one patch version each.

Bump `version` in `package.json` and `APP_META.VERSION` in `src/config/app.config.ts` to
`1.14.0` to match.

```markdown
## 1.14.0 — August 6, 2026

*Getting hire orders ready*

### New
- **Hire order setup checklist** — A checklist beside your hire orders shows exactly what is needed before the first order can be sent, and lets you set it right there. It disappears once you are set up.
- **Ready-made terms templates** — Start from a prepared set of engagement terms instead of writing clauses from scratch. You get your own copy, so editing it changes nothing for anyone else.
```

> The em dash after the bold title is the house bullet form (`- **Title** — description`)
> and stays. The rule is that the description text itself carries no em or en dash.

Do **not** mention the Platform console terms-library card: platform-admin surfaces have
no customer-facing angle and must not appear in this file at all.

- [ ] **Step 3: Regenerate the JSON**

```bash
deno run --allow-read --allow-write scripts/changelog-to-json.ts
```

- [ ] **Step 4: Commit**

```bash
git add public/changelog.md public/changelog.json package.json src/config/app.config.ts
git commit -m "note the hire-order setup checklist in the changelog"
```

---

## Self-review notes

Checked against the spec:

- §1 setup status → Task 3. The blocking-vs-decision distinction is asserted in both the unit test and the rail test.
- §2 platform library → Tasks 1, 4, 9. The separate-key decision is carried in the code comment on `TERMS_LIBRARY_KEY` and in `starterTerms.ts`, so it survives without the spec.
- §3 wiring → Tasks 5, 6, 7, 10. The merge rule has its own module, its own test, and a comment naming the failure it prevents.
- §4 countersign copy → Task 6, including the one existing test assertion it invalidates.
- §6 empty state → Task 11, as the compact pointer the spec decided on.
- §7 dismissal → Task 10, `useRailDismissed`.
- §5 and §8 are **not** in this plan by design. They are the follow-on plan.

Type consistency: `SetupStep` / `SetupStepKey` are defined in Task 3 and consumed by name in Tasks 10 (`SetupRail`, `ProducerWaitingCard`). `Letterhead` is imported from `LetterheadCard` throughout rather than redeclared. `HireOrderTermsSetting` and `HireOrderTemplate` always come from `@/lib/hireOrders/terms`. `mergeLetterhead`, `linesFromText`, `serializeLines` are defined once in Task 5 and used in Tasks 5 and 10.

Known ordering wrinkle: Task 7 Step 5 consumes a hook created in Task 8. It is flagged inline in both tasks with the two acceptable resolutions and an explicit instruction not to stub.
