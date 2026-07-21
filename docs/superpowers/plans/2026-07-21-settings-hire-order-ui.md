# Settings & Hire-Order UI Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Letterhead address field (spaces/new-lines), add a per-order booking-agent name+email override to the Generate hire-order dialog, and replace the overflowing Settings tab bar with a grouped vertical left nav.

**Architecture:** Three independent changes. (1) A controlled-input fix in one card. (2) A new nullable-columns-on-`hire_orders` override that the edge function merges over the org letterhead at render. (3) A layout refactor of `SettingsPage` using the same Radix `Tabs` root with a vertical, grouped `TabsList`.

**Tech Stack:** React 18 + TS, Radix/shadcn `Tabs`, `@tanstack/react-query` v5, Supabase (Postgres + Deno edge functions), Vitest + `@/test/supabaseFake`, Deno test + `_shared/testing.ts`.

## Global Constraints

- Lint gate is zero-warning: `npm run lint` must pass (`--max-warnings 0`). `any` is banned — use an explicit row interface + single `as unknown as` cast at the query boundary, or the typed test helpers.
- Never hand-edit `supabase/migrations/**` or `src/integrations/supabase/types.ts` — schema changes go through the migration tool; types are regenerated.
- `src/integrations/supabase/types.ts` and `supabase/functions/_shared/database.types.ts` are byte-equal mirrors (sync-tested by `src/integrations/supabase/typesMirror.test.ts`) — regenerate both together.
- Use semantic Tailwind tokens only (`bg-muted`, `text-muted-foreground`, `bg-destructive`, …); never hardcode colors.
- Tests import the real module; use `@/test/supabaseFake` (frontend) / `_shared/testing.ts` (edge) — never `vi.mock` the client chain.
- Hire orders ship DARK (`hire_orders` entitlement defaults off). No changelog entry for hire-order internals; the Settings-nav change is user-facing and may get a changelog line at release.
- Edge Deno suite runs with `--node-modules-dir=none`.
- Commit after each task.

---

## File Structure

- `src/components/settings/hireOrders/LetterheadCard.tsx` — MODIFY (Task 1): raw-text address state.
- `src/components/settings/hireOrders/LetterheadCard.test.tsx` — CREATE (Task 1).
- Migration (tool-generated) + `src/integrations/supabase/types.ts` + `supabase/functions/_shared/database.types.ts` — MODIFY (Task 2): two nullable columns.
- `src/data/hireOrders.ts` — MODIFY (Task 3): extend `HireOrderReview` + `updateHireOrderReview`.
- `src/data/hireOrders.test.ts` — MODIFY (Task 3): agent-column write assertions.
- `supabase/functions/generate-hire-orders/index.ts` — MODIFY (Task 4): select + merge override over letterhead in `issueOne` and `previewOrder`.
- `supabase/functions/generate-hire-orders/index.di.test.ts` — MODIFY (Task 4): override + inherit render assertions.
- `src/components/shows/hireOrders/GenerateHireOrderDialog.tsx` — MODIFY (Task 5): letterhead prefill + agent fields + persist.
- `src/components/shows/hireOrders/GenerateHireOrderDialog.test.tsx` — MODIFY (Task 5): prefill + persist + seed `app_settings`.
- `src/pages/SettingsPage.tsx` — MODIFY (Task 6): grouped vertical nav.
- `src/pages/SettingsPage.test.tsx` — MODIFY (Task 6): grouped-nav + role-gating test.

---

## Task 1: Fix spaces & new-lines in Letterhead → Address

**Files:**
- Modify: `src/components/settings/hireOrders/LetterheadCard.tsx`
- Test: `src/components/settings/hireOrders/LetterheadCard.test.tsx` (create)

**Interfaces:**
- Consumes: existing `Letterhead` interface, `LETTERHEAD_DEFAULT`, `resolveOrgSetting`, `upsertOrgSetting`.
- Produces: no new exports. Behavior: the Address `<Textarea>` accepts spaces and new-lines verbatim while editing; `address_lines` is derived only on Save.

- [ ] **Step 1: Write the failing test**

Create `src/components/settings/hireOrders/LetterheadCard.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { LetterheadCard } from "./LetterheadCard";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("LetterheadCard address field", () => {
  it("preserves trailing spaces and blank lines while typing", async () => {
    renderWithProviders(<LetterheadCard orgId="org-1" />);
    const address = await screen.findByLabelText("Address");
    fireEvent.change(address, { target: { value: "Street 1\n\n10999 Berlin " } });
    // The raw text is kept verbatim — not collapsed by trim/filter.
    expect(address).toHaveValue("Street 1\n\n10999 Berlin ");
  });

  it("parses address to lines only on Save (trailing space trimmed, interior blank kept)", async () => {
    renderWithProviders(<LetterheadCard orgId="org-1" />);
    const address = await screen.findByLabelText("Address");
    fireEvent.change(address, { target: { value: "Street 1\n\n10999 Berlin " } });
    fireEvent.click(screen.getByRole("button", { name: "Save letterhead" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const upsert = calls.find((c) => c.table === "app_settings" && c.method === "upsert");
      expect(upsert).toBeDefined();
      const value = (upsert!.args[0] as { value: { address_lines: string[] } }).value;
      expect(value.address_lines).toEqual(["Street 1", "", "10999 Berlin"]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/hireOrders/LetterheadCard.test.tsx`
Expected: FAIL — first test fails (value comes back `"Street 1\n10999 Berlin"`, blank line + trailing space stripped).

- [ ] **Step 3: Implement the fix**

In `src/components/settings/hireOrders/LetterheadCard.tsx`:

Replace the `parseLines` helper with a save-time normalizer and keep `serializeLines`:

```tsx
/** One address line per row. On SAVE only: trim trailing whitespace per line
 *  (leading indentation + interior blanks preserved), then drop empty lines from
 *  the top and bottom so a stray leading/trailing Enter is not stored. */
function linesFromText(text: string): string[] {
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start++;
  while (end > start && lines[end - 1] === "") end--;
  return lines.slice(start, end);
}
function serializeLines(lines: string[]): string {
  return lines.join("\n");
}
```

Add a raw-text state next to `form`, seeded in the same effect:

```tsx
const [form, setForm] = useState<Letterhead>(LETTERHEAD_DEFAULT);
const [addressText, setAddressText] = useState<string>("");
const seededRef = useRef(false);
useEffect(() => {
  if (data && !seededRef.current) {
    seededRef.current = true;
    setForm(data);
    setAddressText(serializeLines(data.address_lines));
  }
}, [data]);
```

Change the save mutation to derive lines from the raw text at save time:

```tsx
const save = useMutation({
  mutationFn: () => {
    if (!orgId) throw new Error("No active organization");
    const payload: Letterhead = { ...form, address_lines: linesFromText(addressText) };
    return upsertOrgSetting(supabase, orgId, "hire_order_letterhead", payload as unknown as Json);
  },
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ["app-settings"] });
    toast.success("Letterhead saved");
  },
  onError: (e: Error) => toast.error(e.message),
});
```

Bind the Address `<Textarea>` to the raw text (no transform on change):

```tsx
<Textarea
  id="ho-address"
  rows={3}
  value={addressText}
  placeholder={"Street and number\nPostal code and city\nCountry"}
  onChange={(e) => setAddressText(e.target.value)}
/>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/settings/hireOrders/LetterheadCard.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/hireOrders/LetterheadCard.tsx src/components/settings/hireOrders/LetterheadCard.test.tsx
git commit -m "fix letterhead address field eating spaces and new lines"
```

---

## Task 2: Add `agent_name` / `agent_email` columns to `hire_orders`

**Files:**
- Create (via migration tool): a new `supabase/migrations/<version>_add_hire_order_agent_override.sql`
- Modify (via codegen): `src/integrations/supabase/types.ts`, `supabase/functions/_shared/database.types.ts`

**Interfaces:**
- Produces: `hire_orders.agent_name: string | null` and `hire_orders.agent_email: string | null` on the Row/Insert/Update types, consumed by Tasks 3, 4, 5.

- [ ] **Step 1: Apply the migration (Supabase MCP)**

Use the Supabase MCP `apply_migration` tool (NOT a hand-written file):
- name: `add_hire_order_agent_override`
- query:

```sql
alter table public.hire_orders
  add column agent_name text,
  add column agent_email text;

comment on column public.hire_orders.agent_name is
  'Per-order booking-agent name override. NULL inherits the org hire_order_letterhead default; empty string prints no agent.';
comment on column public.hire_orders.agent_email is
  'Per-order booking-agent email override. NULL inherits the org hire_order_letterhead default; empty string prints no agent.';
```

The tool records a real-timestamp version and writes the migration file; do not rename or edit it afterward (use a follow-up migration if a change is needed). No RLS change — existing `hire_orders` policies cover the new columns.

- [ ] **Step 2: Regenerate types into both mirrors**

Run the Supabase MCP `generate_typescript_types` tool. Write its output verbatim to `src/integrations/supabase/types.ts`, then copy the identical content to `supabase/functions/_shared/database.types.ts`.

Confirm `hire_orders` Row/Insert/Update now include `agent_name` and `agent_email` (both `string | null` / optional).

- [ ] **Step 3: Verify mirror + typecheck**

Run: `npx vitest run src/integrations/supabase/typesMirror.test.ts && npx tsc --noEmit`
Expected: PASS (mirror byte-equal, no type errors).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts
git commit -m "add agent_name/agent_email override columns to hire_orders"
```

---

## Task 3: Persist the agent override via `updateHireOrderReview`

**Files:**
- Modify: `src/data/hireOrders.ts` (`HireOrderReview`, `updateHireOrderReview`)
- Test: `src/data/hireOrders.test.ts`

**Interfaces:**
- Consumes: `hire_orders.agent_name`/`agent_email` columns (Task 2).
- Produces: `HireOrderReview` gains optional `agentName?: string | null` and `agentEmail?: string | null`. `updateHireOrderReview` writes each column ONLY when its key is present (`!== undefined`). Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Add to `src/data/hireOrders.test.ts` (co-located pattern; uses `createFakeSupabase` + `fake.calls`):

```ts
describe("updateHireOrderReview agent override", () => {
  it("writes agent_name/agent_email when provided", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null } });
    await updateHireOrderReview(
      fake as never,
      "ho-1",
      { feeAmount: 500, termsVariant: "standard", agentName: "Solo Agent", agentEmail: "solo@x.com" },
      { artist_name: { value: "Ada", source: "showflow" } },
    );
    const update = fake.calls.find((c) => c.table === "hire_orders" && c.method === "update");
    const patch = update!.args[0] as { agent_name?: string; agent_email?: string };
    expect(patch.agent_name).toBe("Solo Agent");
    expect(patch.agent_email).toBe("solo@x.com");
  });

  it("omits agent columns entirely when not provided", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null } });
    await updateHireOrderReview(
      fake as never,
      "ho-1",
      { feeAmount: 500, termsVariant: "standard" },
      {},
    );
    const update = fake.calls.find((c) => c.table === "hire_orders" && c.method === "update");
    const patch = update!.args[0] as Record<string, unknown>;
    expect("agent_name" in patch).toBe(false);
    expect("agent_email" in patch).toBe(false);
  });
});
```

Ensure `updateHireOrderReview` is imported at the top of the test file (add to the existing import from `./hireOrders` if not already present).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/hireOrders.test.ts`
Expected: FAIL — `agentName`/`agentEmail` are not on the `HireOrderReview` type and not written.

- [ ] **Step 3: Implement**

In `src/data/hireOrders.ts`, extend the interface:

```ts
/** The producer's pre-issue review edits from the generate dialog. */
export interface HireOrderReview {
  feeAmount: number | null;
  termsVariant: string;
  /** Per-order booking-agent overrides. Present only when the producer edited them;
   *  `""` means "print no agent", omitted means "leave the column unchanged". */
  agentName?: string | null;
  agentEmail?: string | null;
}
```

In `updateHireOrderReview`, after building `patch`, conditionally add the agent columns:

```ts
const patch: Database["public"]["Tables"]["hire_orders"]["Update"] = {
  fee_amount: review.feeAmount,
  terms_variant: review.termsVariant,
  data: data as Database["public"]["Tables"]["hire_orders"]["Update"]["data"],
};
if (review.agentName !== undefined) patch.agent_name = review.agentName;
if (review.agentEmail !== undefined) patch.agent_email = review.agentEmail;
const { error } = await client.from("hire_orders").update(patch).eq("id", id);
if (error) throw error;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/data/hireOrders.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add src/data/hireOrders.ts src/data/hireOrders.test.ts
git commit -m "persist per-order agent override in updateHireOrderReview"
```

---

## Task 4: Merge the order agent override over the letterhead at render

**Files:**
- Modify: `supabase/functions/generate-hire-orders/index.ts` (`IssueOrderRow`, `PreviewOrderRow`, `issueOne` select+merge, `previewOrder` select+merge)
- Test: `supabase/functions/generate-hire-orders/index.di.test.ts`

**Interfaces:**
- Consumes: `hire_orders.agent_name`/`agent_email` (Task 2), existing `HireOrderLetterhead` (has optional `agent_name`/`agent_email`), `deps.renderHireOrderPdf({ ..., letterhead })`.
- Produces: `renderHireOrderPdf` receives a letterhead whose `agent_name`/`agent_email` are `order.agent_name ?? letterhead.agent_name` (same for email).

- [ ] **Step 1: Write the failing tests**

Add to `supabase/functions/generate-hire-orders/index.di.test.ts`. These override `deps.renderHireOrderPdf` with a capturing spy (the default stub ignores its args):

```ts
Deno.test("issue merges the order's agent override over the org letterhead", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: issuableOrder({ agent_name: "Solo Agent", agent_email: "solo@x.com" }) },
        { when: { __write: true }, data: null },
      ],
      artists: { data: { user_id: "u-artist" } },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [{ org_id: ORG, value: { legal_name: "Nord GmbH", address_lines: [], registration_line: "", agent_name: "Org Agent", agent_email: "org@x.com" } }] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured: { letterhead: { agent_name?: string; agent_email?: string } } | null = null;
  deps.renderHireOrderPdf = (a) => { captured = a as unknown as typeof captured; return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46])); };

  const res = await handle(makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }), deps);
  assertEquals(res.status, 200);
  assertEquals(captured!.letterhead.agent_name, "Solo Agent");
  assertEquals(captured!.letterhead.agent_email, "solo@x.com");
});

Deno.test("issue inherits the letterhead agent when the order override is null", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: issuableOrder({ agent_name: null, agent_email: null }) },
        { when: { __write: true }, data: null },
      ],
      artists: { data: { user_id: "u-artist" } },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [{ org_id: ORG, value: { legal_name: "Nord GmbH", address_lines: [], registration_line: "", agent_name: "Org Agent", agent_email: "org@x.com" } }] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured: { letterhead: { agent_name?: string } } | null = null;
  deps.renderHireOrderPdf = (a) => { captured = a as unknown as typeof captured; return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46])); };

  const res = await handle(makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }), deps);
  assertEquals(res.status, 200);
  assertEquals(captured!.letterhead.agent_name, "Org Agent");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/generate-hire-orders/index.di.test.ts`
Expected: FAIL — `captured.letterhead.agent_name` is `"Org Agent"` in the first test (override not applied yet).

- [ ] **Step 3: Implement — extend the row interfaces**

In `supabase/functions/generate-hire-orders/index.ts`, add the two fields to both interfaces:

```ts
interface IssueOrderRow {
  id: string;
  org_id: string;
  order_no: string;
  status: string;
  data: OrderData;
  terms_variant: string | null;
  fee_currency: string | null;
  artist_id: string | null;
  agent_name: string | null;
  agent_email: string | null;
}

/** Shape of previewOrder's hire_orders select. */
interface PreviewOrderRow {
  id: string;
  org_id: string;
  order_no: string;
  data: OrderData;
  terms_variant: string | null;
  fee_currency: string | null;
  agent_name: string | null;
  agent_email: string | null;
}
```

- [ ] **Step 4: Implement — `issueOne` select + merge**

In `issueOne`, add the columns to the select and merge before render:

```ts
const { data: order } = await admin
  .from("hire_orders")
  .select("id, org_id, order_no, status, data, terms_variant, fee_currency, artist_id, agent_name, agent_email")
  .eq("id", orderId)
  .eq("org_id", org)
  .maybeSingle();
```

Then, just before the `deps.renderHireOrderPdf({ ... })` call, build the effective letterhead and pass it:

```ts
const effectiveLetterhead: HireOrderLetterhead = {
  ...letterhead,
  agent_name: o.agent_name ?? letterhead.agent_name,
  agent_email: o.agent_email ?? letterhead.agent_email,
};
const currency = o.fee_currency ?? defaults.currency ?? "EUR";
const bytes = await deps.renderHireOrderPdf({
  data,
  orderNo: o.order_no,
  status: "issued",
  letterhead: effectiveLetterhead,
  terms: variantTerms,
  currency,
  generatedAtIso: deps.now().toISOString(),
});
```

(Leave the `orderReadyIssues(data, letterhead)` gate reading the original `letterhead` — agent is optional and not part of readiness.)

- [ ] **Step 5: Implement — `previewOrder` select + merge**

In `previewOrder`, add the columns to the select and merge before render:

```ts
const { data: order } = await admin
  .from("hire_orders")
  .select("id, org_id, order_no, data, terms_variant, fee_currency, agent_name, agent_email")
  .eq("id", body.order_id)
  .eq("org_id", org)
  .maybeSingle();
```

```ts
const effectiveLetterhead: HireOrderLetterhead = {
  ...letterhead,
  agent_name: o.agent_name ?? letterhead.agent_name,
  agent_email: o.agent_email ?? letterhead.agent_email,
};
const bytes = await deps.renderHireOrderPdf({
  data: o.data as OrderData,
  orderNo: o.order_no,
  status: "preview",
  letterhead: effectiveLetterhead,
  terms: terms[variant] ?? [],
  currency: o.fee_currency ?? defaults.currency ?? "EUR",
  generatedAtIso: deps.now().toISOString(),
});
```

- [ ] **Step 6: Run the FULL edge suite to verify pass + no regressions**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/generate-hire-orders/`
Expected: PASS (new tests green, existing issue/preview tests unaffected — the default `LETTERHEAD` has no agent fields, so `undefined ?? undefined` stays `undefined`).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/generate-hire-orders/index.ts supabase/functions/generate-hire-orders/index.di.test.ts
git commit -m "render per-order agent override over the letterhead"
```

---

## Task 5: Agent name + email fields in the Generate hire-order dialog

**Files:**
- Modify: `src/components/shows/hireOrders/GenerateHireOrderDialog.tsx`
- Test: `src/components/shows/hireOrders/GenerateHireOrderDialog.test.tsx`

**Interfaces:**
- Consumes: `resolveOrgSetting` (`@/data/settings`), `Letterhead` type + `LETTERHEAD_DEFAULT` (`@/components/settings/hireOrders/{LetterheadCard,defaults}`), `HireOrderReview.agentName/agentEmail` (Task 3), `order.agent_name/agent_email` (Task 2), existing `useUpdateHireOrderReview`.
- Produces: dialog UI only.

- [ ] **Step 1: Write the failing tests**

First, update the existing seeds so the new letterhead query resolves. In `GenerateHireOrderDialog.test.tsx`, add `app_settings` to every `seedClient(...)` / `createFakeSupabase(...)` call in this file (the `beforeEach` and the two `seedClient({...})` inside tests):

```ts
seedClient({ hire_orders: { data: [], error: null }, app_settings: { data: [], error: null } });
```
```ts
seedClient({
  hire_orders: { data: [], error: null },
  app_settings: { data: [], error: null },
  "fn:generate-hire-orders": { data: { issued: ["ho-1"], failed: [] }, error: null },
});
```

Then add two tests:

```ts
it("prefills agent fields from the org letterhead default", async () => {
  seedClient({
    hire_orders: { data: [], error: null },
    app_settings: {
      data: [{ org_id: "org-1", value: { legal_name: "Aurora", address_lines: [], agent_name: "Org Agent", agent_email: "org@x.com" } }],
      error: null,
    },
  });
  renderDialog();
  expect(await screen.findByLabelText("Agent name")).toHaveValue("Org Agent");
  expect(screen.getByLabelText("Agent email")).toHaveValue("org@x.com");
});

it("persists an edited agent name + email on issue", async () => {
  seedClient({
    hire_orders: { data: [], error: null },
    app_settings: {
      data: [{ org_id: "org-1", value: { legal_name: "Aurora", address_lines: [], agent_name: "Org Agent", agent_email: "org@x.com" } }],
      error: null,
    },
    "fn:generate-hire-orders": { data: { issued: ["ho-1"], failed: [] }, error: null },
  });
  renderDialog();
  fireEvent.change(await screen.findByLabelText("Agent name"), { target: { value: "Solo Agent" } });
  fireEvent.change(screen.getByLabelText("Agent email"), { target: { value: "solo@x.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Issue and send" }));

  await waitFor(() => {
    const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
    const update = calls.find((c) => c.table === "hire_orders" && c.method === "update");
    const patch = update!.args[0] as { agent_name?: string; agent_email?: string };
    expect(patch.agent_name).toBe("Solo Agent");
    expect(patch.agent_email).toBe("solo@x.com");
  });
});
```

Note: `resolveOrgSetting` selects `app_settings` on `.eq("key", ...)`; the fake does not filter a single-object/array seed by key, so the seeded letterhead row is returned for the letterhead query — matching the HireOrdersTab test's documented behavior.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/shows/hireOrders/GenerateHireOrderDialog.test.tsx`
Expected: FAIL — no "Agent name"/"Agent email" fields exist yet.

- [ ] **Step 3: Implement — imports + letterhead query**

In `GenerateHireOrderDialog.tsx`, add imports:

```tsx
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting } from "@/data/settings";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";
import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
```

Inside the component, load the org letterhead default (reuses the same query key as LetterheadCard so the cache is shared):

```tsx
const { data: letterhead } = useQuery({
  queryKey: ["app-settings", "hire_order_letterhead", orgId],
  queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
  enabled: Boolean(orgId),
});
```

- [ ] **Step 4: Implement — agent state, seeding, persist**

Add state seeded from the order override first, then the letterhead default once it loads:

```tsx
const [agentName, setAgentName] = useState<string>(order.agent_name ?? "");
const [agentEmail, setAgentEmail] = useState<string>(order.agent_email ?? "");
// Baseline for the "changed?" check; updated when we seed from the letterhead.
const initialAgentRef = useRef({ name: order.agent_name ?? "", email: order.agent_email ?? "" });
// Seed from the letterhead default only when the order carries no override of its own.
const seededAgentRef = useRef(order.agent_name != null || order.agent_email != null);
useEffect(() => {
  if (letterhead && !seededAgentRef.current) {
    seededAgentRef.current = true;
    const name = order.agent_name ?? letterhead.agent_name ?? "";
    const email = order.agent_email ?? letterhead.agent_email ?? "";
    setAgentName(name);
    setAgentEmail(email);
    initialAgentRef.current = { name, email };
  }
}, [letterhead, order.agent_name, order.agent_email]);
```

Extend `persist()` to include the agent override when it changed:

```tsx
async function persist(): Promise<void> {
  const agentChanged =
    agentName !== initialAgentRef.current.name || agentEmail !== initialAgentRef.current.email;
  const changed = feeAmount !== initialFeeAmount || variant !== initialVariant || agentChanged;
  if (!changed) return;
  await review.mutateAsync({
    id: order.id,
    review: {
      feeAmount,
      termsVariant: variant,
      ...(agentChanged ? { agentName, agentEmail } : {}),
    },
    currentData: order.data,
  });
}
```

- [ ] **Step 5: Implement — the Agent field group UI**

Add this block after the Terms variant block (before the fee-only info note):

```tsx
{/* Booking agent — prefilled from the org letterhead, overridable per order */}
<div className="space-y-1.5">
  <Label className="text-xs text-muted-foreground">Booking agent (optional)</Label>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
    <Input
      aria-label="Agent name"
      placeholder="Agent name"
      value={agentName}
      onChange={(e) => setAgentName(e.target.value)}
    />
    <Input
      aria-label="Agent email"
      type="email"
      placeholder="Agent email"
      value={agentEmail}
      onChange={(e) => setAgentEmail(e.target.value)}
    />
  </div>
  <p className="text-xs text-muted-foreground">Prefilled from your organization letterhead.</p>
</div>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/shows/hireOrders/GenerateHireOrderDialog.test.tsx`
Expected: PASS (new tests green; the existing "skips persisting when nothing changed" test still passes because the empty `app_settings` seed yields `LETTERHEAD_DEFAULT` agent `""` and the order has no agent, so `agentChanged` is false).

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: no warnings.

- [ ] **Step 8: Commit**

```bash
git add src/components/shows/hireOrders/GenerateHireOrderDialog.tsx src/components/shows/hireOrders/GenerateHireOrderDialog.test.tsx
git commit -m "add per-order agent name/email override to generate dialog"
```

---

## Task 6: Settings vertical grouped left nav

**Files:**
- Modify: `src/pages/SettingsPage.tsx`
- Test: `src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: existing `activeTab`/`setActiveTab`, role flags (`isAdmin`, `isProducer`), `hireOrdersEntitled`, `schedulingWarnings`, all existing `TabsContent` bodies.
- Produces: layout only. Every `TabsTrigger` keeps its `value` and its visible label text (so `getByRole("tab", { name: ... })` selectors are unchanged).

- [ ] **Step 1: Write the failing test**

Add to `src/pages/SettingsPage.test.tsx` a new describe block (the file already sets up the hoisted `client`, `useAuth` mock, and `DEFAULT_AUTH`):

```ts
describe("SettingsPage grouped vertical nav", () => {
  it("renders group headings and switches content", async () => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByText("Automation")).toBeInTheDocument();
    expect(screen.getByText("Organization")).toBeInTheDocument();
    // Switching a section swaps the visible content.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /casts & cities/i }));
    expect(await screen.findByRole("tab", { name: /casts & cities/i })).toHaveAttribute("aria-selected", "true");
  });

  it("hides admin-only sections and empty group headings for a producer", async () => {
    vi.mocked(useAuth).mockReturnValue({
      ...DEFAULT_AUTH,
      hasRole: (r: string) => r === "producer",
    } as never);
    renderWithProviders(<SettingsPage />);
    await screen.findByRole("tab", { name: /scheduling/i });
    expect(screen.queryByRole("tab", { name: /airtable sync/i })).not.toBeInTheDocument();
    // Filters + Notifications are admin-only, so the whole Preferences group disappears.
    expect(screen.queryByText("Preferences")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/SettingsPage.test.tsx`
Expected: FAIL — `getByText("Automation")` not found (no group headings yet).

- [ ] **Step 3: Implement — replace the `TabsList` with a grouped vertical rail**

In `src/pages/SettingsPage.tsx`, widen the page container: change the outer wrapper from `className="space-y-6 max-w-4xl"` to `className="space-y-6 max-w-5xl"`.

Build the nav model just before the `return` (uses the existing `isAdmin`, `isProducer`, `hireOrdersEntitled`, `schedulingWarnings`, and the already-imported lucide icons):

```tsx
const navGroups: { heading: string; items: { value: string; label: string; icon: typeof Building2; show: boolean; dot?: boolean }[] }[] = [
  { heading: "Organization", items: [
    { value: "organization", label: "Organization", icon: Building2, show: isAdmin },
    { value: "production-ownership", label: "Production Ownership", icon: UserCog, show: isAdmin || isProducer },
    { value: "casts-cities", label: "Casts & Cities", icon: MapPin, show: true },
  ] },
  { heading: "Automation", items: [
    { value: "airtable", label: "Airtable Sync", icon: Database, show: isAdmin },
    { value: "booking", label: "Booking flow", icon: Wand2, show: isAdmin },
    { value: "scheduling", label: "Scheduling", icon: Clock, show: true, dot: schedulingWarnings > 0 },
    { value: "hire-orders", label: "Hire orders", icon: FileSignature, show: isAdmin && hireOrdersEntitled },
  ] },
  { heading: "Preferences", items: [
    { value: "filters", label: "Filters", icon: SlidersHorizontal, show: isAdmin },
    { value: "notifications", label: "Notifications", icon: Bell, show: isAdmin },
  ] },
  { heading: "Help", items: [
    { value: "docs", label: "Documentation", icon: BookOpen, show: true },
  ] },
];
```

Wrap the `Tabs` in the two-column grid and replace the `<TabsList>…</TabsList>` block (the old `TabsList` with all its `TabsTrigger`s) with the vertical rail below. Leave every `<TabsContent>` exactly as-is, but move them inside a right-hand `min-w-0` column:

```tsx
<Tabs
  value={activeTab}
  onValueChange={setActiveTab}
  orientation="vertical"
  className="md:grid md:grid-cols-[220px_1fr] md:gap-8 md:items-start"
>
  <TabsList className="mb-4 flex h-auto w-full items-stretch gap-1 overflow-x-auto bg-transparent p-0 md:sticky md:top-4 md:mb-0 md:flex-col md:gap-0 md:overflow-visible">
    {navGroups.map((group) => {
      const items = group.items.filter((i) => i.show);
      if (items.length === 0) return null;
      return (
        <div key={group.heading} className="contents md:mt-4 md:block md:first:mt-0">
          <p className="hidden px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground md:block">
            {group.heading}
          </p>
          {items.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="shrink-0 justify-start gap-2 rounded-md px-3 py-2 text-muted-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none hover:bg-muted/60 md:w-full"
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
              {item.dot && <span className="ml-1 h-2 w-2 shrink-0 rounded-full bg-destructive md:ml-auto" />}
            </TabsTrigger>
          ))}
        </div>
      );
    })}
  </TabsList>

  <div className="min-w-0">
    {/* All existing <TabsContent> blocks move here unchanged. */}
  </div>
</Tabs>
```

Notes for the implementer:
- On mobile the group `<div>` uses `contents` so its items flatten into the horizontal scroll row; on `md+` it becomes a block with a visible heading.
- Keep the exact `value` strings and label text — the content components and existing tests depend on them.
- The `casts-cities`/`scheduling`/`docs` triggers were previously ungated in the JSX; here they are `show: true`. `production-ownership` keeps `isAdmin || isProducer`, `hire-orders` keeps `isAdmin && hireOrdersEntitled`.

- [ ] **Step 4: Run the SettingsPage suite (new + existing)**

Run: `npx vitest run src/pages/SettingsPage.test.tsx`
Expected: PASS — new grouped-nav tests green, and the existing "Booking flow tab Save affordance" tests still pass (triggers keep role `tab` + same names, activated via `mouseDown`).

- [ ] **Step 5: Visual verification in the browser**

Start the dev server and confirm the nav renders as a vertical rail with group headings, the active section highlights, the Scheduling dot shows when there are warnings, and nothing overflows horizontally at desktop and mobile widths.
- `preview_start { name: "dev" }` (port 8080), navigate to `/settings`, `read_page` to confirm the grouped tablist, `resize_window` mobile to confirm the contained horizontal scroll, then a screenshot.

- [ ] **Step 6: Lint + full frontend suite**

Run: `npm run lint && npx vitest run`
Expected: no warnings; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx
git commit -m "replace overflowing settings tab bar with grouped vertical nav"
```

---

## Final verification

- [ ] `npm run lint` — zero warnings
- [ ] `npx vitest run` — all frontend + data + mirror tests pass
- [ ] `deno test --allow-all --node-modules-dir=none supabase/functions/generate-hire-orders/` — edge suite passes
- [ ] `npx tsc --noEmit` — no type errors
- [ ] Browser: `/settings` nav (desktop + mobile), Letterhead address accepts spaces + new-lines, Generate dialog shows prefilled agent fields.

---

## Self-review notes (coverage check)

- Spec Part 1 (address bug) → Task 1. ✅ Covers both spaces and new-lines via raw-text state.
- Spec Part 2 (agent override): DB → Task 2; data layer → Task 3; edge merge → Task 4; dialog prefill/persist → Task 5. ✅ `null` inherits, `""` prints empty (merge `??`), untouched omits the columns.
- Spec Part 3 (settings nav) → Task 6. ✅ Grouped vertical rail, role-gated headings, mobile scroll fallback, content untouched.
- Type consistency: `HireOrderReview.agentName/agentEmail` defined in Task 3, consumed in Task 5; `agent_name`/`agent_email` columns defined Task 2, consumed Tasks 3-5; `effectiveLetterhead` is local to each edge handler. ✅
