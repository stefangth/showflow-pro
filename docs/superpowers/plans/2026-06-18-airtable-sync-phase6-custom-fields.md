# Phase 6 — Custom / Extensible Synced Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org admin capture extra Airtable fields as typed, configurable columns on `show_dates`, displayed/filtered/sorted client-side in the producer Shows & Bookings table — without per-field migrations and without ever driving booking logic.

**Architecture:** A `show_dates.custom jsonb` value bag + a per-org `custom_field_definitions` registry table. `airtable-poll` writes the bag non-fatally. The existing admin editor column system gains a `custom` column kind via explicit threading (Fork A). Filter/sort is client-side, mirroring the app's existing `useMemo` model.

**Tech Stack:** Supabase (Postgres + RLS, Deno edge functions), React 18 + TypeScript, @tanstack/react-query, Vitest, Deno test, pgTAP. Migrations applied via the Supabase MCP (no local CLI).

**Spec:** [`docs/superpowers/specs/2026-06-18-airtable-sync-phase6-custom-fields-design.md`](../specs/2026-06-18-airtable-sync-phase6-custom-fields-design.md)

**The invariant (restate in code comments at each touch point):** Custom fields are display/filter/sort metadata ONLY — never eligibility, offers, slots, or status.

---

## Environment notes (read before starting)

- **No local Node / supabase CLI / Docker.** Deno IS available locally. `npx vitest run` and `deno test` run in CI; the local agent may not be able to execute vitest — if `npx vitest run` is unavailable, still WRITE the test first (TDD) and rely on CI to go red→green. State explicitly in each task whether the test was run locally or deferred to CI.
- **Migrations go through the Supabase MCP** (project `epweartpzwvcasrzyueh`). Tools (load via ToolSearch `select:` if deferred): `mcp__6fbecca6-9b05-4c4a-9991-f438c220c4b5__apply_migration`, `__list_migrations`, `__execute_sql`, `__generate_typescript_types`. Workflow: smoke-test DDL with `execute_sql` wrapped in `BEGIN; … ROLLBACK;` → `apply_migration` → `list_migrations` to read the recorded version → name the committed migration file to match → regenerate `types.ts`.
- **pgTAP is CI-only.** Write the `.sql` test file; it runs in CI via `supabase test db`.
- **Commit trailer (every commit):**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- Branch: `claude/<desc>` off fresh `main` (this work is on the current worktree branch).

---

## File Structure

**Created:**
- `supabase/migrations/<version>_phase6_custom_fields.sql` — `show_dates.custom` + `custom_field_definitions` + RLS.
- `supabase/tests/db/custom_field_definitions.sql` — pgTAP for the table/RLS/constraints.
- `supabase/functions/_shared/customFields.ts` — `coerceCustomValue` (Deno, pure).
- `supabase/functions/_shared/customFields.test.ts` — Deno tests for the above.
- `src/lib/customFields.ts` — frontend pure helpers (type map, slug, format, compare, filter).
- `src/lib/customFields.test.ts` — vitest for the above.
- `src/data/customFields.ts` — `fetch/upsert/deleteCustomFieldDef` (data access).
- `src/data/customFields.test.ts` — vitest (supabaseFake) for the above.
- `src/components/filters/CustomFieldFilter.tsx` — generic type-switched filter control.
- `src/components/filters/CustomFieldFilter.test.tsx` — vitest + RTL.

**Modified:**
- `src/integrations/supabase/types.ts` — regenerated after migration (do NOT hand-edit).
- `supabase/functions/airtable-poll/index.ts` — load defs + write the `custom` bag.
- `supabase/functions/airtable-poll/index.custom.test.ts` — new Deno test file for the custom-bag behavior.
- `src/features/editor/types.ts` — extend `ColumnDef`.
- `src/features/editor/columnRegistries.ts` — `resolveColumnTemplate(extraDefs)`, `CUSTOM_FIELD_PAGES`, `customFieldDefToColumnDef`.
- `src/features/editor/columnRegistries.test.ts` — new/extended vitest.
- `src/features/editor/EditorContext.tsx` — load custom defs; thread through `getColumnDefs`/`getColumnTemplate`/`getColumnLabel`; expose `getCustomFieldDefs`.
- `src/features/editor/ColumnLayoutEditor.tsx` — consume context methods instead of raw functions.
- `src/components/settings/AirtableSyncTab.tsx` — capture card.
- `src/pages/ShowsBookingsPage.tsx` — `custom` in query/type, cell branch, filter controls, sort extension.
- `src/components/filters/SortControl.tsx` — optional `extraOptions` + generic value type.
- `docs/app-logic.md` — note on custom fields + promotion path.

---

## Task 1: Database — `show_dates.custom` + `custom_field_definitions` + RLS

**Files:**
- Apply via MCP, then Create: `supabase/migrations/<version>_phase6_custom_fields.sql`
- Modify (regenerate): `src/integrations/supabase/types.ts`
- Test: `supabase/tests/db/custom_field_definitions.sql`

> ⚠️ This task mutates the live Supabase project. Smoke-test first; verify after.

- [ ] **Step 1: Smoke-test the DDL in a rolled-back transaction**

Load the Supabase MCP tools (ToolSearch `select:mcp__6fbecca6-9b05-4c4a-9991-f438c220c4b5__execute_sql,mcp__6fbecca6-9b05-4c4a-9991-f438c220c4b5__apply_migration,mcp__6fbecca6-9b05-4c4a-9991-f438c220c4b5__list_migrations,mcp__6fbecca6-9b05-4c4a-9991-f438c220c4b5__generate_typescript_types`).

Call `execute_sql` with this exact body (note the wrapping transaction so nothing persists):

```sql
BEGIN;
ALTER TABLE public.show_dates
  ADD COLUMN IF NOT EXISTS custom jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id),
  entity       text NOT NULL DEFAULT 'show_dates'
                 CHECK (entity IN ('show_dates','artists','shows')),
  key          text NOT NULL CHECK (key ~ '^[a-z0-9_]+$'),
  label        text NOT NULL,
  type         text NOT NULL CHECK (type IN ('text','number','date','boolean','select')),
  source       text NOT NULL DEFAULT 'airtable' CHECK (source IN ('airtable')),
  source_field text NOT NULL,
  options      jsonb,
  filterable   boolean NOT NULL DEFAULT true,
  sortable     boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, entity, key)
);
-- prove the CHECK + UNIQUE behave
INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
  SELECT id, 'capacity', 'Capacity', 'number', 'Capacity' FROM public.organizations LIMIT 1;
ROLLBACK;
```

Expected: success, no error (the INSERT proves FK + CHECKs accept a valid row). If `organizations` is empty the INSERT inserts 0 rows — still fine.

- [ ] **Step 2: Apply the migration**

Call `apply_migration` with `name: "phase6_custom_fields"` and this `query` (the full DDL, no transaction wrapper — `apply_migration` manages that):

```sql
ALTER TABLE public.show_dates
  ADD COLUMN IF NOT EXISTS custom jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id),
  entity       text NOT NULL DEFAULT 'show_dates'
                 CHECK (entity IN ('show_dates','artists','shows')),
  key          text NOT NULL CHECK (key ~ '^[a-z0-9_]+$'),
  label        text NOT NULL,
  type         text NOT NULL CHECK (type IN ('text','number','date','boolean','select')),
  source       text NOT NULL DEFAULT 'airtable' CHECK (source IN ('airtable')),
  source_field text NOT NULL,
  options      jsonb,
  filterable   boolean NOT NULL DEFAULT true,
  sortable     boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, entity, key)
);

CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_org
  ON public.custom_field_definitions (org_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_org_entity
  ON public.custom_field_definitions (org_id, entity);

ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON public.custom_field_definitions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), org_id))
  WITH CHECK (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Org members can view custom_field_definitions"
  ON public.custom_field_definitions FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins can manage custom_field_definitions"
  ON public.custom_field_definitions FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'));

CREATE TRIGGER update_custom_field_definitions_updated_at
  BEFORE UPDATE ON public.custom_field_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

- [ ] **Step 3: Record the migration file**

Call `list_migrations`; read the newest version string for `phase6_custom_fields`. Create `supabase/migrations/<version>_phase6_custom_fields.sql` containing the **exact** DDL from Step 2 (so the repo file matches the recorded version).

- [ ] **Step 4: Regenerate types**

Call `generate_typescript_types`; overwrite `src/integrations/supabase/types.ts` with the returned content. Confirm it now contains `custom_field_definitions` and that `show_dates` Row has `custom: Json`.

- [ ] **Step 5: Write the pgTAP test**

Create `supabase/tests/db/custom_field_definitions.sql`:

```sql
-- custom_field_definitions: RLS enabled, org_isolation policy present, key CHECK + type CHECK
-- enforced, UNIQUE(org_id,entity,key) enforced, and show_dates.custom defaults to '{}'.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

INSERT INTO public.organizations (id, name, slug) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Org CF', 'org-cf-test');

-- 1) RLS enabled
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.custom_field_definitions'::regclass),
  true, 'RLS is enabled on custom_field_definitions');

-- 2) org_isolation policy exists
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE tablename = 'custom_field_definitions' AND policyname = 'org_isolation'),
  1, 'org_isolation policy exists');

-- 3) a valid row inserts
INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'capacity', 'Capacity', 'number', 'Capacity');
SELECT is(
  (SELECT count(*)::int FROM public.custom_field_definitions WHERE key = 'capacity'),
  1, 'a valid custom field definition inserts');

-- 4) key CHECK rejects an invalid slug
SELECT throws_ok(
  $$ INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
     VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Bad Key', 'X', 'text', 'X') $$,
  '23514', NULL, 'key CHECK rejects non-slug keys');

-- 5) type CHECK rejects an unknown type
SELECT throws_ok(
  $$ INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
     VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'bogus', 'X', 'json', 'X') $$,
  '23514', NULL, 'type CHECK rejects unknown types');

-- 6) UNIQUE(org_id, entity, key) rejects a duplicate
SELECT throws_ok(
  $$ INSERT INTO public.custom_field_definitions (org_id, key, label, type, source_field)
     VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'capacity', 'Dup', 'text', 'Y') $$,
  '23505', NULL, 'UNIQUE(org_id,entity,key) rejects duplicates');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 6: Verify the live table directly**

Call `execute_sql`:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'show_dates' AND column_name = 'custom';
```
Expected: one row, `data_type = jsonb`, default `'{}'::jsonb`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/ supabase/tests/db/custom_field_definitions.sql src/integrations/supabase/types.ts
git commit -m "feat(custom-fields): add show_dates.custom + custom_field_definitions table" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Deno — `coerceCustomValue` (sync coercion)

**Files:**
- Create: `supabase/functions/_shared/customFields.ts`
- Test: `supabase/functions/_shared/customFields.test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/customFields.test.ts`:

```ts
import { assertEquals } from "./test-asserts.ts";
import { coerceCustomValue } from "./customFields.ts";

Deno.test("coerceCustomValue: number parses numeric strings and rejects NaN", () => {
  assertEquals(coerceCustomValue(42, "number"), { ok: true, value: 42 });
  assertEquals(coerceCustomValue("42", "number"), { ok: true, value: 42 });
  assertEquals(coerceCustomValue("nope", "number"), { ok: false });
});

Deno.test("coerceCustomValue: date keeps YYYY-MM-DD, rejects unparseable", () => {
  assertEquals(coerceCustomValue("2026-06-18", "date"), { ok: true, value: "2026-06-18" });
  assertEquals(coerceCustomValue("2026-06-18T10:00:00.000Z", "date"), { ok: true, value: "2026-06-18" });
  assertEquals(coerceCustomValue("not a date", "date"), { ok: false });
});

Deno.test("coerceCustomValue: boolean is true only when raw === true", () => {
  assertEquals(coerceCustomValue(true, "boolean"), { ok: true, value: true });
  assertEquals(coerceCustomValue("true", "boolean"), { ok: true, value: false });
});

Deno.test("coerceCustomValue: select/text stringify scalars, reject objects/arrays", () => {
  assertEquals(coerceCustomValue("Berlin", "select"), { ok: true, value: "Berlin" });
  assertEquals(coerceCustomValue("hello", "text"), { ok: true, value: "hello" });
  assertEquals(coerceCustomValue(["a", "b"], "text"), { ok: false });
});

Deno.test("coerceCustomValue: blank/missing values are omitted (ok:false)", () => {
  assertEquals(coerceCustomValue(null, "text"), { ok: false });
  assertEquals(coerceCustomValue(undefined, "number"), { ok: false });
  assertEquals(coerceCustomValue("", "text"), { ok: false });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/_shared/customFields.test.ts --allow-all`
Expected: FAIL — `Module not found "./customFields.ts"`.

- [ ] **Step 3: Implement**

Create `supabase/functions/_shared/customFields.ts`:

```ts
/** Custom-field value type. Mirrors src/lib/customFields.ts (separate runtime, no shared import). */
export type CustomFieldType = "text" | "number" | "date" | "boolean" | "select";

/**
 * Coerce a raw Airtable field value to a storable custom value for the show_dates.custom bag.
 * `ok:false` means OMIT the key — custom fields are non-fatal and NEVER hold or drop a date,
 * and they NEVER drive booking logic (eligibility/offers/slots/status run on core columns).
 */
export function coerceCustomValue(
  raw: unknown,
  type: CustomFieldType,
): { ok: true; value: string | number | boolean } | { ok: false } {
  if (raw === null || raw === undefined || raw === "") return { ok: false };
  switch (type) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case "date": {
      const m = String(raw).match(/^\d{4}-\d{2}-\d{2}/);
      return m ? { ok: true, value: m[0] } : { ok: false };
    }
    case "boolean":
      return { ok: true, value: raw === true };
    case "select":
    case "text":
      if (typeof raw === "object") return { ok: false };
      return { ok: true, value: String(raw) };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/_shared/customFields.test.ts --allow-all`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/customFields.ts supabase/functions/_shared/customFields.test.ts
git commit -m "feat(custom-fields): coerceCustomValue for non-fatal sync coercion" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire `airtable-poll` to write the custom bag

**Files:**
- Modify: `supabase/functions/airtable-poll/index.ts`
- Test: `supabase/functions/airtable-poll/index.custom.test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/airtable-poll/index.custom.test.ts`:

```ts
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG = "00000000-0000-0000-0000-0000000000c1";
const FIELD_MAP = { date: "Date", sub_program: "SubProgram", city: "City" };

function airtableResponse(records: unknown[]) {
  return new Response(JSON.stringify({ records }), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** Seed an enabled+keyed ORG with one linked show + city AND two custom field defs. */
function seededDeps(records: unknown[]) {
  return makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "Shows" }] },
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: FIELD_MAP }] },
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-magic", airtable_program_key: "Magic" }], error: null },
      cities: { data: [{ id: "city-berlin", airtable_city_key: "berlin" }], error: null },
      show_dates: { data: [], error: null },
      custom_field_definitions: { data: [
        { key: "capacity", source_field: "Capacity", type: "number" },
        { key: "headliner", source_field: "Headliner", type: "text" },
      ], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
    fetchImpl: (() => Promise.resolve(airtableResponse(records))) as typeof fetch,
  });
}

const authReq = () => makeRequest({ method: "POST", headers: { "X-Cron-Secret": "secret123" } });

/** Capture show_dates insert payloads via the documented from() override trick. */
function captureInserts(deps: ReturnType<typeof seededDeps>["deps"], captured: unknown[]) {
  const originalFrom = deps.admin.from.bind(deps.admin);
  // deno-lint-ignore no-explicit-any
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const originalInsert = chain.insert.bind(chain);
      // deno-lint-ignore no-explicit-any
      (chain as any).insert = (payload: unknown) => {
        captured.push(payload);
        const insertChain = (originalInsert as (x: unknown) => ReturnType<typeof originalInsert>)(payload);
        // deno-lint-ignore no-explicit-any
        (insertChain as any).single = () =>
          Promise.resolve({ data: { id: `sd-${(payload as Record<string, unknown>).airtable_record_id}` }, error: null });
        return insertChain;
      };
    }
    return chain;
  };
}

Deno.test("airtable-poll custom: writes coerced custom bag on insert, omits missing/bad keys", async () => {
  const records = [
    { id: "rec-1", fields: { Date: "2026-06-01", SubProgram: "Magic", City: "Berlin", Capacity: "250", Headliner: "Houdini" } },
    // Capacity unparseable → omitted; Headliner missing → omitted; bag is {}
    { id: "rec-2", fields: { Date: "2026-06-02", SubProgram: "Magic", City: "Berlin", Capacity: "n/a" } },
  ];
  const { deps } = seededDeps(records);
  const inserts: unknown[] = [];
  captureInserts(deps, inserts);

  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);

  const p1 = inserts[0] as Record<string, unknown>;
  assertEquals(p1.custom, { capacity: 250, headliner: "Houdini" });

  const p2 = inserts[1] as Record<string, unknown>;
  assertEquals(p2.custom, {});
});

Deno.test("airtable-poll custom: a malformed custom value never holds/drops the date", async () => {
  const records = [
    { id: "rec-3", fields: { Date: "2026-06-03", SubProgram: "Magic", Capacity: { bad: true } } },
  ];
  const { deps } = seededDeps(records);
  const inserts: unknown[] = [];
  captureInserts(deps, inserts);

  const res = await handle(authReq(), deps);
  const body = await res.json();
  assertEquals(body.new_dates, 1);  // still imported
  assertEquals((inserts[0] as Record<string, unknown>).custom, {});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/airtable-poll/index.custom.test.ts --allow-all`
Expected: FAIL — inserted payloads have no `custom` key (`undefined !== {…}`).

- [ ] **Step 3: Implement — import the coercer**

In `supabase/functions/airtable-poll/index.ts`, add to the imports at the top:

```ts
import { coerceCustomValue, type CustomFieldType } from "../_shared/customFields.ts";
```

- [ ] **Step 4: Implement — load defs once per org**

In `syncOrg`, immediately after the `cityByKey` map is built (after the `cities` lookup block, before the `existingByAirtableId` block ~line 115), add:

```ts
  // ── Custom field definitions (display/filter/sort only — NEVER booking logic) ──
  const { data: customDefsRaw } = await admin
    .from("custom_field_definitions")
    .select("key, source_field, type")
    .eq("org_id", orgId).eq("entity", "show_dates").eq("source", "airtable");
  const customDefs = (customDefsRaw ?? []) as Array<{ key: string; source_field: string; type: CustomFieldType }>;

  /** Build the custom jsonb bag for one record. Non-fatal: bad/missing values are omitted. */
  const buildCustom = (fields: Record<string, unknown>): Record<string, unknown> | undefined => {
    if (customDefs.length === 0) return undefined;
    const bag: Record<string, unknown> = {};
    for (const def of customDefs) {
      const coerced = coerceCustomValue(fields[def.source_field], def.type);
      if (coerced.ok) bag[def.key] = coerced.value;
    }
    return bag;
  };
```

- [ ] **Step 5: Implement — write the bag on update and insert**

In the `existingId` UPDATE branch, after `if (venue !== null) payload.venue = venue;` and before the `.update(payload)` call, add:

```ts
        const customBag = buildCustom(fields);
        if (customBag !== undefined) payload.custom = customBag;
```

In the INSERT branch, after `if (venue !== null) insertPayload.venue = venue;` and before the `.insert(insertPayload)` call, add:

```ts
      const customBagNew = buildCustom(fields);
      if (customBagNew !== undefined) insertPayload.custom = customBagNew;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `deno test supabase/functions/airtable-poll/index.custom.test.ts --allow-all`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the existing poll tests for regression**

Run: `deno test supabase/functions/airtable-poll/ --allow-all`
Expected: PASS (all existing contract/di/org/regression/smoke tests still green).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/airtable-poll/index.ts supabase/functions/airtable-poll/index.custom.test.ts
git commit -m "feat(custom-fields): airtable-poll writes the non-fatal custom bag" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Frontend pure helpers — `src/lib/customFields.ts`

**Files:**
- Create: `src/lib/customFields.ts`
- Test: `src/lib/customFields.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/customFields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  airtableTypeToCustomType, slugifyKey, formatCustomValue,
  compareCustomValues, customFilterMatches,
} from "./customFields";

describe("airtableTypeToCustomType", () => {
  it("maps known Airtable types", () => {
    expect(airtableTypeToCustomType("number")).toBe("number");
    expect(airtableTypeToCustomType("currency")).toBe("number");
    expect(airtableTypeToCustomType("date")).toBe("date");
    expect(airtableTypeToCustomType("dateTime")).toBe("date");
    expect(airtableTypeToCustomType("checkbox")).toBe("boolean");
    expect(airtableTypeToCustomType("singleSelect")).toBe("select");
    expect(airtableTypeToCustomType("multilineText")).toBe("text");
    expect(airtableTypeToCustomType("anythingElse")).toBe("text");
  });
});

describe("slugifyKey", () => {
  it("lowercases and replaces non-alphanumerics with single underscores", () => {
    expect(slugifyKey("1. Show")).toBe("1_show");
    expect(slugifyKey("Max Capacity!!")).toBe("max_capacity");
    expect(slugifyKey("  Trimmed  ")).toBe("trimmed");
  });
});

describe("formatCustomValue", () => {
  it("renders by type, with — for empty", () => {
    expect(formatCustomValue(null, "text")).toBe("—");
    expect(formatCustomValue("", "text")).toBe("—");
    expect(formatCustomValue("Houdini", "text")).toBe("Houdini");
    expect(formatCustomValue(250, "number")).toBe("250");
    expect(formatCustomValue("2026-06-18", "date")).toBe("18.06.2026");
    expect(formatCustomValue(true, "boolean")).toBe("Yes");
    expect(formatCustomValue(false, "boolean")).toBe("No");
  });
});

describe("compareCustomValues", () => {
  it("compares numbers numerically and nulls last", () => {
    expect(compareCustomValues(2, 10, "number")).toBeLessThan(0);
    expect(compareCustomValues(null, 1, "number")).toBeGreaterThan(0);
  });
  it("compares dates lexicographically (ISO) and text via locale", () => {
    expect(compareCustomValues("2026-01-01", "2026-02-01", "date")).toBeLessThan(0);
    expect(compareCustomValues("apple", "banana", "text")).toBeLessThan(0);
  });
});

describe("customFilterMatches", () => {
  it("text contains (case-insensitive), empty matches all", () => {
    expect(customFilterMatches("Houdini", "text", { kind: "text", q: "" })).toBe(true);
    expect(customFilterMatches("Houdini", "text", { kind: "text", q: "houd" })).toBe(true);
    expect(customFilterMatches("Houdini", "text", { kind: "text", q: "xyz" })).toBe(false);
  });
  it("select equality", () => {
    expect(customFilterMatches("Booked", "select", { kind: "select", value: null })).toBe(true);
    expect(customFilterMatches("Booked", "select", { kind: "select", value: "Booked" })).toBe(true);
    expect(customFilterMatches("Live", "select", { kind: "select", value: "Booked" })).toBe(false);
  });
  it("number range inclusive", () => {
    expect(customFilterMatches(250, "number", { kind: "number", min: 100, max: 300 })).toBe(true);
    expect(customFilterMatches(50, "number", { kind: "number", min: 100, max: null })).toBe(false);
  });
  it("date range inclusive on ISO strings", () => {
    expect(customFilterMatches("2026-06-15", "date", { kind: "date", from: "2026-06-01", to: "2026-06-30" })).toBe(true);
    expect(customFilterMatches("2026-07-15", "date", { kind: "date", from: null, to: "2026-06-30" })).toBe(false);
  });
  it("boolean tri-state", () => {
    expect(customFilterMatches(true, "boolean", { kind: "boolean", value: null })).toBe(true);
    expect(customFilterMatches(true, "boolean", { kind: "boolean", value: true })).toBe(true);
    expect(customFilterMatches(false, "boolean", { kind: "boolean", value: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/customFields.test.ts`
Expected: FAIL — module not found. (If vitest is unavailable locally, note "deferred to CI" and proceed.)

- [ ] **Step 3: Implement**

Create `src/lib/customFields.ts`:

```ts
/** Custom-field value type. Mirrors supabase/functions/_shared/customFields.ts. */
export type CustomFieldType = "text" | "number" | "date" | "boolean" | "select";

/** Map an Airtable field type to a custom field type. Unknown → 'text'. */
export function airtableTypeToCustomType(airtableType: string): CustomFieldType {
  switch (airtableType) {
    case "number":
    case "currency":
    case "percent":
    case "duration":
    case "rating":
    case "autoNumber":
      return "number";
    case "date":
    case "dateTime":
      return "date";
    case "checkbox":
      return "boolean";
    case "singleSelect":
      return "select";
    default:
      return "text";
  }
}

/** Slugify a label into a safe custom key: lowercase, [a-z0-9_], collapsed, trimmed. */
export function slugifyKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Display a custom value by type. Null/undefined/'' → '—'. Dates are stored ISO → dd.mm.yyyy. */
export function formatCustomValue(value: unknown, type: CustomFieldType): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (type) {
    case "boolean":
      return value === true || value === "true" ? "Yes" : "No";
    case "date": {
      const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[3]}.${m[2]}.${m[1]}` : String(value);
    }
    case "number":
    case "select":
    case "text":
      return String(value);
  }
}

/** Compare two custom values by type for client-side sort. Empty sorts last. */
export function compareCustomValues(a: unknown, b: unknown, type: CustomFieldType): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  switch (type) {
    case "number": {
      const na = Number(a), nb = Number(b);
      return (Number.isFinite(na) ? na : 0) - (Number.isFinite(nb) ? nb : 0);
    }
    case "boolean": {
      const ba = a === true || a === "true" ? 1 : 0;
      const bb = b === true || b === "true" ? 1 : 0;
      return ba - bb;
    }
    case "date":
    case "select":
    case "text":
      return String(a).localeCompare(String(b));
  }
}

export type CustomFilterState =
  | { kind: "text"; q: string }
  | { kind: "select"; value: string | null }
  | { kind: "number"; min: number | null; max: number | null }
  | { kind: "date"; from: string | null; to: string | null }
  | { kind: "boolean"; value: boolean | null };

/** True when the value passes the filter. An "empty" filter matches everything. */
export function customFilterMatches(
  value: unknown, type: CustomFieldType, filter: CustomFilterState,
): boolean {
  switch (filter.kind) {
    case "text": {
      if (!filter.q) return true;
      if (value === null || value === undefined) return false;
      return String(value).toLowerCase().includes(filter.q.toLowerCase());
    }
    case "select":
      return !filter.value ? true : String(value ?? "") === filter.value;
    case "number": {
      if (filter.min === null && filter.max === null) return true;
      if (value === null || value === undefined || value === "") return false;
      const n = Number(value);
      if (!Number.isFinite(n)) return false;
      if (filter.min !== null && n < filter.min) return false;
      if (filter.max !== null && n > filter.max) return false;
      return true;
    }
    case "date": {
      if (!filter.from && !filter.to) return true;
      if (value === null || value === undefined || value === "") return false;
      const v = String(value).slice(0, 10);
      if (filter.from && v < filter.from) return false;
      if (filter.to && v > filter.to) return false;
      return true;
    }
    case "boolean":
      return filter.value === null ? true : (value === true) === filter.value;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/customFields.test.ts`
Expected: PASS (or deferred to CI).

- [ ] **Step 5: Commit**

```bash
git add src/lib/customFields.ts src/lib/customFields.test.ts
git commit -m "feat(custom-fields): pure frontend helpers (type map, format, compare, filter)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Data access — `src/data/customFields.ts`

**Files:**
- Create: `src/data/customFields.ts`
- Test: `src/data/customFields.test.ts`

> Depends on Task 1 (the `custom_field_definitions` table must exist in `types.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/data/customFields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchCustomFieldDefs, upsertCustomFieldDef, deleteCustomFieldDef } from "./customFields";

describe("customFields data-access", () => {
  it("fetchCustomFieldDefs selects for the org (and entity when given)", async () => {
    const rows = [{ id: "d1", org_id: "org-1", entity: "show_dates", key: "capacity", label: "Capacity",
      type: "number", source: "airtable", source_field: "Capacity", options: null, filterable: true, sortable: true }];
    const fake = createFakeSupabase({ custom_field_definitions: { data: rows, error: null } });
    const res = await fetchCustomFieldDefs(fake as never, { orgId: "org-1", entity: "show_dates" });
    expect(res).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "custom_field_definitions", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "custom_field_definitions", method: "eq", args: ["entity", "show_dates"] });
  });

  it("fetchCustomFieldDefs returns [] for null org (no query)", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchCustomFieldDefs(fake as never, { orgId: null })).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("upsertCustomFieldDef upserts with source=airtable on the (org,entity,key) conflict target", async () => {
    const fake = createFakeSupabase({ custom_field_definitions: { data: null, error: null } });
    await upsertCustomFieldDef(fake as never, {
      org_id: "org-1", entity: "show_dates", key: "capacity", label: "Capacity",
      type: "number", source_field: "Capacity",
    });
    expect(fake.calls).toContainEqual({
      table: "custom_field_definitions", method: "upsert",
      args: [
        { org_id: "org-1", entity: "show_dates", key: "capacity", label: "Capacity", type: "number", source_field: "Capacity", source: "airtable" },
        { onConflict: "org_id,entity,key" },
      ],
    });
  });

  it("deleteCustomFieldDef deletes by id", async () => {
    const fake = createFakeSupabase({ custom_field_definitions: { data: null, error: null } });
    await deleteCustomFieldDef(fake as never, "d1");
    expect(fake.calls).toContainEqual({ table: "custom_field_definitions", method: "delete", args: [] });
    expect(fake.calls).toContainEqual({ table: "custom_field_definitions", method: "eq", args: ["id", "d1"] });
  });

  it("upsertCustomFieldDef throws on error", async () => {
    const fake = createFakeSupabase({ custom_field_definitions: { data: null, error: { message: "nope" } } });
    await expect(upsertCustomFieldDef(fake as never, {
      org_id: "o", entity: "show_dates", key: "k", label: "L", type: "text", source_field: "F",
    })).rejects.toMatchObject({ message: "nope" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/customFields.test.ts`
Expected: FAIL — module not found. (Or deferred to CI.)

- [ ] **Step 3: Implement**

Create `src/data/customFields.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CustomFieldType } from "@/lib/customFields";

export interface CustomFieldDefinition {
  id: string;
  org_id: string;
  entity: string;
  key: string;
  label: string;
  type: CustomFieldType;
  source: string;
  source_field: string;
  options: string[] | null;
  filterable: boolean;
  sortable: boolean;
}

/** All custom field definitions for an org (optionally one entity), oldest first. */
export async function fetchCustomFieldDefs(
  client: SupabaseClient<Database>,
  args: { orgId: string | null; entity?: string },
): Promise<CustomFieldDefinition[]> {
  if (!args.orgId) return [];
  let q = client
    .from("custom_field_definitions")
    .select("id, org_id, entity, key, label, type, source, source_field, options, filterable, sortable")
    .eq("org_id", args.orgId);
  if (args.entity) q = q.eq("entity", args.entity);
  const { data, error } = await q.order("created_at");
  if (error) throw error;
  return (data ?? []) as unknown as CustomFieldDefinition[];
}

/** Create or update a definition (admin-only via RLS). source is always 'airtable' this phase. */
export async function upsertCustomFieldDef(
  client: SupabaseClient<Database>,
  def: {
    org_id: string; entity: string; key: string; label: string;
    type: CustomFieldType; source_field: string;
    options?: string[] | null; filterable?: boolean; sortable?: boolean;
  },
): Promise<void> {
  const { error } = await client
    .from("custom_field_definitions")
    .upsert({ ...def, source: "airtable" } as never, { onConflict: "org_id,entity,key" });
  if (error) throw error;
}

/** Remove a definition by id (admin-only via RLS). */
export async function deleteCustomFieldDef(
  client: SupabaseClient<Database>,
  id: string,
): Promise<void> {
  const { error } = await client.from("custom_field_definitions").delete().eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/data/customFields.test.ts`
Expected: PASS (or deferred to CI).

- [ ] **Step 5: Commit**

```bash
git add src/data/customFields.ts src/data/customFields.test.ts
git commit -m "feat(custom-fields): data-access (fetch/upsert/delete definitions)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Editor column registry — types + `resolveColumnTemplate(extraDefs)` + helpers

**Files:**
- Modify: `src/features/editor/types.ts`
- Modify: `src/features/editor/columnRegistries.ts`
- Test: `src/features/editor/columnRegistries.test.ts`

- [ ] **Step 1: Extend `ColumnDef`**

In `src/features/editor/types.ts`, add the import at the top and two optional fields to `ColumnDef`:

```ts
import type { CustomFieldType } from '@/lib/customFields';
```

```ts
export interface ColumnDef {
  /** Namespaced id: `${table}.${column}`. */
  id: string;
  /** Source table the column comes from (or `_computed` / `custom`). */
  table: string;
  /** Bare DB column name within the table (or the custom key). */
  column: string;
  /** Column kind. Defaults to 'static'; 'custom' for Airtable-synced custom fields. */
  kind?: 'static' | 'custom';
  /** Present when kind === 'custom' — drives client-side format/filter/sort. */
  customType?: CustomFieldType;
  defaultVisible: boolean;
  defaultOrder: number;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/features/editor/columnRegistries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  resolveColumnTemplate, customFieldDefToColumnDef, CUSTOM_FIELD_PAGES,
} from './columnRegistries';
import type { ColumnDef } from './types';

const customCol: ColumnDef = customFieldDefToColumnDef({ key: 'capacity', type: 'number' }, 99);

describe('customFieldDefToColumnDef', () => {
  it('builds a hidden custom column with a custom.<key> id', () => {
    expect(customCol).toEqual({
      id: 'custom.capacity', table: 'custom', column: 'capacity',
      kind: 'custom', customType: 'number', defaultVisible: false, defaultOrder: 99,
    });
  });
});

describe('CUSTOM_FIELD_PAGES', () => {
  it('maps the producer bookings page to show_dates', () => {
    expect(CUSTOM_FIELD_PAGES['bookings-producer']).toBe('show_dates');
    expect(CUSTOM_FIELD_PAGES['availability']).toBeUndefined();
  });
});

describe('resolveColumnTemplate with extraDefs', () => {
  it('includes custom columns (hidden) when no saved template', () => {
    const cols = resolveColumnTemplate('bookings-producer', 'producer', {}, [customCol]);
    const custom = cols.find(c => c.columnId === 'custom.capacity');
    expect(custom).toBeDefined();
    expect(custom!.visible).toBe(false);
  });

  it('keeps a custom column that the saved template enabled', () => {
    const saved = {
      'bookings-producer': {
        producer: [{ columnId: 'custom.capacity', visible: true, order: 0 }],
      },
    };
    const cols = resolveColumnTemplate('bookings-producer', 'producer', saved, [customCol]);
    expect(cols.find(c => c.columnId === 'custom.capacity')!.visible).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/features/editor/columnRegistries.test.ts`
Expected: FAIL — `customFieldDefToColumnDef`/`CUSTOM_FIELD_PAGES` not exported; `resolveColumnTemplate` arity mismatch. (Or deferred to CI.)

- [ ] **Step 4: Implement**

In `src/features/editor/columnRegistries.ts`:

Add the import at the top:

```ts
import type { CustomFieldType } from '@/lib/customFields';
```

Add after the `PAGE_COLUMN_SPECS` const:

```ts
/** Pages that surface custom (Airtable-synced) columns, mapped to the entity they belong to.
 *  Producer bookings table only this phase — custom fields never reach artist surfaces. */
export const CUSTOM_FIELD_PAGES: Record<string, string> = { 'bookings-producer': 'show_dates' };

/** Build a hidden custom ColumnDef from a definition's key+type. */
export function customFieldDefToColumnDef(
  def: { key: string; type: CustomFieldType }, order: number,
): ColumnDef {
  return {
    id: `custom.${def.key}`,
    table: 'custom',
    column: def.key,
    kind: 'custom',
    customType: def.type,
    defaultVisible: false,
    defaultOrder: order,
  };
}
```

Change `resolveColumnTemplate` to accept and merge `extraDefs`:

```ts
export function resolveColumnTemplate(
  pageKey: string,
  role: AppRole,
  savedTemplates: ColumnTemplates,
  extraDefs: ColumnDef[] = [],
): ColumnTemplate[] {
  const defs = [...pageColumnDefs(pageKey), ...extraDefs];
  const saved = savedTemplates[pageKey]?.[role];

  if (!saved || saved.length === 0) {
    return defs.map(d => ({ columnId: d.id, visible: d.defaultVisible, order: d.defaultOrder }));
  }

  const validIds = new Set(defs.map(d => d.id));
  const savedFiltered = saved.filter(s => validIds.has(s.columnId));
  const savedMap = new Map(savedFiltered.map(s => [s.columnId, s]));
  let nextOrder = savedFiltered.length === 0 ? 0 : Math.max(...savedFiltered.map(s => s.order)) + 1;

  return defs
    .map(d => savedMap.get(d.id) ?? { columnId: d.id, visible: d.defaultVisible, order: nextOrder++ })
    .sort((a, b) => a.order - b.order);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/features/editor/columnRegistries.test.ts`
Expected: PASS (or deferred to CI).

- [ ] **Step 6: Commit**

```bash
git add src/features/editor/types.ts src/features/editor/columnRegistries.ts src/features/editor/columnRegistries.test.ts
git commit -m "feat(custom-fields): editor column registry supports a custom column kind" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Editor context wiring + ColumnLayoutEditor

**Files:**
- Modify: `src/features/editor/EditorContext.tsx`
- Modify: `src/features/editor/ColumnLayoutEditor.tsx`

> No new unit test here — the pure pieces are covered by Task 6 and the end-to-end path is exercised by the page in Task 9. This task is careful wiring; verify with `npx vitest run src/features/editor` and a typecheck/lint at the end.

- [ ] **Step 1: EditorContext — imports**

In `src/features/editor/EditorContext.tsx`, extend the imports:

```ts
import { resolveColumnTemplate, pageColumnDefs, COMPUTED_LABELS, customFieldDefToColumnDef, CUSTOM_FIELD_PAGES } from './columnRegistries';
import { fetchCustomFieldDefs, type CustomFieldDefinition } from '@/data/customFields';
```

- [ ] **Step 2: EditorContext — load custom defs + derived maps**

Add the query and memos right after the `rawSettings` query block (after `tablePermissions` memo, ~line 91):

```ts
  const { data: customFieldDefsRaw } = useQuery({
    queryKey: ['custom-field-definitions', orgId],
    enabled: !!orgId,
    staleTime: 30_000,
    queryFn: () => fetchCustomFieldDefs(supabase, { orgId }),
  });
  const customFieldDefs = useMemo<CustomFieldDefinition[]>(() => customFieldDefsRaw ?? [], [customFieldDefsRaw]);

  const customDefsForPage = useCallback((pageKey: string): ColumnDef[] => {
    const entity = CUSTOM_FIELD_PAGES[pageKey];
    if (!entity) return [];
    const base = pageColumnDefs(pageKey).length;
    return customFieldDefs
      .filter(d => d.entity === entity)
      .map((d, i) => customFieldDefToColumnDef(d, base + i));
  }, [customFieldDefs]);

  const customLabelByColId = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of customFieldDefs) m.set(`custom.${d.key}`, d.label);
    return m;
  }, [customFieldDefs]);
```

- [ ] **Step 3: EditorContext — thread into getColumnDefs / getColumnTemplate / getColumnLabel**

Replace the existing `getColumnTemplate` and `getColumnDefs` callbacks with:

```ts
  const getColumnTemplate = useCallback((pageKey: string, role: AppRole): ColumnTemplate[] =>
    resolveColumnTemplate(pageKey, role, columnTemplates, customDefsForPage(pageKey)),
    [columnTemplates, customDefsForPage]
  );

  const getColumnDefs = useCallback((pageKey: string): ColumnDef[] =>
    [...pageColumnDefs(pageKey), ...customDefsForPage(pageKey)],
    [customDefsForPage]
  );
```

In `getColumnLabel`, add the custom branch immediately after the `COMPUTED_LABELS` check:

```ts
  const getColumnLabel = useCallback(
    (colId: string) => {
      if (colId in COMPUTED_LABELS) return COMPUTED_LABELS[colId];
      if (customLabelByColId.has(colId)) return customLabelByColId.get(colId)!;
      const dotIdx = colId.indexOf('.');
      const nameOnly = dotIdx !== -1 ? colId.slice(dotIdx + 1) : colId;
      return (columnDescriptions ?? {})[colId] ?? nameOnly;
    },
    [columnDescriptions, customLabelByColId]
  );
```

- [ ] **Step 4: EditorContext — expose `getCustomFieldDefs`**

Add a callback near the other derived helpers:

```ts
  const getCustomFieldDefs = useCallback((entity: string): CustomFieldDefinition[] =>
    customFieldDefs.filter(d => d.entity === entity), [customFieldDefs]);
```

Add `getCustomFieldDefs: (entity: string) => CustomFieldDefinition[];` to the `EditorContextType` interface, include `getCustomFieldDefs` in the `value` object and its dependency array, and add it to the `useEditorConfig()` return object:

```ts
  return {
    isEditorMode: ctx.isEditorMode,
    pageAccess: ctx.pageAccess,
    getColumnTemplate: ctx.getColumnTemplate,
    getColumnDefs: ctx.getColumnDefs,
    getTablePermission: ctx.getTablePermission,
    getColumnLabel: ctx.getColumnLabel,
    getCustomFieldDefs: ctx.getCustomFieldDefs,
  };
```

- [ ] **Step 5: ColumnLayoutEditor — consume context methods**

In `src/features/editor/ColumnLayoutEditor.tsx`:

Change the import line to drop `pageColumnDefs`/`resolveColumnTemplate` (keep `disambiguateLabels`):

```ts
import { disambiguateLabels } from './columnRegistries';
```

Pull the context methods from the hooks already in use:

```ts
  const { isEditorMode, getColumnLabel, getColumnDefs, getColumnTemplate } = useEditorConfig();
  const { columnTemplates, saveColumnTemplate } = useEditor();
```

Replace the `defs` memo and the sync `useEffect`:

```ts
  const defs = useMemo(() => getColumnDefs(pageKey), [getColumnDefs, pageKey]);

  useEffect(() => {
    setDraft(getColumnTemplate(pageKey, effectiveRole));
    setDirty(false);
  }, [pageKey, effectiveRole, getColumnTemplate]);
```

(`getColumnTemplate` is in both `useEditor` and `useEditorConfig`; reading it from `useEditorConfig` as above is fine. Leave the rest of the component unchanged.)

- [ ] **Step 6: Verify editor tests + typecheck**

Run: `npx vitest run src/features/editor` and `npx tsc --noEmit` (or rely on CI).
Expected: existing editor tests still pass; no type errors. Manually confirm `useEditorConfig` consumers compile (the new `getCustomFieldDefs` is additive).

- [ ] **Step 7: Commit**

```bash
git add src/features/editor/EditorContext.tsx src/features/editor/ColumnLayoutEditor.tsx
git commit -m "feat(custom-fields): thread custom columns through editor context" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Capture card in `AirtableSyncTab`

**Files:**
- Modify: `src/components/settings/AirtableSyncTab.tsx`

> Pure helpers (`airtableTypeToCustomType`, `slugifyKey`) are already tested in Task 4. This task wires them into a card with immediate (non-draft) mutations, mirroring the catalog-link mutations already in the file.

- [ ] **Step 1: Add imports**

At the top of `src/components/settings/AirtableSyncTab.tsx`, add:

```ts
import { Trash2 } from "lucide-react";
import { fetchCustomFieldDefs, upsertCustomFieldDef, deleteCustomFieldDef } from "@/data/customFields";
import { airtableTypeToCustomType, slugifyKey, type CustomFieldType } from "@/lib/customFields";
```

- [ ] **Step 2: Add the custom-fields query + mutations**

Inside the component, after the catalog `linkCity` mutation block (~line 151), add:

```ts
  // ── Custom fields (definitions table; immediate mutations, not the settings draft) ──
  const customFieldsQ = useQuery({
    queryKey: ["custom-field-definitions", orgId, "show_dates"],
    enabled: !!orgId,
    queryFn: () => fetchCustomFieldDefs(supabase, { orgId, entity: "show_dates" }),
  });
  const customDefs = customFieldsQ.data ?? [];
  const customBySourceField = new Set(customDefs.map((d) => d.source_field));
  const mappedFieldNames = new Set(Object.values(fieldMap).filter(Boolean) as string[]);
  const unboundFields = (selectedTable?.fields ?? []).filter(
    (f) => !mappedFieldNames.has(f.name) && !customBySourceField.has(f.name),
  );

  const invalidateCustom = () => {
    qc.invalidateQueries({ queryKey: ["custom-field-definitions", orgId, "show_dates"] });
    qc.invalidateQueries({ queryKey: ["custom-field-definitions", orgId] }); // editor's query
  };
  const addCustom = useMutation({
    mutationFn: (af: { name: string; type: string; options?: Record<string, unknown> }) => {
      const type = airtableTypeToCustomType(af.type);
      const options = type === "select"
        ? ((af.options as { choices?: Array<{ name: string }> } | undefined)?.choices ?? []).map((c) => c.name)
        : null;
      return upsertCustomFieldDef(supabase, {
        org_id: orgId!, entity: "show_dates", key: slugifyKey(af.name), label: af.name,
        type, source_field: af.name, options,
      });
    },
    onSuccess: () => { invalidateCustom(); toast.success("Custom field added"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Could not add custom field"),
  });
  const setCustomType = useMutation({
    mutationFn: (args: { def: (typeof customDefs)[number]; type: CustomFieldType }) =>
      upsertCustomFieldDef(supabase, {
        org_id: orgId!, entity: "show_dates", key: args.def.key, label: args.def.label,
        type: args.type, source_field: args.def.source_field,
        options: args.def.options, filterable: args.def.filterable, sortable: args.def.sortable,
      }),
    onSuccess: () => { invalidateCustom(); toast.success("Updated"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Update failed"),
  });
  const removeCustom = useMutation({
    mutationFn: (id: string) => deleteCustomFieldDef(supabase, id),
    onSuccess: () => { invalidateCustom(); toast.success("Removed"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Remove failed"),
  });
  const CUSTOM_TYPES: CustomFieldType[] = ["text", "number", "date", "boolean", "select"];
```

- [ ] **Step 3: Render the card after the Field-mapping card**

Insert this JSX block immediately after the Field-mapping card's closing `)}` (after line 270, before the Catalog-links card):

```tsx
      {/* ── Custom fields ──────────────────────────────────────────────────── */}
      {selectedTable && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Custom fields</CardTitle>
            <CardDescription>
              Capture extra Airtable fields as typed columns on show dates — shown, filtered, and sorted in the producer Shows &amp; Bookings table (toggle them on via the column editor). These are display metadata only; they never affect bookings, slots, or offers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {customDefs.length === 0 && (
              <p className="text-sm text-muted-foreground">No custom fields yet.</p>
            )}
            {customDefs.map((d) => (
              <div key={d.id} className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-3 items-center border-t border-border pt-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{d.label}</div>
                  <div className="text-xs text-muted-foreground truncate">from “{d.source_field}”</div>
                </div>
                <Select value={d.type} onValueChange={(v) => setCustomType.mutate({ def: d, type: v as CustomFieldType })}>
                  <SelectTrigger className="h-8" aria-label={`type for ${d.label}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CUSTOM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" onClick={() => removeCustom.mutate(d.id)} disabled={removeCustom.isPending} aria-label={`remove ${d.label}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Separator />
            <div className="space-y-2">
              <Label>Add a custom field from an unmapped Airtable field</Label>
              <Select
                value=""
                onValueChange={(name) => {
                  const af = selectedTable.fields.find((f) => f.name === name);
                  if (af) addCustom.mutate({ name: af.name, type: af.type, options: af.options });
                }}
                disabled={addCustom.isPending || unboundFields.length === 0}
              >
                <SelectTrigger><SelectValue placeholder={unboundFields.length ? "Pick an Airtable field…" : "No unmapped fields left"} /></SelectTrigger>
                <SelectContent>
                  {unboundFields.map((f) => <SelectItem key={f.id} value={f.name}>{f.name} <span className="text-muted-foreground">({f.type})</span></SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Type is auto-detected from Airtable; adjust above if needed.</p>
            </div>
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 4: Typecheck / lint**

Run: `npx tsc --noEmit && npm run lint` (or rely on CI). Fix any type issues (e.g. `AirtableField.options` is `Record<string, unknown> | undefined`).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/AirtableSyncTab.tsx
git commit -m "feat(custom-fields): capture card in Airtable Sync settings" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: CustomFieldFilter component + producer page render/filter/sort

**Files:**
- Create: `src/components/filters/CustomFieldFilter.tsx`
- Test: `src/components/filters/CustomFieldFilter.test.tsx`
- Modify: `src/components/filters/SortControl.tsx`
- Modify: `src/pages/ShowsBookingsPage.tsx`

- [ ] **Step 1: Write the failing CustomFieldFilter test**

Create `src/components/filters/CustomFieldFilter.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CustomFieldFilter } from "./CustomFieldFilter";
import type { CustomFieldDefinition } from "@/data/customFields";

const numberDef: CustomFieldDefinition = {
  id: "d1", org_id: "o", entity: "show_dates", key: "capacity", label: "Capacity",
  type: "number", source: "airtable", source_field: "Capacity", options: null, filterable: true, sortable: true,
};
const textDef: CustomFieldDefinition = { ...numberDef, id: "d2", key: "headliner", label: "Headliner", type: "text" };

describe("CustomFieldFilter", () => {
  it("renders min/max number inputs and emits a number filter", () => {
    const onChange = vi.fn();
    render(<CustomFieldFilter def={numberDef} value={{ kind: "number", min: null, max: null }} onChange={onChange} />);
    const min = screen.getByLabelText("Capacity min");
    fireEvent.change(min, { target: { value: "100" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "number", min: 100, max: null });
  });

  it("renders a text input and emits a text filter", () => {
    const onChange = vi.fn();
    render(<CustomFieldFilter def={textDef} value={{ kind: "text", q: "" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Headliner contains"), { target: { value: "houd" } });
    expect(onChange).toHaveBeenCalledWith({ kind: "text", q: "houd" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/filters/CustomFieldFilter.test.tsx`
Expected: FAIL — module not found. (Or deferred to CI.)

- [ ] **Step 3: Implement CustomFieldFilter**

Create `src/components/filters/CustomFieldFilter.tsx`:

```tsx
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CustomFieldDefinition } from "@/data/customFields";
import type { CustomFilterState } from "@/lib/customFields";

const ALL = "__all__";

interface Props {
  def: CustomFieldDefinition;
  value: CustomFilterState;
  onChange: (v: CustomFilterState) => void;
}

/** A single type-switched filter control for one custom field (controlled). */
export function CustomFieldFilter({ def, value, onChange }: Props) {
  if (def.type === "select" && value.kind === "select") {
    return (
      <Select value={value.value ?? ALL} onValueChange={(v) => onChange({ kind: "select", value: v === ALL ? null : v })}>
        <SelectTrigger className="w-[160px]" aria-label={`${def.label} filter`}>
          <SelectValue placeholder={def.label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All {def.label}</SelectItem>
          {(def.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  if (def.type === "boolean" && value.kind === "boolean") {
    const cur = value.value === null ? ALL : value.value ? "yes" : "no";
    return (
      <Select value={cur} onValueChange={(v) => onChange({ kind: "boolean", value: v === ALL ? null : v === "yes" })}>
        <SelectTrigger className="w-[140px]" aria-label={`${def.label} filter`}>
          <SelectValue placeholder={def.label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All {def.label}</SelectItem>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (def.type === "number" && value.kind === "number") {
    const num = (s: string) => (s === "" ? null : Number(s));
    return (
      <div className="flex items-center gap-1">
        <Input type="number" className="w-[90px]" placeholder={`${def.label} min`} aria-label={`${def.label} min`}
          value={value.min ?? ""} onChange={(e) => onChange({ ...value, min: num(e.target.value) })} />
        <span className="text-muted-foreground text-xs">–</span>
        <Input type="number" className="w-[90px]" placeholder="max" aria-label={`${def.label} max`}
          value={value.max ?? ""} onChange={(e) => onChange({ ...value, max: num(e.target.value) })} />
      </div>
    );
  }
  if (def.type === "date" && value.kind === "date") {
    return (
      <div className="flex items-center gap-1">
        <Input type="date" className="w-[150px]" aria-label={`${def.label} from`}
          value={value.from ?? ""} onChange={(e) => onChange({ ...value, from: e.target.value || null })} />
        <span className="text-muted-foreground text-xs">–</span>
        <Input type="date" className="w-[150px]" aria-label={`${def.label} to`}
          value={value.to ?? ""} onChange={(e) => onChange({ ...value, to: e.target.value || null })} />
      </div>
    );
  }
  // text (default)
  if (value.kind === "text") {
    return (
      <Input className="w-[160px]" placeholder={def.label} aria-label={`${def.label} contains`}
        value={value.q} onChange={(e) => onChange({ kind: "text", q: e.target.value })} />
    );
  }
  return null;
}

/** The empty (matches-all) filter state for a field type. */
export function emptyCustomFilter(type: CustomFieldDefinition["type"]): CustomFilterState {
  switch (type) {
    case "select": return { kind: "select", value: null };
    case "number": return { kind: "number", min: null, max: null };
    case "date": return { kind: "date", from: null, to: null };
    case "boolean": return { kind: "boolean", value: null };
    default: return { kind: "text", q: "" };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/filters/CustomFieldFilter.test.tsx`
Expected: PASS (or deferred to CI).

- [ ] **Step 5: Extend SortControl (backward-compatible generic)**

Replace the contents of `src/components/filters/SortControl.tsx` with:

```tsx
import { ArrowDownAZ, ArrowUpAZ, ArrowDown01, ArrowUp01 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type SortValue = 'alpha_asc' | 'alpha_desc' | 'chrono_asc' | 'chrono_desc';

interface Props<T extends string = SortValue> {
  value: T;
  onChange: (v: T) => void;
  chronoLabel?: string;
  /** Extra sort options appended below the built-ins (e.g. custom sortable fields). */
  extraOptions?: { value: T; label: string }[];
}

export function SortControl<T extends string = SortValue>({ value, onChange, chronoLabel = 'Date', extraOptions = [] }: Props<T>) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger className="w-[200px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={'alpha_asc' as T}><span className="flex items-center gap-2"><ArrowDownAZ className="h-4 w-4" />Name A → Z</span></SelectItem>
        <SelectItem value={'alpha_desc' as T}><span className="flex items-center gap-2"><ArrowUpAZ className="h-4 w-4" />Name Z → A</span></SelectItem>
        <SelectItem value={'chrono_asc' as T}><span className="flex items-center gap-2"><ArrowDown01 className="h-4 w-4" />{chronoLabel} ↑</span></SelectItem>
        <SelectItem value={'chrono_desc' as T}><span className="flex items-center gap-2"><ArrowUp01 className="h-4 w-4" />{chronoLabel} ↓</span></SelectItem>
        {extraOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
```

(Existing callers pass `SortValue` and infer `T = SortValue` — unchanged.)

- [ ] **Step 6: ShowsBookingsPage — query, type, and custom defs**

In `src/pages/ShowsBookingsPage.tsx`:

Add imports:

```ts
import { formatCustomValue, compareCustomValues, customFilterMatches, type CustomFilterState } from '@/lib/customFields';
import { CustomFieldFilter, emptyCustomFilter } from '@/components/filters/CustomFieldFilter';
```

Add `custom` to `ShowDateRow`:

```ts
  city: CityRef;
  custom: Record<string, unknown> | null;
```

Add `custom` to the query `select` string (append after `city_id, show_id,`):

```ts
        .select(`
          id, date, session_1, session_2, session_3, venue, status, notes, city_id, show_id, custom,
          show:shows(id, program, sub_program, required_skills, status, main_cast_slots, understudy_slots),
          city:cities(id, name)
        `)
```

In `ProducerShowsBookings`, after `const columnHeaders = useColumnHeaders(orderedColumns);`, read custom defs and derive lookup structures:

```ts
  const { getCustomFieldDefs } = useEditorConfig();
  const customDefs = getCustomFieldDefs('show_dates');
  const customByColId = useMemo(
    () => new Map(customDefs.map(d => [`custom.${d.key}`, d])),
    [customDefs]
  );
  const filterableDefs = customDefs.filter(d => d.filterable);
  const sortableDefs = customDefs.filter(d => d.sortable);
```

(`useEditorConfig` is already imported in this file.)

- [ ] **Step 7: ShowsBookingsPage — custom filter + sort state**

Add state next to the other filter state (after `const [sort, setSort] = useState<SortValue>('chrono_asc');`):

```ts
  const [customFilters, setCustomFilters] = useState<Record<string, CustomFilterState>>({});
```

Widen the sort state type. Replace `const [sort, setSort] = useState<SortValue>('chrono_asc');` with:

```ts
  type ProducerSort = SortValue | `custom:${string}`;
  const [sort, setSort] = useState<ProducerSort>('chrono_asc');
  const isCustomSort = (s: ProducerSort): s is `custom:${string}` => s.startsWith('custom:');
  const sortExtraOptions = sortableDefs.flatMap(d => ([
    { value: `custom:${d.key}:asc` as ProducerSort, label: `${d.label} ↑` },
    { value: `custom:${d.key}:desc` as ProducerSort, label: `${d.label} ↓` },
  ]));
```

- [ ] **Step 8: ShowsBookingsPage — apply custom filter + sort in the `filtered` memo**

In the `filtered` useMemo, after the `statusFilter` block and before the `applySort` return, insert the custom-filter pass:

```ts
    for (const def of filterableDefs) {
      const f = customFilters[`custom.${def.key}`];
      if (f) list = list.filter(sd => customFilterMatches(sd.custom?.[def.key], def.type, f));
    }
```

Replace the `return applySort(...)` line with a branch that honors custom sort:

```ts
    if (isCustomSort(sort)) {
      const [, key, dir] = sort.split(':');
      const def = customDefs.find(d => d.key === key);
      if (def) {
        const sign = dir === 'desc' ? -1 : 1;
        return [...list].sort((a, b) => sign * compareCustomValues(a.custom?.[key], b.custom?.[key], def.type));
      }
    }
    return applySort(list as ShowDateRow[], sort as SortValue,
      sd => sd.show?.program ?? '',
      sd => new Date(sd.date + 'T00:00:00')
    );
```

Add `customFilters`, `filterableDefs`, `customDefs` to the `filtered` memo dependency array (alongside `showDates, search, programs, timeframe, statusFilter, sort`).

- [ ] **Step 9: ShowsBookingsPage — render the SortControl extra options + filter controls**

Pass `extraOptions` to the existing `SortControl`:

```tsx
        {canSee('sort') && <SortControl value={sort} onChange={setSort} chronoLabel="Date" extraOptions={sortExtraOptions} />}
```

Add the custom filter controls into the filter bar, immediately before the `<div className="ml-auto">` ViewToggle wrapper:

```tsx
        {filterableDefs.map(def => (
          <CustomFieldFilter
            key={def.id}
            def={def}
            value={customFilters[`custom.${def.key}`] ?? emptyCustomFilter(def.type)}
            onChange={(v) => setCustomFilters(prev => ({ ...prev, [`custom.${def.key}`]: v }))}
          />
        ))}
```

- [ ] **Step 10: ShowsBookingsPage — render custom cells**

In `cellFor`, replace the `default:` branch with:

```ts
                    default: {
                      // Custom (Airtable-synced) columns — display/filter/sort ONLY, never booking logic.
                      if (colId.startsWith('custom.')) {
                        const def = customByColId.get(colId);
                        const val = sd.custom?.[colId.slice('custom.'.length)];
                        return (
                          <TableCell key={colId} className="text-sm whitespace-nowrap">
                            {def ? formatCustomValue(val, def.type) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        );
                      }
                      return (
                        <TableCell key={colId} className="text-xs text-muted-foreground">—</TableCell>
                      );
                    }
```

- [ ] **Step 11: Typecheck / lint / run filter tests**

Run: `npx tsc --noEmit && npm run lint && npx vitest run src/components/filters src/lib/customFields.test.ts` (or rely on CI).
Expected: green; no type errors from the widened `SortControl` or the new state types.

- [ ] **Step 12: Commit**

```bash
git add src/components/filters/CustomFieldFilter.tsx src/components/filters/CustomFieldFilter.test.tsx src/components/filters/SortControl.tsx src/pages/ShowsBookingsPage.tsx
git commit -m "feat(custom-fields): producer table renders, filters, and sorts custom columns" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Docs + full verification

**Files:**
- Modify: `docs/app-logic.md`

- [ ] **Step 1: Document the boundary + promotion path**

Append a short section to `docs/app-logic.md` (under the Airtable sync area):

```markdown
### Custom (Airtable-synced) fields

Admins can capture extra Airtable fields as typed columns on show dates (Settings → Airtable Sync →
Custom fields). They are stored in `show_dates.custom` (jsonb) and defined per-org in
`custom_field_definitions`. They are **display / filter / sort metadata only** — they never drive
eligibility, offers, slot capacity, or status. If a custom field becomes load-bearing for booking
logic, **promote it to a real typed column** via a migration (add the column, backfill from
`custom`, move the logic onto it) rather than reading `custom` in booking code.
```

- [ ] **Step 2: Full test sweep**

Run (or rely on CI):
```bash
npx vitest run
deno test supabase/functions/ --allow-all
npm run lint
npm run build
```
Expected: all green. pgTAP runs in CI (`supabase test db`).

- [ ] **Step 3: Manual smoke (optional, needs real Airtable config)**

In Settings → Airtable Sync: pick a base/table, map core fields, add a custom field from an unmapped Airtable field, trigger a poll, then in Shows & Bookings enable the custom column via the column editor and confirm it displays/filters/sorts. (This requires a configured PAT + field map; deferred to ops if not available.)

- [ ] **Step 4: Commit**

```bash
git add docs/app-logic.md
git commit -m "docs(custom-fields): boundary + promotion path for Airtable custom fields" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Storage (jsonb + table + RLS) → Task 1. ✓
- Sync coercion + non-fatal write → Tasks 2–3. ✓
- Frontend pure helpers (format/compare/filter/type-map/slug) → Task 4. ✓
- Data access → Task 5. ✓
- Editor threading (ColumnDef/resolveColumnTemplate/CUSTOM_FIELD_PAGES/context/ColumnLayoutEditor) → Tasks 6–7. ✓
- Capture UI → Task 8. ✓
- Page render + client-side filter/sort + SortControl extension → Task 9. ✓
- Tests across pgTAP/Deno/Vitest/RTL → embedded in each task. ✓
- Docs + boundary → Task 10. ✓

**Type consistency:** `CustomFieldType` is the same union in `src/lib/customFields.ts` and `supabase/functions/_shared/customFields.ts`. `CustomFieldDefinition` (data layer) is consumed by the editor context, capture card, and page. `CustomFilterState` (lib) is consumed by `CustomFieldFilter` and the page. `customFieldDefToColumnDef({key,type})` signature matches its call in EditorContext. `resolveColumnTemplate(..., extraDefs)` arity matches its callers (EditorContext + the Task 6 test; ColumnLayoutEditor now routes through `getColumnTemplate`). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows the run command and expected result. ✓

**Boundary invariant** is restated in code at the coercer, the poll, and the page cell. ✓
