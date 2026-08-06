# Hire Order Issue Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a producer ever discovering an issue failure from a toast. Every blocker on an order is surfaced before the Issue action, with an inline fix where the viewer is allowed to make it and an explicit admin-only state where they are not, and the artist's signing surface moves out of a modal onto the document.

**Architecture:** One new pure module turns the existing server-side readiness rule into a typed, viewer-aware blocker list by calling `orderReadyIssues` rather than restating it, so the rule keeps living in exactly one mirrored pair. Three surfaces consume it: a contextual callout over the live PDF preview on the edit page, a preflight sheet at the single-order Issue click, and a summary dialog for batch issue that sends only the clean subset. Nothing about the server contract, the readiness rule or the signing model changes.

**Tech Stack:** React 18 + TypeScript, Vite 5, TanStack Query v5, Tailwind + shadcn/ui, Vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-06-hire-order-onboarding-design.md` sections 5 and 8.

**Depends on:** `docs/superpowers/plans/2026-08-06-hire-order-setup-readiness.md` must land first. This plan consumes `useTermsLibrary` / `useImportTermsTemplates` / `useOrgTerms` (its Task 8), `TermsLibraryPicker` (its Task 7), and `mergeLetterhead` (its Task 5).

## Global Constraints

- **`any` is banned.** Lint runs `--max-warnings 0`. Where supabase-js cannot infer a joined-row shape, declare a local row `interface` and cast once at the query result with `as unknown as Row[]`, immediately after the error check.
- **No em dashes or en dashes in product copy** (UI strings, changelog). Use a period, comma, colon or middot.
- **Semantic design tokens only.** Accent numbered stops (`accent-50` to `accent-900`) and the amber and green stops are plain hex and **do not support Tailwind opacity modifiers**.
- **Test-first.** Write the failing test, run it, watch it fail, then implement.
- **Tests import the real module.** `computeBlockers` must call `orderReadyIssues`, not restate its rules, and its test must assert that behaviour rather than duplicate it.
- **No `vi.mock('@/integrations/supabase/client')` chains.** Use `createFakeSupabase` with the `vi.hoisted` client-swap idiom.
- **No migration, no edge-function change, no mirror change.** The readiness gate in `supabase/functions/generate-hire-orders/index.ts` is authoritative and untouched. Everything here is a client-side pre-check over the same inputs.
- **Do not rebuild the document in HTML.** The PDF is the legal artifact. Every surface keeps embedding the real rendered PDF.
- **Ships dark** behind the `hire_orders` entitlement.
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

| File | Responsibility |
|---|---|
| `src/lib/hireOrders/preflight.ts` | NEW. `computeBlockers`: the viewer-aware blocker list |
| `src/hooks/useOrderBlockers.ts` | NEW. Composes the org settings reads + capability + one order |
| `src/components/hireOrders/BlockerList.tsx` | NEW. The shared blocker rows with inline fixes, used by both preflight surfaces |
| `src/components/hireOrders/IssuePreflightSheet.tsx` | NEW. Single-order preflight at the Issue click |
| `src/components/hireOrders/BatchIssuePreflightDialog.tsx` | NEW. Batch summary, issues the clean subset |
| `src/components/hireOrders/edit/SetupCallout.tsx` | NEW. The contextual prompt over the live preview |
| `src/components/hireOrders/OrderSlideOver.tsx` | MOD. Issue opens the sheet instead of firing |
| `src/components/hireOrders/OrdersTable.tsx` | MOD. Issue selected opens the dialog instead of firing |
| `src/pages/HireOrderEditPage.tsx` | MOD. Mounts `SetupCallout` above the preview pane |
| `src/pages/HireOrderDetailPage.tsx` | MOD. Artist signing moves inline below the document |

---

## Task 1: `computeBlockers`

**Files:**
- Create: `src/lib/hireOrders/preflight.ts`
- Test: `src/lib/hireOrders/preflight.test.ts`

**Interfaces:**
- Consumes: `orderReadyIssues` from `./validate`, `resolveTermsClauses` from `./terms`, `OrderData` from `./types`
- Produces: `BlockerKey`, `Blocker`, `BlockerInput`, `computeBlockers(input: BlockerInput): Blocker[]`, `BLOCKER_COPY: Record<BlockerKey, { label: string; detail: string }>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/hireOrders/preflight.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeBlockers, BLOCKER_COPY } from "./preflight";
import type { OrderData } from "./types";
import type { HireOrderTermsSetting } from "./terms";

const READY: OrderData = {
  fee: { value: "1200.00", source: "manual" },
  recipient_email: { value: "mara@example.de", source: "showflow" },
  date: { value: "2026-04-12", source: "showflow" },
};
const LETTERHEAD = { legal_name: "Aurora Productions GmbH" };
const TERMS: HireOrderTermsSetting = {
  templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }],
  default_id: "t1",
};

describe("computeBlockers", () => {
  it("returns nothing when the order and the org are both ready", () => {
    expect(
      computeBlockers({ data: READY, letterhead: LETTERHEAD, terms: TERMS, termsVariant: "t1", canEditSettings: true }),
    ).toEqual([]);
  });

  it("reports order-scoped gaps as fixable regardless of capability", () => {
    const blockers = computeBlockers({
      data: { ...READY, fee: undefined },
      letterhead: LETTERHEAD,
      terms: TERMS,
      termsVariant: "t1",
      canEditSettings: false,
    });
    expect(blockers).toEqual([{ key: "missing_fee", scope: "order", fixable: true }]);
  });

  it("reports org-scoped gaps as fixable only with the settings capability", () => {
    const args = { data: READY, letterhead: null, terms: TERMS, termsVariant: "t1" };
    expect(computeBlockers({ ...args, canEditSettings: true })).toEqual([
      { key: "missing_letterhead", scope: "org", fixable: true },
    ]);
    expect(computeBlockers({ ...args, canEditSettings: false })).toEqual([
      { key: "missing_letterhead", scope: "org", fixable: false },
    ]);
  });

  // Mirrors issueOne: resolveTermsClauses(setting, order.terms_variant) must be non-empty.
  it("reports missing_terms when the order's variant resolves to no clauses", () => {
    const empty: HireOrderTermsSetting = { templates: [{ id: "t1", name: "Standard", clauses: [] }], default_id: "t1" };
    const blockers = computeBlockers({
      data: READY, letterhead: LETTERHEAD, terms: empty, termsVariant: "t1", canEditSettings: true,
    });
    expect(blockers.map((b) => b.key)).toEqual(["missing_terms"]);
  });

  it("orders blockers order-scope first, so the fixable ones read first", () => {
    const blockers = computeBlockers({
      data: {}, letterhead: null, terms: { templates: [], default_id: null }, termsVariant: null, canEditSettings: true,
    });
    expect(blockers.map((b) => b.key)).toEqual([
      "missing_fee",
      "missing_recipient_email",
      "missing_date",
      "missing_letterhead",
      "missing_terms",
    ]);
  });

  it("has copy for every key it can emit", () => {
    const blockers = computeBlockers({
      data: {}, letterhead: null, terms: { templates: [], default_id: null }, termsVariant: null, canEditSettings: true,
    });
    for (const b of blockers) {
      expect(BLOCKER_COPY[b.key].label.trim()).not.toBe("");
      expect(BLOCKER_COPY[b.key].detail.trim()).not.toBe("");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hireOrders/preflight.test.ts`
Expected: FAIL, cannot resolve `./preflight`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/hireOrders/preflight.ts`:

```ts
import { resolveTermsClauses, type HireOrderTermsSetting } from "./terms";
import type { OrderData } from "./types";
import { orderReadyIssues } from "./validate";

export type BlockerKey =
  | "missing_fee"
  | "missing_recipient_email"
  | "missing_date"
  | "missing_letterhead"
  | "missing_terms";

export interface Blocker {
  key: BlockerKey;
  /** `order`: fixable on the order itself. `org`: an app_settings value. */
  scope: "order" | "org";
  /** Whether THIS viewer may fix it. Order scope always; org scope by capability. */
  fixable: boolean;
}

export interface BlockerInput {
  data: OrderData;
  /** The org's resolved `hire_order_letterhead`. */
  letterhead: unknown;
  /** The org's resolved and normalized `hire_order_terms`. */
  terms: HireOrderTermsSetting;
  /** The order's own `terms_variant`. */
  termsVariant: string | null;
  /** `useCan("edit_hire_order_settings")`. */
  canEditSettings: boolean;
}

/** Order-scoped first, so the rows a producer can act on read before the ones they
 *  may not be able to. Also the display order in both preflight surfaces. */
const BLOCKER_ORDER: readonly BlockerKey[] = [
  "missing_fee",
  "missing_recipient_email",
  "missing_date",
  "missing_letterhead",
  "missing_terms",
];

const ORG_SCOPED: ReadonlySet<BlockerKey> = new Set(["missing_letterhead", "missing_terms"]);

function isBlockerKey(value: string): value is BlockerKey {
  return (BLOCKER_ORDER as readonly string[]).includes(value);
}

/** User-facing copy per blocker. Kept beside the rule so a new code cannot ship
 *  without text, unlike ISSUE_FAILURE_COPY which deliberately falls back to the raw
 *  code for internal failure modes. */
export const BLOCKER_COPY: Record<BlockerKey, { label: string; detail: string }> = {
  missing_fee: {
    label: "Engagement fee",
    detail: "This order has no fee. An order cannot go out without one.",
  },
  missing_recipient_email: {
    label: "Recipient email",
    detail: "There is no address to send the order to.",
  },
  missing_date: {
    label: "Engagement date",
    detail: "This order has no date on it.",
  },
  missing_letterhead: {
    label: "Letterhead legal name",
    detail: "The document header is empty. A hire order needs a legal party on it.",
  },
  missing_terms: {
    label: "Terms template",
    detail: "No clauses are configured for this order's terms, so the back page would be blank.",
  },
};

/**
 * Every reason this order cannot be issued yet, tagged with whether the current viewer
 * can fix it.
 *
 * Delegates to `orderReadyIssues` rather than restating its rules: that function is the
 * mirrored pair the edge function's `issueOne` actually gates on, so a change there
 * flows here automatically. The terms check below mirrors the one extra line `issueOne`
 * adds on top of it (`resolveTermsClauses(setting, order.terms_variant).length === 0`).
 *
 * This is a pre-check for the UI, never the enforcement. The server gate is unchanged.
 */
export function computeBlockers(input: BlockerInput): Blocker[] {
  const codes = new Set<BlockerKey>(orderReadyIssues(input.data, input.letterhead).filter(isBlockerKey));
  if (resolveTermsClauses(input.terms, input.termsVariant).length === 0) codes.add("missing_terms");

  return BLOCKER_ORDER.filter((key) => codes.has(key)).map((key) => {
    const scope = ORG_SCOPED.has(key) ? ("org" as const) : ("order" as const);
    return { key, scope, fixable: scope === "order" || input.canEditSettings };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hireOrders/preflight.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hireOrders/preflight.ts src/lib/hireOrders/preflight.test.ts
git commit -m "derive a viewer-aware blocker list from the existing readiness rule"
```

---

## Task 2: `useOrderBlockers`

**Files:**
- Create: `src/hooks/useOrderBlockers.ts`
- Test: `src/hooks/useOrderBlockers.test.ts`

**Interfaces:**
- Consumes: `computeBlockers` (Task 1), `useOrgTerms` from `@/hooks/useHireOrderSetup` (previous plan, Task 8), `useCan`, `resolveOrgSetting`
- Produces: `useOrderBlockers(orgId, order): { blockers: Blocker[]; isLoading: boolean; canEditSettings: boolean }` where `order` is `{ data: OrderData; terms_variant: string | null } | null`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useOrderBlockers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

const { canRef } = vi.hoisted(() => ({ canRef: { value: true } }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canRef.value }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useOrderBlockers } from "./useOrderBlockers";

const ORDER = {
  data: { fee: { value: "1200.00", source: "manual" as const } },
  terms_variant: "t1",
};

beforeEach(() => {
  canRef.value = true;
  seedClient({ app_settings: { data: [], error: null } });
});

describe("useOrderBlockers", () => {
  it("reports the org gaps on an unconfigured org", async () => {
    const { result } = renderHookWithProviders(() => useOrderBlockers("org-1", ORDER));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.blockers.map((b) => b.key)).toEqual([
      "missing_recipient_email",
      "missing_date",
      "missing_letterhead",
      "missing_terms",
    ]);
  });

  it("marks org gaps unfixable without the settings capability", async () => {
    canRef.value = false;
    const { result } = renderHookWithProviders(() => useOrderBlockers("org-1", ORDER));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const letterhead = result.current.blockers.find((b) => b.key === "missing_letterhead");
    expect(letterhead?.fixable).toBe(false);
    expect(result.current.canEditSettings).toBe(false);
  });

  it("returns no blockers for a null order", async () => {
    const { result } = renderHookWithProviders(() => useOrderBlockers("org-1", null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.blockers).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useOrderBlockers.test.ts`
Expected: FAIL, cannot resolve `./useOrderBlockers`.

- [ ] **Step 3: Write the implementation**

Create `src/hooks/useOrderBlockers.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting } from "@/data/settings";
import { useCan } from "@/hooks/useCapabilities";
import { useOrgTerms } from "@/hooks/useHireOrderSetup";
import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";
import { computeBlockers, type Blocker } from "@/lib/hireOrders/preflight";
import type { HireOrderTermsSetting } from "@/lib/hireOrders/terms";
import type { OrderData } from "@/lib/hireOrders/types";

const EMPTY_TERMS: HireOrderTermsSetting = { templates: [], default_id: null };

export interface BlockableOrder {
  data: OrderData;
  terms_variant: string | null;
}

/**
 * Every reason one order cannot be issued yet, resolved against the org's current
 * settings and this viewer's capability. Both preflight surfaces and the edit-page
 * callout read this, so they can never disagree about what is blocking.
 *
 * Shares the `["app-settings", ...]` cache entries with the setup rail, so opening the
 * preflight sheet on an already-loaded page costs no extra round trips.
 */
export function useOrderBlockers(
  orgId: string | null,
  order: BlockableOrder | null | undefined,
): { blockers: Blocker[]; isLoading: boolean; canEditSettings: boolean } {
  const canEditSettings = useCan("edit_hire_order_settings");
  const letterhead = useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    enabled: !!orgId,
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
  });
  const terms = useOrgTerms(orgId);

  const isLoading = !!orgId && (letterhead.isLoading || terms.isLoading);
  const blockers = order
    ? computeBlockers({
        data: order.data,
        letterhead: letterhead.data ?? null,
        terms: terms.data ?? EMPTY_TERMS,
        termsVariant: order.terms_variant,
        canEditSettings,
      })
    : [];

  return { blockers, isLoading, canEditSettings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useOrderBlockers.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOrderBlockers.ts src/hooks/useOrderBlockers.test.ts
git commit -m "resolve one order's blockers against org settings and capability"
```

---

## Task 3: `BlockerList` with inline fixes

The shared body of both preflight surfaces: one row per blocker, an inline control where the viewer can fix it, an admin-only state where they cannot.

**Files:**
- Create: `src/components/hireOrders/BlockerList.tsx`
- Test: `src/components/hireOrders/BlockerList.test.tsx`

**Interfaces:**
- Consumes: `Blocker`, `BLOCKER_COPY` (Task 1); `TermsLibraryPicker`, `useTermsLibrary`, `useImportTermsTemplates`, `useOrgTerms` (previous plan); `mergeLetterhead` (previous plan)
- Produces: `BlockerList({ orgId, blockers, orderId, onFixOrderField })`

- [ ] **Step 1: Write the failing test**

Create `src/components/hireOrders/BlockerList.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import type { Blocker } from "@/lib/hireOrders/preflight";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { BlockerList } from "./BlockerList";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("BlockerList", () => {
  it("names every blocker with its detail line", () => {
    const blockers: Blocker[] = [{ key: "missing_fee", scope: "order", fixable: true }];
    renderWithProviders(<BlockerList orgId="org-1" blockers={blockers} onFixOrderField={vi.fn()} />);
    expect(screen.getByText("Engagement fee")).toBeInTheDocument();
    expect(screen.getByText(/An order cannot go out without one/i)).toBeInTheDocument();
  });

  it("offers an inline letterhead fix when the viewer may make it", async () => {
    const blockers: Blocker[] = [{ key: "missing_letterhead", scope: "org", fixable: true }];
    renderWithProviders(<BlockerList orgId="org-1" blockers={blockers} onFixOrderField={vi.fn()} />);
    expect(await screen.findByLabelText(/Legal name/i)).toBeInTheDocument();
    expect(screen.queryByText("Admin only")).not.toBeInTheDocument();
  });

  it("shows an admin-only state instead of a control when the viewer may not", () => {
    const blockers: Blocker[] = [{ key: "missing_letterhead", scope: "org", fixable: false }];
    renderWithProviders(<BlockerList orgId="org-1" blockers={blockers} onFixOrderField={vi.fn()} />);
    expect(screen.getByText("Admin only")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Legal name/i)).not.toBeInTheDocument();
  });

  it("sends an order-scoped blocker back to the caller rather than fixing it inline", () => {
    const onFix = vi.fn();
    const blockers: Blocker[] = [{ key: "missing_date", scope: "order", fixable: true }];
    renderWithProviders(<BlockerList orgId="org-1" blockers={blockers} onFixOrderField={onFix} />);
    screen.getByRole("button", { name: /Open the order/i }).click();
    expect(onFix).toHaveBeenCalledWith("missing_date");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/hireOrders/BlockerList.test.tsx`
Expected: FAIL, cannot resolve `./BlockerList`.

- [ ] **Step 3: Write the implementation**

Create `src/components/hireOrders/BlockerList.tsx`:

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";
import { TermsLibraryPicker } from "@/components/settings/hireOrders/fields/TermsLibraryPicker";
import { useImportTermsTemplates, useOrgTerms, useTermsLibrary } from "@/hooks/useHireOrderSetup";
import { mergeLetterhead } from "@/lib/hireOrders/letterhead";
import { BLOCKER_COPY, type Blocker, type BlockerKey } from "@/lib/hireOrders/preflight";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Inline fix for `missing_letterhead`: the one field the gate actually checks.
 *  Merges onto the stored value so it cannot erase the agent fields (see
 *  mergeLetterhead). Everything else about the letterhead stays in Settings. */
function LetterheadFix({ orgId, idPrefix }: { orgId: string | null; idPrefix: string }) {
  const qc = useQueryClient();
  const stored = useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    enabled: !!orgId,
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
  });
  const [legalName, setLegalName] = useState("");
  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error("No active organization");
      if (!legalName.trim()) throw new Error("Enter the legal name");
      const payload = mergeLetterhead(stored.data, { legal_name: legalName.trim() });
      return upsertOrgSetting(supabase, orgId, "hire_order_letterhead", payload as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Letterhead saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="mt-2 space-y-1.5">
      <Label htmlFor={`${idPrefix}-legal-name`} className="text-xs">Legal name</Label>
      <div className="flex gap-2">
        <Input
          id={`${idPrefix}-legal-name`}
          className="h-8"
          value={legalName}
          placeholder="Aurora Productions GmbH"
          onChange={(e) => setLegalName(e.target.value)}
        />
        <Button size="sm" disabled={save.isPending || !orgId} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Saved for the whole organization, once.</p>
    </div>
  );
}

/** Inline fix for `missing_terms`: import a template from the platform library. */
function TermsFix({ orgId, idPrefix }: { orgId: string | null; idPrefix: string }) {
  const library = useTermsLibrary();
  const terms = useOrgTerms(orgId);
  const importTerms = useImportTermsTemplates(orgId);
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <div className="mt-2 space-y-2">
      <TermsLibraryPicker
        idPrefix={idPrefix}
        library={library.data ?? []}
        selectedIds={picked}
        alreadyHeldIds={(terms.data?.templates ?? []).map((t) => t.id)}
        onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
      />
      <Button
        size="sm"
        disabled={picked.length === 0 || importTerms.isPending || !orgId}
        onClick={() => importTerms.mutate({ templateIds: picked }, { onSuccess: () => setPicked([]) })}
      >
        Create from this template
      </Button>
    </div>
  );
}

export interface BlockerListProps {
  orgId: string | null;
  blockers: Blocker[];
  /** Order-scoped blockers are fixed on the order itself, not here. The caller
   *  decides what that means: the sheet navigates to the edit page, the edit page
   *  focuses the field. */
  onFixOrderField: (key: BlockerKey) => void;
  idPrefix?: string;
}

/** One row per blocker, with the inline fix where the viewer is allowed to make it.
 *  Shared by the single-order sheet and the edit-page callout so the wording and the
 *  affordances are identical wherever a producer meets the same gap. */
export function BlockerList({ orgId, blockers, onFixOrderField, idPrefix = "blocker" }: BlockerListProps) {
  return (
    <div className="space-y-2.5">
      {blockers.map((b) => (
        <div key={b.key} className="flex gap-2.5 rounded-lg border border-border p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{BLOCKER_COPY[b.key].label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{BLOCKER_COPY[b.key].detail}</p>

            {b.scope === "order" && (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => onFixOrderField(b.key)}>
                Open the order
              </Button>
            )}
            {b.scope === "org" && b.fixable && b.key === "missing_letterhead" && (
              <LetterheadFix orgId={orgId} idPrefix={`${idPrefix}-lh`} />
            )}
            {b.scope === "org" && b.fixable && b.key === "missing_terms" && (
              <TermsFix orgId={orgId} idPrefix={`${idPrefix}-terms`} />
            )}
            {b.scope === "org" && !b.fixable && (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                <Lock className="h-3 w-3" />
                Admin only
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/hireOrders/BlockerList.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/hireOrders/BlockerList.tsx src/components/hireOrders/BlockerList.test.tsx
git commit -m "add the shared blocker rows with inline fixes"
```

---

## Task 4: `IssuePreflightSheet` and wiring `OrderSlideOver`

**Files:**
- Create: `src/components/hireOrders/IssuePreflightSheet.tsx`
- Test: `src/components/hireOrders/IssuePreflightSheet.test.tsx`
- Modify: `src/components/hireOrders/OrderSlideOver.tsx`

**Interfaces:**
- Consumes: `useOrderBlockers` (Task 2), `BlockerList` (Task 3)
- Produces: `IssuePreflightSheet({ open, onOpenChange, orgId, order, onConfirm, isIssuing })`

- [ ] **Step 1: Write the failing test**

Create `src/components/hireOrders/IssuePreflightSheet.test.tsx`:

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

import { IssuePreflightSheet } from "./IssuePreflightSheet";

const ORDER = {
  id: "ho-1",
  order_no: "HO-2026-0001",
  artistName: "Mara Vogel",
  data: { fee: { value: "1200.00", source: "manual" as const }, recipient_email: { value: "m@e.de", source: "manual" as const }, date: { value: "2026-04-12", source: "manual" as const } },
  terms_variant: "t1",
};

const READY_SEED: Record<string, TableSeed> = {
  app_settings: {
    data: [
      { key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } },
      { key: "hire_order_terms", org_id: "org-1", value: { templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "t1" } },
    ],
    error: null,
  },
};

beforeEach(() => {
  canRef.value = true;
  seedClient({ app_settings: { data: [], error: null } });
});

describe("IssuePreflightSheet", () => {
  it("enables Issue and send when nothing is blocking", async () => {
    seedClient(READY_SEED);
    renderWithProviders(
      <IssuePreflightSheet open orgId="org-1" order={ORDER} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Issue and send" })).toBeEnabled());
    expect(screen.getByText(/Ready to issue/i)).toBeInTheDocument();
  });

  it("disables Issue and send while a blocker stands, and names it", async () => {
    renderWithProviders(
      <IssuePreflightSheet open orgId="org-1" order={ORDER} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText("Letterhead legal name")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Issue and send" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep as draft" })).toBeEnabled();
  });

  it("shows Admin only for an org blocker a producer cannot fix", async () => {
    canRef.value = false;
    renderWithProviders(
      <IssuePreflightSheet open orgId="org-1" order={ORDER} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getAllByText("Admin only").length).toBeGreaterThan(0));
  });

  it("calls onConfirm when Issue and send is pressed on a clean order", async () => {
    seedClient(READY_SEED);
    const onConfirm = vi.fn();
    renderWithProviders(
      <IssuePreflightSheet open orgId="org-1" order={ORDER} onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Issue and send" })).toBeEnabled());
    screen.getByRole("button", { name: "Issue and send" }).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/hireOrders/IssuePreflightSheet.test.tsx`
Expected: FAIL, cannot resolve `./IssuePreflightSheet`.

- [ ] **Step 3: Write the implementation**

Create `src/components/hireOrders/IssuePreflightSheet.tsx`:

```tsx
import { useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { ROUTES } from "@/config/app.config";
import { useOrderBlockers } from "@/hooks/useOrderBlockers";
import type { OrderData } from "@/lib/hireOrders/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BlockerList } from "./BlockerList";

export interface PreflightOrder {
  id: string;
  order_no: string | null;
  artistName: string;
  data: OrderData;
  terms_variant: string | null;
}

export interface IssuePreflightSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  order: PreflightOrder | null;
  /** Called only when nothing is blocking. The caller performs the actual issue. */
  onConfirm: () => void;
  isIssuing?: boolean;
}

/**
 * The pre-issue check. Replaces firing `issue` blind and reporting the failure in a
 * toast: everything that would fail is shown first, with the fix inline where this
 * viewer is allowed to make it.
 *
 * It is a pre-check, not the gate. The edge function still validates every order it is
 * asked to issue, so a stale client here costs a toast, never a bad document.
 */
export function IssuePreflightSheet({
  open, onOpenChange, orgId, order, onConfirm, isIssuing = false,
}: IssuePreflightSheetProps) {
  const navigate = useNavigate();
  const { blockers, isLoading } = useOrderBlockers(orgId, order);
  const clean = blockers.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader className="text-left">
          <p className="font-mono text-xs text-muted-foreground">
            {order?.order_no ?? "Draft"} · {order?.artistName ?? ""}
          </p>
          <SheetTitle className="font-display">
            {isLoading
              ? "Checking"
              : clean
                ? "Ready to issue"
                : blockers.length === 1
                  ? "One thing to settle first"
                  : `${blockers.length} things to settle first`}
          </SheetTitle>
          <SheetDescription>
            {clean
              ? "The PDF is generated, numbered and emailed. The artist gets a link to countersign."
              : "Nothing is sent until these are cleared. The draft is saved either way."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : clean ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-border p-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
              <p className="text-sm text-muted-foreground">Everything this order needs is in place.</p>
            </div>
          ) : (
            <BlockerList
              orgId={orgId}
              blockers={blockers}
              idPrefix="preflight"
              onFixOrderField={() => {
                if (order) navigate(ROUTES.HIRE_ORDER_EDIT.replace(":id", order.id));
              }}
            />
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-4">
          <Button disabled={!clean || isIssuing || isLoading} onClick={onConfirm}>
            Issue and send
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep as draft
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/hireOrders/IssuePreflightSheet.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire `OrderSlideOver`**

In `src/components/hireOrders/OrderSlideOver.tsx`:

1. Add imports:

```ts
import { IssuePreflightSheet, type PreflightOrder } from "./IssuePreflightSheet";
```

2. Add state beside the existing hooks:

```ts
const [preflightOpen, setPreflightOpen] = useState(false);
```

3. Replace the body of `handleIssue` so the button opens the sheet, and add the real issue as a separate function:

```ts
function handleIssue() {
  if (!displayOrder) return;
  setPreflightOpen(true);
}

function performIssue() {
  if (!displayOrder) return;
  action.mutate(
    { action: "issue", org_id: orgId, order_ids: [displayOrder.id] },
    {
      onSuccess: () => {
        setPreflightOpen(false);
        onOpenChange(false);
      },
    },
  );
}
```

4. Render the sheet at the end of the component's returned tree, as a sibling of `<Sheet>`:

```tsx
<IssuePreflightSheet
  open={preflightOpen}
  onOpenChange={setPreflightOpen}
  orgId={orgId}
  order={
    displayOrder
      ? ({
          id: displayOrder.id,
          order_no: displayOrder.order_no,
          artistName,
          data,
          terms_variant: displayOrder.terms_variant,
        } satisfies PreflightOrder)
      : null
  }
  onConfirm={performIssue}
  isIssuing={action.isPending}
/>
```

`artistName` and `data` are already computed in this component. Wrap the existing return
in a fragment if it is not already one.

- [ ] **Step 6: Run the slide-over tests**

Run: `npx vitest run src/components/hireOrders/OrderSlideOver.test.tsx`
Expected: PASS. A test that asserted "Issue and send" fires the mutation directly now
needs to assert it opens the sheet, then confirm from the sheet. Update it rather than
weakening the assertion.

- [ ] **Step 7: Commit**

```bash
git add src/components/hireOrders/IssuePreflightSheet.tsx src/components/hireOrders/IssuePreflightSheet.test.tsx src/components/hireOrders/OrderSlideOver.tsx src/components/hireOrders/OrderSlideOver.test.tsx
git commit -m "check an order before issuing instead of reporting the failure after"
```

---

## Task 5: Batch issue preflight

The single-order sheet does not answer what happens when seven orders are selected and
four are blocked. This dialog summarizes, then issues only the clean subset.

**Files:**
- Create: `src/components/hireOrders/BatchIssuePreflightDialog.tsx`
- Test: `src/components/hireOrders/BatchIssuePreflightDialog.test.tsx`
- Modify: `src/components/hireOrders/OrdersTable.tsx`

**Interfaces:**
- Consumes: `computeBlockers` (Task 1), `useCan`, the same settings reads as `useOrderBlockers`
- Produces: `BatchIssuePreflightDialog({ open, onOpenChange, orgId, orders, onConfirm, isIssuing })` where `onConfirm(cleanIds: string[]) => void`

- [ ] **Step 1: Write the failing test**

Create `src/components/hireOrders/BatchIssuePreflightDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => true }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { BatchIssuePreflightDialog } from "./BatchIssuePreflightDialog";

const full = { source: "manual" as const };
const CLEAN = {
  id: "a", order_no: "HO-1", artistName: "Mara Vogel", terms_variant: "t1",
  data: { fee: { value: "1200.00", ...full }, recipient_email: { value: "m@e.de", ...full }, date: { value: "2026-04-12", ...full } },
};
const NO_FEE = { ...CLEAN, id: "b", order_no: "HO-2", artistName: "Jonas Reiter", data: { ...CLEAN.data, fee: undefined } };

beforeEach(() =>
  seedClient({
    app_settings: {
      data: [
        { key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } },
        { key: "hire_order_terms", org_id: "org-1", value: { templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "t1" } },
      ],
      error: null,
    },
  }),
);

describe("BatchIssuePreflightDialog", () => {
  it("summarizes how many can go now", async () => {
    renderWithProviders(
      <BatchIssuePreflightDialog open orgId="org-1" orders={[CLEAN, NO_FEE]} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(await screen.findByText(/1 of 2 can be issued now/i)).toBeInTheDocument();
  });

  it("names the blocked orders and why", async () => {
    renderWithProviders(
      <BatchIssuePreflightDialog open orgId="org-1" orders={[CLEAN, NO_FEE]} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(await screen.findByText("Jonas Reiter")).toBeInTheDocument();
    expect(screen.getByText(/Engagement fee/)).toBeInTheDocument();
  });

  it("confirms with only the clean ids", async () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <BatchIssuePreflightDialog open orgId="org-1" orders={[CLEAN, NO_FEE]} onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );
    const btn = await screen.findByRole("button", { name: /Issue 1 order/i });
    btn.click();
    expect(onConfirm).toHaveBeenCalledWith(["a"]);
  });

  it("disables issuing when nothing in the selection is clean", async () => {
    renderWithProviders(
      <BatchIssuePreflightDialog open orgId="org-1" orders={[NO_FEE]} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /Issue 0 orders/i })).toBeDisabled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/hireOrders/BatchIssuePreflightDialog.test.tsx`
Expected: FAIL, cannot resolve `./BatchIssuePreflightDialog`.

- [ ] **Step 3: Write the implementation**

Create `src/components/hireOrders/BatchIssuePreflightDialog.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting } from "@/data/settings";
import { useCan } from "@/hooks/useCapabilities";
import { useOrgTerms } from "@/hooks/useHireOrderSetup";
import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";
import { BLOCKER_COPY, computeBlockers } from "@/lib/hireOrders/preflight";
import type { HireOrderTermsSetting } from "@/lib/hireOrders/terms";
import type { OrderData } from "@/lib/hireOrders/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const EMPTY_TERMS: HireOrderTermsSetting = { templates: [], default_id: null };

export interface BatchPreflightOrder {
  id: string;
  order_no: string | null;
  artistName: string;
  data: OrderData;
  terms_variant: string | null;
}

export interface BatchIssuePreflightDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  orders: BatchPreflightOrder[];
  /** Called with the ids that passed the check. The caller performs the issue. */
  onConfirm: (cleanIds: string[]) => void;
  isIssuing?: boolean;
}

/**
 * Batch preflight. The single-order sheet does not scale to a selection, and issuing
 * seven to have four fail is exactly the post-hoc-toast pattern this work removes.
 *
 * Sends only the clean subset, leaving the blocked rows selected in the table so they
 * can be fixed and retried, which matches what OrdersTable's onSuccess already does
 * with per-row failures returned by the edge function.
 *
 * No inline fixes here on purpose: a fix is per-order or org-wide, and mixing both into
 * a list of seven is unreadable. The blocked rows are named so the producer can open
 * each one, where the single-order sheet does offer the fix.
 */
export function BatchIssuePreflightDialog({
  open, onOpenChange, orgId, orders, onConfirm, isIssuing = false,
}: BatchIssuePreflightDialogProps) {
  const canEditSettings = useCan("edit_hire_order_settings");
  const letterhead = useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    enabled: !!orgId && open,
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
  });
  const terms = useOrgTerms(orgId);
  const isLoading = !!orgId && (letterhead.isLoading || terms.isLoading);

  const checked = orders.map((o) => ({
    order: o,
    blockers: computeBlockers({
      data: o.data,
      letterhead: letterhead.data ?? null,
      terms: terms.data ?? EMPTY_TERMS,
      termsVariant: o.terms_variant,
      canEditSettings,
    }),
  }));
  const clean = checked.filter((c) => c.blockers.length === 0);
  const blocked = checked.filter((c) => c.blockers.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Issue selected orders</DialogTitle>
          <DialogDescription>
            {isLoading
              ? "Checking the selection."
              : `${clean.length} of ${orders.length} can be issued now. The rest stay as drafts.`}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          blocked.length > 0 && (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {blocked.map(({ order, blockers }) => (
                <div key={order.id} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">{order.artistName}</p>
                  <p className="font-mono text-xs text-muted-foreground">{order.order_no ?? "Draft"}</p>
                  <p className="mt-1 text-xs text-amber-600">
                    {blockers.map((b) => BLOCKER_COPY[b.key].label).join(", ")}
                  </p>
                </div>
              ))}
            </div>
          )
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={clean.length === 0 || isIssuing || isLoading}
            onClick={() => onConfirm(clean.map((c) => c.order.id))}
          >
            Issue {clean.length} {clean.length === 1 ? "order" : "orders"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/hireOrders/BatchIssuePreflightDialog.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire `OrdersTable`**

In `src/components/hireOrders/OrdersTable.tsx`:

1. Add imports and state:

```ts
import { BatchIssuePreflightDialog, type BatchPreflightOrder } from "./BatchIssuePreflightDialog";
import type { OrderData } from "@/lib/hireOrders/types";

const [batchOpen, setBatchOpen] = useState(false);
```

2. Change `handleIssueSelected` so the button opens the dialog, and move the existing
   mutation body into a function that takes the ids the dialog confirmed. Keep the
   existing `onSuccess` selection-pruning logic exactly as it is:

```ts
const handleIssueSelected = () => setBatchOpen(true);

const issueIds = (idsToIssue: string[]) => {
  if (idsToIssue.length === 0) return;
  action.mutate(
    { action: "issue", org_id: orgId, order_ids: idsToIssue },
    {
      // ...the existing onSuccess block, unchanged...
    },
  );
  setBatchOpen(false);
};
```

3. Render the dialog beside the selection bar:

```tsx
<BatchIssuePreflightDialog
  open={batchOpen}
  onOpenChange={setBatchOpen}
  orgId={orgId}
  orders={orders
    .filter((o) => selected.has(o.id) && isIssuable(o.status))
    .map((o) => ({
      id: o.id,
      order_no: o.order_no,
      artistName: o.artists?.name ?? "Unknown artist",
      data: (o.data ?? {}) as OrderData,
      terms_variant: o.terms_variant,
    } satisfies BatchPreflightOrder))}
  onConfirm={issueIds}
  isIssuing={action.isPending}
/>
```

The `orders.filter(...)` here reproduces the exact same guarded id derivation the old
`handleIssueSelected` used, so the dialog can never offer to issue a row that is hidden
or not issuable.

- [ ] **Step 6: Run the table tests**

Run: `npx vitest run src/components/hireOrders/OrdersTable.test.tsx`
Expected: PASS. Tests that asserted "Issue selected" fires the mutation now need to go
through the dialog. Update them; do not delete them.

- [ ] **Step 7: Commit**

```bash
git add src/components/hireOrders/BatchIssuePreflightDialog.tsx src/components/hireOrders/BatchIssuePreflightDialog.test.tsx src/components/hireOrders/OrdersTable.tsx src/components/hireOrders/OrdersTable.test.tsx
git commit -m "summarize a batch before issuing and send only the clean subset"
```

---

## Task 6: Contextual callout on the edit page

`HireOrderEditPage` already renders fields left, live PDF right, and already computes
`orderReadyIssues` at line 451. This adds the missing half: an org-scoped gap is called
out on the document where it is visible, with the same one-click fix.

**Files:**
- Create: `src/components/hireOrders/edit/SetupCallout.tsx`
- Test: `src/components/hireOrders/edit/SetupCallout.test.tsx`
- Modify: `src/pages/HireOrderEditPage.tsx`

**Interfaces:**
- Consumes: `Blocker`, `BLOCKER_COPY` (Task 1); `BlockerList` (Task 3)
- Produces: `SetupCallout({ orgId, blockers })`, rendering nothing when no org-scoped blocker is present

- [ ] **Step 1: Write the failing test**

Create `src/components/hireOrders/edit/SetupCallout.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import type { Blocker } from "@/lib/hireOrders/preflight";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { SetupCallout } from "./SetupCallout";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("SetupCallout", () => {
  it("renders nothing when only order-scoped blockers stand", () => {
    const blockers: Blocker[] = [{ key: "missing_fee", scope: "order", fixable: true }];
    const { container } = renderWithProviders(<SetupCallout orgId="org-1" blockers={blockers} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are no blockers at all", () => {
    const { container } = renderWithProviders(<SetupCallout orgId="org-1" blockers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("calls out an org-scoped gap against the document", async () => {
    const blockers: Blocker[] = [{ key: "missing_letterhead", scope: "org", fixable: true }];
    renderWithProviders(<SetupCallout orgId="org-1" blockers={blockers} />);
    expect(screen.getByText(/The header on this document is empty/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/Legal name/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/hireOrders/edit/SetupCallout.test.tsx`
Expected: FAIL, cannot resolve `./SetupCallout`.

- [ ] **Step 3: Write the implementation**

Create `src/components/hireOrders/edit/SetupCallout.tsx`:

```tsx
import type { Blocker } from "@/lib/hireOrders/preflight";
import { BlockerList } from "@/components/hireOrders/BlockerList";

/**
 * Org-level gaps, called out over the live document preview.
 *
 * Only org-scoped blockers appear here: the order's own fields are already on screen in
 * the left column, with their own provenance chips, so repeating them would be noise.
 * The point is the gap you can SEE on the document but cannot fix from the form.
 *
 * Renders nothing when there is nothing org-level to say, so it never occupies space on
 * a configured org.
 */
export function SetupCallout({ orgId, blockers }: { orgId: string | null; blockers: Blocker[] }) {
  const orgBlockers = blockers.filter((b) => b.scope === "org");
  if (orgBlockers.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-accent-200 bg-accent-50 p-3">
      <p className="text-sm font-semibold text-accent-700">
        {orgBlockers.some((b) => b.key === "missing_letterhead")
          ? "The header on this document is empty"
          : "The back page of this document is empty"}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Set it once here and every future order carries it. This is not specific to this order.
      </p>
      <div className="mt-3">
        <BlockerList orgId={orgId} blockers={orgBlockers} idPrefix="callout" onFixOrderField={() => {}} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/hireOrders/edit/SetupCallout.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Mount it on the edit page**

In `src/pages/HireOrderEditPage.tsx`:

1. Add imports:

```ts
import { useOrderBlockers } from "@/hooks/useOrderBlockers";
import { SetupCallout } from "@/components/hireOrders/edit/SetupCallout";
```

2. Beside the existing `readyIssues` computation around line 451, add:

```ts
const { blockers } = useOrderBlockers(orgId, order ? { data: displayData, terms_variant: termsVariant } : null);
```

Leave `readyIssues`, `issueDisabled` and `issueTitle` exactly as they are. They already
gate the Issue button correctly; this hook only feeds the callout, and duplicating the
gate would be a second source of truth.

3. In the right-hand column of the `lg:grid-cols-[428px_1fr]` grid at line 498, render
   the callout immediately above the preview:

```tsx
<div>
  <SetupCallout orgId={orgId} blockers={blockers} />
  {/* the existing live preview element, unchanged */}
</div>
```

- [ ] **Step 6: Run the edit-page tests**

Run: `npx vitest run src/pages/HireOrderEditPage.test.tsx`
Expected: PASS, unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/components/hireOrders/edit/SetupCallout.tsx src/components/hireOrders/edit/SetupCallout.test.tsx src/pages/HireOrderEditPage.tsx
git commit -m "call out org-level gaps against the live document"
```

---

## Task 7: Artist signing moves onto the document

Presentation only. `canArtistSign`, the consent text, `SignaturePad` and the whole
electronic-countersign path are unchanged.

**Files:**
- Modify: `src/pages/HireOrderDetailPage.tsx`
- Test: `src/pages/HireOrderDetailPage.test.tsx`

**Interfaces:**
- Consumes: the existing `canArtistSign`, `SignHireOrderDialog`, embedded PDF and `OrderFactsRail`

- [ ] **Step 1: Write the failing test**

Append to `src/pages/HireOrderDetailPage.test.tsx`:

```tsx
describe("artist signing strip", () => {
  it("shows a signing prompt directly under the document when the artist may sign", async () => {
    // Render the page in the artist-can-sign state the existing suite already sets up.
    // Reuse whatever helper that suite uses to produce an issued order in electronic
    // mode with the viewer linked as its artist.
    await renderArtistViewingSignableOrder();
    expect(screen.getByText(/needs your signature/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Countersign/i })).toBeInTheDocument();
  });

  it("shows no signing strip for a producer viewing the same order", async () => {
    await renderProducerViewingIssuedOrder();
    expect(screen.queryByText(/needs your signature/i)).not.toBeInTheDocument();
  });
});
```

> Read the existing `HireOrderDetailPage.test.tsx` first and reuse its setup helpers
> rather than inventing new ones. If it has no such helper, extract one from its
> existing artist-signing test before writing these two.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/HireOrderDetailPage.test.tsx`
Expected: FAIL, no "needs your signature" text.

- [ ] **Step 3: Add the strip**

In `src/pages/HireOrderDetailPage.tsx`, inside the `HireOrderDetail` component, directly
below the embedded PDF element and before the closing of its column, add:

```tsx
{artistCanSign && (
  <div className="mt-3 rounded-lg border border-accent-200 bg-accent-50 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-accent-700">This order needs your signature</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Read the document above, then sign. You get a countersigned PDF by email straight after.
        </p>
      </div>
      <Button className="shrink-0" onClick={() => setSignOpen(true)}>
        Countersign
      </Button>
    </div>
  </div>
)}
```

using whatever local names the file already carries for the `canArtistSign` result and
the `SignHireOrderDialog` open state. Then remove the previous, less prominent signing
entry point so there is exactly one, and leave `SignHireOrderDialog` itself mounted and
unchanged: it still owns the pad, the consent text and the mutation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/HireOrderDetailPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify in the browser**

Use `preview_start`, sign in as an artist with an issued order on an org in electronic
mode, open `/hire-orders/<id>`, and confirm the strip sits under the document, that
Countersign opens the pad, and that signing still produces the signed PDF and the
countersigned status. Screenshot both states.

- [ ] **Step 6: Commit**

```bash
git add src/pages/HireOrderDetailPage.tsx src/pages/HireOrderDetailPage.test.tsx
git commit -m "put the artist signing prompt on the document"
```

---

## Task 8: Full gate and changelog

- [ ] **Step 1: Run the whole gate**

```bash
npm run lint && npx tsc -p tsconfig.app.json --noEmit && npx tsc -p tsconfig.tools.json --noEmit && npx vitest run
```

Expected: all green. No edge or pgTAP run is needed: this plan changes neither.

- [ ] **Step 2: Verify the end-to-end path in the browser**

On a fresh org with `hire_orders` on and nothing configured:

1. `/hire-orders`, draft an order from a fully cast date. Drafting must still work with
   nothing configured. That is the soft gate and it must not have regressed.
2. Open the order in the slide-over, press Issue. The preflight sheet must name the
   letterhead and terms gaps and disable Issue.
3. Fix both from the sheet. Issue must enable without a reload.
4. Select two orders in the table, one of which has no fee. The batch dialog must read
   "1 of 2 can be issued now" and issue only the clean one, leaving the other selected.

- [ ] **Step 3: Add the changelog entry**

If the setup-readiness plan landed on the same calendar day, its `1.14.0` block already
exists: append an `### Improved` section to it and do **not** open a new version. Only if
this ships on a later day does it get its own MINOR block, with `package.json` and
`APP_META.VERSION` bumped to match.

```markdown
### Improved
- **Know before you send** — Issuing a hire order now shows anything missing first, with the fix right there, instead of failing after you press send.
- **Batch issuing is honest about what it can send** — Select any number of orders and see exactly how many can go now. The rest stay selected as drafts so you can fix them.
- **Signing is on the document** — Artists sign right under the order they are reading, instead of in a separate window.
```

> The em dash after the bold title is the house bullet form and stays. The rule is that
> the description text itself carries no em or en dash.

- [ ] **Step 4: Regenerate the JSON**

```bash
deno run --allow-read --allow-write scripts/changelog-to-json.ts
```

- [ ] **Step 5: Commit**

```bash
git add public/changelog.md public/changelog.json
git commit -m "note the issue preflight in the changelog"
```

---

## Self-review notes

Checked against the spec:

- §5 `computeBlockers` shape and the delegation-not-restatement rule → Task 1, asserted directly in its test.
- §5.1 contextual callout on the edit page → Task 6, org-scoped only, mounted over the existing preview pane.
- §5.2 preflight sheet → Task 4, including the three states (clean, fixable, admin only) and "Keep as draft".
- §5.3 batch → Task 5, issuing the clean subset and preserving the existing selection-pruning behaviour.
- §5.4 generic producer copy, no name, no nudge → carried by `BlockerList`'s "Admin only" state; nothing in this plan calls `list_org_members`.
- §8 artist signing → Task 7, presentation only, PDF and signing model untouched.

Type consistency: `Blocker`, `BlockerKey`, `BLOCKER_COPY` are defined once in Task 1 and imported by name in Tasks 2, 3, 5, 6. `PreflightOrder` (Task 4) and `BatchPreflightOrder` (Task 5) are deliberately separate types with the same fields, because the batch one is always a list row while the single one can come from either a list row or the detail query; both are constructed at their call site with `satisfies`. `useOrgTerms` and `mergeLetterhead` come from the previous plan and are consumed, never redefined.

Deliberate non-change: `HireOrderEditPage`'s existing `readyIssues` / `issueDisabled` /
`issueTitle` gate stays. Task 6 adds a hook alongside it for the callout only. Replacing
that gate with `computeBlockers` would be a second refactor riding on a UI task, and the
existing gate is already correct.
