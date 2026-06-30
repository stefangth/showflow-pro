# resolveOrgSetting null-row passthrough fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `resolveOrgSetting` (edge + frontend) and `get_org_setting()` (SQL) so a row whose `value` is the JSONB literal `null` falls through to the next resolution tier (org row → platform row → typed fallback) instead of being returned as-is.

**Architecture:** Same one-line logic fix applied identically in three places that intentionally mirror each other: pick the first candidate row whose `value` is not `null`/`undefined`, else use the typed fallback (TS) or SQL `NULL` (SQL function, caller coalesces). No signature changes, no new abstractions — this is a targeted correctness fix to existing, already-tested resolution logic.

**Tech Stack:** Deno (edge function + `Deno.test`), TypeScript/Vitest (frontend), PostgreSQL/pgTAP (`get_org_setting` + `supabase/tests/rls/per_org_settings.sql`), Supabase migration tool.

## Global Constraints

- **Test-first per layer** — write the failing regression test before the implementation change (CLAUDE.md "Testing").
- **Tests import the real module** — never re-implement `resolveOrgSetting`/`get_org_setting` logic inside a test file.
- **Never hand-edit `supabase/migrations/`** — schema changes go through the migration tool (`apply_migration` MCP). After applying, mirror the exact SQL into a new file in `supabase/migrations/` named with the tool's real returned version timestamp (established project pattern — `apply_migration` stamps the live timestamp as the version regardless of the name argument).
- **Never hand-edit `src/integrations/supabase/types.ts`.**
- **Commit messages:** imperative, lowercase, ≤72 chars.
- **Branch:** this worktree's current branch (`claude/priceless-bardeen-8ca4b1`) is already even with `origin/main` (verified via `git fetch origin main` — both at `ef7cfae`). Develop directly on it; no new branch needed.
- **Docker is not running in this sandbox** → `supabase test db` (pgTAP) cannot be executed locally. Write the pgTAP regression test (Task 3) for CI, and additionally verify the SQL fix directly against the live project with `execute_sql` wrapped in `BEGIN; ... ROLLBACK;` so no test data persists.
- **`apply_migration` mutates the live Supabase project directly** (single project `epweartpzwvcasrzyueh`, no dev branch exists) — this is a low-risk additive `WHERE` clause on a `SECURITY DEFINER` function, but confirm with the user before running it, per the project's care-with-irreversible-actions norm.
- Frontend tests run via `npx vitest run <file>` (run `npm install` first since `node_modules` is absent in this worktree). Edge tests run via `deno test --allow-all --node-modules-dir=none supabase/functions/` (the **whole** suite, not just the touched file — a single-file run has previously hidden a regression elsewhere in the suite).

---

### Task 1: Edge function — `supabase/functions/_shared/settings.ts`

**Files:**
- Modify: `supabase/functions/_shared/settings.ts:36-39`
- Test: `supabase/functions/_shared/settings.test.ts`

**Interfaces:**
- Consumes: nothing new — `resolveOrgSetting<T>(admin, orgId, key, fallback): Promise<T>` keeps its existing signature.
- Produces: same signature, corrected null-row semantics. Consumed unchanged by `airtable-poll`, `send-offer-digest`, `send-confirmation-digest`, `send-transactional-email`.

- [ ] **Step 1: Write the failing tests**

In `supabase/functions/_shared/settings.test.ts`, insert two new `Deno.test` blocks between the existing `"falls back to the platform default when no org row"` test (ends line 34) and the `"returns the fallback when neither row exists"` test (starts line 36):

```ts
Deno.test("resolveOrgSetting: a null-valued org row falls through to the platform default", async () => {
  const admin = adminWith({
    app_settings: [{
      when: { key: "offer_digest_hour_berlin" },
      data: [{ org_id: ORG_A, value: null }, { org_id: null, value: 19 }],
    }],
  });
  assertEquals(await resolveOrgSetting<number>(admin, ORG_A, "offer_digest_hour_berlin", 0), 19);
});

Deno.test("resolveOrgSetting: a null-valued platform row falls through to the fallback", async () => {
  const admin = adminWith({
    app_settings: [{
      when: { key: "offer_digest_hour_berlin" },
      data: [{ org_id: null, value: null }],
    }],
  });
  assertEquals(await resolveOrgSetting<number>(admin, ORG_A, "offer_digest_hour_berlin", 48), 48);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/settings.test.ts`
Expected: FAIL — both new tests report `19 !== null` / `48 !== null` (the current `chosen ? chosen.value : fallback` returns the null-valued row's `value`, i.e. `null`, instead of falling through).

- [ ] **Step 3: Implement the minimal fix**

In `supabase/functions/_shared/settings.ts`, replace lines 36-39:

```ts
  const orgRow = orgId ? rows.find((r) => r.org_id === orgId) : undefined;
  const platformRow = rows.find((r) => r.org_id === null);
  const chosen = orgRow ?? platformRow;
  return chosen ? (chosen.value as T) : fallback;
```

with:

```ts
  const orgRow = orgId ? rows.find((r) => r.org_id === orgId) : undefined;
  const platformRow = rows.find((r) => r.org_id === null);
  // A JSONB-null-valued row (org override or platform default) is not a "real"
  // value — fall through to the next tier instead of returning null.
  const chosen = [orgRow, platformRow].find((r) => r && r.value != null);
  return chosen ? (chosen.value as T) : fallback;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/settings.test.ts`
Expected: PASS (7 tests: 5 existing + 2 new).

Then run the whole edge-function suite to catch any cross-file regression:
Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS, no new failures.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/settings.ts supabase/functions/_shared/settings.test.ts
git commit -m "fix: resolveOrgSetting falls through null-valued rows (edge)"
```

---

### Task 2: Frontend — `src/data/settings.ts`

**Files:**
- Modify: `src/data/settings.ts:46-50`
- Test: `src/data/settings.test.ts`

**Interfaces:**
- Consumes: nothing new — `resolveOrgSetting<T>(client, orgId, key, fallback): Promise<T>` keeps its existing signature.
- Produces: same signature, corrected null-row semantics. Consumed unchanged by `SettingsPage` and any other caller of this export.

- [ ] **Step 1: Write the failing tests**

In `src/data/settings.test.ts`, inside `describe("resolveOrgSetting", ...)`, insert two new `it` blocks between the `"falls back to the platform default (org_id null) when no override"` test (ends line 69) and the `"returns the fallback when no row matches"` test (starts line 71):

```ts
  it("falls through to the platform default when the org row is null-valued", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: "o1", value: null }, { org_id: null, value: "plat" }], error: null },
    });
    expect(await resolveOrgSetting(fake as never, "o1", "k", "def")).toBe("plat");
  });

  it("falls through to the fallback when the platform row is null-valued and there's no org override", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: null, value: null }], error: null },
    });
    expect(await resolveOrgSetting(fake as never, "o1", "k", "def")).toBe("def");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (install deps first if `node_modules` is missing): `npm install && npx vitest run src/data/settings.test.ts`
Expected: FAIL — both new tests report the received value as `null` instead of `"plat"` / `"def"`.

- [ ] **Step 3: Implement the minimal fix**

In `src/data/settings.ts`, replace lines 46-50:

```ts
  const orgRow = orgId ? rows.find((r) => r.org_id === orgId) : undefined;
  const platformRow = rows.find((r) => r.org_id === null);
  const chosen = orgRow ?? platformRow;
  return (chosen ? (chosen.value as T) : fallback);
```

with:

```ts
  const orgRow = orgId ? rows.find((r) => r.org_id === orgId) : undefined;
  const platformRow = rows.find((r) => r.org_id === null);
  // A JSONB-null-valued row (org override or platform default) is not a "real"
  // value — fall through to the next tier instead of returning null.
  const chosen = [orgRow, platformRow].find((r) => r && r.value != null);
  return (chosen ? (chosen.value as T) : fallback);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/settings.test.ts`
Expected: PASS (7 tests in the `resolveOrgSetting` describe block: 5 existing + 2 new; unrelated describes in the same file unaffected).

Then run the broader data-layer suite to catch any cross-file regression (e.g. `airtableSettings.test.ts`, which imports `mergeOrgRows` from the same module):
Run: `npx vitest run src/data/`
Expected: PASS, no new failures.

- [ ] **Step 5: Commit**

```bash
git add src/data/settings.ts src/data/settings.test.ts
git commit -m "fix: resolveOrgSetting falls through null-valued rows (frontend)"
```

---

### Task 3: SQL — `get_org_setting()` + pgTAP regression

**Files:**
- Test: `supabase/tests/rls/per_org_settings.sql` (extend existing file)
- Create: `supabase/migrations/<applied-version-timestamp>_get_org_setting_null_value_fallback.sql` (filename finalized in Step 3 once the real version is known)

**Interfaces:**
- Consumes: nothing new — `get_org_setting(_org uuid, _key text) returns jsonb` keeps its existing signature.
- Produces: same signature, corrected null-row semantics. Consumed unchanged by `compute_show_date_status` and any other `SECURITY DEFINER` caller.

- [ ] **Step 1: Write the failing pgTAP assertions**

In `supabase/tests/rls/per_org_settings.sql`, bump the plan count on line 10 from:

```sql
SELECT plan(11);
```

to:

```sql
SELECT plan(13);
```

Then replace the INSERT block at lines 26-30:

```sql
-- platform default + an org-A override of the same key
INSERT INTO public.app_settings (org_id, key, value) VALUES
  (NULL, 'demo_key', '"platform"'::jsonb),
  ('00000000-0000-0000-0000-00000000a000', 'demo_key', '"orgA"'::jsonb);
SET session_replication_role = DEFAULT;
```

with:

```sql
-- platform default + an org-A override of the same key
-- + a null-valued org override (must fall through to platform) and a null-valued
--   platform-only row (must fall through to NULL — no lower tier exists)
INSERT INTO public.app_settings (org_id, key, value) VALUES
  (NULL, 'demo_key', '"platform"'::jsonb),
  ('00000000-0000-0000-0000-00000000a000', 'demo_key', '"orgA"'::jsonb),
  (NULL, 'null_org_key', '"plat-fallback"'::jsonb),
  ('00000000-0000-0000-0000-00000000a000', 'null_org_key', 'null'::jsonb),
  (NULL, 'null_platform_key', 'null'::jsonb);
SET session_replication_role = DEFAULT;
```

Then add two new assertions immediately after line 35 (`'unknown key resolves to null'`), i.e. between the existing function-resolution assertions and the `-- ── reads under RLS ──` section:

```sql
SELECT is( public.get_org_setting('00000000-0000-0000-0000-00000000a000','null_org_key'), '"plat-fallback"'::jsonb, 'null-valued org row falls through to platform default');
SELECT is( public.get_org_setting('00000000-0000-0000-0000-00000000a000','null_platform_key'), NULL, 'null-valued platform-only row resolves to null (no lower tier)');
```

- [ ] **Step 2: Confirm the test cannot run locally, and verify the failure directly instead**

Docker is not running in this sandbox, so `npm run test:db` (`supabase test db`) cannot execute here — it will run in CI. To still observe the bug fail before fixing it, run this against the live project with the Supabase `execute_sql` MCP tool, wrapped in a transaction that always rolls back:

```sql
BEGIN;
INSERT INTO public.app_settings (org_id, key, value) VALUES
  (NULL, 'null_org_key_tmp', '"plat-fallback"'::jsonb),
  ('00000000-0000-0000-0000-00000000a000', 'null_org_key_tmp', 'null'::jsonb);
SELECT public.get_org_setting('00000000-0000-0000-0000-00000000a000', 'null_org_key_tmp') AS result;
ROLLBACK;
```

Expected (current, buggy behavior): `result` is `null` instead of `"plat-fallback"`.

- [ ] **Step 3: Apply the fix via the migration tool**

Confirm with the user before running this — it mutates the live project directly (single project, no dev branch).

Use the Supabase `apply_migration` MCP tool with name `get_org_setting_null_value_fallback` and this SQL:

```sql
-- Fix get_org_setting(): a JSONB-null-valued row (org or platform) must fall through
-- to the next tier instead of being treated as a "real" value. Previously a row
-- with value = 'null'::jsonb short-circuited resolution and returned null, even when
-- a usable platform default existed (or no row existed at all below it).
create or replace function public.get_org_setting(_org uuid, _key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.app_settings
  where key = _key and (org_id = _org or org_id is null)
    and value <> 'null'::jsonb
  order by (org_id is null)
  limit 1
$$;
```

Note the version timestamp the tool returns (e.g. via `list_migrations` immediately after) — it stamps the real apply time as the version regardless of the `name` argument given.

- [ ] **Step 4: Re-run the manual verification to confirm the fix, then mirror the migration file locally**

Re-run the same `BEGIN; ... ROLLBACK;` block from Step 2 via `execute_sql`.
Expected (fixed behavior): `result` is `"plat-fallback"`.

Then create `supabase/migrations/<version-from-step-3>_get_org_setting_null_value_fallback.sql` (exact filename using the real returned version) containing the same SQL applied in Step 3, so the local migrations directory matches the live project's migration history.

Run `mcp__6fbecca6-9b05-4c4a-9991-f438c220c4b5__get_advisors` (type `security`) to confirm the function change introduced no new advisories.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/rls/per_org_settings.sql supabase/migrations/<version-from-step-3>_get_org_setting_null_value_fallback.sql
git commit -m "fix: get_org_setting falls through null-valued rows (sql)"
```

(The pgTAP additions in `per_org_settings.sql` will run for real in CI's `supabase test db` job and confirm the fix there, since it isn't runnable locally without Docker.)

---

## After all three tasks pass

All three mirrors (edge, frontend, SQL) now share identical null-row-passthrough semantics. Next step is deciding how to land this branch — use `superpowers:finishing-a-development-branch` to choose between merge, PR, or further cleanup rather than defaulting to one path.
