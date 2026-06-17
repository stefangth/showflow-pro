# Airtable Sync Phase 3 — `airtable-poll` rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `airtable-poll` to resolve Airtable records against the Phase-2 field map + catalog-link keys, log every record's outcome, and surface a "Last sync report" — killing the silent `success / 0 rows` import.

**Architecture:** A single source-of-truth key helper (`_shared/airtableKey.ts`) is shared by the Deno poll and the React UI. The poll reads `app_settings.airtable_field_map`, resolves shows/cities **strictly** by their linked `airtable_program_key` / `airtable_city_key`, upserts `show_dates` on `airtable_record_id`, writes a per-record `airtable_sync_record_log` plus an extended `airtable_sync_log` summary, and notifies admins only when the held set changes. A read-only report section in `AirtableSyncTab` renders the summary + held records.

**Tech Stack:** Deno edge function (DI via `Deps`/`makeFakeDeps`), Supabase Postgres (migration via Supabase MCP), React 18 + React Query + shadcn/ui, Vitest (frontend) + Deno test (edge) + pgTAP (DB).

**Branch:** `claude/airtable-poll-phase3` (already created off `origin/main`).

**Spec:** `docs/superpowers/specs/2026-06-17-airtable-poll-phase3-design.md` (and parent `2026-06-16-airtable-sync-engine-design.md`).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/functions/_shared/airtableKey.ts` | Pure link-key composition (`buildProgramKey`/`buildCityKey`/`clean`) | Create |
| `supabase/functions/_shared/airtableKey.test.ts` | Deno unit test for the shared helper | Create |
| `src/data/airtableMapping.ts` | Re-export helpers from `_shared`; keep field-map types/constants | Modify |
| `supabase/migrations/<version>_airtable_sync_records.sql` | Extend `airtable_sync_log`; create `airtable_sync_record_log` + trigger + RLS + indexes | Create (via MCP) |
| `src/integrations/supabase/types.ts` | Regenerated DB types | Regenerate |
| `supabase/tests/db/airtable_sync_record_log.sql` | pgTAP: RLS, CHECK, cascade, org-derive | Create |
| `supabase/functions/airtable-poll/index.ts` | The rewrite: field-map + key resolution, record logging, change-only notify | Modify |
| `supabase/functions/airtable-poll/index.regression.test.ts` | German-field-names regression test | Create |
| `supabase/functions/airtable-poll/index.di.test.ts` | Update to new field-map/key contract | Modify |
| `supabase/functions/airtable-poll/index.test.ts`, `index.org.test.ts` | Update to new contract | Modify |
| `src/data/airtableSync.ts` | `fetchLatestSyncLog` / `fetchHeldRecords` data fns | Create |
| `src/data/airtableSync.test.ts` | Data-fn tests (fake client) | Create |
| `src/components/settings/AirtableSyncTab.tsx` | Add read-only "Last sync report" section | Modify |
| `src/components/settings/AirtableSyncTab.test.tsx` | Report-renders test | Modify |

**Environment note:** No local Node/npm/supabase-CLI/Docker — only Deno. Deno tests run locally (`deno test`); frontend Vitest + pgTAP run in CI. DB migrations apply via the Supabase MCP (`mcp__6fbecca6-…__apply_migration`, project `epweartpzwvcasrzyueh`); types regenerate via `mcp__6fbecca6-…__generate_typescript_types`.

---

## Task 1: Shared link-key helper (single source of truth)

**Files:**
- Create: `supabase/functions/_shared/airtableKey.ts`
- Create: `supabase/functions/_shared/airtableKey.test.ts`
- Modify: `src/data/airtableMapping.ts`

- [ ] **Step 1: Create the shared helper** (verbatim move of the bodies currently in `src/data/airtableMapping.ts`)

Create `supabase/functions/_shared/airtableKey.ts`:

```ts
/** Pure Airtable link-key composition — the SINGLE source shared by the React mapping UI
 *  (re-exported via src/data/airtableMapping.ts) and the airtable-poll edge function.
 *  No imports: must stay valid under both Deno and the Vite/tsc bundler resolver.
 *  ADR-0010: the UI and the poll MUST build keys identically or records silently fail to resolve. */

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

/** Grain-agnostic program link key. program present → "program|sub_program"; else the sub_program
 *  value alone. Returns null when neither yields content. */
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

- [ ] **Step 2: Write the Deno unit test**

Create `supabase/functions/_shared/airtableKey.test.ts`:

```ts
import { assertEquals } from "./test-asserts.ts";
import { buildProgramKey, buildCityKey } from "./airtableKey.ts";

Deno.test("buildProgramKey: sub-program alone when program absent", () => {
  assertEquals(buildProgramKey(null, "TJE: Murder"), "TJE: Murder");
});
Deno.test("buildProgramKey: composite when both present", () => {
  assertEquals(buildProgramKey("TJE", "TJE: Murder"), "TJE|TJE: Murder");
});
Deno.test("buildProgramKey: trims; null when nothing usable", () => {
  assertEquals(buildProgramKey(null, "  "), null);
  assertEquals(buildProgramKey("  ", null), null);
});
Deno.test("buildCityKey: trims; blank → null", () => {
  assertEquals(buildCityKey(" Berlin "), "Berlin");
  assertEquals(buildCityKey(""), null);
});
```

- [ ] **Step 3: Run the Deno test to verify it passes**

Run: `deno test --allow-all supabase/functions/_shared/airtableKey.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Re-export from the frontend mapping module**

In `src/data/airtableMapping.ts`, delete the `clean` const and the `buildProgramKey` / `buildCityKey` function bodies (lines 28–45), and replace them with a re-export. The final file is:

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

// Single source of truth (ADR-0010): the link-key helpers live in the shared edge module so the
// poll and this UI compose keys identically. Re-exported here so frontend imports are unchanged.
export { buildProgramKey, buildCityKey } from "../../supabase/functions/_shared/airtableKey.ts";
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/airtableKey.ts supabase/functions/_shared/airtableKey.test.ts src/data/airtableMapping.ts
git commit -m "refactor(airtable): single-source link-key helper in _shared/airtableKey.ts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **CI checkpoint (cannot run locally — no Node):** the frontend Typecheck/Unit/Lint jobs validate the cross-boundary re-export and that `src/data/airtableMapping.test.ts` still passes (it imports the helpers from `./airtableMapping`, which now re-exports). If CI's typecheck rejects importing across `supabase/`, fall back to a duplicated copy in `_shared/airtableKey.ts` + a vitest parity test asserting byte-identical output, and revert the re-export.

---

## Task 2: DB migration — extend `airtable_sync_log` + new `airtable_sync_record_log`

**Files:**
- Create: `supabase/migrations/<version>_airtable_sync_records.sql` (version filled in after MCP apply)
- Regenerate: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Apply the migration via the Supabase MCP**

Call `mcp__6fbecca6-9b05-4c4a-9991-f438c220c4b5__apply_migration` with `name: "airtable_sync_records"` and this SQL:

```sql
-- Phase 3: observable sync. Extend the summary log with counts + details, and add a
-- per-record child table so every Airtable record's outcome (imported/updated/held/error)
-- is auditable and surfaced in the Settings "Last sync report".

-- ── Summary log: count + details columns (additive, nullable) ────────────────
ALTER TABLE public.airtable_sync_log
  ADD COLUMN IF NOT EXISTS imported_count int,
  ADD COLUMN IF NOT EXISTS new_count int,
  ADD COLUMN IF NOT EXISTS updated_count int,
  ADD COLUMN IF NOT EXISTS held_count int,
  ADD COLUMN IF NOT EXISTS details jsonb;

-- ── Per-record history ───────────────────────────────────────────────────────
CREATE TABLE public.airtable_sync_record_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_log_id uuid NOT NULL REFERENCES public.airtable_sync_log(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  airtable_record_id text,
  action text NOT NULL CHECK (action IN ('imported_new','updated','held_unresolved','error')),
  show_date_id uuid REFERENCES public.show_dates(id) ON DELETE SET NULL,
  reason text,
  raw_fields jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_airtable_sync_record_log_sync_log ON public.airtable_sync_record_log (sync_log_id);
CREATE INDEX idx_airtable_sync_record_log_org_created ON public.airtable_sync_record_log (org_id, created_at);
CREATE INDEX idx_airtable_sync_record_log_org_record ON public.airtable_sync_record_log (org_id, airtable_record_id);

-- org_id derived from the parent summary row (mirrors 20260604130000_org_id_derivation_triggers.sql).
CREATE OR REPLACE FUNCTION public.derive_org_id_from_sync_log_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT org_id INTO NEW.org_id FROM public.airtable_sync_log WHERE id = NEW.sync_log_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_derive_org_id ON public.airtable_sync_record_log;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT ON public.airtable_sync_record_log
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_from_sync_log_id();

-- RLS: org isolation (restrictive) + admin read + system insert (mirrors airtable_sync_log).
ALTER TABLE public.airtable_sync_record_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON public.airtable_sync_record_log AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), org_id))
  WITH CHECK (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins can view sync record logs" ON public.airtable_sync_record_log FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'));

CREATE POLICY "System can insert sync record logs" ON public.airtable_sync_record_log FOR INSERT TO authenticated
  WITH CHECK (true);
```

Expected: success response. (If it reports the `app_settings`-recompute or any unrelated trigger, ignore — this migration touches only the two tables above.)

- [ ] **Step 2: Read back the recorded version and name the local file to match**

Call `mcp__6fbecca6-9b05-4c4a-9991-f438c220c4b5__list_migrations`. Find the just-applied entry (name `airtable_sync_records`), note its `version` (a real timestamp like `20260617HHMMSS`). Create the local file `supabase/migrations/<version>_airtable_sync_records.sql` containing the exact SQL from Step 1 (so the committed migration matches the applied version — avoids the CI preview-branch orphan trap).

- [ ] **Step 3: Verify the schema landed**

Call `mcp__6fbecca6-9b05-4c4a-9991-f438c220c4b5__execute_sql` with:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'airtable_sync_record_log' ORDER BY column_name;
```

Expected: rows include `action`, `airtable_record_id`, `created_at`, `id`, `org_id`, `raw_fields`, `reason`, `show_date_id`, `sync_log_id`.

- [ ] **Step 4: Regenerate types**

Call `mcp__6fbecca6-9b05-4c4a-9991-f438c220c4b5__generate_typescript_types`. Overwrite `src/integrations/supabase/types.ts` with the result. Confirm it now contains an `airtable_sync_record_log` table type and the new `airtable_sync_log` columns (`imported_count`, `held_count`, `details`, …).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ src/integrations/supabase/types.ts
git commit -m "feat(db): airtable_sync_record_log + sync_log counts/details

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: pgTAP test for `airtable_sync_record_log`

**Files:**
- Create: `supabase/tests/db/airtable_sync_record_log.sql`

> pgTAP runs in CI only (no local Docker). Mirror the style of `supabase/tests/db/airtable_link_columns.sql`.

- [ ] **Step 1: Write the pgTAP test**

Create `supabase/tests/db/airtable_sync_record_log.sql`:

```sql
-- airtable_sync_record_log: org_id derives from the parent log, the action CHECK is enforced,
-- the FK cascades, and RLS is enabled with the org-isolation + admin-read policies.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

INSERT INTO public.organizations (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a-syncrec');

INSERT INTO public.airtable_sync_log (id, org_id, sync_type, status, synced_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-1111-1111-1111-111111111111', 'airtable_poll', 'partial', now());

-- 1) RLS is enabled on the table
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.airtable_sync_record_log'::regclass),
  true,
  'RLS is enabled on airtable_sync_record_log');

-- 2) org_id is derived from the parent log by the trigger (insert WITHOUT org_id succeeds + is stamped)
INSERT INTO public.airtable_sync_record_log (sync_log_id, airtable_record_id, action, reason)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'recTEST1', 'held_unresolved', 'program ''X'' not linked');
SELECT is(
  (SELECT org_id FROM public.airtable_sync_record_log WHERE airtable_record_id = 'recTEST1'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'org_id is derived from the parent sync_log row');

-- 3) the action CHECK rejects an unknown action
SELECT throws_ok(
  $$ INSERT INTO public.airtable_sync_record_log (sync_log_id, action)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bogus') $$,
  '23514', NULL,
  'action CHECK rejects values outside the allowed set');

-- 4) the org-isolation policy exists
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE tablename = 'airtable_sync_record_log' AND policyname = 'org_isolation'),
  1, 'org_isolation policy exists');

-- 5) deleting the parent log cascades to its record rows
DELETE FROM public.airtable_sync_log WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SELECT is(
  (SELECT count(*)::int FROM public.airtable_sync_record_log WHERE airtable_record_id = 'recTEST1'),
  0, 'deleting the parent sync_log cascades to record logs');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/tests/db/airtable_sync_record_log.sql
git commit -m "test(db): pgTAP for airtable_sync_record_log RLS + org-derive + cascade

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Rewrite `airtable-poll/index.ts` (test-first with the German regression test)

**Files:**
- Create: `supabase/functions/airtable-poll/index.regression.test.ts`
- Modify: `supabase/functions/airtable-poll/index.ts`

- [ ] **Step 1: Write the failing regression test (German field names + key links)**

Create `supabase/functions/airtable-poll/index.regression.test.ts`:

```ts
/**
 * Regression test for the silent "success / 0 rows" import (spec §11).
 * Feeds the poll a fake Airtable page using the REAL German field names and the Phase-2
 * field map + catalog-link keys. Asserts linked records land, unlinked are held, and both
 * the summary log + per-record logs are written.
 */
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG = "00000000-0000-0000-0000-0000000000a1";

const FIELD_MAP = {
  date: "Datum",
  program: "Program",
  sub_program: "Sub-Programm",
  city: "City",
  venue: "Venue",
  session_1: "1. Show",
  session_2: "2. Show",
};

function airtableResponse(records: unknown[]) {
  return new Response(JSON.stringify({ records }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function seededDeps() {
  const showDateInserts: Record<string, unknown>[] = [];
  const recordLogInserts: unknown[] = [];
  const syncLogInserts: Record<string, unknown>[] = [];

  const records = [
    // linked: Sub-Programm "Candlelight Classics" matches a show airtable_program_key
    { id: "recLINKED", fields: { Datum: "2026-07-15", Program: "Candlelight", "Sub-Programm": "Candlelight Classics", City: "Berlin", "1. Show": "T19:00:00", "2. Show": "T21:30:00" } },
    // unlinked: no show has this key → held
    { id: "recHELD", fields: { Datum: "2026-07-16", Program: "Candlelight", "Sub-Programm": "Unmapped Program", City: "Berlin" } },
    // missing date → held
    { id: "recNODATE", fields: { Program: "Candlelight", "Sub-Programm": "Candlelight Classics" } },
  ];

  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        { when: { key: "airtable_sync_enabled" }, data: [{ org_id: ORG, value: true }] },
        { when: { key: "airtable_base_id" }, data: [{ org_id: ORG, value: "appABCDEFGHIJKLMNO" }] },
        { when: { key: "airtable_table_name" }, data: [{ org_id: ORG, value: "Events" }] },
        { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: FIELD_MAP }] },
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [{ id: "show-cc", airtable_program_key: "Candlelight Classics" }], error: null },
      cities: { data: [{ id: "city-berlin", airtable_city_key: "Berlin" }], error: null },
      show_dates: { data: [], error: null },
      // .insert(...).select('id').single() returns this id; .maybeSingle() (prev-log fetch) also returns it.
      airtable_sync_log: { data: { id: "log-1" }, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null } },
    fetchImpl: () => Promise.resolve(airtableResponse(records)) as Promise<Response>,
  });

  // Capture inserts for show_dates / record-log / sync-log.
  // deno-lint-ignore no-explicit-any
  const originalFrom = (deps.admin.from as any).bind(deps.admin);
  // deno-lint-ignore no-explicit-any
  (deps.admin as any).from = (table: string) => {
    const chain = originalFrom(table);
    if (table === "show_dates") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: Record<string, unknown>) => {
        showDateInserts.push(p);
        const c = orig(p);
        // give the inserted row a stable id for offer opening
        c.single = () => Promise.resolve({ data: { id: `sd-${p.airtable_record_id}` }, error: null });
        return c;
      };
    }
    if (table === "airtable_sync_record_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { recordLogInserts.push(p); return orig(p); };
    }
    if (table === "airtable_sync_log") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: Record<string, unknown>) => { syncLogInserts.push(p); return orig(p); };
    }
    return chain;
  };

  return { deps, invokeCalls, showDateInserts, recordLogInserts, syncLogInserts };
}

Deno.test("airtable-poll regression: German field names import linked rows + hold unlinked + write logs", async () => {
  const { deps, showDateInserts, recordLogInserts, syncLogInserts } = seededDeps();
  const res = await handle(makeRequest({ method: "POST", headers: { "X-Cron-Secret": "secret123" } }), deps);
  assertEquals(res.status, 200);

  // 1) the linked record imported into show_dates with the resolved show + city + parsed sessions
  assertEquals(showDateInserts.length, 1);
  const sd = showDateInserts[0];
  assertEquals(sd.show_id, "show-cc");
  assertEquals(sd.date, "2026-07-15");
  assertEquals(sd.airtable_record_id, "recLINKED");
  assertEquals(sd.city_id, "city-berlin");
  assertEquals(sd.session_1, "19:00");
  assertEquals(sd.session_2, "21:30");

  // 2) the summary log was written with correct counts + partial status (held > 0)
  assertEquals(syncLogInserts.length, 1);
  const log = syncLogInserts[0];
  assertEquals(log.org_id, ORG);
  assertEquals(log.status, "partial");
  assertEquals(log.imported_count, 1);
  assertEquals(log.new_count, 1);
  assertEquals(log.updated_count, 0);
  assertEquals(log.held_count, 2);

  // 3) per-record logs written for all three records with the right actions
  const rows = recordLogInserts[0] as Array<Record<string, unknown>>;
  assertEquals(rows.length, 3);
  const byId = Object.fromEntries(rows.map((r) => [r.airtable_record_id, r]));
  assertEquals(byId["recLINKED"].action, "imported_new");
  assertEquals(byId["recHELD"].action, "held_unresolved");
  assertEquals(byId["recHELD"].reason, "program 'Unmapped Program' not linked");
  assertEquals(byId["recNODATE"].action, "held_unresolved");
  assertEquals(byId["recNODATE"].reason, "missing date");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test --allow-all supabase/functions/airtable-poll/index.regression.test.ts`
Expected: FAIL — the current poll reads `Date`/`Show`, ignores the field map, and writes no record logs (e.g. `showDateInserts.length` is 0, no `airtable_sync_record_log` insert).

- [ ] **Step 3: Rewrite `index.ts`**

Replace the entire contents of `supabase/functions/airtable-poll/index.ts` with:

```ts
import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { getActiveOrgs, resolveOrgSetting } from "../_shared/settings.ts";
import { buildProgramKey, buildCityKey } from "../_shared/airtableKey.ts";

/** Max concurrent open-offer-tier invocations per batch to avoid exhausting the DB connection pool. */
const OFFER_TIER_BATCH_SIZE = 10;
const MAX_PAGES = 100;

/** Which Airtable field feeds each Showflow field (per-org, from app_settings.airtable_field_map). */
interface FieldMap {
  date?: string | null;
  program?: string | null;
  sub_program?: string | null;
  city?: string | null;
  venue?: string | null;
  session_1?: string | null;
  session_2?: string | null;
  session_3?: string | null;
}

type RecordAction = "imported_new" | "updated" | "held_unresolved" | "error";
interface RecordOutcome {
  airtable_record_id: string;
  action: RecordAction;
  show_date_id: string | null;
  reason: string | null;
  raw_fields: Record<string, unknown>;
}
interface OrgSyncResult { processed: number; new_dates: number; updated: number; held: number; tiers_opened: number }

/** Extract HH:MM from an Airtable time/ISO value; null when absent/unparseable. */
function parseTime(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).match(/T?(\d{2}:\d{2})(:\d{2})?/);
  return m ? m[1] : null;
}

async function openOfferTierBatch(deps: Deps, ids: string[]): Promise<number> {
  let opened = 0;
  for (let i = 0; i < ids.length; i += OFFER_TIER_BATCH_SIZE) {
    const batch = ids.slice(i, i + OFFER_TIER_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((id) => deps.invokeFunction("open-offer-tier", { show_date_id: id, tier: 1 })),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value.error) console.error("airtable-poll: open-offer-tier failed", { error: result.value.error });
        else opened += 1;
      } else {
        console.error("airtable-poll: open-offer-tier threw", { reason: result.reason });
      }
    }
  }
  return opened;
}

/** Notify org admins when the held set changes vs. the previous run. */
async function notifyAdminsIfHeldChanged(
  deps: Deps,
  orgId: string,
  syncLogId: string,
  heldIds: string[],
  prevHeldIds: Set<string>,
  prevHeldCount: number,
): Promise<void> {
  if (heldIds.length === 0) return;
  const hasNewHeld = heldIds.some((id) => !prevHeldIds.has(id));
  if (!hasNewHeld && heldIds.length <= prevHeldCount) return; // nothing newly broken

  const { data: admins } = await deps.admin.from("org_memberships").select("user_id").eq("org_id", orgId).eq("role", "admin");
  const recipients = Array.from(new Set((admins ?? []).map((a: { user_id: string }) => a.user_id)));
  if (recipients.length === 0) return;

  const message = `${heldIds.length} Airtable record(s) couldn't be matched and were held. Review the Last sync report in Settings → Airtable.`;
  await deps.admin.from("notifications").insert(recipients.map((uid) => ({
    org_id: orgId,
    user_id: uid,
    type: "airtable_sync_held",
    title: "Airtable sync: records held",
    message,
    related_entity_type: "airtable_sync_log",
    related_entity_id: syncLogId,
  })));
}

/** Sync one org's Airtable base into its show_dates using the field map + catalog-link keys.
 *  Resolution is STRICT: shows/cities resolve only by airtable_program_key / airtable_city_key;
 *  anything unlinked is held (city is non-fatal). org_id on show_dates / record logs comes from
 *  derive triggers. Throws on Airtable API error (after logging) so handle() skips counting it. */
async function syncOrg(deps: Deps, orgId: string, baseId: string, tableName: string, apiKey: string, fieldMap: FieldMap): Promise<OrgSyncResult> {
  const admin = deps.admin;

  // ── Linked-catalog lookup maps (key → id). No name fallback, no lowercasing. ──
  const { data: shows } = await admin.from("shows").select("id, airtable_program_key").eq("org_id", orgId).limit(10000);
  const showByKey = new Map<string, string>();
  for (const s of (shows ?? []) as Array<{ id: string; airtable_program_key: string | null }>) {
    if (s.airtable_program_key) showByKey.set(s.airtable_program_key, s.id);
  }
  const { data: citiesRows } = await admin.from("cities").select("id, airtable_city_key").eq("org_id", orgId).limit(10000);
  const cityByKey = new Map<string, string>();
  for (const c of (citiesRows ?? []) as Array<{ id: string; airtable_city_key: string | null }>) {
    if (c.airtable_city_key) cityByKey.set(c.airtable_city_key, c.id);
  }

  // Existing show_dates keyed by airtable_record_id (paginated to clear PostgREST's 1000-row cap).
  const existingByAirtableId = new Map<string, string>();
  {
    const PAGE_SIZE = 1000;
    let page = 0;
    while (true) {
      const { data: batch } = await admin
        .from("show_dates").select("id, airtable_record_id")
        .eq("org_id", orgId).not("airtable_record_id", "is", null)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (!batch || batch.length === 0) break;
      for (const r of batch as Array<{ id: string; airtable_record_id: string | null }>) {
        if (r.airtable_record_id) existingByAirtableId.set(r.airtable_record_id, r.id);
      }
      if (batch.length < PAGE_SIZE) break;
      page += 1;
    }
  }

  // ── Page through Airtable, classify each record ───────────────────────────
  const encodedTable = encodeURIComponent(tableName);
  const airtableBaseUrl = `https://api.airtable.com/v0/${baseId}/${encodedTable}?view=Grid%20view`;
  const outcomes: RecordOutcome[] = [];
  const newDateIds: string[] = [];
  let processed = 0, newDates = 0, updated = 0, held = 0, recordsSeen = 0;
  let offset: string | undefined;
  let pageCount = 0;
  let apiError: string | null = null;

  do {
    pageCount += 1;
    const url = offset ? `${airtableBaseUrl}&offset=${encodeURIComponent(offset)}` : airtableBaseUrl;
    const res = await deps.fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      apiError = `Airtable API error ${res.status}: ${body}`;
      console.error("airtable-poll: Airtable API error", { org: orgId, status: res.status, body });
      break;
    }
    const pageData = await res.json();
    offset = pageData.offset;
    for (const record of (pageData.records ?? []) as Array<{ id: string; fields: Record<string, unknown> }>) {
      recordsSeen += 1;
      const fields = record.fields;
      const id = record.id;

      const dateValue = fieldMap.date ? fields[fieldMap.date] ?? null : null;
      if (!dateValue) { held += 1; outcomes.push({ airtable_record_id: id, action: "held_unresolved", show_date_id: null, reason: "missing date", raw_fields: fields }); continue; }

      const subProgramValue = fieldMap.sub_program ? fields[fieldMap.sub_program] ?? null : null;
      const programKey = buildProgramKey(null, subProgramValue == null ? null : String(subProgramValue));
      const showId = programKey ? showByKey.get(programKey) ?? null : null;
      if (!showId) { held += 1; outcomes.push({ airtable_record_id: id, action: "held_unresolved", show_date_id: null, reason: `program '${subProgramValue ?? ""}' not linked`, raw_fields: fields }); continue; }

      const cityValue = fieldMap.city ? fields[fieldMap.city] ?? null : null;
      const cityKey = buildCityKey(cityValue == null ? null : String(cityValue));
      const cityId = cityKey ? cityByKey.get(cityKey) ?? null : null;
      const cityNote = cityValue && !cityId ? `city '${cityValue}' not linked` : null;

      const session1 = fieldMap.session_1 ? parseTime(fields[fieldMap.session_1]) : null;
      const session2 = fieldMap.session_2 ? parseTime(fields[fieldMap.session_2]) : null;
      const session3 = fieldMap.session_3 ? parseTime(fields[fieldMap.session_3]) : null;
      const venue = fieldMap.venue ? (fields[fieldMap.venue] ?? null) : null;

      const existingId = existingByAirtableId.get(id);
      if (existingId) {
        const payload: Record<string, unknown> = { date: dateValue };
        if (session1 !== null) payload.session_1 = session1;
        if (session2 !== null) payload.session_2 = session2;
        if (session3 !== null) payload.session_3 = session3;
        if (venue !== null) payload.venue = venue;
        if (cityId !== null) payload.city_id = cityId;
        const { error } = await admin.from("show_dates").update(payload).eq("id", existingId);
        if (error) { outcomes.push({ airtable_record_id: id, action: "error", show_date_id: existingId, reason: error.message, raw_fields: fields }); continue; }
        processed += 1; updated += 1;
        outcomes.push({ airtable_record_id: id, action: "updated", show_date_id: existingId, reason: cityNote, raw_fields: fields });
        continue;
      }

      // org_id is set by the derive trigger from show_id. session_1 is NOT NULL → default 00:00.
      const insertPayload: Record<string, unknown> = { show_id: showId, date: dateValue, airtable_record_id: id, city_id: cityId, session_1: session1 ?? "00:00" };
      if (session2 !== null) insertPayload.session_2 = session2;
      if (session3 !== null) insertPayload.session_3 = session3;
      if (venue !== null) insertPayload.venue = venue;
      const { data: inserted, error: insertErr } = await admin.from("show_dates").insert(insertPayload).select("id").single();
      if (insertErr || !inserted?.id) { outcomes.push({ airtable_record_id: id, action: "error", show_date_id: null, reason: insertErr?.message ?? "insert returned no id", raw_fields: fields }); continue; }
      processed += 1; newDates += 1;
      newDateIds.push(inserted.id);
      existingByAirtableId.set(id, inserted.id);
      outcomes.push({ airtable_record_id: id, action: "imported_new", show_date_id: inserted.id, reason: cityNote, raw_fields: fields });
    }
  } while (!apiError && offset && pageCount < MAX_PAGES);

  const truncated = pageCount >= MAX_PAGES && !!offset;
  if (truncated) console.warn("airtable-poll: reached MAX_PAGES limit; sync may be incomplete", { org: orgId });

  // Flush tier-1 offers for new dates (resilient batch).
  const tiersOpened = await openOfferTierBatch(deps, newDateIds);
  const tiersFailed = newDateIds.length - tiersOpened;

  // Previous run's held set (fetched BEFORE inserting this run's log) for change-only notify.
  const { data: prevLog } = await admin
    .from("airtable_sync_log").select("id, held_count")
    .eq("org_id", orgId).eq("sync_type", "airtable_poll")
    .order("synced_at", { ascending: false }).limit(1).maybeSingle();
  let prevHeldIds = new Set<string>();
  let prevHeldCount = 0;
  if (prevLog?.id) {
    prevHeldCount = (prevLog.held_count as number | null) ?? 0;
    const { data: prevHeld } = await admin
      .from("airtable_sync_record_log").select("airtable_record_id")
      .eq("sync_log_id", prevLog.id).eq("action", "held_unresolved");
    prevHeldIds = new Set((prevHeld ?? []).map((r: { airtable_record_id: string | null }) => r.airtable_record_id ?? ""));
  }

  const status = apiError ? "error" : (held > 0 ? "partial" : "success");
  const parts: string[] = [];
  if (apiError) parts.push(apiError);
  if (truncated) parts.push(`Reached MAX_PAGES (${MAX_PAGES}); sync is incomplete`);
  if (tiersFailed > 0) parts.push(`${tiersFailed} of ${newDateIds.length} open-offer-tier calls failed`);
  if (held > 0) parts.push(`${held} record(s) held (unresolved)`);

  const { data: logRow } = await admin.from("airtable_sync_log").insert({
    org_id: orgId,
    sync_type: "airtable_poll",
    status,
    records_processed: processed,
    imported_count: processed,
    new_count: newDates,
    updated_count: updated,
    held_count: held,
    details: { truncated, new: newDates, updated, held, records_seen: recordsSeen },
    error_details: parts.length ? parts.join("; ") : null,
    synced_at: deps.now().toISOString(),
  }).select("id").single();
  const syncLogId = (logRow as { id?: string } | null)?.id ?? null;

  const heldIds = outcomes.filter((o) => o.action === "held_unresolved").map((o) => o.airtable_record_id);
  if (syncLogId && outcomes.length) {
    await admin.from("airtable_sync_record_log").insert(outcomes.map((o) => ({
      sync_log_id: syncLogId,
      airtable_record_id: o.airtable_record_id,
      action: o.action,
      show_date_id: o.show_date_id,
      reason: o.reason,
      raw_fields: o.raw_fields,
    })));
    await notifyAdminsIfHeldChanged(deps, orgId, syncLogId, heldIds, prevHeldIds, prevHeldCount);
  }

  if (apiError) {
    throw { httpStatus: 502, body: { error: apiError, org_id: orgId, new_dates: newDates, tiers_opened: tiersOpened } };
  }
  return { processed, new_dates: newDates, updated, held, tiers_opened: tiersOpened };
}

/**
 * Polls Airtable per ACTIVE org, resolving records against the org's field map + catalog-link keys,
 * upserting show_dates, logging every record's outcome, and opening tier-1 offers for new dates.
 *
 * Per active org it resolves (org override ?? platform default): airtable_sync_enabled,
 * airtable_base_id, airtable_table_name, airtable_field_map; and the Vault key via get_org_airtable_key.
 * An enabled-but-misconfigured org (bad base / missing base|table|key) leaves a visible error log row.
 * Disabled orgs are skipped silently. One org's failure never aborts the others.
 *
 * Auth: X-Cron-Secret header (pg_cron, platform cron_secret row). Cron-only — no user JWT.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  const admin = deps.admin;

  const cronSecretHeader = req.headers.get("X-Cron-Secret");
  if (!cronSecretHeader) return json({ error: "Unauthorized" }, 401);
  const { data: secretSetting } = await admin
    .from("app_settings").select("value").eq("key", "cron_secret").is("org_id", null).maybeSingle();
  if (cronSecretHeader !== ((secretSetting?.value as string | null) ?? "")) return json({ error: "Unauthorized" }, 401);

  let orgs: Array<{ id: string }>;
  try {
    orgs = await getActiveOrgs(admin);
  } catch (e) {
    console.error("airtable-poll: failed to fetch active orgs", { error: (e as Error).message });
    return json({ error: "failed to fetch active orgs" }, 500);
  }

  const totals = { orgs_synced: 0, processed: 0, new_dates: 0, updated: 0, held: 0, tiers_opened: 0 };

  for (const org of orgs) {
    try {
      const enabled = await resolveOrgSetting<boolean>(admin, org.id, "airtable_sync_enabled", false);
      if (!enabled) continue; // intentionally off → skip silently

      const baseId = await resolveOrgSetting<string | null>(admin, org.id, "airtable_base_id", null);
      const tableName = await resolveOrgSetting<string | null>(admin, org.id, "airtable_table_name", null);
      const fieldMap = await resolveOrgSetting<FieldMap>(admin, org.id, "airtable_field_map", {});

      const logMisconfig = (detail: string) =>
        admin.from("airtable_sync_log").insert({ org_id: org.id, sync_type: "airtable_poll", status: "error", records_processed: 0, imported_count: 0, new_count: 0, updated_count: 0, held_count: 0, error_details: detail, synced_at: deps.now().toISOString() });

      if (!baseId || !tableName) { await logMisconfig("Airtable sync enabled but base_id or table_name is not configured"); continue; }
      if (!/^app[A-Za-z0-9]{14,}$/.test(baseId)) { await logMisconfig("airtable_base_id has unexpected format; expected app + 14 alphanumeric chars"); continue; }
      if (!fieldMap?.date || !fieldMap?.sub_program) { await logMisconfig("Airtable field map incomplete: 'date' and 'sub_program' must be mapped"); continue; }

      const { data: apiKey } = await admin.rpc("get_org_airtable_key", { _org: org.id });
      if (!apiKey) { await logMisconfig("Airtable sync enabled but no API key is configured in the Vault"); continue; }

      const r = await syncOrg(deps, org.id, baseId, tableName, apiKey as string, fieldMap);
      totals.orgs_synced += 1;
      totals.processed += r.processed;
      totals.new_dates += r.new_dates;
      totals.updated += r.updated;
      totals.held += r.held;
      totals.tiers_opened += r.tiers_opened;
    } catch (e) {
      console.error("airtable-poll: org sync failed", { org: org.id, error: (e as { body?: unknown })?.body ?? (e as Error).message });
      // continue; any sync_log row was already written inside syncOrg / the misconfig guards.
    }
  }

  return json(totals);
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 4: Run the regression test to verify it passes**

Run: `deno test --allow-all supabase/functions/airtable-poll/index.regression.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/airtable-poll/index.ts supabase/functions/airtable-poll/index.regression.test.ts
git commit -m "feat(airtable-poll): field-map + key resolution, per-record logging, change-only notify

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Update the existing poll tests to the new contract

The old tests seed English fields (`Date`/`Show`) and assert name-based resolution + the old totals shape (`skipped`). The new contract uses a field map + `airtable_program_key`, totals `{ orgs_synced, processed, new_dates, updated, held, tiers_opened }`, and `show_dates` inserts no longer carry name-derived show ids.

**Files:**
- Modify: `supabase/functions/airtable-poll/index.di.test.ts`
- Modify: `supabase/functions/airtable-poll/index.test.ts`
- Modify: `supabase/functions/airtable-poll/index.org.test.ts`

- [ ] **Step 1: Read the three test files**

Run: `ls -la supabase/functions/airtable-poll/` then open each. Identify every place that (a) seeds `shows` with `program`/`sub_program`, (b) puts `Date`/`Show`/`Sub Program`/`City`/`Session 1` on a record, (c) asserts `body.skipped`, or (d) relies on the program-only fallback.

- [ ] **Step 2: Update `index.di.test.ts` — the shared helpers + each test**

In `makeHappyDeps` (and the inline-seeded tests), change:
- `ENABLED_SETTINGS` → add a field-map row:
  ```ts
  { when: { key: "airtable_field_map" }, data: [{ org_id: ORG, value: { date: "Date", sub_program: "SubProgram", city: "City", session_1: "Session 1", session_2: "Session 2" } }] },
  ```
- `shows` seed → key-based: `{ data: [{ id: "show-uuid-1", airtable_program_key: "TestShow" }], error: null }`.
- `cities` seed → `{ data: [{ id: "city-uuid-berlin", airtable_city_key: "Berlin" }], error: null }`.
- `airtable_sync_log` seed → `{ data: { id: "log-1" }, error: null }` (insert now does `.select('id').single()`), and add `airtable_sync_record_log: { data: [], error: null }`, `org_memberships: { data: [], error: null }`, `notifications: { data: null, error: null }`.
- Records: replace `Show: "TestShow"` with `SubProgram: "TestShow"` (and drop `"Sub Program"`), keep `Date`/`City`/`Session 1`.

Then per-test:
- **"maps Date/Show/City/Session fields…"**: the inserted `show_id` is now `"show-uuid-1"` (resolved by `airtable_program_key`), `session_1` `"19:30"`, `city_id` `"city-uuid-berlin"`, `airtable_record_id` `"recABC123"`, and `"org_id" in payload === false`. Rename `Show`→`SubProgram` in the record. Keep these assertions.
- **"accepts alternate field name variants"**: this test exercised hardcoded lowercase fallbacks that no longer exist. **Delete it** (the field map now defines exact names; variant fallback is intentionally gone).
- **"session_1 defaults to 00:00 when field missing"**: keep — record omits `Session 1`; assert `payload.session_1 === "00:00"`. Ensure the record still maps a show via `SubProgram: "TestShow"`.
- **"city_id is null when city not in DB"**: record `City: "Atlantis"`; assert `payload.city_id === null`. Keep.
- **"record without Date field is skipped entirely"**: rename to **"record without Date field is held, not inserted"**; the no-date record is now `held_unresolved` (no insert). Assert `insertedPayloads.length === 1` (only the dated record) and that the dated record inserted. (Inserts, not skips — same count assertion holds.)
- **"resolves show by (program, sub_program) key — exact match wins"** and **"falls back to program-only match…"**: these test the retired name-matching grain. **Delete both** (replaced by Task 4's regression test, which asserts key-based resolution).
- **"unresolvable show → record skipped, skipped count in totals"**: rename to **"unresolvable show → record held, held count in totals"**. Record `SubProgram: "UnknownShow"` (no linked show) + `SubProgram: "TestShow"` (linked). Assert `insertedPayloads.length === 1` and `body.held === 1` (was `body.skipped`).
- **"new date → invokeFunction(open-offer-tier…)"**: unchanged logic; record uses `SubProgram: "TestShow"`. Keep the single() override returning `{ id: "new-date-uuid-001" }`. Assert `body.new_dates === 1`, the offer call, `body.tiers_opened === 1`.
- **"existing date → update only…"**: record `SubProgram: "TestShow"`, `existingShowDates: [{ id: "existing-uuid-001", airtable_record_id: "recEXISTING" }]`. Assert `body.new_dates === 0`, no offer calls, update payload has `date`. (`session_1` is now only set when mapped & parseable — the record has no `Session 1`, so do **not** assert `session_1` is present on the update payload; assert `updatePayload.date === "2026-07-20"`.)
- **"totals contain all required fields on success (0 records)"**: update the asserted shape to `{ orgs_synced, processed, new_dates, updated, held, tiers_opened }` (replace `skipped` with `updated` + `held`), all `0` except `orgs_synced === 1`.
- **Airtable API error tests** and **sync_log success/error row tests**: keep. Add `airtable_sync_record_log`, `org_memberships`, `notifications` seeds. The success-row test now also asserts `logRow.imported_count === 0`, `logRow.held_count === 0`, `logRow.status === "success"`. The bad-base test still asserts a single error row with `org_id` + `error_details`.
- **"synced_at uses deps.now()"**: keep (add the new seeds).

- [ ] **Step 3: Update `index.test.ts` and `index.org.test.ts`**

Open both. `index.test.ts` is a contract/model test (`applyAirtablePollContract`) — update its model so resolution is key-based (field map + `airtable_program_key`) and the outcome vocabulary is `imported_new`/`updated`/`held_unresolved` rather than "skipped". `index.org.test.ts` exercises multi-org skip/log paths — update its `shows`/`cities`/settings seeds to the key-based + field-map shape and add the `airtable_sync_log: { data: { id } }`, `airtable_sync_record_log`, `org_memberships`, `notifications` seeds. Keep their structural assertions (per-org isolation, a log row per active org).

- [ ] **Step 4: Run the whole poll test suite**

Run: `deno test --allow-all supabase/functions/airtable-poll/`
Expected: PASS (regression + all updated tests; deleted tests gone).

- [ ] **Step 5: Run the shared-module tests too (no regressions)**

Run: `deno test --allow-all supabase/functions/_shared/ supabase/functions/airtable-poll/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/airtable-poll/index.di.test.ts supabase/functions/airtable-poll/index.test.ts supabase/functions/airtable-poll/index.org.test.ts
git commit -m "test(airtable-poll): update suite to field-map/key contract + record logs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Report data-access functions

**Files:**
- Create: `src/data/airtableSync.ts`
- Create: `src/data/airtableSync.test.ts`

- [ ] **Step 1: Write the failing data-fn test**

Create `src/data/airtableSync.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchLatestSyncLog, fetchHeldRecords } from "./airtableSync";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const asClient = (f: ReturnType<typeof createFakeSupabase>) => f as unknown as SupabaseClient<Database>;

describe("airtableSync data fns", () => {
  it("fetchLatestSyncLog returns null when there is no row", async () => {
    const fake = createFakeSupabase({ airtable_sync_log: { data: null, error: null } });
    expect(await fetchLatestSyncLog(asClient(fake), "org-1")).toBeNull();
  });

  it("fetchLatestSyncLog returns the most recent log row", async () => {
    const row = { id: "log-1", status: "partial", imported_count: 3, new_count: 2, updated_count: 1, held_count: 4, synced_at: "2026-06-17T10:00:00Z" };
    const fake = createFakeSupabase({ airtable_sync_log: { data: row, error: null } });
    const out = await fetchLatestSyncLog(asClient(fake), "org-1");
    expect(out?.id).toBe("log-1");
    expect(out?.held_count).toBe(4);
  });

  it("fetchHeldRecords returns only the held rows for a log", async () => {
    const held = [{ id: "r1", airtable_record_id: "recA", reason: "program 'X' not linked", created_at: "2026-06-17T10:00:00Z", raw_fields: {} }];
    const fake = createFakeSupabase({ airtable_sync_record_log: { data: held, error: null } });
    const out = await fetchHeldRecords(asClient(fake), "log-1");
    expect(out).toHaveLength(1);
    expect(out[0].airtable_record_id).toBe("recA");
  });

  it("fetchHeldRecords returns [] when syncLogId is null", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchHeldRecords(asClient(fake), null)).toEqual([]);
  });
});
```

- [ ] **Step 2: (Cannot run vitest locally — no Node.)** Skip running; CI runs it. Proceed to implement.

- [ ] **Step 3: Write the implementation**

Create `src/data/airtableSync.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface SyncLogSummary {
  id: string;
  status: string;
  imported_count: number | null;
  new_count: number | null;
  updated_count: number | null;
  held_count: number | null;
  error_details: string | null;
  synced_at: string;
}

export interface HeldRecord {
  id: string;
  airtable_record_id: string | null;
  reason: string | null;
  created_at: string;
}

/** The org's most recent airtable_sync_log row, or null if it has never synced. */
export async function fetchLatestSyncLog(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<SyncLogSummary | null> {
  if (!orgId) return null;
  const { data, error } = await client
    .from("airtable_sync_log")
    .select("id, status, imported_count, new_count, updated_count, held_count, error_details, synced_at")
    .eq("org_id", orgId).eq("sync_type", "airtable_poll")
    .order("synced_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return (data ?? null) as SyncLogSummary | null;
}

/** Held (unresolved) records for a given sync-log run, newest first. */
export async function fetchHeldRecords(
  client: SupabaseClient<Database>,
  syncLogId: string | null,
): Promise<HeldRecord[]> {
  if (!syncLogId) return [];
  const { data, error } = await client
    .from("airtable_sync_record_log")
    .select("id, airtable_record_id, reason, created_at")
    .eq("sync_log_id", syncLogId).eq("action", "held_unresolved")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as HeldRecord[];
}
```

- [ ] **Step 4: Commit**

```bash
git add src/data/airtableSync.ts src/data/airtableSync.test.ts
git commit -m "feat(airtable): data fns for the last-sync report

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: "Last sync report" section in `AirtableSyncTab`

**Files:**
- Modify: `src/components/settings/AirtableSyncTab.tsx`
- Modify: `src/components/settings/AirtableSyncTab.test.tsx`

- [ ] **Step 1: Add the failing component test**

In `AirtableSyncTab.test.tsx`, add a mock for the new data module at the top (beside the others):

```ts
vi.mock("@/data/airtableSync", () => ({
  fetchLatestSyncLog: vi.fn(),
  fetchHeldRecords: vi.fn(),
}));
```

Add the import and two tests:

```ts
import { fetchLatestSyncLog, fetchHeldRecords } from "@/data/airtableSync";

describe("AirtableSyncTab — last sync report", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders summary counts and held records from the latest log", async () => {
    (fetchLatestSyncLog as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "log-1", status: "partial", imported_count: 3, new_count: 2, updated_count: 1, held_count: 1, error_details: null, synced_at: "2026-06-17T10:00:00Z",
    });
    (fetchHeldRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "r1", airtable_record_id: "recHELD", reason: "program 'X' not linked", created_at: "2026-06-17T10:00:00Z" },
    ]);
    renderTab();
    expect(await screen.findByText("Last sync report")).toBeInTheDocument();
    expect(await screen.findByText("program 'X' not linked")).toBeInTheDocument();
    expect(screen.getByText("recHELD")).toBeInTheDocument();
  });

  it("shows an empty state when the org has never synced", async () => {
    (fetchLatestSyncLog as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (fetchHeldRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText(/No sync has run yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: (Cannot run vitest locally.)** Proceed to implement; CI runs it.

- [ ] **Step 3: Implement the report section**

In `AirtableSyncTab.tsx`:

(a) Add imports near the others:

```ts
import { fetchLatestSyncLog, fetchHeldRecords } from "@/data/airtableSync";
```

(b) Inside the component (after `citiesQ`), add the queries:

```ts
  // ── Last sync report ────────────────────────────────────────────────────────
  const syncLogQ = useQuery({ queryKey: ["airtable", "sync-log", orgId], enabled: !!orgId, queryFn: () => fetchLatestSyncLog(supabase, orgId) });
  const heldQ = useQuery({
    queryKey: ["airtable", "held", syncLogQ.data?.id ?? null],
    enabled: !!syncLogQ.data?.id,
    queryFn: () => fetchHeldRecords(supabase, syncLogQ.data?.id ?? null),
  });
  const baseId = get("airtable_base_id", "") as string;
  const recordUrl = (recId: string) => (baseId ? `https://airtable.com/${baseId}/${recId}` : undefined);
```

(c) Add a new `<Card>` as the LAST child inside the top-level `<div className="space-y-6">` (after the Catalog links card, before the closing `</div>`):

```tsx
      {/* ── Last sync report ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Last sync report</CardTitle>
          <CardDescription>The most recent Airtable poll. Held records were not matched to a linked program — link the option above and they import on the next run.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!syncLogQ.data ? (
            <p className="text-sm text-muted-foreground">No sync has run yet for this organization.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-4 text-sm">
                <div><span className="text-muted-foreground">Status </span><Badge variant={syncLogQ.data.status === "success" ? "secondary" : "outline"}>{syncLogQ.data.status}</Badge></div>
                <div><span className="text-muted-foreground">Imported </span><strong>{syncLogQ.data.imported_count ?? 0}</strong></div>
                <div><span className="text-muted-foreground">New </span><strong>{syncLogQ.data.new_count ?? 0}</strong></div>
                <div><span className="text-muted-foreground">Updated </span><strong>{syncLogQ.data.updated_count ?? 0}</strong></div>
                <div><span className="text-muted-foreground">Held </span><strong>{syncLogQ.data.held_count ?? 0}</strong></div>
              </div>
              {(heldQ.data ?? []).length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-display font-semibold text-sm">Held records</h4>
                  {(heldQ.data ?? []).map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 border-t border-border pt-2 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.reason ?? "Unresolved"}</div>
                        <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                      </div>
                      {r.airtable_record_id && (
                        recordUrl(r.airtable_record_id)
                          ? <a className="text-xs underline shrink-0" href={recordUrl(r.airtable_record_id)} target="_blank" rel="noreferrer">{r.airtable_record_id}</a>
                          : <span className="text-xs text-muted-foreground shrink-0">{r.airtable_record_id}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/AirtableSyncTab.tsx src/components/settings/AirtableSyncTab.test.tsx
git commit -m "feat(settings): last-sync report (counts + held records) in AirtableSyncTab

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Final verification + PR

- [ ] **Step 1: Full Deno suite**

Run: `deno test --allow-all supabase/functions/`
Expected: PASS (no regressions in other functions — only `airtable-poll` + `_shared/airtableKey` changed).

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin claude/airtable-poll-phase3
gh pr create --base main --title "Airtable sync Phase 3 — airtable-poll rewrite (fixes silent 0-row import)" --body "$(cat <<'EOF'
## Summary
Rewrites `airtable-poll` to consume the Phase-2 field map + catalog-link keys, resolve shows/cities strictly by `airtable_program_key`/`airtable_city_key`, log every record's outcome, and surface a "Last sync report" in Settings → Airtable. Kills the silent `success / 0 rows` import.

- Single-source link-key helper (`_shared/airtableKey.ts`), re-exported by the UI (ADR-0010 parity).
- New `airtable_sync_record_log` + extended `airtable_sync_log` (counts + details), with org-derive trigger, RLS, indexes, and pgTAP.
- Strict key-only resolution; unlinked → held (city non-fatal). Change-only admin notification.
- German-field-names regression test (the test for today's silent no-op).

Spec: `docs/superpowers/specs/2026-06-17-airtable-poll-phase3-design.md`

## Verification
- Deno: `deno test --allow-all supabase/functions/airtable-poll/ supabase/functions/_shared/` — green.
- CI: frontend Typecheck/Unit/Lint (incl. cross-boundary re-export + new tests), pgTAP (`airtable_sync_record_log`).
- Migration applied via Supabase MCP; types regenerated.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Watch CI**

Run: `gh pr checks --watch`
Expected: all checks (Typecheck, Unit, Lint, E2E, pgTAP, Deno) green. If a check flakes on a network blip, re-check actual states before concluding it's red.

- [ ] **Step 4: Post-merge end-to-end sanity (live German base)**

After merge, trigger a poll (Settings → Airtable, or invoke the function) and verify via the Supabase MCP `execute_sql`:
```sql
SELECT status, imported_count, new_count, held_count
FROM airtable_sync_log WHERE sync_type = 'airtable_poll' ORDER BY synced_at DESC LIMIT 1;
```
Expected: non-zero `imported_count` (the silent 0-row outcome is gone); any unresolved records show as `held_unresolved` in `airtable_sync_record_log` and in the report UI.

---

## Self-Review notes (addressed)

- **Spec coverage:** §5 data model → Task 2/3; §9 poll algorithm → Task 4; §8.4 report → Task 6/7; §10 edge cases (misconfig logs, API error, renamed option held, string-name match, MAX_PAGES) → Task 4; §11 tests (Deno regression, pgTAP, unit, component) → Tasks 4/3/1/7. ADR-0010 parity → Task 1 single source + Task 4 `buildProgramKey(null, sub_program)` call.
- **Type consistency:** totals shape `{ orgs_synced, processed, new_dates, updated, held, tiers_opened }` is used identically in `syncOrg`/`handle` (Task 4) and asserted in Task 5. `RecordOutcome.action` ∈ the CHECK set (Task 2). Data-fn types (`SyncLogSummary`/`HeldRecord`, Task 6) match the columns rendered in Task 7.
- **No placeholders:** every code step is complete; the only deferred value is the migration `<version>` (resolved from `list_migrations` in Task 2 Step 2, as the environment requires).
