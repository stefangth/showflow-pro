# Phase 2b-UI — Airtable Mapping/Linking Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-typed Airtable Settings tab with a schema-driven mapping UI — base/table/field dropdowns from the `airtable-schema` edge function (with a typed fallback), admin-chosen link grain, and catalog linking (bulk "import all" + manual link/slot edit) of Airtable Program/City options to `shows`/`cities` — and remove the dead "Filter Mappings" card.

**Architecture:** A new `src/components/settings/AirtableSyncTab.tsx` component (extracted from the 1205-line `SettingsPage.tsx`), driven by a new `src/data/` access layer: `airtableSchema.ts` (invoke wrappers), field-map + link-key helpers, a new `cities.ts` module, and `shows` linking/import added to `settings.ts`. Field-map + connection config persist through the existing `get/set` draft → `upsertOrgSetting` save; catalog links/imports are immediate mutations (like `ShowSlotsEditor`). Implements [the Phase 2b design](../specs/2026-06-17-airtable-mapping-model-phase-2b-design.md) §4 and [engine spec](../specs/2026-06-16-airtable-sync-engine-design.md) §6/§8.

**Tech Stack:** React 18 + TS, `@tanstack/react-query`, shadcn/ui, `sonner`, vitest + jsdom + @testing-library. **Frontend tests are CI-only in this environment (no local Node/npm)** — write tests test-first, but they RUN in CI (the "Unit tests" + "Typecheck" jobs). Verify each task by pushing and reading CI, or rely on review; do not expect a local `vitest` run. Data-access is tested with `src/test/supabaseFake.ts` (`createFakeSupabase`), components with `src/test/renderWithProviders.tsx`. The vitest command (CI) is `npm run test` (`vitest run`).

---

## ⚠️ Conventions to follow (verified in the codebase)

- **Data-access:** every function takes `client: SupabaseClient<Database>` first; never import the `supabase` singleton inside `src/data/`. Hooks/components pass `supabase`. (Pattern: `src/data/settings.ts`, `src/data/invitations.ts`.)
- **invoke:** `const { data, error } = await client.functions.invoke('name', { body }); if (error) throw error; const payload = data as {...}; if (payload?.error) throw new Error(payload.error);` (Pattern: `src/data/invitations.ts:27`.) Test by seeding `"fn:<name>"` in `createFakeSupabase`.
- **Settings draft:** `get(key, fallback)` / `set(key, value)` mutate a SettingsPage `draft`; the global Save button persists dirty keys via `upsertOrgSetting`. Sub-tabs receive `{ get, set }` props (like `BookingEngineTab`). Keep base/table/field-map in the draft.
- **Immediate mutations** (links, imports, the API key) use `useMutation` + `toast` + `qc.invalidateQueries`, NOT the draft.
- **Toast:** `import { toast } from 'sonner'`. **Query keys:** invalidate broad prefixes (`['app-settings']`, `['shows']`, `['cities']`).

---

## File Structure

- `src/data/airtableSchema.ts` — **new.** `fetchAirtableBases` / `fetchAirtableTables` invoke wrappers + types. Test: `airtableSchema.test.ts`.
- `src/data/airtableMapping.ts` — **new.** `AirtableFieldMap` type, `SHOWFLOW_FIELDS` constant, `buildProgramKey`/`buildCityKey` (grain-agnostic key composition). Test: `airtableMapping.test.ts`.
- `src/data/cities.ts` — **new.** `fetchCitiesForLinking`, `linkCityAirtableKey`, `importCitiesFromOptions`. Test: `cities.test.ts`.
- `src/data/settings.ts` — **modify.** Add `airtable_program_key` to the shows fetch; add `linkShowAirtableKey`, `importShowsFromOptions`. Test: extend `settings.test.ts`.
- `src/components/settings/AirtableSyncTab.tsx` — **new.** The whole tab (extracted, then enhanced). Test: `AirtableSyncTab.test.tsx`.
- `src/pages/SettingsPage.tsx` — **modify.** Render `<AirtableSyncTab>`; drop the moved key state; remove the Filter Mappings card.
- `CLAUDE.md` — **modify.** Note the mapping UI replaces Filter Mappings.

---

### Task 1: `airtableSchema` data-access (invoke wrappers)

**Files:** Create `src/data/airtableSchema.ts`, `src/data/airtableSchema.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/data/airtableSchema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchAirtableBases, fetchAirtableTables } from "./airtableSchema";

describe("airtableSchema data-access", () => {
  it("fetchAirtableBases returns bases and sends org_id", async () => {
    const fake = createFakeSupabase({
      "fn:airtable-schema": { data: { schemaAccessible: true, bases: [{ id: "appA", name: "Base A" }] }, error: null },
    });
    const res = await fetchAirtableBases(fake as never, "org-1");
    expect(res).toEqual({ schemaAccessible: true, bases: [{ id: "appA", name: "Base A" }] });
    expect(fake.calls).toContainEqual({ table: "fn:airtable-schema", method: "invoke", args: [{ body: { org_id: "org-1" } }] });
  });

  it("fetchAirtableTables sends org_id + baseId and returns tables", async () => {
    const fake = createFakeSupabase({
      "fn:airtable-schema": { data: { schemaAccessible: true, tables: [{ id: "tbl1", name: "Events", fields: [{ id: "f1", name: "Datum", type: "date" }] }] }, error: null },
    });
    const res = await fetchAirtableTables(fake as never, "org-1", "appA");
    expect(res.tables?.[0].name).toBe("Events");
    expect(fake.calls).toContainEqual({ table: "fn:airtable-schema", method: "invoke", args: [{ body: { org_id: "org-1", baseId: "appA" } }] });
  });

  it("maps schemaAccessible:false (no bases)", async () => {
    const fake = createFakeSupabase({ "fn:airtable-schema": { data: { schemaAccessible: false }, error: null } });
    const res = await fetchAirtableBases(fake as never, "org-1");
    expect(res).toEqual({ schemaAccessible: false, bases: undefined });
  });

  it("throws the function-level error", async () => {
    const fake = createFakeSupabase({ "fn:airtable-schema": { data: { error: "No Airtable key configured" }, error: null } });
    await expect(fetchAirtableBases(fake as never, "org-1")).rejects.toThrow("No Airtable key configured");
  });
});
```

> **Note:** confirm `createFakeSupabase` records `functions.invoke` as `{ table: "fn:<name>", method: "invoke", args: [opts] }`. If the recorded shape differs (check `src/test/supabaseFake.ts`), adjust the `toContainEqual` expectations to match the harness — the harness is the source of truth, do not change production code to fit a guessed shape.

- [ ] **Step 2: Run (CI or note)** — `npm run test` runs in CI. Expected: FAIL (`Cannot find module './airtableSchema'`).

- [ ] **Step 3: Implement** — `src/data/airtableSchema.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface AirtableBase { id: string; name: string }
export interface AirtableField { id: string; name: string; type: string; options?: Record<string, unknown> }
export interface AirtableTable { id: string; name: string; fields: AirtableField[] }

export interface BasesResult { schemaAccessible: boolean; bases?: AirtableBase[] }
export interface TablesResult { schemaAccessible: boolean; tables?: AirtableTable[] }

/** List the org's accessible Airtable bases via the airtable-schema edge fn (no baseId mode). */
export async function fetchAirtableBases(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<BasesResult> {
  const { data, error } = await client.functions.invoke("airtable-schema", { body: { org_id: orgId } });
  if (error) throw error;
  const payload = data as { error?: string; schemaAccessible?: boolean; bases?: AirtableBase[] };
  if (payload?.error) throw new Error(payload.error);
  return { schemaAccessible: !!payload?.schemaAccessible, bases: payload?.bases };
}

/** Describe one base's tables + fields via the airtable-schema edge fn (baseId mode). */
export async function fetchAirtableTables(
  client: SupabaseClient<Database>,
  orgId: string,
  baseId: string,
): Promise<TablesResult> {
  const { data, error } = await client.functions.invoke("airtable-schema", { body: { org_id: orgId, baseId } });
  if (error) throw error;
  const payload = data as { error?: string; schemaAccessible?: boolean; tables?: AirtableTable[] };
  if (payload?.error) throw new Error(payload.error);
  return { schemaAccessible: !!payload?.schemaAccessible, tables: payload?.tables };
}
```

- [ ] **Step 4: Run (CI)** — Expected: the 4 tests pass.
- [ ] **Step 5: Commit** — `git add src/data/airtableSchema.ts src/data/airtableSchema.test.ts && git commit -m "feat(data): airtable-schema invoke wrappers" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 2: Field-map type + grain-agnostic key helpers

**Files:** Create `src/data/airtableMapping.ts`, `src/data/airtableMapping.test.ts`.

The link key is **grain-agnostic**: `buildProgramKey` joins the mapped program-identifying value(s) with a canonical separator so the UI link-builder and the Phase 3 poll agree. When only `sub_program` is mapped → key = that option; when `program` + `sub_program` are both mapped → composite `"<program>|<sub_program>"`.

- [ ] **Step 1: Write the failing test** — `src/data/airtableMapping.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildProgramKey, buildCityKey, SHOWFLOW_FIELDS } from "./airtableMapping";

describe("airtableMapping key helpers", () => {
  it("buildProgramKey uses sub_program alone when program value is absent", () => {
    expect(buildProgramKey(null, "TJE: Murder")).toBe("TJE: Murder");
  });
  it("buildProgramKey composes program|sub_program when both present", () => {
    expect(buildProgramKey("TJE", "TJE: Murder")).toBe("TJE|TJE: Murder");
  });
  it("buildProgramKey trims and returns null when nothing usable", () => {
    expect(buildProgramKey(null, "  ")).toBeNull();
    expect(buildProgramKey("  ", null)).toBeNull();
  });
  it("buildCityKey trims; null/blank → null", () => {
    expect(buildCityKey(" Berlin ")).toBe("Berlin");
    expect(buildCityKey("")).toBeNull();
  });
  it("SHOWFLOW_FIELDS lists the mappable core fields incl. optional session_3", () => {
    expect(SHOWFLOW_FIELDS.map(f => f.key)).toEqual(
      ["date", "program", "sub_program", "city", "venue", "session_1", "session_2", "session_3"]);
    expect(SHOWFLOW_FIELDS.find(f => f.key === "session_3")?.optional).toBe(true);
  });
});
```

- [ ] **Step 2: Run (CI)** — FAIL (module missing).

- [ ] **Step 3: Implement** — `src/data/airtableMapping.ts`:

```ts
/** Which Showflow field each Airtable field name maps to. Stored in app_settings.airtable_field_map.
 *  Values are Airtable field NAMES (matched against the schema-read field list) or null/absent. */
export interface AirtableFieldMap {
  date?: string | null;
  program?: string | null;
  sub_program?: string | null;
  city?: string | null;
  venue?: string | null;
  session_1?: string | null;
  session_2?: string | null;
  session_3?: string | null;
}

export interface ShowflowFieldDef { key: keyof AirtableFieldMap; label: string; optional?: boolean }

/** The core fields the admin maps, in display order. session_3 is optional (Fever's base has two). */
export const SHOWFLOW_FIELDS: ShowflowFieldDef[] = [
  { key: "date", label: "Date" },
  { key: "program", label: "Program" },
  { key: "sub_program", label: "Sub-program" },
  { key: "city", label: "City" },
  { key: "venue", label: "Venue" },
  { key: "session_1", label: "Session 1" },
  { key: "session_2", label: "Session 2" },
  { key: "session_3", label: "Session 3", optional: true },
];

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

/** Grain-agnostic program link key. program present → "program|sub_program"; else the sub_program
 *  value alone. Returns null when neither yields content. Must match the Phase 3 poll's resolver. */
export function buildProgramKey(program: string | null | undefined, subProgram: string | null | undefined): string | null {
  const p = clean(program);
  const s = clean(subProgram);
  if (p && s) return `${p}|${s}`;
  return s ?? p;
}

/** City link key — the city option value, trimmed. */
export function buildCityKey(city: string | null | undefined): string | null {
  return clean(city);
}
```

- [ ] **Step 4: Run (CI)** — pass. **Step 5: Commit** — `feat(data): airtable field-map types + grain-agnostic link-key helpers`.

---

### Task 3: `cities` data-access (fetch, link, bulk import)

**Files:** Create `src/data/cities.ts`, `src/data/cities.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/data/cities.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchCitiesForLinking, linkCityAirtableKey, importCitiesFromOptions } from "./cities";

describe("cities data-access", () => {
  it("fetchCitiesForLinking selects link fields for the org", async () => {
    const rows = [{ id: "c1", name: "Berlin", airtable_city_key: "Berlin" }];
    const fake = createFakeSupabase({ cities: { data: rows, error: null } });
    const res = await fetchCitiesForLinking(fake as never, "org-1");
    expect(res).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "cities", method: "eq", args: ["org_id", "org-1"] });
  });
  it("fetchCitiesForLinking returns [] for null org (no query)", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchCitiesForLinking(fake as never, null)).toEqual([]);
  });
  it("linkCityAirtableKey updates the key on the row", async () => {
    const fake = createFakeSupabase({ cities: { data: null, error: null } });
    await linkCityAirtableKey(fake as never, "c1", "Berlin");
    expect(fake.calls).toContainEqual({ table: "cities", method: "update", args: [{ airtable_city_key: "Berlin" }] });
    expect(fake.calls).toContainEqual({ table: "cities", method: "eq", args: ["id", "c1"] });
  });
  it("importCitiesFromOptions inserts only unlinked options (org-scoped, key set)", async () => {
    const fake = createFakeSupabase({ cities: { data: null, error: null } });
    await importCitiesFromOptions(fake as never, "org-1", [{ name: "Hamburg", key: "Hamburg" }]);
    expect(fake.calls).toContainEqual({ table: "cities", method: "insert", args: [[{ org_id: "org-1", name: "Hamburg", airtable_city_key: "Hamburg" }]] });
  });
});
```

- [ ] **Step 2: Run (CI)** — FAIL.

- [ ] **Step 3: Implement** — `src/data/cities.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface CityLink { id: string; name: string; airtable_city_key: string | null }

/** Org's cities with their Airtable link key, for the catalog-linking UI. */
export async function fetchCitiesForLinking(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<CityLink[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("cities").select("id, name, airtable_city_key").eq("org_id", orgId).order("name");
  if (error) throw error;
  return (data ?? []) as CityLink[];
}

/** Link (or, with null, unlink) a city to an Airtable city-option key. */
export async function linkCityAirtableKey(
  client: SupabaseClient<Database>,
  cityId: string,
  key: string | null,
): Promise<void> {
  const { error } = await client.from("cities").update({ airtable_city_key: key }).eq("id", cityId);
  if (error) throw error;
}

/** Bulk-create cities from Airtable City options. Each row: { name, key }. org_id set; idempotency
 *  (skipping already-linked keys) is the caller's job — pass only unlinked options. */
export async function importCitiesFromOptions(
  client: SupabaseClient<Database>,
  orgId: string,
  rows: Array<{ name: string; key: string }>,
): Promise<void> {
  if (!rows.length) return;
  const { error } = await client
    .from("cities")
    .insert(rows.map((r) => ({ org_id: orgId, name: r.name, airtable_city_key: r.key })));
  if (error) throw error;
}
```

- [ ] **Step 4: Run (CI)** — pass. **Step 5: Commit** — `feat(data): cities linking + bulk-import data-access`.

---

### Task 4: `shows` linking + bulk import

**Files:** Modify `src/data/settings.ts`, `src/data/settings.test.ts`.

- [ ] **Step 1: Write the failing test** — append to `src/data/settings.test.ts`:

```ts
import { fetchShowsForLinking, linkShowAirtableKey, importShowsFromOptions } from "./settings";

describe("shows linking data-access", () => {
  it("fetchShowsForLinking includes airtable_program_key + slots for the org", async () => {
    const rows = [{ id: "s1", program: "TJE", sub_program: "TJE: Murder", main_cast_slots: null, understudy_slots: null, airtable_program_key: "TJE|TJE: Murder" }];
    const fake = createFakeSupabase({ shows: { data: rows, error: null } });
    const res = await fetchShowsForLinking(fake as never, "org-1");
    expect(res).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "shows", method: "eq", args: ["org_id", "org-1"] });
  });
  it("linkShowAirtableKey updates the key", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await linkShowAirtableKey(fake as never, "s1", "TJE|TJE: Murder");
    expect(fake.calls).toContainEqual({ table: "shows", method: "update", args: [{ airtable_program_key: "TJE|TJE: Murder" }] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "eq", args: ["id", "s1"] });
  });
  it("importShowsFromOptions inserts shows with NULL slots and the link key", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await importShowsFromOptions(fake as never, "org-1", [{ program: "TJE", sub_program: "TJE: Murder", key: "TJE|TJE: Murder" }]);
    expect(fake.calls).toContainEqual({ table: "shows", method: "insert", args: [[
      { org_id: "org-1", program: "TJE", sub_program: "TJE: Murder", airtable_program_key: "TJE|TJE: Murder", main_cast_slots: null, understudy_slots: null, status: "active" },
    ]] });
  });
});
```

- [ ] **Step 2: Run (CI)** — FAIL.

- [ ] **Step 3: Implement** — append to `src/data/settings.ts` (after `updateShowSlots`):

```ts
export interface ShowLink extends ShowWithSlots { airtable_program_key: string | null }

/** Org's shows with slots + Airtable link key, for the catalog-linking UI. */
export async function fetchShowsForLinking(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<ShowLink[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("shows")
    .select("id, program, sub_program, main_cast_slots, understudy_slots, airtable_program_key")
    .eq("org_id", orgId).order("program").order("sub_program");
  if (error) throw error;
  return (data ?? []) as ShowLink[];
}

/** Link (or, with null, unlink) a show to an Airtable program-option key. */
export async function linkShowAirtableKey(
  client: SupabaseClient<Database>,
  showId: string,
  key: string | null,
): Promise<void> {
  const { error } = await client.from("shows").update({ airtable_program_key: key }).eq("id", showId);
  if (error) throw error;
}

/** Bulk-create shows from Airtable Program options. Slots start NULL ("needs config"); status active.
 *  Pass only unlinked options (caller dedupes against existing airtable_program_key). */
export async function importShowsFromOptions(
  client: SupabaseClient<Database>,
  orgId: string,
  rows: Array<{ program: string | null; sub_program: string | null; key: string }>,
): Promise<void> {
  if (!rows.length) return;
  const { error } = await client.from("shows").insert(
    rows.map((r) => ({
      org_id: orgId, program: r.program, sub_program: r.sub_program,
      airtable_program_key: r.key, main_cast_slots: null, understudy_slots: null, status: "active" as const,
    })),
  );
  if (error) throw error;
}
```

- [ ] **Step 4: Run (CI)** — pass. **Step 5: Commit** — `feat(data): shows linking + bulk-import data-access`.

---

### Task 5: Extract the Airtable tab into `AirtableSyncTab` (pure refactor)

**Files:** Create `src/components/settings/AirtableSyncTab.tsx`; Modify `src/pages/SettingsPage.tsx`.

Move the **current** connection card verbatim into a component taking `{ get, set, orgId }`, with the write-only key state moved in. No behavior change.

- [ ] **Step 1: Create the component** — `src/components/settings/AirtableSyncTab.tsx`:

```tsx
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

interface Props {
  orgId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: (key: string, fallback?: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: (key: string, value: any) => void;
}

export function AirtableSyncTab({ orgId, get, set }: Props) {
  const [airtableKey, setAirtableKey] = useState("");
  const saveKey = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No active organization");
      if (!airtableKey.trim()) throw new Error("Enter an API key");
      const { error } = await supabase.rpc("set_org_airtable_key", { _org: orgId, _key: airtableKey.trim() });
      if (error) throw error;
    },
    onSuccess: () => { setAirtableKey(""); toast.success("Airtable API key saved"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Failed to save Airtable key"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Airtable Sync</CardTitle>
        <CardDescription>
          Pull show schedules from Airtable on a regular interval. The sync runs on a pg_cron schedule — enable this toggle to allow the cron job to process records. Make sure the Airtable base ID, table name, and API key secret are configured first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Label className="font-medium">Enable Airtable sync</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Turn polling on or off globally.</p>
          </div>
          <Switch checked={!!get("airtable_sync_enabled", false)} onCheckedChange={(v) => set("airtable_sync_enabled", v)} />
        </div>
        <Separator />
        <div className="grid grid-cols-1 gap-4">
          <div className="space-y-2">
            <Label>Airtable base ID</Label>
            <Input placeholder="app1234567890" value={get("airtable_base_id", "")} onChange={(e) => set("airtable_base_id", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Airtable table name</Label>
            <Input placeholder="Shows" value={get("airtable_table_name", "")} onChange={(e) => set("airtable_table_name", e.target.value)} />
          </div>
        </div>
        {/* Write-only: the key is stored in Vault and never read back into the UI. */}
        <div className="space-y-2">
          <Label htmlFor="airtable-key">Airtable API key</Label>
          <div className="flex gap-2">
            <Input id="airtable-key" type="password" autoComplete="off" placeholder="key… (write-only)" value={airtableKey} onChange={(e) => setAirtableKey(e.target.value)} />
            <Button onClick={() => saveKey.mutate()} disabled={saveKey.isPending}>Save key</Button>
          </div>
          <p className="text-sm text-muted-foreground">Stored encrypted; never displayed. Required for Airtable sync.</p>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Wire into SettingsPage** — in `src/pages/SettingsPage.tsx`:
  1. Add import (near line 25): `import { AirtableSyncTab } from '@/components/settings/AirtableSyncTab';`
  2. Replace the entire `<TabsContent value="airtable" …>…</TabsContent>` block (lines 1018–1068) with:
     ```tsx
     <TabsContent value="airtable" className="mt-4">
       <AirtableSyncTab orgId={orgId} get={get} set={set} />
     </TabsContent>
     ```
  3. Delete the now-unused `airtableKey` state + `saveAirtableKey` mutation (lines 399–409) — they moved into the component. Confirm nothing else references them: `grep -n "airtableKey\|saveAirtableKey" src/pages/SettingsPage.tsx` should return no matches after the edit.

- [ ] **Step 3: Typecheck (CI)** — the "Typecheck" job must stay green. No test yet (behavior unchanged; covered by Task 10).
- [ ] **Step 4: Commit** — `refactor(settings): extract AirtableSyncTab from SettingsPage`.

---

### Task 6: Schema-driven base/table dropdowns (with typed fallback)

**Files:** Modify `src/components/settings/AirtableSyncTab.tsx`.

Add a **"Load from Airtable"** action that calls `fetchAirtableBases`; if `schemaAccessible`, render base + table **dropdowns** (selecting a base loads its tables); else keep the typed inputs and show a scope banner. Selected base/table persist to the draft (`airtable_base_id` / `airtable_table_name`).

- [ ] **Step 1** — add imports + state + load logic at the top of `AirtableSyncTab`:

```tsx
// add to imports:
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { fetchAirtableBases, fetchAirtableTables, type AirtableTable } from "@/data/airtableSchema";

// inside the component, after saveKey:
const [schemaState, setSchemaState] = useState<"idle" | "accessible" | "fallback">("idle");
const [bases, setBases] = useState<{ id: string; name: string }[]>([]);
const [tables, setTables] = useState<AirtableTable[]>([]);

const loadBases = useMutation({
  mutationFn: () => fetchAirtableBases(supabase, orgId!),
  onSuccess: (res) => {
    if (res.schemaAccessible) { setSchemaState("accessible"); setBases(res.bases ?? []); }
    else { setSchemaState("fallback"); toast.info("Airtable key can't read schema — enter base/table/field names manually."); }
  },
  onError: (e: unknown) => toast.error((e as Error).message ?? "Could not load Airtable bases"),
});
const loadTables = useMutation({
  mutationFn: (baseId: string) => fetchAirtableTables(supabase, orgId!, baseId),
  onSuccess: (res) => setTables(res.schemaAccessible ? res.tables ?? [] : []),
  onError: (e: unknown) => toast.error((e as Error).message ?? "Could not load tables"),
});

const selectedTable = tables.find((t) => t.name === get("airtable_table_name", ""));
```

- [ ] **Step 2** — replace the base/table `grid` block (the two typed inputs) with a load button + conditional dropdowns/fallback:

```tsx
<div className="space-y-4">
  <Button variant="outline" onClick={() => loadBases.mutate()} disabled={loadBases.isPending || !orgId}>
    {loadBases.isPending ? "Loading…" : "Load from Airtable"}
  </Button>

  {schemaState === "accessible" ? (
    <div className="grid grid-cols-1 gap-4">
      <div className="space-y-2">
        <Label>Base</Label>
        <Select value={get("airtable_base_id", "")} onValueChange={(v) => { set("airtable_base_id", v); setTables([]); set("airtable_table_name", ""); loadTables.mutate(v); }}>
          <SelectTrigger><SelectValue placeholder="Select a base" /></SelectTrigger>
          <SelectContent>{bases.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Table</Label>
        <Select value={get("airtable_table_name", "")} onValueChange={(v) => set("airtable_table_name", v)} disabled={!tables.length}>
          <SelectTrigger><SelectValue placeholder="Select a table" /></SelectTrigger>
          <SelectContent>{tables.map((t) => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  ) : (
    <>
      {schemaState === "fallback" && (
        <Alert><AlertDescription>Your Airtable key lacks the <code>schema.bases:read</code> scope. Grant it to pick base/table/fields from dropdowns; until then, type the names below.</AlertDescription></Alert>
      )}
      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2">
          <Label>Airtable base ID</Label>
          <Input placeholder="app1234567890" value={get("airtable_base_id", "")} onChange={(e) => set("airtable_base_id", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Airtable table name</Label>
          <Input placeholder="Shows" value={get("airtable_table_name", "")} onChange={(e) => set("airtable_table_name", e.target.value)} />
        </div>
      </div>
    </>
  )}
</div>
```

- [ ] **Step 3: Typecheck (CI).** **Step 4: Commit** — `feat(settings): schema-driven base/table dropdowns with typed fallback`.

> `selectedTable` (the chosen table's fields) is consumed by Tasks 7–8.

---

### Task 7: Field-mapping section

**Files:** Modify `src/components/settings/AirtableSyncTab.tsx`.

A dropdown per `SHOWFLOW_FIELDS` entry, options = `selectedTable.fields`, saved to the `airtable_field_map` draft key. The **link grain** follows which of `program`/`sub_program` the admin maps (documented inline).

- [ ] **Step 1** — add imports + a helper, then render the section (only when a table's fields are loaded):

```tsx
// imports:
import { SHOWFLOW_FIELDS, type AirtableFieldMap } from "@/data/airtableMapping";

// inside the component:
const fieldMap = (get("airtable_field_map", {}) ?? {}) as AirtableFieldMap;
const setField = (key: keyof AirtableFieldMap, value: string | null) =>
  set("airtable_field_map", { ...fieldMap, [key]: value });
const NONE = "__none__"; // shadcn Select can't use "" as an item value
```

```tsx
{selectedTable && (
  <Card>
    <CardHeader>
      <CardTitle className="font-display">Field mapping</CardTitle>
      <CardDescription>
        Map each Showflow field to a column in <strong>{selectedTable.name}</strong>. Catalog links are keyed on the <strong>Sub-program</strong> option (current scope) — map the Sub-program field to enable linking. (The link column is grain-agnostic, so a Program+Sub-program composite grain can be added later without a migration.)
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {SHOWFLOW_FIELDS.map((f) => (
        <div key={f.key} className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 items-center">
          <Label>{f.label}{f.optional ? " (optional)" : ""}</Label>
          <Select
            value={(fieldMap[f.key] as string | null) ?? NONE}
            onValueChange={(v) => setField(f.key, v === NONE ? null : v)}
          >
            <SelectTrigger><SelectValue placeholder="Not mapped" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Not mapped</SelectItem>
              {selectedTable.fields.map((af) => <SelectItem key={af.id} value={af.name}>{af.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ))}
    </CardContent>
  </Card>
)}
```

- [ ] **Step 2: Typecheck (CI).** **Step 3: Commit** — `feat(settings): Airtable field-mapping dropdowns`.

> The field map saves through the global Settings "Save" button (it's in the draft). Catalog linking (Task 8) is immediate.

---

### Task 8: Catalog-linking section (import-all + manual link + slots)

**Files:** Modify `src/components/settings/AirtableSyncTab.tsx`.

Resolve the mapped Program/City **options** from the selected table's `singleSelect` fields (`field.options.choices`), and link them to `shows`/`cities`. "Import all" creates the unlinked ones (NULL slots); each linked show shows slot inputs.

- [ ] **Step 1** — add imports + query/mutation wiring:

```tsx
// imports:
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { buildProgramKey, buildCityKey } from "@/data/airtableMapping";
import { fetchShowsForLinking, linkShowAirtableKey, importShowsFromOptions, updateShowSlots } from "@/data/settings";
import { fetchCitiesForLinking, linkCityAirtableKey, importCitiesFromOptions } from "@/data/cities";

// inside the component:
const qc = useQueryClient();
const showsQ = useQuery({ queryKey: ["shows", "linking", orgId], enabled: !!orgId, queryFn: () => fetchShowsForLinking(supabase, orgId) });
const citiesQ = useQuery({ queryKey: ["cities", "linking", orgId], enabled: !!orgId, queryFn: () => fetchCitiesForLinking(supabase, orgId) });

/** Distinct option names from a mapped singleSelect field. */
const optionNames = (fieldName: string | null | undefined): string[] => {
  if (!fieldName || !selectedTable) return [];
  const f = selectedTable.fields.find((x) => x.name === fieldName);
  const choices = (f?.options as { choices?: Array<{ name: string }> } | undefined)?.choices ?? [];
  return choices.map((c) => c.name);
};

const programOptions = optionNames(fieldMap.sub_program); // sub-program-only linking (current scope)
const cityOptions = optionNames(fieldMap.city);

const importPrograms = useMutation({
  mutationFn: async () => {
    const linked = new Set((showsQ.data ?? []).map((s) => s.airtable_program_key).filter(Boolean));
    // Sub-program-only linking (current scope): key = the sub-program option value.
    const rows = programOptions
      .map((name) => ({ name, key: buildProgramKey(null, name) }))
      .filter((r) => r.key && !linked.has(r.key))
      .map((r) => ({ program: null, sub_program: r.name, key: r.key! }));
    await importShowsFromOptions(supabase, orgId!, rows);
  },
  onSuccess: () => { qc.invalidateQueries({ queryKey: ["shows"] }); toast.success("Imported program options"); },
  onError: (e: unknown) => toast.error((e as Error).message ?? "Import failed"),
});
const importCities = useMutation({
  mutationFn: async () => {
    const linked = new Set((citiesQ.data ?? []).map((c) => c.airtable_city_key).filter(Boolean));
    const rows = cityOptions.map((name) => ({ name, key: buildCityKey(name) })).filter((r) => r.key && !linked.has(r.key)).map((r) => ({ name: r.name, key: r.key! }));
    await importCitiesFromOptions(supabase, orgId!, rows);
  },
  onSuccess: () => { qc.invalidateQueries({ queryKey: ["cities"] }); toast.success("Imported city options"); },
  onError: (e: unknown) => toast.error((e as Error).message ?? "Import failed"),
});
```

> **Grain (decided): sub-program-only.** Link/import on the **Sub-Programm** option value (`buildProgramKey(null, name)`); imported shows get `program = null, sub_program = name`. The Program+Sub-Programm composite grain is **out of scope for 2b-UI** — the grain-agnostic `airtable_program_key` column + `buildProgramKey` already support it, so it can be added later (or in Phase 3) without a migration. Do **not** build the composite import path.

- [ ] **Step 2** — render the linking section (a Card listing program options with link state + a slots editor for linked shows, and city options). Use a `Table` (programs) and a simple list (cities); "Import all" buttons call the mutations; per-row link uses `linkShowAirtableKey`/`linkCityAirtableKey` (wrap in small `useMutation`s invalidating `['shows']`/`['cities']`); slot inputs reuse `updateShowSlots`. Render only when `selectedTable` and a Program/City field are mapped. (Build this with the same `Card`/`Table`/`Badge`/`Input`/`Button` primitives already imported; mirror `ShowSlotsEditor`'s per-row save for the slot inputs.)

- [ ] **Step 3: Typecheck (CI).** **Step 4: Commit** — `feat(settings): Airtable catalog linking (import-all + manual link + slots)`.

---

### Task 9: Remove the dead "Filter Mappings" card

**Files:** Modify `src/pages/SettingsPage.tsx`.

- [ ] **Step 1** — delete ONLY the "Filter Mappings (Airtable)" Card (the `<Card>…</Card>` at lines 1071–1090), leaving the surrounding `<TabsContent value="filters">` and the "Filter Visibility per Role" Card intact. The exact block to remove starts at `<Card>` immediately under `<TabsContent value="filters" …>` and ends at the `</Card>` just before the "Filter Visibility per Role" `<Card>`. Its `CardTitle` is `Filter Mappings (Airtable)` and it maps `['program', 'timeframe', 'sort_field', 'status']` writing `filter_mappings`.
- [ ] **Step 2** — confirm no `filter_mappings` references remain: `grep -rn "filter_mappings" src/` → no matches.
- [ ] **Step 3: Typecheck (CI).** **Step 4: Commit** — `feat(settings): remove dead Filter Mappings card`.

---

### Task 10: Component tests

**Files:** Create `src/components/settings/AirtableSyncTab.test.tsx`.

- [ ] **Step 1** — write tests with `renderWithProviders` + `createFakeSupabase` covering: (a) renders the typed base/table inputs by default; (b) clicking "Load from Airtable" with a `fn:airtable-schema` seed of `{schemaAccessible:false}` switches to the fallback banner; (c) with `{schemaAccessible:true,bases:[…]}` renders the base dropdown; (d) the field-mapping section appears once a table with fields is selected. Use the harness's documented way to drive shadcn `Select` (query by role/text). Seed `fn:airtable-schema` and `rpc:set_org_airtable_key` as needed. Mock `get`/`set` with simple closures over a local object.
- [ ] **Step 2: Run (CI) → pass.** **Step 3: Commit** — `test(settings): AirtableSyncTab schema-load + fallback + mapping`.

> Keep these behavior-level (rendered output, branch on schemaAccessible), not implementation detail. If a shadcn `Select` is awkward to drive in jsdom, assert on the presence of the trigger/options text rather than simulating the full Radix open sequence.

---

### Task 11: Docs

**Files:** Modify `CLAUDE.md`.

- [ ] **Step 1** — in the `## Architecture` `components/` list, add `settings/` with `AirtableSyncTab`; and update the Airtable decision bullet to note the Settings → Airtable Sync tab now does schema-driven mapping + catalog linking (replacing the removed "Filter Mappings" card), reading `airtable_field_map` and linking options to `shows.airtable_program_key`/`cities.airtable_city_key`.
- [ ] **Step 2: Commit** — `docs: document the Airtable mapping/linking Settings UI`.

---

## Notes for the executor

- **Frontend tests run in CI only** (no local Node). Treat the "run the test" steps as: write test-first, then validate via the CI "Unit tests" + "Typecheck" jobs after pushing (or via review). Do not claim a green test you did not see — rely on CI output.
- **Order:** data-access (1–4) before the component (5–8); 5 (extract) before 6–8 (enhance); 9 + 10 + 11 any time after 8.
- **No prod/DB work** — 2b-DB already shipped the columns. This plan is pure frontend + data-access.
- **`createFakeSupabase` call shape:** before writing the data-access tests, open `src/test/supabaseFake.ts` and confirm exactly how `functions.invoke`, `update`, and `insert` are recorded into `.calls` (and how `fn:`/`rpc:` seeds resolve). Match the assertions to the harness; if a recorded shape differs from this plan's `toContainEqual`, the harness wins — adjust the test, never bend production code to a guessed shape.
- **Grain (decided): sub-program-only.** 2b-UI links/imports on the Sub-Programm option value; composite is deferred (the column + `buildProgramKey` support it later, no migration needed). Do not build the composite import path.

## Self-Review

- **Spec coverage (design §4):** field-map data-access ✓ (T2), cities access ✓ (T3), shows linking/import ✓ (T4), schema invoke ✓ (T1); Connection dropdowns + fallback ✓ (T6), field mapping + grain ✓ (T7), catalog links + import-all + NULL slots ✓ (T8), delete Filter Mappings ✓ (T9), component extraction ✓ (T5), tests ✓ (T10), docs ✓ (T11). §4.3 (per-record sync report) correctly deferred to Phase 3 — not in this plan.
- **Placeholder scan:** Task 8 Step 2 and Task 10 Step 1 describe the JSX structurally (build with the already-imported primitives) rather than reprinting every row — the data flow, handlers, and primitives are fully specified, and the repetitive rendering is a `.map` over the listed primitives. The grain is decided as sub-program-only (composite deferred — column + helper support it later). No "TODO/TBD".
- **Type consistency:** `airtable_program_key`/`airtable_city_key`, `AirtableFieldMap`, `fetchShowsForLinking`/`linkShowAirtableKey`/`importShowsFromOptions`, `fetchCitiesForLinking`/`linkCityAirtableKey`/`importCitiesFromOptions`, `fetchAirtableBases`/`fetchAirtableTables`, `buildProgramKey`/`buildCityKey`, `SHOWFLOW_FIELDS` are used identically across tasks.
