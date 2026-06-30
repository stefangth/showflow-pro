# Productions "Program" Composite-Grain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mapped Airtable "Program" field flow into `shows.program` so the `/productions` Program column renders real values (`BOL`, `TJE`) instead of `—`, by adopting the composite `program|sub_program` link grain end-to-end.

**Architecture:** This ships the **deferred composite link grain** anticipated by [ADR-0010](../../adr/0010-catalog-link-keys.md) (action item 2 — "no migration"). The `airtable-poll` function builds the link key from `buildProgramKey(program, sub_program)`, **self-heals** existing sub-program-only-keyed shows (re-keys them to the composite key and backfills `shows.program`), and write-throughs `shows.program` on every sync. The mapping UI (`AirtableSyncTab`) links at the same composite grain by reading distinct `(program, sub_program)` pairs from Airtable records via a new `airtable-schema` mode, so UI and poll compose keys identically (the ADR-0010 parity requirement). No schema migration: `airtable_program_key` is an opaque per-org key column.

**Tech Stack:** Deno edge functions (poll, schema) tested with `deno test`; React + TanStack Query frontend tested with Vitest; Supabase Postgres (`shows` table, opaque `airtable_program_key`).

## Global Constraints

- **ADR-0010 parity (load-bearing):** the UI and `airtable-poll` MUST build link keys via the **same** `buildProgramKey(program, subProgram)` helper from `supabase/functions/_shared/airtableKey.ts` (re-exported by `src/data/airtableMapping.ts`). A divergence silently fails to resolve records. Do not re-derive keys inline.
- **No schema migration.** `shows.airtable_program_key` is an opaque `text` column with a per-org partial-unique index. The grain change is additive (helper inputs only).
- **Backward compatibility:** when `airtable_field_map.program` is **unmapped/empty**, behavior MUST be byte-identical to today (sub-program-only keys, `shows.program` untouched). All existing tests must stay green.
- **Edge-function test pattern (ADR-0002):** import `handle`, pass `makeFakeDeps(...)` from `_shared/testing.ts`. Never re-implement production logic in a test. Run the **whole** `supabase/functions/` Deno suite (a single-file run has hidden multi-file regressions before).
- **Deno suite local invocation:** `deno test --allow-all --node-modules-dir=none supabase/functions/...`.
- **Frontend test pattern:** mock the `src/data/*` layer (see existing `AirtableSyncTab.test.tsx`); use `renderWithProviders`. Vitest runs in CI (no local node in this env).
- **Styling/semantic-token and naming conventions** per `CLAUDE.md` apply to any UI text added.

---

### Task 1: `airtable-poll` — composite-grain resolution, self-heal re-key, program write-through

**Files:**
- Modify: `supabase/functions/airtable-poll/index.ts` (the `showByKey` build ~lines 168–172, and the per-record resolution ~lines 270–273)
- Test: `supabase/functions/airtable-poll/index.test.ts` (append new cases + two small helpers)

**Interfaces:**
- Consumes: `buildProgramKey(program, subProgram)` (already imported at top of `index.ts`).
- Produces: a poll that resolves shows by the composite key, re-keys legacy shows in-loop, and keeps `shows.program` current. No new exports.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/airtable-poll/index.test.ts`:

```ts
// ─── Program composite grain (Task 1) ───────────────────────────────────────────
const PROGRAM_FIELD_MAP = { date: "Date", program: "Program", sub_program: "SubProgram", city: "City" };

/** Seed an enabled+keyed ORG with a caller-supplied `shows` array and PROGRAM_FIELD_MAP. */
function seededDepsShows(records: unknown[], shows: unknown[]) {
  return makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "Shows" }] },
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: PROGRAM_FIELD_MAP }] },
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: shows, error: null },
      cities: { data: [{ id: "city-berlin", airtable_city_key: "berlin" }], error: null },
      show_dates: { data: [], error: null },
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
    fetchImpl: (() => Promise.resolve(airtableResponse(records)) as Promise<Response>),
  });
}

/** Capture `shows` UPDATE payloads and `show_dates` INSERT payloads in one from() wrapper. */
function captureWrites(deps: ReturnType<typeof makeFakeDeps>["deps"]) {
  const showUpdates: unknown[] = [];
  const showDateInserts: unknown[] = [];
  const originalFrom = deps.admin.from.bind(deps.admin);
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "shows") {
      const origUpdate = chain.update.bind(chain);
      chain.update = (payload: unknown) => { showUpdates.push(payload); return (origUpdate as (x: unknown) => any)(payload); };
    }
    if (table === "show_dates") {
      const origInsert = chain.insert.bind(chain);
      chain.insert = (payload: unknown) => {
        showDateInserts.push(payload);
        const insertChain = (origInsert as (x: unknown) => any)(payload);
        (insertChain as any).single = () => Promise.resolve({ data: { id: "sd-new" }, error: null });
        return insertChain;
      };
    }
    return chain;
  };
  return { showUpdates, showDateInserts };
}

Deno.test("airtable-poll grain: composite-keyed show resolves; program matches → no shows write", async () => {
  const records = [{ id: "rec-1", fields: { Date: "2026-06-01", Program: "BOL", SubProgram: "BOL: PP", City: "Berlin" } }];
  const { deps } = seededDepsShows(records, [{ id: "show-bol", program: "BOL", airtable_program_key: "BOL|BOL: PP" }]);
  const { showUpdates, showDateInserts } = captureWrites(deps);
  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  assertEquals(showDateInserts.length, 1);
  assertEquals((showDateInserts[0] as Record<string, unknown>).show_id, "show-bol");
  assertEquals(showUpdates.length, 0);
});

Deno.test("airtable-poll grain: a sub-program-only-keyed show is re-keyed to composite + program set", async () => {
  const records = [{ id: "rec-1", fields: { Date: "2026-06-01", Program: "BOL", SubProgram: "BOL: PP", City: "Berlin" } }];
  const { deps } = seededDepsShows(records, [{ id: "show-bol", program: null, airtable_program_key: "BOL: PP" }]);
  const { showUpdates, showDateInserts } = captureWrites(deps);
  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  assertEquals(showUpdates.length, 1);
  assertEquals(showUpdates[0], { airtable_program_key: "BOL|BOL: PP", program: "BOL" });
  assertEquals(showDateInserts.length, 1);
  assertEquals((showDateInserts[0] as Record<string, unknown>).show_id, "show-bol");
});

Deno.test("airtable-poll grain: composite-keyed show with null program gets program written through", async () => {
  const records = [{ id: "rec-1", fields: { Date: "2026-06-01", Program: "BOL", SubProgram: "BOL: PP", City: "Berlin" } }];
  const { deps } = seededDepsShows(records, [{ id: "show-bol", program: null, airtable_program_key: "BOL|BOL: PP" }]);
  const { showUpdates } = captureWrites(deps);
  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  assertEquals(showUpdates.length, 1);
  assertEquals(showUpdates[0], { program: "BOL" });
});

Deno.test("airtable-poll grain: program unmapped → no shows write, resolves as before", async () => {
  const records = [{ id: "rec-1", fields: { Date: "2026-06-01", SubProgram: "Magic", City: "Berlin" } }];
  const { deps } = seededDeps(records); // existing helper: FIELD_MAP (no program), show-magic keyed "Magic"
  const { showUpdates, showDateInserts } = captureWrites(deps);
  const res = await handle(authReq(), deps);
  assertEquals(res.status, 200);
  assertEquals(showUpdates.length, 0);
  assertEquals(showDateInserts.length, 1);
  assertEquals((showDateInserts[0] as Record<string, unknown>).show_id, "show-magic");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/index.test.ts`
Expected: the 4 new tests FAIL (e.g. re-key test sees `showUpdates.length` 0; write-through sees 0) because the poll still builds sub-program-only keys and never writes `shows`.

- [ ] **Step 3: Update the `showByKey` map to carry `program`**

In `supabase/functions/airtable-poll/index.ts`, replace the catalog lookup block (currently ~lines 168–172):

```ts
  const { data: shows } = await admin.from("shows").select("id, airtable_program_key").eq("org_id", orgId).limit(10000);
  const showByKey = new Map<string, string>();
  for (const s of (shows ?? []) as Array<{ id: string; airtable_program_key: string | null }>) {
    if (s.airtable_program_key) showByKey.set(s.airtable_program_key, s.id);
  }
```

with:

```ts
  const { data: shows } = await admin.from("shows").select("id, program, airtable_program_key").eq("org_id", orgId).limit(10000);
  const showByKey = new Map<string, { id: string; program: string | null }>();
  for (const s of (shows ?? []) as Array<{ id: string; program: string | null; airtable_program_key: string | null }>) {
    if (s.airtable_program_key) showByKey.set(s.airtable_program_key, { id: s.id, program: s.program });
  }
```

- [ ] **Step 4: Replace the per-record show resolution with composite-grain + self-heal + write-through**

Replace the resolution block (currently ~lines 270–273):

```ts
      const subProgramValue = fieldMap.sub_program ? fields[fieldMap.sub_program] ?? null : null;
      const programKey = buildProgramKey(null, subProgramValue == null ? null : String(subProgramValue));
      const showId = programKey ? showByKey.get(programKey) ?? null : null;
      if (!showId) { held += 1; outcomes.push({ airtable_record_id: id, action: "held_unresolved", show_date_id: null, reason: `program '${subProgramValue ?? ""}' not linked`, raw_fields: fields }); continue; }
```

with:

```ts
      const subProgramRaw = fieldMap.sub_program ? fields[fieldMap.sub_program] ?? null : null;
      const subProgramValue = subProgramRaw == null ? null : String(subProgramRaw);
      const programRaw = fieldMap.program ? fields[fieldMap.program] ?? null : null;
      const programValue = programRaw == null ? null : (String(programRaw).trim() || null);

      // Composite grain (ADR-0010): program present → "program|sub_program"; else sub_program alone.
      const programKey = buildProgramKey(programValue, subProgramValue);
      const legacyKey = buildProgramKey(null, subProgramValue);
      let resolved = programKey ? showByKey.get(programKey) ?? null : null;
      let showId = resolved?.id ?? null;

      // Transition self-heal: a show still keyed sub-program-only is adopted to the composite
      // grain (re-keyed + program backfilled) so its existing dates keep resolving. Idempotent —
      // the in-memory map is updated so later records in this run hit the composite key directly.
      if (!showId && programKey && legacyKey && legacyKey !== programKey) {
        const legacy = showByKey.get(legacyKey);
        if (legacy) {
          const { error: rekeyErr } = await admin.from("shows")
            .update({ airtable_program_key: programKey, program: programValue }).eq("id", legacy.id);
          if (!rekeyErr) {
            showByKey.delete(legacyKey);
            resolved = { id: legacy.id, program: programValue };
            showByKey.set(programKey, resolved);
            showId = legacy.id;
          }
        }
      }

      if (!showId) { held += 1; outcomes.push({ airtable_record_id: id, action: "held_unresolved", show_date_id: null, reason: `program '${subProgramValue ?? ""}' not linked`, raw_fields: fields }); continue; }

      // Keep shows.program current with Airtable (fills the column on already-composite shows).
      if (programValue !== null && resolved && resolved.program !== programValue) {
        await admin.from("shows").update({ program: programValue }).eq("id", showId);
        resolved.program = programValue;
        showByKey.set(programKey!, resolved);
      }
```

- [ ] **Step 5: Run the whole poll suite to verify pass + no regressions**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/`
Expected: PASS — the 4 new tests and all pre-existing poll tests (`index.test.ts`, `index.di.test.ts`, `index.linked.test.ts`, `index.org.test.ts`, `index.regression.test.ts`, `index.smoke.test.ts`, `index.custom.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/airtable-poll/index.ts supabase/functions/airtable-poll/index.test.ts
git commit -m "feat: airtable-poll composite program grain + self-heal re-key"
```

---

### Task 2: `airtable-schema` — distinct `(program, sub_program)` pairs mode

**Files:**
- Modify: `supabase/functions/airtable-schema/index.ts` (extend `Body`, add a new mode before "describe base")
- Test: `supabase/functions/airtable-schema/index.di.test.ts` (append cases)

**Interfaces:**
- Produces (HTTP contract): body `{ org_id, baseId, tableName, subProgramField, programField? }` → `{ schemaAccessible: true, pairs: Array<{ program: string | null; sub_program: string }> }`. 403 → `{ schemaAccessible: false }`. Consumed by Task 3's `fetchAirtableProgramPairs`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/airtable-schema/index.di.test.ts`:

```ts
// ─── Program pairs mode (baseId + tableName + subProgramField) ───────────────────
Deno.test("airtable-schema: program pairs → distinct (program, sub_program) from records", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (url) => {
    urls.push(String(url));
    return Promise.resolve(airtableJson({
      records: [
        { id: "r1", fields: { Program: "BOL", "Sub-Programm": "BOL: PP" } },
        { id: "r2", fields: { Program: "TJE", "Sub-Programm": "TJE: Boat" } },
        { id: "r3", fields: { Program: "TJE", "Sub-Programm": "TJE: Boat" } }, // duplicate pair → collapsed
        { id: "r4", fields: { "Sub-Programm": "  " } },                        // blank sub → skipped
      ],
    })) as Promise<Response>;
  };
  const { deps } = adminDeps({ fetchImpl });
  const res = await handle(
    adminReq({ org_id: ORG, baseId: "appX", tableName: "Events", programField: "Program", subProgramField: "Sub-Programm" }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.schemaAccessible, true);
  assertEquals(body.pairs, [
    { program: "BOL", sub_program: "BOL: PP" },
    { program: "TJE", sub_program: "TJE: Boat" },
  ]);
  assertEquals(urls[0].includes("/v0/appX/Events"), true);
  assertEquals(decodeURIComponent(urls[0]).includes("fields[]=Sub-Programm"), true);
});

Deno.test("airtable-schema: program pairs without programField → program null", async () => {
  const { deps } = adminDeps({
    fetchImpl: () => Promise.resolve(airtableJson({ records: [{ id: "r1", fields: { "Sub-Programm": "BOL: PP" } }] })) as Promise<Response>,
  });
  const res = await handle(adminReq({ org_id: ORG, baseId: "appX", tableName: "Events", subProgramField: "Sub-Programm" }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).pairs, [{ program: null, sub_program: "BOL: PP" }]);
});

Deno.test("airtable-schema: program pairs 403 (missing scope) → { schemaAccessible: false }", async () => {
  const { deps } = adminDeps({
    fetchImpl: () => Promise.resolve(new Response("", { status: 403 })) as Promise<Response>,
  });
  const res = await handle(adminReq({ org_id: ORG, baseId: "appX", tableName: "Events", subProgramField: "Sub-Programm" }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).schemaAccessible, false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-schema/index.di.test.ts`
Expected: FAIL — the new mode isn't handled, so the request falls through to "describe base" and returns `tables`, not `pairs`.

- [ ] **Step 3: Extend the `Body` type**

In `supabase/functions/airtable-schema/index.ts`, replace:

```ts
type Body = { org_id?: string; baseId?: string; linkedTableId?: string };
```

with:

```ts
type Body = { org_id?: string; baseId?: string; linkedTableId?: string; tableName?: string; programField?: string; subProgramField?: string };
```

- [ ] **Step 4: Add the pairs mode**

Insert this block immediately **after** Mode C (the `if (body?.baseId && body?.linkedTableId) { … }` block ends, ~line 93) and **before** Mode B (`if (body?.baseId) { … }`):

```ts
    // ── Mode D: distinct (program, sub_program) pairs from the main table ──────
    //    Powers composite-grain catalog linking; the UI builds keys from these.
    if (body?.baseId && body?.tableName && body?.subProgramField) {
      const seen = new Set<string>();
      const pairs: Array<{ program: string | null; sub_program: string }> = [];
      let offset: string | undefined;
      let pages = 0;
      do {
        const params = new URLSearchParams();
        params.append("fields[]", body.subProgramField);
        if (body.programField) params.append("fields[]", body.programField);
        if (offset) params.set("offset", offset);
        const recRes = await deps.fetch(
          `${AIRTABLE_DATA}/${encodeURIComponent(body.baseId)}/${encodeURIComponent(body.tableName)}?${params.toString()}`,
          { headers },
        );
        const recFail = await airtableFailure(recRes, "Airtable records read failed");
        if (recFail) return recFail;
        const data = (await recRes.json()) as { records?: Array<{ fields?: Record<string, unknown> }>; offset?: string };
        for (const r of data.records ?? []) {
          const subRaw = r.fields?.[body.subProgramField];
          const sub = subRaw == null ? "" : String(subRaw).trim();
          if (!sub) continue;
          const progRaw = body.programField ? r.fields?.[body.programField] : null;
          const prog = progRaw == null ? null : (String(progRaw).trim() || null);
          const dedup = `${prog ?? ""} ${sub}`;
          if (seen.has(dedup)) continue;
          seen.add(dedup);
          pairs.push({ program: prog, sub_program: sub });
        }
        offset = data.offset;
        pages += 1;
      } while (offset && pages < MAX_RECORD_PAGES);

      return json({ schemaAccessible: true, pairs });
    }
```

- [ ] **Step 5: Update the mode doc-comment**

In the handler's JSDoc (the "Modes" list, ~lines 37–41), add a line after the linkedTableId bullet:

```ts
 *  - body has baseId + tableName + subProgramField (+ programField?) → distinct (program, sub_program) pairs → { schemaAccessible: true, pairs: [{ program, sub_program }] }.
```

- [ ] **Step 6: Run the schema suite to verify pass**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-schema/`
Expected: PASS — new pairs tests plus all existing `index.di.test.ts` cases (guards, list bases, describe base, linked records).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/airtable-schema/index.ts supabase/functions/airtable-schema/index.di.test.ts
git commit -m "feat: airtable-schema distinct program/sub-program pairs mode"
```

---

### Task 3: Data layer — `fetchAirtableProgramPairs` + `planProgramImport`

**Files:**
- Modify: `src/data/airtableSchema.ts` (add fetch fn + types)
- Modify: `src/data/airtableMapping.ts` (add `ProgramPair` + `planProgramImport`)
- Test: `src/data/airtableMapping.test.ts` (append `planProgramImport` cases)

**Interfaces:**
- Produces `fetchAirtableProgramPairs(client, orgId, baseId, tableName, subProgramField, programField?) → Promise<{ schemaAccessible: boolean; pairs?: ProgramPair[] }>`.
- Produces `ProgramPair = { program: string | null; sub_program: string }`.
- Produces `planProgramImport(pairs: ProgramPair[], existing: Array<{ sub_program: string | null; airtable_program_key: string | null }>) → Array<{ program: string | null; sub_program: string; key: string }>` — dedupes against existing composite keys AND legacy (no-`|`) keys with the same sub-program (covers the transition window). Consumed by Task 4 and fed straight into the existing `importShowsFromOptions(client, orgId, rows)`.

- [ ] **Step 1: Write the failing `planProgramImport` tests**

Append to `src/data/airtableMapping.test.ts`:

```ts
import { planProgramImport } from "./airtableMapping";

describe("planProgramImport", () => {
  it("builds composite keys and rows for unlinked pairs", () => {
    const rows = planProgramImport(
      [{ program: "BOL", sub_program: "BOL: PP" }, { program: "TJE", sub_program: "TJE: Boat" }],
      [],
    );
    expect(rows).toEqual([
      { program: "BOL", sub_program: "BOL: PP", key: "BOL|BOL: PP" },
      { program: "TJE", sub_program: "TJE: Boat", key: "TJE|TJE: Boat" },
    ]);
  });

  it("skips a pair whose composite key already exists", () => {
    const rows = planProgramImport(
      [{ program: "BOL", sub_program: "BOL: PP" }],
      [{ sub_program: "BOL: PP", airtable_program_key: "BOL|BOL: PP" }],
    );
    expect(rows).toEqual([]);
  });

  it("skips a pair whose sub-program is still legacy-keyed (transition window)", () => {
    // Existing show created pre-grain (key === sub_program, no '|') must not be duplicated.
    const rows = planProgramImport(
      [{ program: "BOL", sub_program: "BOL: PP" }],
      [{ sub_program: "BOL: PP", airtable_program_key: "BOL: PP" }],
    );
    expect(rows).toEqual([]);
  });

  it("falls back to sub-program-only keys when program is null", () => {
    const rows = planProgramImport([{ program: null, sub_program: "Solo" }], []);
    expect(rows).toEqual([{ program: null, sub_program: "Solo", key: "Solo" }]);
  });

  it("dedupes repeated pairs and drops blank sub-programs", () => {
    const rows = planProgramImport(
      [{ program: "BOL", sub_program: "BOL: PP" }, { program: "BOL", sub_program: "BOL: PP" }, { program: "X", sub_program: "  " }],
      [],
    );
    expect(rows).toEqual([{ program: "BOL", sub_program: "BOL: PP", key: "BOL|BOL: PP" }]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run (CI): `npx vitest run src/data/airtableMapping.test.ts`
Expected: FAIL — `planProgramImport` is not exported.

- [ ] **Step 3: Implement `ProgramPair` + `planProgramImport`**

In `src/data/airtableMapping.ts`, add after the `buildProgramKey` re-export (after line 38):

```ts
/** A distinct program/sub-program pairing read from Airtable records (Mode D of airtable-schema). */
export interface ProgramPair { program: string | null; sub_program: string }

/** Plan which (program, sub_program) pairs to create as catalog shows, at the composite link grain.
 *  Dedupes against existing shows by composite key AND by sub-program for legacy (pre-grain,
 *  no-"|") keys, so re-running "Import all" during/after the grain migration never duplicates a show.
 *  Pure: no client, no side effects. Rows feed importShowsFromOptions unchanged. */
export function planProgramImport(
  pairs: ProgramPair[],
  existing: Array<{ sub_program: string | null; airtable_program_key: string | null }>,
): Array<{ program: string | null; sub_program: string; key: string }> {
  const existingKeys = new Set(
    existing.map((e) => e.airtable_program_key).filter((k): k is string => !!k),
  );
  const legacySubs = new Set(
    existing
      .filter((e) => e.airtable_program_key && !e.airtable_program_key.includes("|"))
      .map((e) => (e.sub_program ?? "").trim())
      .filter(Boolean),
  );
  const seen = new Set<string>();
  const rows: Array<{ program: string | null; sub_program: string; key: string }> = [];
  for (const p of pairs) {
    const sub = (p.sub_program ?? "").trim();
    const prog = p.program == null ? null : (p.program.trim() || null);
    const key = buildProgramKey(prog, sub);
    if (!key || existingKeys.has(key) || legacySubs.has(sub) || seen.has(key)) continue;
    seen.add(key);
    rows.push({ program: prog, sub_program: sub, key });
  }
  return rows;
}
```

> Note: `buildProgramKey` is already imported/re-exported at the top of this file — use it directly (ADR-0010 single source).

- [ ] **Step 4: Add `fetchAirtableProgramPairs` to the data layer**

In `src/data/airtableSchema.ts`, append:

```ts
export interface AirtableProgramPair { program: string | null; sub_program: string }
export interface ProgramPairsResult { schemaAccessible: boolean; pairs?: AirtableProgramPair[] }

/** Distinct (program, sub_program) pairs from the mapped table's records, via airtable-schema
 *  Mode D. Used by the mapping UI to link at the composite grain (ADR-0010 parity with the poll). */
export async function fetchAirtableProgramPairs(
  client: SupabaseClient<Database>,
  orgId: string,
  baseId: string,
  tableName: string,
  subProgramField: string,
  programField?: string,
): Promise<ProgramPairsResult> {
  const { data, error } = await client.functions.invoke("airtable-schema", {
    body: { org_id: orgId, baseId, tableName, subProgramField, ...(programField ? { programField } : {}) },
  });
  if (error) throw error;
  const payload = data as { error?: string; schemaAccessible?: boolean; pairs?: AirtableProgramPair[] };
  if (payload?.error) throw new Error(payload.error);
  return { schemaAccessible: !!payload?.schemaAccessible, pairs: payload?.pairs };
}
```

- [ ] **Step 5: Run the data tests to verify pass**

Run (CI): `npx vitest run src/data/airtableMapping.test.ts`
Expected: PASS — new `planProgramImport` cases + existing `buildProgramKey`/city cases.

- [ ] **Step 6: Commit**

```bash
git add src/data/airtableMapping.ts src/data/airtableMapping.test.ts src/data/airtableSchema.ts
git commit -m "feat: planProgramImport + fetchAirtableProgramPairs (composite grain)"
```

---

### Task 4: `AirtableSyncTab` — link Programs at the composite grain

**Files:**
- Modify: `src/components/settings/AirtableSyncTab.tsx`
- Test: `src/components/settings/AirtableSyncTab.test.tsx`

**Interfaces:**
- Consumes: `fetchAirtableProgramPairs`, `ProgramPair`, `planProgramImport` (Task 3), `buildProgramKey` (already imported), `importShowsFromOptions`/`linkShowAirtableKey` (existing).
- Produces: when `airtable_field_map.program` is mapped, the "Programs" linking section iterates distinct `(program, sub_program)` pairs and composes composite keys; when unmapped, it keeps today's sub-program-only behavior.

- [ ] **Step 1: Write the failing component test**

In `src/components/settings/AirtableSyncTab.test.tsx`, extend the `@/data/airtableSchema` mock factory to include the new fn:

```ts
vi.mock("@/data/airtableSchema", () => ({
  fetchAirtableBases: vi.fn(),
  fetchAirtableTables: vi.fn(),
  fetchAirtableLinkedRecords: vi.fn(() => Promise.resolve({ schemaAccessible: true, records: [] })),
  fetchAirtableProgramPairs: vi.fn(() => Promise.resolve({ schemaAccessible: true, pairs: [] })),
}));
```

Update the import line near the top to also import it:

```ts
import { fetchAirtableBases, fetchAirtableTables, fetchAirtableLinkedRecords, fetchAirtableProgramPairs } from "@/data/airtableSchema";
```

Append this test inside the `describe("AirtableSyncTab — autosave", …)` block (it already imports `fetchShowsForLinking`):

```ts
  it("links Programs at the composite grain when Program is mapped", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appX", name: "Base" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({
      schemaAccessible: true,
      tables: [{
        id: "tbl", name: "Events",
        fields: [
          { id: "fP", name: "Program", type: "singleSelect", options: { choices: [{ id: "p1", name: "TJE" }] } },
          { id: "fS", name: "Sub", type: "singleSelect", options: { choices: [{ id: "c1", name: "TJE: Murder" }] } },
        ],
      }],
    });
    (fetchAirtableProgramPairs as ReturnType<typeof vi.fn>).mockResolvedValue({
      schemaAccessible: true, pairs: [{ program: "TJE", sub_program: "TJE: Murder" }],
    });
    (fetchShowsForLinking as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderTab({ airtable_base_id: "appX", airtable_table_name: "Events", airtable_field_map: { program: "Program", sub_program: "Sub" } });

    // Composite display label "TJE – TJE: Murder" renders for the pair.
    expect(await screen.findByText("TJE – TJE: Murder")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchAirtableProgramPairs).toHaveBeenCalledWith(expect.anything(), "org-1", "appX", "Events", "Sub", "Program"),
    );
  });
```

- [ ] **Step 2: Run to verify it fails**

Run (CI): `npx vitest run src/components/settings/AirtableSyncTab.test.tsx`
Expected: FAIL — `fetchAirtableProgramPairs` is never called and "TJE – TJE: Murder" is not rendered (the section still lists raw sub-program option names).

- [ ] **Step 3: Add the program-pairs query**

In `src/components/settings/AirtableSyncTab.tsx`, update the import (line 18) to include the new fn:

```ts
import { fetchAirtableBases, fetchAirtableTables, fetchAirtableLinkedRecords, fetchAirtableProgramPairs } from "@/data/airtableSchema";
```

Update the mapping import (line 19) to also bring in `planProgramImport` and `ProgramPair`:

```ts
import { SHOWFLOW_FIELDS, buildProgramKey, buildCityKey, planCityReconciliation, groupDuplicateCities, planProgramImport, type AirtableFieldMap, type ProgramPair } from "@/data/airtableMapping";
```

Add a query next to `cityLinkedRecordsQ` (after line 172):

```ts
  // When Program is mapped, link at the composite grain: read distinct (program, sub_program)
  // pairs from records so the UI builds the SAME key the poll does (ADR-0010).
  const programPairsQ = useQuery({
    queryKey: ["airtable", "program-pairs", orgId, baseId, s.airtable_table_name, fieldMap.program, fieldMap.sub_program],
    enabled: !!orgId && keyPresent && basesAccessible && !!baseId && !!selectedTable && !!fieldMap.program && !!fieldMap.sub_program,
    queryFn: () => fetchAirtableProgramPairs(supabase, orgId!, baseId, s.airtable_table_name!, fieldMap.sub_program!, fieldMap.program!),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
```

- [ ] **Step 4: Derive the grain pairs and use them everywhere a program key is built**

Replace the `programOptions` line (line 242):

```ts
  const programOptions = optionNames(fieldMap.sub_program); // sub-program-only linking (current scope)
```

with:

```ts
  // Composite grain when Program is mapped (pairs from records); else sub-program-only options.
  const programGrainPairs: ProgramPair[] = fieldMap.program
    ? (programPairsQ.data?.pairs ?? [])
    : optionNames(fieldMap.sub_program).map((name) => ({ program: null, sub_program: name }));
```

Replace the `importPrograms` mutation body (lines 251–261) so it imports the planned composite rows:

```ts
  const importPrograms = useMutation({
    mutationFn: async () => {
      const rows = planProgramImport(programGrainPairs, showsQ.data ?? []);
      await importShowsFromOptions(supabase, orgId!, rows);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shows"] }); toast.success("Imported program options"); },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Import failed"),
  });
```

- [ ] **Step 5: Render the Programs linking section from pairs (composite keys)**

Replace the Programs block header button + list (lines 639–667). Replace:

```tsx
                  <h4 className="font-display font-semibold">Programs ({fieldMap.sub_program})</h4>
                  <Button variant="outline" size="sm" onClick={() => importPrograms.mutate()} disabled={importPrograms.isPending || !programOptions.length}>Import all</Button>
                </div>
                {programOptions.length ? programOptions.map((name) => {
                  const key = buildProgramKey(null, name);
                  const show = key ? showByKey.get(key) : undefined;
                  return (
                    <div key={name} className="flex items-center justify-between gap-2 border-t border-border pt-2">
                      <span className="text-sm font-medium">{name}</span>
```

with:

```tsx
                  <h4 className="font-display font-semibold">Programs ({fieldMap.sub_program})</h4>
                  <Button variant="outline" size="sm" onClick={() => importPrograms.mutate()} disabled={importPrograms.isPending || !programGrainPairs.length}>Import all</Button>
                </div>
                {programGrainPairs.length ? programGrainPairs.map((pair) => {
                  const name = pair.sub_program;
                  const key = buildProgramKey(pair.program, pair.sub_program);
                  const show = key ? showByKey.get(key) : undefined;
                  const display = pair.program ? `${pair.program} – ${pair.sub_program}` : pair.sub_program;
                  return (
                    <div key={key ?? name} className="flex items-center justify-between gap-2 border-t border-border pt-2">
                      <span className="text-sm font-medium">{display}</span>
```

> The remaining lines of this block (the linked/unlinked badges, the `unlinkShow.mutate(show.id)` button, and the `Select` whose `onValueChange` calls `linkShow.mutate({ showId, key: key! })` with `aria-label={`link ${name} to an existing show`}`) are unchanged — `name` (= `pair.sub_program`) and `key` are still in scope, so the aria-label and link key stay correct. Also update the empty-state copy on the same block from `No options on the mapped Sub-program field.` to `No program options found in the mapped table.`

- [ ] **Step 6: Run the component tests to verify pass + no regressions**

Run (CI): `npx vitest run src/components/settings/AirtableSyncTab.test.tsx`
Expected: PASS — the new composite-grain test, plus the existing `offers 'Link to existing' for an unlinked program option` test (program **unmapped** path still lists `TJE: Murder` and exposes `link TJE: Murder to an existing show`).

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/AirtableSyncTab.tsx src/components/settings/AirtableSyncTab.test.tsx
git commit -m "feat: composite-grain Program linking in AirtableSyncTab"
```

---

### Task 5: Documentation — record the shipped composite grain (ADR-0010)

**Files:**
- Modify: `docs/adr/0010-catalog-link-keys.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Mark the grain shipped**

In `docs/adr/0010-catalog-link-keys.md`, under **Decision → "Grain shipped"** (line 47–49), change the deferred wording to reflect reality:

```markdown
- **Grain shipped:** Phase 2b shipped **sub-program-only**. The composite `program|sub_program`
  grain shipped on 2026-06-30 (this change) — additive, **no migration**: the UI reads distinct
  `(program, sub_program)` pairs (airtable-schema Mode D) and the poll reads the record's `program`
  cell; both compose the key via `buildProgramKey`. The poll **self-heals** pre-grain shows by
  re-keying them to the composite key and backfilling `shows.program` on the next sync.
```

- [ ] **Step 2: Tick the action item**

In **Action Items**, change item 2 to:

```markdown
2. [x] Composite grain shipped (2026-06-30): `AirtableSyncTab` maps Program via distinct record
   pairs and the poll resolves the composite key — no migration. See plan
   `docs/superpowers/plans/2026-06-30-program-composite-grain.md`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0010-catalog-link-keys.md
git commit -m "docs: ADR-0010 composite program grain shipped"
```

---

## Self-Review

- **Spec coverage:** (1) Program column shows real values → poll write-through + self-heal re-key (Task 1) populate `shows.program`; the existing `ProductionsPage` cell `s.program || —` then renders it (no page change needed). (2) UI/poll key parity → Task 2 (pairs mode) + Task 4 (UI builds composite keys from pairs) + shared `buildProgramKey`. (3) Existing shows re-keyed + dates re-resolved → Task 1 self-heal (no SQL migration). (4) No duplicate imports during transition → `planProgramImport` legacy-sub dedup (Task 3). (5) Backward compat (program unmapped) → guarded throughout, asserted in Task 1 & Task 4.
- **Placeholder scan:** none — all steps carry concrete code and exact commands.
- **Type consistency:** `showByKey` value type `{ id; program }` (Task 1) used consistently in re-key + write-through. `ProgramPair`/`planProgramImport` signatures match between Task 3 (definition) and Task 4 (consumption). `fetchAirtableProgramPairs` arg order `(client, orgId, baseId, tableName, subProgramField, programField?)` matches the Task 4 call and the Task 4 test assertion.

## Post-merge / delivery notes (not code tasks)

- **Deploy & self-heal:** merging to `main` auto-deploys both edge functions (CI). On the **next** `airtable-poll` run (≤5 min), the org's 5 existing shows are re-keyed to composite keys and `shows.program` is backfilled (`BOL`, `TJE`); `/productions` then renders the Program column. **No pre-deploy SQL** — running a backfill before the new poll deploys would make the *old* (sub-program-only) poll hold records until redeploy.
- **Optional immediacy:** after confirming the new poll is live, an admin can hit Settings → Airtable to confirm Programs show as "linked" at the composite grain; the next scheduled poll fills program. (A manual one-time backfill is unnecessary given self-heal.)
- **Changelog/version:** a user-facing changelog entry + semver bump are a release step (per `CLAUDE.md`), to be done when cutting the next tag — not part of this fix branch.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-30-program-composite-grain.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session with checkpoints for review.

**Which approach?**
