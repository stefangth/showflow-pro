# Phase 2b-DB — Catalog-Link Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two grain-agnostic catalog-link columns — `shows.airtable_program_key` and `cities.airtable_city_key` — each unique per org, so a future mapping UI (2b-UI) can link an Airtable controlled-option value to exactly one Showflow `shows`/`cities` row within an org.

**Architecture:** One additive, nullable-column migration on `shows` and `cities`, each backed by a **partial unique index** (`(org_id, …key) WHERE …key IS NOT NULL`): a key is unique *within* an org, free *across* orgs, and most rows stay unlinked (NULL). The keys are opaque `text` — the grain (single sub-program option vs a Program+Sub-Programm composite) is a 2b-UI concern, not baked into the DB. No RLS, trigger, or data changes. Driven test-first with pgTAP.

**Tech Stack:** PostgreSQL (Supabase, project `epweartpzwvcasrzyueh`), pgTAP. **No local Supabase CLI/Docker in this environment** — apply DDL with the Supabase MCP `apply_migration`, run pgTAP with the Supabase MCP `execute_sql` (the test file is `BEGIN … ROLLBACK`, so it leaves no residue), regenerate types with the Supabase MCP `generate_typescript_types`. CI runs `supabase test db` on the committed pgTAP file and the Supabase-Preview check re-applies migrations.

Implements [the Phase 2b design](../specs/2026-06-17-airtable-mapping-model-phase-2b-design.md) §3 and [the engine spec](../specs/2026-06-16-airtable-sync-engine-design.md) §5; per [ADR-0001](../../adr/0001-airtable-system-of-record.md).

---

## ⚠️ Migration-version gotcha (read before Task 1)

The MCP `apply_migration` records the migration version as the **apply-moment UTC timestamp**, *not* a name you choose (e.g. applying now records `20260617HHMMSS`). The latest existing version is `20260617120000`. **Workflow that avoids the rename trap that bit Phase 1a:** apply via MCP **first**, then `list_migrations` to read the recorded version `V`, then create the repo file named **exactly** `supabase/migrations/<V>_airtable_link_columns.sql`. Never guess the version in the filename first. A filename that matches the recorded version makes the CI Supabase-Preview treat the migration as already-applied (it baselines from the project that already has these objects) instead of re-running plain DDL on existing objects.

---

## File Structure

- `supabase/tests/db/airtable_link_columns.sql` — **new.** pgTAP: per-org uniqueness of both keys (6 assertions).
- `supabase/migrations/<V>_airtable_link_columns.sql` — **new.** `ALTER TABLE … ADD COLUMN` on `shows`/`cities` + the two partial-unique indexes. `<V>` is the version recorded by `apply_migration` (see gotcha above).
- `src/integrations/supabase/types.ts` — **modify (regenerated).** Picks up the two new nullable columns.
- `CLAUDE.md` — **modify.** One line recording the two link columns.

Fixture UUIDs (valid hex): org A `11111111-…`, org B `22222222-…`, show `33333333-…`, city `44444444-…`.

---

### Task 1: Catalog-link columns + per-org uniqueness

**Files:**
- Create: `supabase/tests/db/airtable_link_columns.sql`
- Create: `supabase/migrations/<V>_airtable_link_columns.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/db/airtable_link_columns.sql`:

```sql
-- Catalog-link keys are unique PER ORG (free across orgs); many rows stay NULL.
-- Keys are grain-agnostic opaque text (the value the admin's field mapping yields).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

INSERT INTO public.organizations (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a-airtable-link'),
  ('22222222-2222-2222-2222-222222222222', 'Org B', 'org-b-airtable-link');

-- ── shows.airtable_program_key ───────────────────────────────────────────────
INSERT INTO public.shows (id, org_id, program, sub_program, status, airtable_program_key)
  VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'TJE', 'TJE: Murder', 'active', 'TJE: Murder');

-- 1) the same key in a DIFFERENT org is allowed (per-org, not global, uniqueness)
SELECT lives_ok(
  $$ INSERT INTO public.shows (org_id, program, sub_program, status, airtable_program_key)
     VALUES ('22222222-2222-2222-2222-222222222222', 'TJE', 'TJE: Murder', 'active', 'TJE: Murder') $$,
  'same airtable_program_key in another org is allowed');

-- 2) a duplicate key WITHIN the same org is rejected
SELECT throws_ok(
  $$ INSERT INTO public.shows (org_id, program, sub_program, status, airtable_program_key)
     VALUES ('11111111-1111-1111-1111-111111111111', 'TJE', 'TJE: Other', 'active', 'TJE: Murder') $$,
  '23505', NULL,
  'duplicate airtable_program_key within an org is rejected');

-- 3) multiple UNLINKED (NULL) shows in one org are allowed (partial index excludes NULL)
SELECT lives_ok(
  $$ INSERT INTO public.shows (org_id, program, sub_program, status, airtable_program_key)
     VALUES ('11111111-1111-1111-1111-111111111111', 'X', 'X1', 'active', NULL),
            ('11111111-1111-1111-1111-111111111111', 'Y', 'Y1', 'active', NULL) $$,
  'multiple NULL airtable_program_key rows in one org are allowed');

-- ── cities.airtable_city_key ─────────────────────────────────────────────────
INSERT INTO public.cities (id, org_id, name, airtable_city_key)
  VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Berlin', 'Berlin');

-- 4) the same city key in another org is allowed
SELECT lives_ok(
  $$ INSERT INTO public.cities (org_id, name, airtable_city_key)
     VALUES ('22222222-2222-2222-2222-222222222222', 'Berlin', 'Berlin') $$,
  'same airtable_city_key in another org is allowed');

-- 5) a duplicate city key within an org is rejected
SELECT throws_ok(
  $$ INSERT INTO public.cities (org_id, name, airtable_city_key)
     VALUES ('11111111-1111-1111-1111-111111111111', 'Berlin Alt', 'Berlin') $$,
  '23505', NULL,
  'duplicate airtable_city_key within an org is rejected');

-- 6) multiple UNLINKED (NULL) cities in one org are allowed
SELECT lives_ok(
  $$ INSERT INTO public.cities (org_id, name, airtable_city_key)
     VALUES ('11111111-1111-1111-1111-111111111111', 'Hamburg', NULL),
            ('11111111-1111-1111-1111-111111111111', 'Munich', NULL) $$,
  'multiple NULL airtable_city_key rows in one org are allowed');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test and confirm it fails**

Run it via the Supabase MCP `execute_sql` (project `epweartpzwvcasrzyueh`) with the entire file contents as `query`.
Expected: an **error**, not a clean assertion fail — the run aborts at the first `shows` insert with `column "airtable_program_key" of relation "shows" does not exist` (the column isn't there yet). This confirms the test exercises the not-yet-added columns.

- [ ] **Step 3: Apply the migration (MCP first, then name the file)**

Apply via the Supabase MCP `apply_migration` (project `epweartpzwvcasrzyueh`, name `airtable_link_columns`, `query` = the SQL below):

```sql
-- Catalog-link columns: connect an Airtable controlled-option value to a Showflow
-- catalog row. Grain-agnostic opaque text — the value the admin's 2b-UI field
-- mapping produces (a single sub-program option, or a Program+Sub-Programm
-- composite). Unique per org (partial, since most rows stay unlinked); free across
-- orgs. The poll (Phase 3) resolves records against these links.
ALTER TABLE public.shows  ADD COLUMN airtable_program_key text;
ALTER TABLE public.cities ADD COLUMN airtable_city_key text;

CREATE UNIQUE INDEX shows_airtable_program_key_org_uniq
  ON public.shows (org_id, airtable_program_key)
  WHERE airtable_program_key IS NOT NULL;

CREATE UNIQUE INDEX cities_airtable_city_key_org_uniq
  ON public.cities (org_id, airtable_city_key)
  WHERE airtable_city_key IS NOT NULL;
```

Then run the Supabase MCP `list_migrations` and read the new top version `V` (a 14-digit `20260617HHMMSS`, above `20260617120000`). Create `supabase/migrations/<V>_airtable_link_columns.sql` containing the **identical** SQL above. (Filename version MUST equal `V` — see the gotcha section.)

- [ ] **Step 4: Run the test and confirm it passes**

Run `supabase/tests/db/airtable_link_columns.sql` again via `execute_sql`.
Expected: `ok 1` … `ok 6`, `# Looks like you ran 6 tests`, no `not ok` lines.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_airtable_link_columns.sql supabase/tests/db/airtable_link_columns.sql
git commit -m "feat(db): add per-org catalog-link columns to shows and cities" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Regenerate Supabase types

**Files:**
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Regenerate the types**

Call the Supabase MCP `generate_typescript_types` (project `epweartpzwvcasrzyueh`). Overwrite `src/integrations/supabase/types.ts` with the returned content **verbatim** (this file is auto-generated — never hand-edit).

- [ ] **Step 2: Verify the new columns are present**

Run: `grep -n "airtable_program_key\|airtable_city_key" src/integrations/supabase/types.ts`
Expected: matches under both the `shows` and `cities` `Row`/`Insert`/`Update` shapes, typed `string | null`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json` (or `npm run build` if `tsc` isn't wired standalone).
Expected: no errors. Adding nullable columns is backward-compatible — existing selects/inserts still type-check.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(types): regenerate Supabase types for catalog-link columns" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Document the columns

**Files:**
- Modify: `CLAUDE.md` (the Airtable-sync key-decision bullet)

- [ ] **Step 1: Add a note to the Airtable decision bullet**

In `CLAUDE.md`, find the key-decisions bullet that begins `- **Airtable sync is org-aware.**`. Append this sentence to the end of that bullet:

```markdown
 Catalog linking (Phase 2b) connects Airtable controlled-option values to catalog rows via `shows.airtable_program_key` and `cities.airtable_city_key` — grain-agnostic `text`, **unique per org** (partial index where not null). The link grain (single sub-program option vs a Program+Sub-Programm composite) is chosen by the admin in the mapping UI, not fixed in the DB.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note the Airtable catalog-link columns" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- **Order:** Task 1 (migration + test) before Task 2 (types depend on the columns existing) before Task 3.
- **This touches the live prod project** (`epweartpzwvcasrzyueh`) — there is no local DB in this environment. The change is additive and nullable (two new columns, two partial indexes), so it is safe on existing data: every existing row has a NULL key and is excluded from the unique index. No backfill.
- **Why `execute_sql` for the pgTAP:** the file is wrapped in `BEGIN … ROLLBACK`, so running it against the live project leaves no residue. The same file is what CI runs via `supabase test db`.
- **No RLS/policy/trigger changes** — the columns ride the existing `shows`/`cities` org-isolation policies; nothing reads them yet (2b-UI writes them, Phase 3's poll reads them).
- If `apply_migration` shows a cost-confirmation prompt, that is expected for the first DDL of a session — confirm and proceed.

## Self-Review

- **Spec coverage (design §3):** `shows.airtable_program_key` ✓ (Task 1), `cities.airtable_city_key` ✓ (Task 1), partial-unique-per-org indexes ✓ (Task 1), grain-agnostic text ✓ (no CHECK), no RLS/trigger changes ✓, types regen ✓ (Task 2). The data-access functions and the UI are explicitly **2b-UI**, not this plan.
- **Placeholder scan:** the only intentional placeholder is `<V>` (the apply-recorded migration version), which cannot be known until `apply_migration` runs — Step 3 defines exactly how to resolve it. No other placeholders.
- **Type consistency:** column names `airtable_program_key` / `airtable_city_key` and index names `shows_airtable_program_key_org_uniq` / `cities_airtable_city_key_org_uniq` are identical across the test, the migration, and the docs.
