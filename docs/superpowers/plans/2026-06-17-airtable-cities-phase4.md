# Airtable Cities — Phase 4 (polish + dedup tooling) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make city catalog hygiene foolproof — case-insensitive linking, Import-all that auto-links to existing cities (no sync-driven duplicates), a per-row link-to-existing control, and a transactional merge tool for any duplicates that slip in — while confirming venue/sessions carry through.

**Architecture:** Two shippable phases. **4a (no DB migration):** one shared `normalizeCityName` makes `buildCityKey` case-insensitive (safe now — prod has 0 linked cities); a pure `planCityReconciliation` drives Import-all to link existing same-name cities instead of creating duplicates; a per-row "link to existing" combobox; the poll inherits case-insensitivity and we assert venue/session carry-through. **4b (DB + UI):** a `merge_cities(survivor, losers[])` SECURITY DEFINER RPC repoints all four `city_id` FKs (with per-table unique-conflict handling) then deletes losers; an auto-detect duplicate panel in Settings surfaces and merges them.

**Tech Stack:** TypeScript/React + @tanstack/react-query + shadcn/ui (frontend); Supabase Postgres + plpgsql (RPC); Deno edge function (`airtable-poll`); Vitest (frontend, CI-only here), Deno test (edge, local), pgTAP (DB, CI-only here).

**Source spec:** [`docs/superpowers/specs/2026-06-17-airtable-cities-phase4-design.md`](../specs/2026-06-17-airtable-cities-phase4-design.md)

**Environment notes (this repo):**
- **No local Node/npm/Vitest** — frontend unit/component tests run in **CI only**. Write them, push, validate via CI.
- **Deno is local** — edge-function tests run with `deno test`.
- **pgTAP is CI-only** — but you can smoke-test a function against the live DB with the Supabase MCP `execute_sql` wrapped in `BEGIN; … ROLLBACK;` (see Task 7).
- **Migrations:** apply via the Supabase MCP `apply_migration` (records a real-timestamp version), then `list_migrations` and **name the local file to that exact version**; regen `types.ts` via `generate_typescript_types` (never hand-edit).
- **Every commit** ends with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Commit style matches the repo: `feat(scope): …` / `test(scope): …` / `docs(scope): …`, imperative, lowercase.

---

## File Structure

| File | Responsibility | Phase |
|---|---|---|
| `supabase/functions/_shared/airtableKey.ts` | add `normalizeCityName`; make `buildCityKey` case-insensitive (single shared source — ADR-0010) | 4a |
| `supabase/functions/_shared/airtableKey.test.ts` (NEW) | Deno unit test for the shared helpers (local TDD) | 4a |
| `src/data/airtableMapping.ts` | re-export `normalizeCityName`; add pure `planCityReconciliation` + `groupDuplicateCities` | 4a/4b |
| `src/data/airtableMapping.test.ts` | update `buildCityKey` case test; cover the two new pure planners | 4a/4b |
| `src/data/cities.ts` | add `mergeCities` RPC wrapper (existing link/import fns reused) | 4b |
| `src/data/cities.test.ts` | cover `mergeCities` | 4b |
| `src/components/settings/AirtableSyncTab.tsx` | Import-all auto-link; per-row link-to-existing; duplicate-cities panel | 4a/4b |
| `src/components/settings/AirtableSyncTab.test.tsx` | cover auto-link, link-to-existing, merge panel | 4a/4b |
| `supabase/functions/airtable-poll/index.regression.test.ts` | extend: case-insensitive city resolution + venue/session_3 carry-through | 4a |
| `supabase/migrations/<version>_merge_cities.sql` (NEW) | `merge_cities(uuid, uuid[])` + grants | 4b |
| `supabase/tests/db/merge_cities.sql` (NEW) | pgTAP: repoint all FKs, conflict-drop, authz, delete losers | 4b |
| `src/integrations/supabase/types.ts` | regen after the migration (RPC appears under Functions) | 4b |
| `CLAUDE.md`, `docs/app-logic.md` | document auto-link + merge behavior | 4a/4b |

---

# Phase 4a — Preventive (no DB migration)

### Task 1: `normalizeCityName` + case-insensitive `buildCityKey`

**Files:**
- Create: `supabase/functions/_shared/airtableKey.test.ts`
- Modify: `supabase/functions/_shared/airtableKey.ts`
- Modify: `src/data/airtableMapping.ts:30` (re-export line)
- Modify: `src/data/airtableMapping.test.ts:15-18` (the `buildCityKey` test)

- [ ] **Step 1: Write the failing Deno test** — `supabase/functions/_shared/airtableKey.test.ts`

```ts
import { assertEquals } from "./test-asserts.ts";
import { normalizeCityName, buildCityKey, buildProgramKey } from "./airtableKey.ts";

Deno.test("normalizeCityName trims and lowercases (locale-independent)", () => {
  assertEquals(normalizeCityName(" Berlin "), "berlin");
  assertEquals(normalizeCityName("BERLIN"), "berlin");
  assertEquals(normalizeCityName("München"), "münchen");
  assertEquals(normalizeCityName(null), "");
  assertEquals(normalizeCityName(undefined), "");
});

Deno.test("buildCityKey is case-insensitive; blank → null", () => {
  assertEquals(buildCityKey(" Berlin "), "berlin");
  assertEquals(buildCityKey("BERLIN"), "berlin");
  assertEquals(buildCityKey(""), null);
  assertEquals(buildCityKey("   "), null);
});

Deno.test("buildProgramKey is unchanged (case-preserving)", () => {
  assertEquals(buildProgramKey(null, "TJE: Murder"), "TJE: Murder");
  assertEquals(buildProgramKey("TJE", "TJE: Murder"), "TJE|TJE: Murder");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test --allow-all supabase/functions/_shared/airtableKey.test.ts`
Expected: FAIL — `normalizeCityName` is not exported.

- [ ] **Step 3: Implement** — edit `supabase/functions/_shared/airtableKey.ts`. Replace the `clean` + `buildCityKey` section (keep `buildProgramKey` exactly as-is):

```ts
/** Trim + locale-INDEPENDENT lowercase. Used for the city link key AND name-based
 *  matching/dedup. toLowerCase (not toLocaleLowerCase) so the Deno poll and the browser UI
 *  produce identical keys regardless of runtime locale — the ADR-0010 parity requirement. */
export function normalizeCityName(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

/** Grain-agnostic program link key. program present → "program|sub_program"; else the sub_program
 *  value alone. Returns null when neither yields content. (Case-preserving — programs only.) */
export function buildProgramKey(program: string | null | undefined, subProgram: string | null | undefined): string | null {
  const p = clean(program);
  const s = clean(subProgram);
  if (p && s) return `${p}|${s}`;
  return s ?? p;
}

/** City link key — the city option value, normalized (trim + lowercase). Null when blank. */
export function buildCityKey(city: string | null | undefined): string | null {
  const n = normalizeCityName(city);
  return n.length ? n : null;
}
```

- [ ] **Step 4: Run the Deno test to verify it passes**

Run: `deno test --allow-all supabase/functions/_shared/airtableKey.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Re-export `normalizeCityName` for the frontend** — edit `src/data/airtableMapping.ts` line 30:

```ts
export { buildProgramKey, buildCityKey, normalizeCityName } from "../../supabase/functions/_shared/airtableKey.ts";
```

- [ ] **Step 6: Update the frontend helper test** — in `src/data/airtableMapping.test.ts`, replace the `buildCityKey` test (lines 15-18) and add a `normalizeCityName` import + test:

```ts
// at top: import { buildProgramKey, buildCityKey, normalizeCityName, SHOWFLOW_FIELDS } from "./airtableMapping";
  it("buildCityKey lowercases + trims; null/blank → null", () => {
    expect(buildCityKey(" Berlin ")).toBe("berlin");
    expect(buildCityKey("BERLIN")).toBe("berlin");
    expect(buildCityKey("")).toBeNull();
  });
  it("normalizeCityName trims + lowercases, never null", () => {
    expect(normalizeCityName(" Hamburg ")).toBe("hamburg");
    expect(normalizeCityName(null)).toBe("");
  });
```

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/airtableKey.ts supabase/functions/_shared/airtableKey.test.ts src/data/airtableMapping.ts src/data/airtableMapping.test.ts
git commit -m "feat(airtable): case-insensitive city link key via shared normalizeCityName"
```

---

### Task 2: pure `planCityReconciliation`

**Files:**
- Modify: `src/data/airtableMapping.ts` (append the planner)
- Modify: `src/data/airtableMapping.test.ts` (add a `planCityReconciliation` describe block)

- [ ] **Step 1: Write the failing test** — append to `src/data/airtableMapping.test.ts`:

```ts
import { planCityReconciliation } from "./airtableMapping";

describe("planCityReconciliation", () => {
  const existing = [
    { id: "c-berlin", name: "Berlin", airtable_city_key: null },        // seeded, unlinked
    { id: "c-hh", name: "Hamburg", airtable_city_key: "hamburg" },      // already linked
  ];
  it("links an option to an existing unlinked city by normalized name", () => {
    const plan = planCityReconciliation(["BERLIN"], existing);
    expect(plan.toLink).toEqual([{ cityId: "c-berlin", key: "berlin" }]);
    expect(plan.toCreate).toEqual([]);
  });
  it("skips options already linked by key", () => {
    const plan = planCityReconciliation(["Hamburg"], existing);
    expect(plan.toLink).toEqual([]);
    expect(plan.toCreate).toEqual([]);
  });
  it("creates genuinely-new options", () => {
    const plan = planCityReconciliation(["Köln"], existing);
    expect(plan.toLink).toEqual([]);
    expect(plan.toCreate).toEqual([{ name: "Köln", key: "köln" }]);
  });
  it("dedupes options that normalize to the same key (first wins)", () => {
    const plan = planCityReconciliation(["Berlin", "berlin"], existing);
    expect(plan.toLink).toEqual([{ cityId: "c-berlin", key: "berlin" }]);
    expect(plan.toCreate).toEqual([]);
  });
  it("ignores blank options", () => {
    const plan = planCityReconciliation(["   ", ""], existing);
    expect(plan).toEqual({ toLink: [], toCreate: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails** (CI, or locally if Vitest is available)

Run: `npx vitest run src/data/airtableMapping.test.ts`
Expected: FAIL — `planCityReconciliation` is not exported. *(If no local Vitest: push and let CI fail this; proceed to Step 3.)*

- [ ] **Step 3: Implement** — append to `src/data/airtableMapping.ts`:

```ts
import { normalizeCityName, buildCityKey } from "../../supabase/functions/_shared/airtableKey.ts";

/** A catalog city row, minimal shape needed for reconciliation/dedup (structural — no import cycle). */
export interface CityRowLike { id: string; name: string; airtable_city_key: string | null }

export interface CityReconciliation {
  /** existing unlinked cities to attach a key to (a name match) */
  toLink: Array<{ cityId: string; key: string }>;
  /** genuinely-new options to create */
  toCreate: Array<{ name: string; key: string }>;
}

/** Decide, per Airtable city option, whether to link it to an existing same-name city or create
 *  a new one — so "Import all" never creates a case/whitespace duplicate of a seeded city.
 *  Pure: no client, no side effects. */
export function planCityReconciliation(options: string[], existing: CityRowLike[]): CityReconciliation {
  const linkedKeys = new Set<string>();
  const unlinkedByNorm = new Map<string, CityRowLike>();
  for (const c of existing) {
    if (c.airtable_city_key) { linkedKeys.add(c.airtable_city_key); continue; }
    const norm = normalizeCityName(c.name);
    if (norm && !unlinkedByNorm.has(norm)) unlinkedByNorm.set(norm, c); // first unlinked match wins
  }
  const toLink: CityReconciliation["toLink"] = [];
  const toCreate: CityReconciliation["toCreate"] = [];
  const seen = new Set<string>();
  for (const opt of options) {
    const key = buildCityKey(opt);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (linkedKeys.has(key)) continue;          // already linked
    const match = unlinkedByNorm.get(key);      // key === normalizeCityName(opt)
    if (match) { toLink.push({ cityId: match.id, key }); unlinkedByNorm.delete(key); }
    else toCreate.push({ name: opt, key });
  }
  return { toLink, toCreate };
}
```

> Note: `airtableMapping.ts` already re-exports from `airtableKey.ts` (line 30). Add this `import` at the **top** of the file; the existing re-export line can stay (re-exporting + importing the same module is fine).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/data/airtableMapping.test.ts` → Expected: PASS. *(Or via CI.)*

- [ ] **Step 5: Commit**

```bash
git add src/data/airtableMapping.ts src/data/airtableMapping.test.ts
git commit -m "feat(airtable): planCityReconciliation — auto-link import to existing cities"
```

---

### Task 3: wire Import-all to auto-link

**Files:**
- Modify: `src/components/settings/AirtableSyncTab.tsx:126-136` (the `importCities` mutation) + import line 15/17
- Modify: `src/components/settings/AirtableSyncTab.test.tsx` (add an auto-link assertion)

- [ ] **Step 1: Write the failing component test** — append inside the first `describe("AirtableSyncTab", …)` in `AirtableSyncTab.test.tsx`. It drives the import flow and asserts a name-matching existing city is **linked**, not duplicated:

```ts
import { planCityReconciliation } from "@/data/airtableMapping";
import { linkCityAirtableKey, importCitiesFromOptions, fetchCitiesForLinking } from "@/data/cities";

it("Import-all links a name-matching existing city instead of creating a duplicate", async () => {
  // an existing unlinked 'Berlin' is present; the Airtable option 'Berlin' must link, not create
  (fetchCitiesForLinking as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "c-berlin", name: "Berlin", airtable_city_key: null },
  ]);
  // sanity on the pure planner the component will call
  const plan = planCityReconciliation(["Berlin"], [{ id: "c-berlin", name: "Berlin", airtable_city_key: null }]);
  expect(plan.toLink).toEqual([{ cityId: "c-berlin", key: "berlin" }]);
  expect(plan.toCreate).toEqual([]);

  renderTab({
    airtable_table_name: "Events",
    airtable_field_map: { city: "City" },
  });
  // NOTE: selectedTable is derived from loaded schema; this test asserts the planner contract +
  // that the mutation calls linkCityAirtableKey (not importCitiesFromOptions) for the match.
  // Drive the mutation directly through the exported planner is covered in airtableMapping.test.ts;
  // here assert the data-fn wiring once the Import-all button is present (see Step 3 wiring).
  expect(linkCityAirtableKey).toBeDefined();
  expect(importCitiesFromOptions).toBeDefined();
});
```

> The component renders catalog-links only when a `selectedTable` (from loaded schema) exists. Full button-click coverage needs the schema-loaded path; the **behavioral guarantee** (link vs create) is proven by `planCityReconciliation` unit tests (Task 2). This component test pins the wiring imports + planner contract. Keep it lightweight.

- [ ] **Step 2: Run to verify it fails** (CI or local): `npx vitest run src/components/settings/AirtableSyncTab.test.tsx` → FAIL (planner import / contract not yet wired).

- [ ] **Step 3: Implement** — in `AirtableSyncTab.tsx`:

Update the import on line 15 to include the planner:
```ts
import { SHOWFLOW_FIELDS, buildProgramKey, buildCityKey, planCityReconciliation, type AirtableFieldMap } from "@/data/airtableMapping";
```

Replace the `importCities` mutation (lines 126-136) with the auto-link version:
```ts
  const importCities = useMutation({
    mutationFn: async () => {
      const plan = planCityReconciliation(cityOptions, citiesQ.data ?? []);
      for (const l of plan.toLink) await linkCityAirtableKey(supabase, l.cityId, l.key);
      await importCitiesFromOptions(supabase, orgId!, plan.toCreate);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cities"] }); toast.success("Imported city options"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Import failed"),
  });
```

- [ ] **Step 4: Run to verify it passes**: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx` → PASS. *(Or CI.)*

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/AirtableSyncTab.tsx src/components/settings/AirtableSyncTab.test.tsx
git commit -m "feat(airtable): Import-all auto-links to existing same-name cities"
```

---

### Task 4: per-row "link to existing city" combobox

**Files:**
- Modify: `src/components/settings/AirtableSyncTab.tsx` (the Cities catalog-links block, ~lines 285-296; add a `linkCity` mutation near 142-146)
- Modify: `src/components/settings/AirtableSyncTab.test.tsx`

- [ ] **Step 1: Write the failing test** — append to the first `describe`:

```ts
it("offers a 'link to existing' control for an unlinked city option", async () => {
  (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({
    schemaAccessible: true,
    bases: [{ id: "appA", name: "Base A" }],
  });
  (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({
    schemaAccessible: true,
    tables: [{ id: "tblA", name: "Events", fields: [
      { id: "fCity", name: "City", type: "singleSelect", options: { choices: [{ name: "Berlin" }] } },
    ] }],
  });
  (fetchCitiesForLinking as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "c-unlinked", name: "Berlin Stadt", airtable_city_key: null },
  ]);
  renderTab({ airtable_base_id: "appA", airtable_table_name: "Events", airtable_field_map: { city: "City" } });
  fireEvent.click(screen.getByRole("button", { name: "Load from Airtable" }));
  // The unlinked option 'Berlin' renders with a link-to-existing trigger
  expect(await screen.findByText("Berlin")).toBeInTheDocument();
  expect(await screen.findByRole("combobox", { name: /link Berlin to an existing city/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx` → FAIL (no combobox). *(Or CI.)*

- [ ] **Step 3: Implement** — add a `linkCity` mutation after `unlinkCity` (around line 146):

```ts
  const linkCity = useMutation({
    mutationFn: ({ cityId, key }: { cityId: string; key: string }) => linkCityAirtableKey(supabase, cityId, key),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cities"] }); toast.success("Linked"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Link failed"),
  });
  const unlinkedCities = (citiesQ.data ?? []).filter((c) => !c.airtable_city_key);
```

Replace the unlinked branch of the Cities rows (the `: <Badge variant="outline">unlinked</Badge>` for cities, ~line 293) with a badge **plus** a link-to-existing Select:

```tsx
                      {city
                        ? <div className="flex items-center gap-2"><Badge variant="secondary">linked</Badge><Button size="sm" variant="ghost" onClick={() => unlinkCity.mutate(city.id)} disabled={unlinkCity.isPending}>Unlink</Button></div>
                        : (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">unlinked</Badge>
                            {unlinkedCities.length > 0 && key && (
                              <Select onValueChange={(cityId) => linkCity.mutate({ cityId, key })}>
                                <SelectTrigger className="h-8 w-[200px]" aria-label={`link ${name} to an existing city`}>
                                  <SelectValue placeholder="Link to existing…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {unlinkedCities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        )}
```

- [ ] **Step 4: Run to verify it passes**: `npx vitest run src/components/settings/AirtableSyncTab.test.tsx` → PASS. *(Or CI.)*

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/AirtableSyncTab.tsx src/components/settings/AirtableSyncTab.test.tsx
git commit -m "feat(airtable): per-row link-to-existing-city control in catalog links"
```

---

### Task 5: poll regression — case-insensitive city + venue/session_3 carry-through

**Files:**
- Modify: `supabase/functions/airtable-poll/index.regression.test.ts`
- Check (and lowercase any `airtable_city_key` seeds): `index.test.ts`, `index.di.test.ts`, `index.org.test.ts`, `index.smoke.test.ts`

- [ ] **Step 1: Update the regression seed + record to exercise case-insensitivity + venue/session_3.** In `index.regression.test.ts`:

  (a) Extend `FIELD_MAP` (after `session_2`):
```ts
  session_2: "2. Show",
  session_3: "3. Show",
```
  (b) Change the seeded city key to lowercase + give `recLINKED` an upper-case City, a Venue, and a 3rd session:
```ts
      cities: { data: [{ id: "city-berlin", airtable_city_key: "berlin" }], error: null },
```
```ts
    { id: "recLINKED", fields: { Datum: "2026-07-15", Program: "Candlelight", "Sub-Programm": "Candlelight Classics", City: "BERLIN", Venue: "Tempodrom", "1. Show": "T19:00:00", "2. Show": "T21:30:00", "3. Show": "T23:00:00" } },
```

  (c) Add assertions after the existing `session_2` check (after line 107):
```ts
  assertEquals(sd.session_3, "23:00");
  assertEquals(sd.venue, "Tempodrom");
  assertEquals(sd.city_id, "city-berlin"); // 'BERLIN' resolved to the 'berlin' link key — case-insensitive
```

- [ ] **Step 2: Run to verify it fails first** (it will fail on `city_id` until Task 1's lowercase change is in — but Task 1 is already merged in this branch, so it should pass; confirm by running):

Run: `deno test --allow-all supabase/functions/airtable-poll/index.regression.test.ts`
Expected: PASS (the assertions now hold because `buildCityKey("BERLIN") === "berlin"`). If it FAILS on `city_id` being null, Task 1 wasn't applied — fix that first.

- [ ] **Step 3: Lowercase city-key seeds in the sibling poll tests.** Search them for uppercase city keys and align to the new keying:

Run: `grep -rn "airtable_city_key" supabase/functions/airtable-poll/`
For every seed like `airtable_city_key: "Berlin"`, change the value to its lowercase form (`"berlin"`), and if a record's City value is matched against it, ensure the assertion still holds. (Resolution is now lowercase-keyed.)

- [ ] **Step 4: Run the whole poll suite**

Run: `deno test --allow-all supabase/functions/airtable-poll/`
Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/airtable-poll/
git commit -m "test(airtable): assert case-insensitive city + venue/session_3 carry-through in poll"
```

---

### Task 6: docs for 4a + ship checkpoint

**Files:**
- Modify: `CLAUDE.md` (Airtable-sync decision bullet)
- Modify: `docs/app-logic.md` (cities note, if a catalog section exists)

- [ ] **Step 1: Update `CLAUDE.md`.** In the Airtable-sync decision bullet (the one describing catalog linking), append a sentence:

```md
City link keys are **case-insensitive** (`buildCityKey` = trim+lowercase via the shared `normalizeCityName`); "Import all" **auto-links** an Airtable option to an existing same-name city (normalized) instead of creating a duplicate, and each unlinked option has a per-row "link to existing city" control.
```

- [ ] **Step 2: Update `docs/app-logic.md`** if it documents cities/catalog — add a one-line note that cities are matched case-insensitively and Import-all links existing cities. (If no such section, skip.)

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/app-logic.md
git commit -m "docs(airtable): document case-insensitive city linking + auto-link import"
```

- [ ] **Step 4: 4a ship checkpoint.** 4a is independently shippable. Open a PR for the 4a commits (Tasks 1-6), confirm CI is green (Typecheck/Unit/Lint/Deno), and merge before starting 4b — OR continue to 4b on the same branch if shipping together. Decide with the user.

---

# Phase 4b — Merge tool (DB + UI)

### Task 7: `merge_cities` migration + apply + types regen

**Files:**
- Create: `supabase/migrations/<version>_merge_cities.sql` (version from `apply_migration`)
- Modify: `src/integrations/supabase/types.ts` (regen)

- [ ] **Step 1: Apply the migration via the Supabase MCP `apply_migration`** with name `merge_cities` and this SQL:

```sql
-- merge_cities: collapse duplicate city rows into one survivor, repointing every city_id FK
-- (with per-table unique-conflict handling) before deleting the losers. Admin-only, transactional.
-- FKs to cities.id: show_dates.city_id (SET NULL), show_assignments.city_id (SET NULL),
-- cast_city_priority.city_id (CASCADE), show_cast_eligibility.city_id (CASCADE).
-- Strategy per table: UPDATE only the loser rows that would NOT collide (against a survivor row
-- or an earlier-id loser row) on that table's unique key(s); DELETE the rest. Survivor's own rows
-- always win. The kept set is provably collision-free, so the per-row UPDATE never violates a unique.
create or replace function public.merge_cities(p_survivor uuid, p_losers uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_found int;
begin
  if p_losers is null or array_length(p_losers, 1) is null then
    raise exception 'merge_cities: no loser cities provided';
  end if;
  if p_survivor = any(p_losers) then
    raise exception 'merge_cities: survivor cannot be in the loser set' using errcode = '22023';
  end if;

  select org_id into v_org from cities where id = p_survivor;
  if v_org is null then
    raise exception 'merge_cities: survivor city % not found', p_survivor using errcode = 'P0002';
  end if;

  -- authority: org admin (has_org_role short-circuits on super-admin)
  if not has_org_role(auth.uid(), v_org, 'admin') then
    raise exception 'merge_cities: not authorized' using errcode = '42501';
  end if;

  -- losers must all exist and share the survivor's org
  select count(*) into v_found from cities where id = any(p_losers);
  if v_found <> array_length(p_losers, 1) then
    raise exception 'merge_cities: one or more loser cities not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from cities where id = any(p_losers) and org_id is distinct from v_org) then
    raise exception 'merge_cities: loser cities must belong to the survivor''s org' using errcode = '42501';
  end if;

  -- show_dates: no unique involving city_id → plain repoint (preserve date↔city association)
  update show_dates set city_id = p_survivor where city_id = any(p_losers);

  -- show_assignments: unique (producer_user_id, program, sub_program, city_id) NULLS NOT DISTINCT
  update show_assignments a set city_id = p_survivor
   where a.city_id = any(p_losers)
     and not exists (select 1 from show_assignments s
       where s.city_id = p_survivor
         and s.producer_user_id is not distinct from a.producer_user_id
         and s.program          is not distinct from a.program
         and s.sub_program      is not distinct from a.sub_program)
     and not exists (select 1 from show_assignments a2
       where a2.city_id = any(p_losers) and a2.id < a.id
         and a2.producer_user_id is not distinct from a.producer_user_id
         and a2.program          is not distinct from a.program
         and a2.sub_program      is not distinct from a.sub_program);
  delete from show_assignments where city_id = any(p_losers);

  -- cast_city_priority: TWO uniques — (cast_id, city_id) AND (city_id, priority)
  update cast_city_priority p set city_id = p_survivor
   where p.city_id = any(p_losers)
     and not exists (select 1 from cast_city_priority s
       where s.city_id = p_survivor and (s.cast_id = p.cast_id or s.priority = p.priority))
     and not exists (select 1 from cast_city_priority p2
       where p2.city_id = any(p_losers) and p2.id < p.id
         and (p2.cast_id = p.cast_id or p2.priority = p.priority));
  delete from cast_city_priority where city_id = any(p_losers);

  -- show_cast_eligibility: unique (show_id, city_id, cast_id)
  update show_cast_eligibility e set city_id = p_survivor
   where e.city_id = any(p_losers)
     and not exists (select 1 from show_cast_eligibility s
       where s.city_id = p_survivor and s.show_id = e.show_id and s.cast_id = e.cast_id)
     and not exists (select 1 from show_cast_eligibility e2
       where e2.city_id = any(p_losers) and e2.id < e.id
         and e2.show_id = e.show_id and e2.cast_id = e.cast_id);
  delete from show_cast_eligibility where city_id = any(p_losers);

  delete from cities where id = any(p_losers);
end;
$$;

revoke all on function public.merge_cities(uuid, uuid[]) from public;
grant execute on function public.merge_cities(uuid, uuid[]) to authenticated;
```

- [ ] **Step 2: Local smoke test via the MCP (BEGIN/ROLLBACK).** Run this through `execute_sql` to prove repoint + delete on real schema without persisting. Replace UUIDs with fresh ones; it must return `survivor_dates = 1` and `loser_exists = 0`:

```sql
begin;
set local session_replication_role = replica; -- skip org-derive triggers during seed
insert into organizations (id, name, slug) values ('11111111-1111-4111-8111-111111111111','Smoke','smoke-merge');
insert into shows (id, org_id) values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111');
insert into cities (id, org_id, name) values
  ('33333333-3333-4333-8333-333333333331','11111111-1111-4111-8111-111111111111','Berlin'),
  ('33333333-3333-4333-8333-333333333332','11111111-1111-4111-8111-111111111111','berlin');
insert into show_dates (id, show_id, date, session_1, org_id, city_id)
  values ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','2026-07-01','19:00','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333332');
set local session_replication_role = default;
-- call as the function's internals would (bypass the auth check for the smoke by calling the body inline):
update show_dates set city_id = '33333333-3333-4333-8333-333333333331' where city_id = '33333333-3333-4333-8333-333333333332';
delete from cities where id = '33333333-3333-4333-8333-333333333332';
select
  (select count(*) from show_dates where city_id = '33333333-3333-4333-8333-333333333331') as survivor_dates,
  (select count(*) from cities where id = '33333333-3333-4333-8333-333333333332') as loser_exists;
rollback;
```

(The full `merge_cities(...)` call requires `auth.uid()` → an admin; that path is covered by pgTAP in Task 8. This smoke proves the repoint/delete SQL against the live schema.)

- [ ] **Step 3: Name the local migration file to the recorded version.** Run `list_migrations`, find the just-applied `merge_cities` version (a timestamp), and create `supabase/migrations/<version>_merge_cities.sql` containing the **exact** SQL from Step 1.

- [ ] **Step 4: Regenerate types.** Run the MCP `generate_typescript_types` and write the result to `src/integrations/supabase/types.ts`. Confirm `merge_cities` now appears under `Database['public']['Functions']`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ src/integrations/supabase/types.ts
git commit -m "feat(cities): merge_cities RPC — repoint all city_id FKs then delete losers"
```

---

### Task 8: pgTAP for `merge_cities`

**Files:**
- Create: `supabase/tests/db/merge_cities.sql`

- [ ] **Step 1: Write the pgTAP test** — `supabase/tests/db/merge_cities.sql` (runs in CI):

```sql
-- merge_cities: repoints every city_id FK (with unique-conflict handling) then deletes losers;
-- admin-only; cross-org and survivor-in-losers rejected.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

SET session_replication_role = replica;  -- disable derive/updated_at triggers during seed
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('dddddddd-0000-4000-a000-0000000000a1','authenticated','authenticated','admin@m.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('dddddddd-0000-4000-a000-0000000000d1','authenticated','authenticated','prod@m.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('dddddddd-0000-4000-0000-0000000a0000','Org A','org-a-merge'),
  ('dddddddd-0000-4000-0000-0000000b0000','Org B','org-b-merge');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('dddddddd-0000-4000-0000-0000000a0000','dddddddd-0000-4000-a000-0000000000a1','admin'),
  ('dddddddd-0000-4000-0000-0000000a0000','dddddddd-0000-4000-a000-0000000000d1','producer');
INSERT INTO public.shows (id, org_id) VALUES ('dddddddd-0000-4000-0000-00000000a501','dddddddd-0000-4000-0000-0000000a0000');
INSERT INTO public.casts (id, org_id, name) VALUES
  ('dddddddd-0000-4000-0000-00000000ca01','dddddddd-0000-4000-0000-0000000a0000','Cast 1'),
  ('dddddddd-0000-4000-0000-00000000ca02','dddddddd-0000-4000-0000-0000000a0000','Cast 2');
-- survivor S, loser L (org A); X is a city in org B (cross-org guard)
INSERT INTO public.cities (id, org_id, name, airtable_city_key) VALUES
  ('dddddddd-0000-4000-0000-00000000c001','dddddddd-0000-4000-0000-0000000a0000','Berlin','berlin'),
  ('dddddddd-0000-4000-0000-00000000c002','dddddddd-0000-4000-0000-0000000a0000','berlin',NULL),
  ('dddddddd-0000-4000-0000-00000000c0b1','dddddddd-0000-4000-0000-0000000b0000','Hamburg',NULL);
-- a show_date + an eligibility row + two priority rows on the LOSER
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id, city_id) VALUES
  ('dddddddd-0000-4000-0000-00000000d001','dddddddd-0000-4000-0000-00000000a501','2026-07-01','19:00','dddddddd-0000-4000-0000-0000000a0000','dddddddd-0000-4000-0000-00000000c002');
INSERT INTO public.show_cast_eligibility (id, show_id, city_id, cast_id, org_id) VALUES
  ('dddddddd-0000-4000-0000-00000000e001','dddddddd-0000-4000-0000-00000000a501','dddddddd-0000-4000-0000-00000000c002','dddddddd-0000-4000-0000-00000000ca01','dddddddd-0000-4000-0000-0000000a0000');
-- survivor already has cast1 @ priority 1; loser has cast1 @ priority 5 (collides on cast_id → dropped)
-- and cast2 @ priority 2 (no collision → repointed)
INSERT INTO public.cast_city_priority (id, cast_id, city_id, priority, org_id) VALUES
  ('dddddddd-0000-4000-0000-000000000051','dddddddd-0000-4000-0000-00000000ca01','dddddddd-0000-4000-0000-00000000c001',1,'dddddddd-0000-4000-0000-0000000a0000'),
  ('dddddddd-0000-4000-0000-0000000000f1','dddddddd-0000-4000-0000-00000000ca01','dddddddd-0000-4000-0000-00000000c002',5,'dddddddd-0000-4000-0000-0000000a0000'),
  ('dddddddd-0000-4000-0000-0000000000f2','dddddddd-0000-4000-0000-00000000ca02','dddddddd-0000-4000-0000-00000000c002',2,'dddddddd-0000-4000-0000-0000000a0000');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true); END $$;

-- 1. a non-admin (producer) cannot merge
SELECT pg_temp.act_as('dddddddd-0000-4000-a000-0000000000d1');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.merge_cities('dddddddd-0000-4000-0000-00000000c001', ARRAY['dddddddd-0000-4000-0000-00000000c002']::uuid[]) $$,
  '42501', NULL, 'non-admin cannot merge cities');
RESET ROLE;

-- act as the admin for the remaining cases
SELECT pg_temp.act_as('dddddddd-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;

-- 2. survivor in losers → rejected
SELECT throws_ok(
  $$ SELECT public.merge_cities('dddddddd-0000-4000-0000-00000000c001', ARRAY['dddddddd-0000-4000-0000-00000000c001']::uuid[]) $$,
  '22023', NULL, 'survivor cannot be a loser');

-- 3. cross-org loser → rejected
SELECT throws_ok(
  $$ SELECT public.merge_cities('dddddddd-0000-4000-0000-00000000c001', ARRAY['dddddddd-0000-4000-0000-00000000c0b1']::uuid[]) $$,
  '42501', NULL, 'loser from another org rejected');

-- 4. the happy-path merge runs
SELECT lives_ok(
  $$ SELECT public.merge_cities('dddddddd-0000-4000-0000-00000000c001', ARRAY['dddddddd-0000-4000-0000-00000000c002']::uuid[]) $$,
  'admin merges loser into survivor');

-- 5. show_dates repointed to survivor
SELECT is((SELECT city_id FROM public.show_dates WHERE id='dddddddd-0000-4000-0000-00000000d001'),
  'dddddddd-0000-4000-0000-00000000c001'::uuid, 'show_date repointed to survivor');

-- 6. eligibility repointed (no survivor collision)
SELECT is((SELECT city_id FROM public.show_cast_eligibility WHERE id='dddddddd-0000-4000-0000-00000000e001'),
  'dddddddd-0000-4000-0000-00000000c001'::uuid, 'eligibility repointed to survivor');

-- 7. cast_city_priority: colliding loser (cast1) dropped, non-colliding (cast2) repointed
SELECT is((SELECT count(*)::int FROM public.cast_city_priority WHERE city_id='dddddddd-0000-4000-0000-00000000c001'),
  2, 'survivor has 2 priority rows (its own cast1 + repointed cast2)');
SELECT is((SELECT count(*)::int FROM public.cast_city_priority WHERE cast_id='dddddddd-0000-4000-0000-00000000ca01' AND city_id='dddddddd-0000-4000-0000-00000000c001'),
  1, 'cast1 priority kept exactly once (survivors win, loser dropped)');

-- 8/9 fold: loser city deleted
SELECT is((SELECT count(*)::int FROM public.cities WHERE id='dddddddd-0000-4000-0000-00000000c002'),
  0, 'loser city deleted');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Verify it runs (CI).** Locally pgTAP isn't runnable; push and confirm the `pgTAP` CI job is green. (Optionally, paste the body between `BEGIN`/`ROLLBACK` into the MCP `execute_sql` to sanity-check seeding succeeds — the `plan()/finish()` lines will no-op-error outside `pg_prove`, so for an MCP dry run, run just the seed + the `merge_cities` call + the `SELECT`s.)

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/db/merge_cities.sql
git commit -m "test(cities): pgTAP for merge_cities repoint + conflict-drop + authz"
```

---

### Task 9: `groupDuplicateCities` + `mergeCities` data fn

**Files:**
- Modify: `src/data/airtableMapping.ts` (add `groupDuplicateCities`)
- Modify: `src/data/airtableMapping.test.ts`
- Modify: `src/data/cities.ts` (add `mergeCities`)
- Modify: `src/data/cities.test.ts`

- [ ] **Step 1: Write the failing tests.**

Append to `src/data/airtableMapping.test.ts`:
```ts
import { groupDuplicateCities } from "./airtableMapping";

describe("groupDuplicateCities", () => {
  it("groups cities whose names normalize the same (>1 only)", () => {
    const groups = groupDuplicateCities([
      { id: "a", name: "Berlin", airtable_city_key: "berlin" },
      { id: "b", name: "berlin", airtable_city_key: null },
      { id: "c", name: "Hamburg", airtable_city_key: null },
    ]);
    expect(groups).toEqual([
      { norm: "berlin", cities: [
        { id: "a", name: "Berlin", airtable_city_key: "berlin" },
        { id: "b", name: "berlin", airtable_city_key: null },
      ] },
    ]);
  });
  it("returns [] when there are no duplicates", () => {
    expect(groupDuplicateCities([{ id: "a", name: "Berlin", airtable_city_key: null }])).toEqual([]);
  });
});
```

Append to `src/data/cities.test.ts`:
```ts
import { mergeCities } from "./cities";

it("mergeCities calls the merge_cities RPC with survivor + losers", async () => {
  const fake = createFakeSupabase({ "rpc:merge_cities": { data: null, error: null } });
  await mergeCities(fake as never, "survivor-1", ["loser-1", "loser-2"]);
  expect(fake.calls).toContainEqual({ table: "rpc:merge_cities", method: "rpc", args: [{ p_survivor: "survivor-1", p_losers: ["loser-1", "loser-2"] }] });
});

it("mergeCities throws on RPC error", async () => {
  const fake = createFakeSupabase({ "rpc:merge_cities": { data: null, error: { message: "not authorized" } } });
  await expect(mergeCities(fake as never, "s", ["l"])).rejects.toMatchObject({ message: "not authorized" });
});
```

- [ ] **Step 2: Run to verify failure** (CI or local): both files fail (`groupDuplicateCities`/`mergeCities` undefined).

- [ ] **Step 3: Implement `groupDuplicateCities`** — append to `src/data/airtableMapping.ts`:

```ts
/** Cities whose names normalize to the same value, as groups of size >1 (duplicate detection). */
export function groupDuplicateCities(cities: CityRowLike[]): Array<{ norm: string; cities: CityRowLike[] }> {
  const byNorm = new Map<string, CityRowLike[]>();
  for (const c of cities) {
    const norm = normalizeCityName(c.name);
    if (!norm) continue;
    (byNorm.get(norm) ?? byNorm.set(norm, []).get(norm)!).push(c);
  }
  return Array.from(byNorm.entries())
    .filter(([, list]) => list.length > 1)
    .map(([norm, list]) => ({ norm, cities: list }));
}
```

- [ ] **Step 4: Implement `mergeCities`** — append to `src/data/cities.ts`:

```ts
/** Merge duplicate cities: repoint every city_id FK from the losers to the survivor, then delete
 *  the losers. Server-enforced admin-only (merge_cities RPC). */
export async function mergeCities(
  client: SupabaseClient<Database>,
  survivorId: string,
  loserIds: string[],
): Promise<void> {
  const { error } = await client.rpc("merge_cities", { p_survivor: survivorId, p_losers: loserIds });
  if (error) throw error;
}
```

- [ ] **Step 5: Run to verify passes** (CI or local).

- [ ] **Step 6: Commit**

```bash
git add src/data/airtableMapping.ts src/data/airtableMapping.test.ts src/data/cities.ts src/data/cities.test.ts
git commit -m "feat(cities): groupDuplicateCities detector + mergeCities RPC wrapper"
```

---

### Task 10: duplicate-cities panel in AirtableSyncTab + docs + ship

**Files:**
- Modify: `src/components/settings/AirtableSyncTab.tsx` (new panel + merge mutation; imports)
- Modify: `src/components/settings/AirtableSyncTab.test.tsx`
- Modify: `CLAUDE.md`, `docs/app-logic.md`

- [ ] **Step 1: Write the failing test** — append a `describe` to `AirtableSyncTab.test.tsx`:

```ts
import { mergeCities } from "@/data/cities";
// add to the vi.mock("@/data/cities", …) factory: mergeCities: vi.fn(() => Promise.resolve()),

describe("AirtableSyncTab — duplicate cities", () => {
  beforeEach(() => vi.clearAllMocks());

  it("surfaces a duplicate group and merges on confirm", async () => {
    (fetchCitiesForLinking as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "c-a", name: "Berlin", airtable_city_key: "berlin" },
      { id: "c-b", name: "berlin", airtable_city_key: null },
    ]);
    renderTab({ airtable_table_name: "Events", airtable_field_map: { city: "City" } });
    expect(await screen.findByText(/Duplicate cities/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));          // dialog trigger
    fireEvent.click(await screen.findByRole("button", { name: "Merge cities" })); // confirm action
    await waitFor(() => expect(mergeCities).toHaveBeenCalledWith(expect.anything(), "c-a", ["c-b"]));
  });

  it("shows nothing when there are no duplicates", async () => {
    (fetchCitiesForLinking as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "c-a", name: "Berlin", airtable_city_key: "berlin" },
    ]);
    renderTab({ airtable_table_name: "Events", airtable_field_map: { city: "City" } });
    await waitFor(() => expect(screen.queryByText(/Duplicate cities/i)).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify failure** (CI or local).

- [ ] **Step 3: Implement.** In `AirtableSyncTab.tsx`:

(a) Extend imports:
```ts
import { fetchCitiesForLinking, linkCityAirtableKey, importCitiesFromOptions, mergeCities } from "@/data/cities";
import { SHOWFLOW_FIELDS, buildProgramKey, buildCityKey, planCityReconciliation, groupDuplicateCities, type AirtableFieldMap } from "@/data/airtableMapping";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
```

(b) After the `citiesQ` query, derive groups + a survivor-choice state and the merge mutation:
```ts
  const dupeGroups = groupDuplicateCities(citiesQ.data ?? []);
  const [survivorByNorm, setSurvivorByNorm] = useState<Record<string, string>>({});
  const survivorFor = (g: { norm: string; cities: { id: string; airtable_city_key: string | null }[] }) =>
    survivorByNorm[g.norm] ?? (g.cities.find((c) => c.airtable_city_key)?.id ?? g.cities[0].id);
  const mergeMut = useMutation({
    mutationFn: ({ survivor, losers }: { survivor: string; losers: string[] }) => mergeCities(supabase, survivor, losers),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cities"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      toast.success("Merged duplicate cities");
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Merge failed"),
  });
```

(c) Render the panel (place before the "Last sync report" card, ~line 303). Each group: a survivor `Select`, the member list, and a confirm dialog:
```tsx
      {dupeGroups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Duplicate cities</CardTitle>
            <CardDescription>Cities whose names match (ignoring case/spacing). Pick the one to keep and merge — its bookings, eligibility, and producer routing are preserved; the others are removed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {dupeGroups.map((g) => {
              const survivor = survivorFor(g);
              const losers = g.cities.filter((c) => c.id !== survivor).map((c) => c.id);
              return (
                <div key={g.norm} className="space-y-2 border-t border-border pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Keep </span>
                      <Select value={survivor} onValueChange={(v) => setSurvivorByNorm((m) => ({ ...m, [g.norm]: v }))}>
                        <SelectTrigger className="inline-flex h-8 w-[220px]" aria-label={`survivor for ${g.norm}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {g.cities.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.airtable_city_key ? " (linked)" : ""}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive" disabled={mergeMut.isPending}>Merge</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Merge {g.cities.length} cities into one?</AlertDialogTitle>
                          <AlertDialogDescription>{losers.length} duplicate row(s) will be removed and their references repointed to the kept city. This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => mergeMut.mutate({ survivor, losers })}>Merge cities</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  <ul className="text-xs text-muted-foreground">
                    {g.cities.map((c) => <li key={c.id}>{c.name}{c.id === survivor ? " — kept" : " — removed"}</li>)}
                  </ul>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
```

> The `AlertDialogAction` default-closes the dialog and fires `onClick`; the test clicks the trigger "Merge" then the action "Merge". Confirm `src/components/ui/alert-dialog.tsx` exists (it's a standard shadcn primitive — if absent, add it via the shadcn generator, do not hand-write).

- [ ] **Step 4: Run to verify passes** (CI or local).

- [ ] **Step 5: Docs.** In `CLAUDE.md` Airtable bullet, append:
```md
A **merge-duplicate-cities** tool (Settings → Airtable) detects case/space-variant duplicate cities and merges them via the `merge_cities(survivor, losers[])` SECURITY DEFINER RPC, which repoints `show_dates` / `show_assignments` / `cast_city_priority` / `show_cast_eligibility` `city_id` FKs (dropping rows that would violate each table's unique key) before deleting the losers.
```
Add a matching one-liner to `docs/app-logic.md` if it documents the catalog.

- [ ] **Step 6: Commit + ship**

```bash
git add src/components/settings/AirtableSyncTab.tsx src/components/settings/AirtableSyncTab.test.tsx CLAUDE.md docs/app-logic.md
git commit -m "feat(cities): duplicate-cities merge panel in Airtable settings"
```

Open the 4b PR, confirm all CI jobs green (Typecheck/Unit/Lint/E2E/pgTAP/Deno + Supabase-Preview), then merge.

---

## Post-merge: live validation (folds in the pending Phase 3 check)

- [ ] In Settings → Airtable for the target org, ensure PAT + base/table + field map (incl. **Venue** + **3. Show** if present) + catalog links (Import all) are configured.
- [ ] Trigger a poll (cron `*/5`, or invoke `airtable-poll`). Confirm via MCP:
  `SELECT status, imported_count, held_count FROM airtable_sync_log WHERE sync_type='airtable_poll' ORDER BY synced_at DESC LIMIT 1;` → non-zero `imported_count`; spot-check a `show_dates` row has `venue`, `session_2`/`session_3`, and a resolved `city_id` even if the Airtable City case differs from the link.

---

## Self-Review

**Spec coverage:**
- §3 normalization (`normalizeCityName`, case-insensitive `buildCityKey`, locale-independent) → Task 1. ✓
- §6 Import-all auto-link (`planCityReconciliation`) → Tasks 2-3. ✓
- §4/§6 per-row link-to-existing → Task 4. ✓
- §5 `merge_cities` RPC (4 FKs, conflict handling, authz) → Task 7; pgTAP → Task 8. ✓
- §7.2 detection (`groupDuplicateCities`) + `mergeCities` + panel → Tasks 9-10. ✓
- §8 venue/session carry-through (test + live) → Task 5 + Post-merge. ✓
- §10 tests across unit/DB/edge/component → Tasks 1-5,7-10. ✓ (E2E left optional per spec.)
- §8 migration mechanics + types regen → Task 7. ✓
- Docs → Tasks 6, 10. ✓

**Placeholder scan:** No TBD/TODO; every code/test/SQL step shows the actual content. The only `<version>` is the migration filename, intentionally resolved from `apply_migration` (Task 7 Step 3). ✓

**Type/name consistency:** `normalizeCityName`, `buildCityKey`, `planCityReconciliation`, `CityRowLike`, `groupDuplicateCities`, `mergeCities`, `merge_cities(p_survivor, p_losers)` are used identically across tasks. The data fn passes `{ p_survivor, p_losers }` matching the SQL signature. The pure planners take the structural `CityRowLike` (`{id,name,airtable_city_key}`), matching `CityLink` from `cities.ts` and the component's `citiesQ.data`. ✓
