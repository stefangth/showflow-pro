# Wireflow v3 — Phase 4: new backend (Sheet importer + per-cast fee) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the two backend capabilities the v3 board's `source`/`connect`/`map`/`cities` steps and `fee` step were built to depend on: (A) a **Google Sheet → `show_dates` importer** (manual trigger this phase, no cron) so the wizard's "Google Sheet" source becomes a real path; and (B) a **per-(cast × production) fee** (`cast_production_fees` table) that the `fee` step edits and that contract generation resolves, replacing the Phase 3 static shell. All behind the off-by-default `getrunning_v3` flag; v1 board code stays byte-untouched.

**Architecture:** Two independent workstreams, one PR.
- **Part A (Sheet importer):** a fresh set-based RPC `import_sheet_dates(p_org, p_rows)` does the idempotent upsert into `show_dates`; a new `import-sheet-dates` edge function (DI, JWT-only, `requireOrgRole(['producer','admin'])` + `requireFeature('booking_flow')`) receives client-parsed rows, resolves each row's `show_id` (by production name) and `city_id` (by city name) against the org catalog, applies Airtable-style **city-hold** (a new row with a non-empty unresolved city is held, not imported city-less), calls the RPC, writes the same `airtable_sync_log` shape (`sync_type='sheet_import'`) + per-record `airtable_sync_record_log` rows, and opens tier-1 offers for new dates under the same gate `airtable-poll` uses. The client (wizard) only fetches the published CSV via the existing SSRF-guarded `fetch-remote-sheet` (`fetchPublicSheetCsv`) and parses it with the existing `parseSheet`, then maps columns to rows. **Sheet dedupe:** `show_dates` has no natural unique key and `airtable_record_id` is Airtable-only, so this phase adds a nullable `source` column and a partial unique index `(org_id, show_id, date) WHERE source = 'sheet'`; sheet rows are stamped `source='sheet'` and dedupe only among themselves, never clobbering Airtable or by-hand rows.
- **Part B (per-cast fee):** a new tenant table `cast_production_fees(org_id, cast_id, show_id, fee_amount, currency, fee_basis)` (unique `(cast_id, show_id)`) with the modern org-scoped RLS kit; the `fee` step edits it (list appears once casts exist, amber "no casts yet" gate otherwise); `generate-hire-orders` resolves a booking's cast via `cast_members` (artist→cast) intersected with the show_date's eligible casts, and inserts the `(cast × production)` fee as a resolution layer **between** the booking/manual fee and the org default — precedence `booking/manual → (cast × production) → org default`, falling back to the org default when the cast is ambiguous or absent.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind + shadcn/ui, @tanstack/react-query v5, Supabase (Postgres + RLS + RPC + Deno edge functions), react-i18next (EN + DE). Tests: Vitest + @testing-library/react (jsdom) + the `src/test/` harness (`supabaseFake.ts`, `renderWithProviders.tsx`, `fixtures.ts`, `castHelpers.ts`); Deno test + `supabase/functions/_shared/testing.ts` (`makeFakeDeps`/`bindFakeFrom`/`setFakeFrom`) for edge functions; pgTAP (`supabase test db`) for RLS + RPC.

**Spec:** `docs/superpowers/specs/2026-08-23-wireflow-v3-get-running-settings-design.md` (owner-approved 2026-08-23, commit 2a5f43bb), §6 "New backend capabilities" (§6.1 Sheet importer, §6.2 per-cast fee), §9 Testing, §10 Phase 4. Prior plans (context, all merged): Phase 1 `…-phase-1-frame-board-model.md`, Phase 2 `…-phase-2-get-dates-wizard.md`, Phase 3 `…-phase-3-bookable-contracts-steps.md`.

**Two owner decisions locked before planning (AskUserQuestion, 2026-08-23):**
1. **Cast→fee resolution:** derive the booking's cast from `cast_members` (artist→cast) intersected with the show_date's eligible casts; use its `(cast × production)` fee only when exactly one cast matches; otherwise fall back to the org default. **No `cast_id` is added to `bookings`.**
2. **Sheet importer:** **manual import only** this phase; **no cron re-read** (the spec's "keeps re-reading on the org's poll schedule" is deferred). No pg_cron migration, no `X-Cron-Secret` path on `import-sheet-dates`.

## Global Constraints

- **Flag-gated + additive.** All Phase 4 UI is reached only through `GETRUNNING_V3` (`src/config/flags.ts`, `import.meta.env.VITE_GETRUNNING_V3 === "true"`; on in local `.env.development`, off in prod). Do **not** flip the flag. v1 board code (`src/lib/getRunning/tasks.ts`, `taskFeature.ts`, `GetRunningPage.tsx` v1 branch, `src/components/getRunning/panels/**`, `TaskPanel*`) stays byte-untouched; no v1 file is deleted (Phase 5). The new backend (migrations, RPC, edge fn, `generate-hire-orders` change) is NOT flag-gated at the data layer — it is inert until data/callers exist, and the `fee`-precedence change is a pure refinement of an existing resolver that defaults to today's behavior when no `cast_production_fees` row exists.
- **Migrations: never hand-apply to prod; the merge applies them.** Author migration files under `supabase/migrations/` via the migration tool / MCP `apply_migration` against the **local** stack only. If you apply out of band with MCP, it stamps its own timestamp version — `git mv` the file to the recorded version in the same commit (`scripts/check-migrations.mjs` gates this; see memory [[migrations-not-auto-applied-on-merge]], [[duplicate-migration-version-20260809120000]]). Two migrations here (A1 sheet, B1 fee) must get **distinct** version timestamps.
- **SECURITY DEFINER RPC needs a `service_role` grant.** `import_sheet_dates` is called by the edge function through the **service-role** client. A definer RPC that does `revoke all on function … from public` MUST then `grant execute … to service_role` or the edge caller 42501s at runtime (pgTAP runs as superuser and Deno rpc-fakes both miss this). Assert the grant with `has_function_privilege('service_role', '…', 'EXECUTE')` in pgTAP. (Memory [[security-definer-rpc-service-role-grant]].)
- **RLS template = the modern org-scoped kit, NOT `cast_city_priority`.** New tenant tables (`cast_production_fees`) mirror `supabase/migrations/20260812190000_show_date_skill_drops.sql`: `org_id uuid NOT NULL REFERENCES organizations`, a BEFORE-INSERT `org_id` derivation trigger, permissive `is_org_member(auth.uid(), org_id)` SELECT + `has_org_role(auth.uid(), org_id, 'admin'|'producer')` write policies, a RESTRICTIVE `org_isolation` policy with **plain `is_org_member` on both USING and WITH CHECK** (never an active-org conjunct on WITH CHECK — memory [[active-org-conjunct-breaks-writes]]), the `update_updated_at_column()` trigger, and a guarded realtime add. Explicit table `GRANT`s are **not** needed (the global default-privileges migration `20260808201308` covers new tables — memory [[local-cli-drops-default-table-grants]]).
- **Types are generated; regenerate + mirror after each migration.** After applying a migration locally: regenerate `src/integrations/supabase/types.ts` (`supabase gen types typescript --project-id epweartpzwvcasrzyueh > src/integrations/supabase/types.ts`, or the MCP `generate_typescript_types`), then `npm run sync:mirrors` (updates `supabase/functions/_shared/database.types.ts`), then verify `npm run sync:mirrors:check`. Never hand-edit either types file. Nullable RPC args have no home in generated types — if `import_sheet_dates` needs a widened arg, declare it in `supabase/functions/_shared/rows.ts` and cast at the `.rpc()` call (memory: `scripts/generatedTypes.test.ts` guards this); `p_org uuid`/`p_rows jsonb` are both non-null so this likely does not apply.
- **Data access is `fetchX(client, args)` / `mutateX(client, args)` in `src/data/<domain>.ts`; hooks are thin wrappers** passing the `supabase` singleton. Test data-access with `src/test/supabaseFake.ts` (never `vi.mock` the client). `any` is banned (lint `--max-warnings 0`): at a query boundary use an explicit row interface + a single `as unknown as Row[]` cast in `src/data/**`; tests use `src/test/castHelpers.ts`.
- **Edge functions use the shared kit.** `handle(req, deps)` + `Deno.serve(...)` only at the bottom; `_shared/http.ts` (CORS + json), `_shared/auth.ts` (`requireOrgRole`), `_shared/settings.ts` (`resolveOrgSetting`), `_shared/deps.ts` (`Deps`), `_shared/entitlements.ts` (`requireFeature`/`checkFeature`). Register `[functions.import-sheet-dates]` in `supabase/config.toml` (`verify_jwt = true`). Run the **whole** `supabase/functions/` Deno suite after any edge change (memory [[edge-fn-multi-test-files]]). Service-role internal invokes (`open-offer-tier`) must pass an explicit `Authorization: Bearer <serviceKey>` (the `serviceInvokeOptions` pattern — memory [[service-role-invoke-header]]); `deps.invokeFunction` already handles this for airtable-poll, reuse it.
- **UI conventions (`docs/ui-conventions.md`), CI-enforced at `--max-warnings 0`.** Reuse `src/components/ui` primitives; no raw hex/rgba/`text-[13px]`/`rounded-[10px]` outside `src/components/ui`; 13px control size (`text-control`); uppercase is `<Eyebrow>`; status colour from `TONES`/`StatusPill`; numbers are `<Metric>`; tint washes `bg-hover-tint`/`bg-well-tint`/`bg-accent-tint`. Match the existing v3 step-body idiom (`SourceStep.tsx`): heading `text-title-sm font-semibold tracking-[-0.2px] text-foreground`, sub `text-xs text-muted-foreground`, primary `<Button type="button" size="sm">`, footer via `WizardFooterContext` portal.
- **i18n from the start.** Every new user-facing string goes through `t()` in the `getRunningV3` namespace (`src/i18n/locales/{en,de}/getRunningV3.json`), EN canonical, DE at full key parity (`src/i18n/keyParity.test.ts`). No em/en dashes (`src/i18n/copyLint.test.ts`; regular hyphens OK), no exclamation marks, no emoji, German Du-form. App terminology wins over design copy: **production** (not "show"), **part/Position** (not "slot"), **Contract**/**Engagementvertrag** (not "hire order"). New domain terms go in `src/i18n/terms.ts` `TERMS`, never inlined.
- **No dashes / help-center / page-mini rules.** Per-PR: update `src/lib/help/items.ts` (EN+DE, Du) if Phase 4 changes what a user asks, or state "No help center impact."; the get-running board has no page mini (`src/lib/minis/index.ts` `MINIS`), state "No page mini." in the PR.
- **Branch + merge.** Work on `claude/wireflow-v3-phase-4-f338f7` (currently `= origin/main`). Do not commit or push to `main`; `main` requires the owner's review approval (memory [[repo-no-required-checks-automerge]]). The executor never self-merges. Never cancel deploy/apply CI workflows (memory [[never-cancel-deploy-apply-workflows]]).

---

## File Structure

**Part A — Sheet importer:**
- Create: `supabase/migrations/<ts>_import_sheet_dates.sql` — `show_dates.source` column, partial unique index, `import_sheet_dates(p_org, p_rows)` RPC + grant.
- Create: `supabase/tests/rls/import_sheet_dates.sql` — pgTAP: RPC upsert/dedupe/held semantics, org guard, `service_role` EXECUTE grant.
- Create: `src/lib/sheetImport/mapRows.ts` (+ `.test.ts`) — pure: `(parsedRows, columnMap) → SheetDateRow[]` (the client-side column→row mapping).
- Create: `src/data/sheetImport.ts` (+ `.test.ts`) — sheet settings (URL + column map) read/write over `app_settings`; `importSheetDates(client, orgId, rows)` (invokes the edge fn); `fetchSheetHeaders` helper (fetch CSV via `fetchPublicSheetCsv` + `parseSheet`, return header names).
- Create: `supabase/functions/import-sheet-dates/index.ts` (+ `index.di.test.ts`) — the edge fn.
- Modify: `supabase/config.toml` — add `[functions.import-sheet-dates]`.
- Create: `src/hooks/useSheetImport.ts` (+ `.test.tsx`) — thin hook: settings state, `fetchSheetHeaders`, `importSheetDates` mutation, result.
- Modify: `src/components/getRunning/v3/steps/SourceStep.tsx` (+ test) — enable `sheet` as a real choice.
- Modify: `src/components/getRunning/v3/steps/ConnectStep.tsx` (+ test) — sheet URL branch.
- Modify: `src/components/getRunning/v3/steps/MapStep.tsx` (+ test) — sheet column-map branch.
- Modify: `src/components/getRunning/v3/steps/CitiesStep.tsx` (+ test) — sheet import + held-cities branch.
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json` — sheet copy.

**Part B — per-cast fee:**
- Create: `supabase/migrations/<ts>_cast_production_fees.sql` — table + org derivation trigger + RLS + unique + realtime.
- Create: `supabase/tests/rls/cast_production_fees.sql` — pgTAP: RLS (member read, role write, cross-org denial).
- Create: `src/data/castProductionFees.ts` (+ `.test.ts`) — `fetchCastProductionFees` / `upsertCastProductionFee` / `deleteCastProductionFee`.
- Create: `src/hooks/useCastProductionFees.ts` (+ `.test.tsx`) — query + upsert/delete mutations.
- Modify: `src/components/getRunning/v3/steps/FeeStep.tsx` (+ test) — replace the static shell with the real per-cast fee list + "no casts yet" gate.
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json` — per-cast fee list copy.
- Modify: `supabase/functions/generate-hire-orders/index.ts` (+ `index.di.test.ts`) — cast derivation + `(cast × production)` fee precedence in the three fee-resolving handlers.
- Modify: `supabase/functions/_shared/hireOrders.ts` — (only if a shared helper for the cast-fee layer is cleaner; otherwise inline in `index.ts`).

**Shared:**
- Modify (twice, once per migration): `src/integrations/supabase/types.ts` + `supabase/functions/_shared/database.types.ts` — regenerated, never hand-edited.

---

# PART A — Google Sheet dates importer (manual)

## Task A1: Migration + RPC + pgTAP — `import_sheet_dates`

**Files:**
- Create: `supabase/migrations/<ts>_import_sheet_dates.sql`
- Create: `supabase/tests/rls/import_sheet_dates.sql`
- Modify (regenerate): `src/integrations/supabase/types.ts`, `supabase/functions/_shared/database.types.ts`

**Interfaces:**
- Produces: column `show_dates.source text NULL`; partial unique index `show_dates_sheet_uniq` on `(org_id, show_id, date) WHERE source = 'sheet'`; RPC `public.import_sheet_dates(p_org uuid, p_rows jsonb) RETURNS jsonb` returning `{ "new_count": int, "updated_count": int }`. Each element of `p_rows` is `{ show_id uuid, date text (YYYY-MM-DD), city_id uuid|null, session_1 text|null, session_2 text|null, session_3 text|null, venue text|null }` — **already resolved** (the edge fn does name→id resolution and city-hold; held rows never reach the RPC). The RPC stamps `source='sheet'` on inserts and upserts on the partial-unique key; `org_id` is set by the existing `trg_derive_org_id` (from `show_id`) on insert. The RPC is `SECURITY DEFINER`, asserts the caller (via `auth.uid()`) is an admin/producer of `p_org` **or** is the service role, and returns counts.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/rls/import_sheet_dates.sql`, mirroring the structure of `supabase/tests/rls/casts_capabilities.sql` (read it first for the exact seed/impersonate idiom). Plan for these assertions:

```sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

-- Seed with RLS bypassed.
SET session_replication_role = replica;
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com');
INSERT INTO public.organizations (id, name) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'Org One');
INSERT INTO public.org_memberships (user_id, org_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'admin');
INSERT INTO public.shows (id, org_id, program, sub_program, status) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', 'Cats', 'Evening', 'active');
INSERT INTO public.cities (id, org_id, name) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 'Berlin');
SET session_replication_role = DEFAULT;

-- 1. service_role has EXECUTE on the RPC (the runtime caller; see Global Constraints).
SELECT ok(
  has_function_privilege('service_role', 'public.import_sheet_dates(uuid, jsonb)', 'EXECUTE'),
  'service_role can execute import_sheet_dates'
);

-- 2. First import inserts a source=sheet row for the (org, show, date).
SELECT is(
  (public.import_sheet_dates(
     '00000000-0000-0000-0000-0000000000f1',
     '[{"show_id":"00000000-0000-0000-0000-0000000000c1","date":"2026-09-01","city_id":"00000000-0000-0000-0000-0000000000d1","session_1":"19:30"}]'::jsonb
   ) ->> 'new_count')::int,
  1,
  'first import inserts one new date'
);
SELECT is(
  (SELECT count(*)::int FROM public.show_dates
    WHERE show_id = '00000000-0000-0000-0000-0000000000c1' AND date = '2026-09-01' AND source = 'sheet'),
  1, 'the inserted row is stamped source=sheet with org_id derived'
);

-- 3. Re-importing the same (org, show, date) UPDATES, does not duplicate (idempotent).
SELECT is(
  (public.import_sheet_dates(
     '00000000-0000-0000-0000-0000000000f1',
     '[{"show_id":"00000000-0000-0000-0000-0000000000c1","date":"2026-09-01","city_id":"00000000-0000-0000-0000-0000000000d1","session_1":"20:00"}]'::jsonb
   ) ->> 'updated_count')::int,
  1, 're-import updates the existing sheet row'
);
SELECT is(
  (SELECT session_1 FROM public.show_dates
    WHERE show_id = '00000000-0000-0000-0000-0000000000c1' AND date = '2026-09-01' AND source = 'sheet'),
  '20:00', 're-import overwrote session_1'
);
SELECT is(
  (SELECT count(*)::int FROM public.show_dates
    WHERE show_id = '00000000-0000-0000-0000-0000000000c1' AND date = '2026-09-01'),
  1, 'still exactly one row (no duplicate)'
);

-- 4. A non-member caller cannot import (org guard). Impersonate a user with no membership.
SET session_replication_role = replica;
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000a9', 'outsider@example.com');
SET session_replication_role = DEFAULT;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.import_sheet_dates(
       '00000000-0000-0000-0000-0000000000f1',
       '[{"show_id":"00000000-0000-0000-0000-0000000000c1","date":"2026-09-02"}]'::jsonb) $$,
  'P0001', NULL, 'a non-member cannot import sheet dates'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run (per memory [[env-no-node-supabase-cli]] — the executor's stack has the local Supabase CLI): `supabase test db` (or `npm run test:db`).
Expected: FAIL — `import_sheet_dates` does not exist, `show_dates.source` does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/<ts>_import_sheet_dates.sql` (use the migration tool so the version timestamp is real and unique; do NOT collide with Task B1's):

```sql
-- Phase 4 (wireflow v3): Google Sheet -> show_dates importer.
-- show_dates has no natural unique key and airtable_record_id is Airtable-only, so sheet
-- rows get their own identity via a `source` marker and a partial unique on (org, show, date)
-- scoped to source='sheet' -- isolated from Airtable rows (source NULL, airtable_record_id set)
-- and by-hand rows (source NULL, no airtable_record_id), so re-imports never clobber them.

ALTER TABLE public.show_dates ADD COLUMN IF NOT EXISTS source text;
COMMENT ON COLUMN public.show_dates.source IS
  'Origin of the row: ''sheet'' for Google Sheet imports; NULL for Airtable-synced or by-hand rows.';

CREATE UNIQUE INDEX IF NOT EXISTS show_dates_sheet_uniq
  ON public.show_dates (org_id, show_id, date)
  WHERE source = 'sheet';

-- Set-based idempotent upsert. Rows arrive already resolved (show_id + city_id) from the
-- edge function; held rows never reach here. org_id is set by the existing trg_derive_org_id
-- (BEFORE INSERT, from show_id). SECURITY DEFINER so it can upsert regardless of the caller's
-- direct table grants, but it re-checks the caller is an admin/producer of p_org (or the
-- service role) first.
CREATE OR REPLACE FUNCTION public.import_sheet_dates(p_org uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new int := 0;
  v_updated int := 0;
  v_is_service boolean := (auth.jwt() ->> 'role') = 'service_role';
BEGIN
  IF NOT v_is_service
     AND NOT (public.has_org_role(auth.uid(), p_org, 'admin'::app_role)
           OR public.has_org_role(auth.uid(), p_org, 'producer'::app_role)) THEN
    RAISE EXCEPTION 'not authorized to import sheet dates for this org'
      USING ERRCODE = 'P0001';
  END IF;

  WITH incoming AS (
    SELECT
      (r ->> 'show_id')::uuid   AS show_id,
      (r ->> 'date')::date      AS date,
      NULLIF(r ->> 'city_id','')::uuid AS city_id,
      NULLIF(r ->> 'session_1','') AS session_1,
      NULLIF(r ->> 'session_2','') AS session_2,
      NULLIF(r ->> 'session_3','') AS session_3,
      NULLIF(r ->> 'venue','')     AS venue
    FROM jsonb_array_elements(p_rows) AS r
  ),
  upserted AS (
    INSERT INTO public.show_dates
      (show_id, date, city_id, session_1, session_2, session_3, venue, source)
    SELECT show_id, date, city_id, session_1, session_2, session_3, venue, 'sheet'
    FROM incoming
    ON CONFLICT (org_id, show_id, date) WHERE source = 'sheet'
    DO UPDATE SET
      city_id   = EXCLUDED.city_id,
      session_1 = EXCLUDED.session_1,
      session_2 = EXCLUDED.session_2,
      session_3 = EXCLUDED.session_3,
      venue     = EXCLUDED.venue
    RETURNING (xmax = 0) AS inserted
  )
  SELECT
    count(*) FILTER (WHERE inserted),
    count(*) FILTER (WHERE NOT inserted)
  INTO v_new, v_updated
  FROM upserted;

  RETURN jsonb_build_object('new_count', v_new, 'updated_count', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.import_sheet_dates(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.import_sheet_dates(uuid, jsonb) TO authenticated, service_role;
```

Notes for the implementer:
- `ON CONFLICT (org_id, show_id, date) WHERE source = 'sheet'` must exactly match the partial index predicate for Postgres to pick it — keep them identical.
- The insert omits `org_id`; the existing `trg_derive_org_id` (`derive_org_id_for_...` from `show_id`) fills it BEFORE INSERT. Confirm that trigger exists on `show_dates` (it does — see `20260604130000_org_id_derivation_triggers.sql` referenced in `airtable-poll`); if the trigger derives from `show_id`, the partial-index `org_id` is populated before the conflict check. **Verify** by reading the trigger definition; if `org_id` is not yet set when the unique index is evaluated, set `org_id := p_org` explicitly in the INSERT column list instead (both `p_org` and the derived value are the same org).
- `(xmax = 0)` distinguishes an inserted row from an updated one in the same statement.
- `has_org_role` is the org-scoped role check used throughout; `auth.jwt() ->> 'role' = 'service_role'` lets the edge fn's service-role client through.

- [ ] **Step 4: Apply locally, run the test green, regenerate types**

Apply to the local stack (MCP `apply_migration` or `supabase migration up`; if MCP stamps a different version, `git mv` the file to match — see Global Constraints). Then:
Run: `supabase test db` → expected PASS (7 assertions).
Then regenerate + mirror:
```bash
supabase gen types typescript --project-id epweartpzwvcasrzyueh > src/integrations/supabase/types.ts
npm run sync:mirrors
npm run sync:mirrors:check
npx tsc -p tsconfig.app.json --noEmit
```
Expected: `show_dates` row type now has `source: string | null`; `Database["public"]["Functions"]["import_sheet_dates"]` exists; mirror check clean; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/rls/import_sheet_dates.sql src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts
git commit -m "v3 phase 4: import_sheet_dates RPC + show_dates.source (migration + pgTAP)"
```

---

## Task A2: Pure client-side column→row mapping (`mapRows`)

**Files:**
- Create: `src/lib/sheetImport/mapRows.ts`
- Test: `src/lib/sheetImport/mapRows.test.ts`

**Interfaces:**
- Consumes: `parseSheet` output shape from `src/lib/artistImport/parseSheet.ts` (read it — it returns headers + row objects/arrays; match the actual exported type, e.g. `{ headers: string[]; rows: string[][] }` or `Record<string,string>[]`).
- Produces:
  ```ts
  export interface SheetColumnMap {
    program: string;         // required: sheet column holding the production name
    subProgram?: string;     // optional: sub-program / variant column
    date: string;            // required: sheet column holding the date
    city?: string;           // optional: city name column
    session1?: string; session2?: string; session3?: string; // optional time columns
    venue?: string;
  }
  export interface SheetDateRaw {
    program: string; subProgram: string; date: string; city: string;
    session_1: string | null; session_2: string | null; session_3: string | null; venue: string | null;
    rowIndex: number; // 1-based source row for held-cause reporting
  }
  export function isSheetMapComplete(map: Partial<SheetColumnMap>): map is SheetColumnMap;
  export function mapSheetRows(parsed: ParsedSheet, map: SheetColumnMap): SheetDateRaw[];
  ```
  `mapSheetRows` skips fully-empty rows and rows missing the date value (those become "held: missing date" downstream, but the mapper only emits rows that have at least a program+date; document that held-for-missing-date is decided in the edge fn, and here we simply carry through empty strings so the edge fn can categorize). Normalize each time via a shared HH:MM check (reuse or mirror `parseTime` from `_shared` — but this is client code; add a tiny local `normalizeTime(s): string|null` returning `s` if it matches `/^\d{1,2}:\d{2}$/`, else null).

- [ ] **Step 1: Write the failing test**

Create `src/lib/sheetImport/mapRows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isSheetMapComplete, mapSheetRows } from "@/lib/sheetImport/mapRows";

// Build a ParsedSheet literal in the exact shape parseSheet returns (read parseSheet.ts).
const parsed = {
  headers: ["Show", "Variant", "Day", "Town", "Eve", "House"],
  rows: [
    ["Cats", "Evening", "2026-09-01", "Berlin", "19:30", "Theater am Potsdamer"],
    ["Cats", "Evening", "2026-09-02", "", "20:00", ""],
    ["", "", "", "", "", ""], // fully empty -> skipped
  ],
};
const map = { program: "Show", subProgram: "Variant", date: "Day", city: "Town", session1: "Eve", venue: "House" };

describe("mapSheetRows", () => {
  it("maps columns to rows by header name and skips empty rows", () => {
    const out = mapSheetRows(parsed as never, map as never);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      program: "Cats", subProgram: "Evening", date: "2026-09-01",
      city: "Berlin", session_1: "19:30", venue: "Theater am Potsdamer", rowIndex: 1,
    });
    expect(out[1]).toMatchObject({ city: "", session_1: "20:00", venue: null, rowIndex: 2 });
  });

  it("normalizes a non-time session value to null", () => {
    const out = mapSheetRows({ headers: ["Show","Day","Eve"], rows: [["Cats","2026-09-01","matinee"]] } as never,
      { program: "Show", date: "Day", session1: "Eve" } as never);
    expect(out[0].session_1).toBeNull();
  });
});

describe("isSheetMapComplete", () => {
  it("requires program and date", () => {
    expect(isSheetMapComplete({ program: "Show", date: "Day" })).toBe(true);
    expect(isSheetMapComplete({ program: "Show" })).toBe(false);
    expect(isSheetMapComplete({ date: "Day" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/sheetImport/mapRows.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `mapRows.ts`** with the interfaces above. Resolve each column by finding its index in `parsed.headers`; read the cell from each row; trim; empty rows (every mapped cell blank) are skipped; `venue`/sessions become `null` when blank/non-time; `city`/`program`/`subProgram`/`date` carry through as strings (possibly empty). Read `parseSheet.ts` first and match its exact output field names.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/sheetImport/mapRows.test.ts` then `npx tsc -p tsconfig.app.json --noEmit`. Expected PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sheetImport/mapRows.ts src/lib/sheetImport/mapRows.test.ts
git commit -m "v3 phase 4: pure sheet column->row mapping (mapSheetRows)"
```

---

## Task A3: `import-sheet-dates` edge function

**Files:**
- Create: `supabase/functions/import-sheet-dates/index.ts`
- Test: `supabase/functions/import-sheet-dates/index.di.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `Deps` (`_shared/deps.ts`), `requireOrgRole` (`_shared/auth.ts`), `requireFeature` (`_shared/entitlements.ts`), `resolveBookingFlow` (`_shared/bookingFlow.ts`), `corsHeaders`/`json` (`_shared/http.ts`). Request body: `{ org_id: string, rows: SheetDateRaw[] }` (the client's `mapSheetRows` output — `program`/`subProgram`/`date`/`city`/`session_1..3`/`venue`/`rowIndex`).
- Produces: `export async function handle(req, deps): Promise<Response>`; response `200 { processed, new_dates, updated, held, tiers_opened }`, or `4xx { error }`. Behavior mirrors `airtable-poll`'s `syncOrg` reduced to one org and to client-supplied rows:
  1. `requireOrgRole(deps, req, org_id, ['producer','admin'])`; then `requireFeature(deps.admin, org_id, 'booking_flow')` (403 if absent).
  2. Load catalog maps from `deps.admin`: `shows` for the org keyed by `lower(program)||' '||lower(sub_program)`; `cities` for the org keyed by `lower(name)`.
  3. For each row: resolve `show_id` by `(program, subProgram)` key — miss → **held** `program '<program>' not linked`. Missing/blank `date` → **held** `missing date`. Resolve `city_id` by `lower(city)` when city non-blank — miss → **held** `city '<city>' not linked` (do NOT import city-less); blank city → `city_id = null`. Build a resolved row `{ show_id, date, city_id, session_1..3, venue }`.
  4. Call `deps.admin.rpc('import_sheet_dates', { p_org: org_id, p_rows: resolvedRows })` → `{ new_count, updated_count }`.
  5. Determine new date ids: re-query `show_dates` for the org's `source='sheet'` rows matching the imported `(show_id, date)` pairs to get ids (the RPC returns counts, not ids; a second select keyed on the imported pairs is the simplest id source — or extend the RPC to return ids; see note).
  6. Write one `airtable_sync_log` row `sync_type='sheet_import'` with `records_processed`, `imported_count`, `new_count`, `updated_count`, `held_count`, `details`, `synced_at = deps.now()`; write child `airtable_sync_record_log` rows for held/imported/updated (`action` in `imported_new|updated|held_unresolved`, `reason`, `raw_fields`). Reuse the exact column names airtable-poll writes (Agent A report §4).
  7. Open tier-1 offers for new dates, gated on `resolveBookingFlow(...).active && .auto_open_tier1 && .artist_acceptance && await checkFeature(admin, org_id, 'booking_flow')`, batched through `deps.invokeFunction('open-offer-tier', { show_date_id, tier: 1 })` — reuse airtable-poll's `openTierOne`/batching helper verbatim if it is exported from `_shared`, else replicate the small loop.

  **Note on new-date ids (step 5):** prefer extending the RPC to `RETURNING id, inserted` and returning `{ new_ids: uuid[], new_count, updated_count }` — cleaner than a re-select. If you take that route, update Task A1's RPC + pgTAP (add an assertion on `new_ids`) in this task's first commit-cycle, and re-run `supabase test db`. Pick ONE approach and keep the RPC contract and its pgTAP in sync.

- [ ] **Step 1: Write the failing DI test**

Create `supabase/functions/import-sheet-dates/index.di.test.ts`, modeled on `supabase/functions/fetch-remote-sheet/index.di.test.ts` (proxy-style auth cases) + `supabase/functions/airtable-poll/index.di.test.ts` (seed + write-capture via `bindFakeFrom`/`setFakeFrom`). Read both first. Cover:

```ts
// (imports: handle from ./index, makeFakeDeps/makeRequest/bindFakeFrom/setFakeFrom from ../_shared/testing.ts)

Deno.test("OPTIONS returns CORS 204", async () => { /* handle(makeRequest({method:"OPTIONS"}), deps) */ });

Deno.test("no Authorization -> 401", async () => { /* makeRequest with no Bearer */ });

Deno.test("wrong role -> 403", async () => {
  // authUser is a member with role 'artist'; requireOrgRole(['producer','admin']) rejects.
});

Deno.test("feature off -> 403", async () => {
  // admin member, but org lacks booking_flow entitlement -> requireFeature 403.
});

Deno.test("resolves show + city, imports, holds unresolved city, opens tier-1", async () => {
  // Seed shows (Cats/Evening -> showC1), cities (Berlin -> cityB1), org entitled to booking_flow,
  // app_settings booking flow active+auto_open_tier1+artist_acceptance, rpc import_sheet_dates
  // returning {new_count:1, updated_count:0, new_ids:["sd-1"]}.
  // rows: one resolvable (Cats/Evening/2026-09-01/Berlin), one held (Cats/Evening/2026-09-02/Paris).
  // Capture the rpc call args and the airtable_sync_log insert and the invokeFunction calls.
  const { deps, invokeCalls, client } = makeFakeDeps({ /* ... */ });
  // wrap import_sheet_dates rpc + capture show_dates/sync_log writes with setFakeFrom
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { org_id, rows } }), deps);
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body).toMatchObject({ processed: 2, new_dates: 1, held: 1, tiers_opened: 1 });
  // assert the rpc got exactly the ONE resolved row (Paris held out), sync_log sync_type==="sheet_import",
  // and open-offer-tier invoked once with { show_date_id: "sd-1", tier: 1 }.
});

Deno.test("no new dates -> no tier opened", async () => { /* rpc returns new_count:0 -> invokeCalls empty */ });
```

- [ ] **Step 2: Run to verify it fails** — `deno test --allow-all supabase/functions/import-sheet-dates/` → FAIL (module missing).

- [ ] **Step 3: Implement the edge fn** per the Interfaces contract. Keep it lean: no CSV fetching (the client already parsed), so no SSRF concern here. Reuse `_shared` helpers; do not re-inline CORS/auth/settings. Mirror airtable-poll's held-cause strings and sync-log column set exactly so the future Sources console (Phase 5) reads both uniformly. Bottom of file: `if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));`.

- [ ] **Step 4: Register in config.toml**

Add after the `[functions.fetch-remote-sheet]` block:
```toml
[functions.import-sheet-dates]
verify_jwt = true
```
(JWT-required: it is user-triggered only this phase; no `X-Cron-Secret` path.)

- [ ] **Step 5: Run the WHOLE Deno suite + typecheck**

Run: `deno test --allow-all supabase/functions/` (whole suite — memory [[edge-fn-multi-test-files]]), then `deno check --node-modules-dir=none supabase/functions/import-sheet-dates/index.ts`.
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/import-sheet-dates supabase/config.toml
git commit -m "v3 phase 4: import-sheet-dates edge fn (resolve, hold, upsert, tier-1)"
```

---

## Task A4: Data access + hook — sheet settings, headers, trigger

**Files:**
- Create: `src/data/sheetImport.ts`, `src/data/sheetImport.test.ts`
- Create: `src/hooks/useSheetImport.ts`, `src/hooks/useSheetImport.test.tsx`

**Interfaces:**
- `src/data/sheetImport.ts`:
  ```ts
  export interface SheetImportSettings { url: string; map: Partial<SheetColumnMap>; } // SheetColumnMap from @/lib/sheetImport/mapRows
  export interface SheetImportResult { processed: number; new_dates: number; updated: number; held: number; tiers_opened: number; }
  export async function fetchSheetImportSettings(client, orgId): Promise<SheetImportSettings>;   // app_settings key "sheet_import_settings", default { url:"", map:{} }
  export async function saveSheetImportSettings(client, orgId, settings): Promise<void>;         // upsertOrgSetting
  export async function fetchSheetHeaders(client, orgId, url): Promise<string[]>;                 // fetchPublicSheetCsv + parseSheet -> headers
  export async function importSheetDates(client, orgId, rows): Promise<SheetImportResult>;        // functions.invoke("import-sheet-dates", { body: { org_id: orgId, rows } })
  ```
  Reuse `resolveOrgSetting`/`upsertOrgSetting` (`@/data/settings`), `fetchPublicSheetCsv` (`@/data/remoteSheet`), `parseSheet` (`@/lib/artistImport/parseSheet`). `importSheetDates` mirrors `triggerAirtableSyncNow` in `src/data/airtableSync.ts` (read it for the `functions.invoke` + error-unwrap idiom).
- `src/hooks/useSheetImport.ts`:
  ```ts
  export function useSheetImport(orgId: string | null): {
    settings: SheetImportSettings; isLoading: boolean;
    saveSettings: (s: SheetImportSettings) => void; saving: boolean;
    loadHeaders: (url: string) => Promise<string[]>;
    runImport: (rows: SheetDateRaw[]) => void; importing: boolean; result: SheetImportResult | null;
  };
  ```
  Query key `["sheet-import", orgId]` for settings; mutations invalidate `["sheet-import", orgId]` and `["show-dates"]`/`["bookings"]` (a successful import creates dates + may open offers — bust both domains).

- [ ] **Step 1: Failing data-access test** — `src/data/sheetImport.test.ts` with `src/test/supabaseFake.ts`. Assert: `fetchSheetImportSettings` returns the default `{url:"",map:{}}` when no row; `saveSheetImportSettings` upserts under key `sheet_import_settings`; `importSheetDates` calls `functions.invoke("import-sheet-dates", …)` and returns the result. Read `src/data/settings.test.ts` + `src/data/airtableSync.test.ts` for the fake-client seeding + `functions.invoke` stub idiom.

- [ ] **Step 2: Run red** — `npx vitest run src/data/sheetImport.test.ts`.

- [ ] **Step 3: Implement `src/data/sheetImport.ts`.**

- [ ] **Step 4: Run green + typecheck.**

- [ ] **Step 5: Failing hook test** — `src/hooks/useSheetImport.test.tsx` with the project query wrapper (mirror `src/hooks/useGetRunningV3.test.tsx`). Assert settings load + a `runImport` mutation surfaces `result`.

- [ ] **Step 6: Run red, implement `useSheetImport.ts`, run green + typecheck.**

- [ ] **Step 7: Commit**

```bash
git add src/data/sheetImport.ts src/data/sheetImport.test.ts src/hooks/useSheetImport.ts src/hooks/useSheetImport.test.tsx
git commit -m "v3 phase 4: sheet-import data access + useSheetImport hook"
```

---

## Task A5: Wizard sheet path (Source/Connect/Map/Cities) + copy

**Files:**
- Modify: `src/components/getRunning/v3/steps/SourceStep.tsx` (+ `.test.tsx`)
- Modify: `src/components/getRunning/v3/steps/ConnectStep.tsx` (+ `.test.tsx`)
- Modify: `src/components/getRunning/v3/steps/MapStep.tsx` (+ `.test.tsx`)
- Modify: `src/components/getRunning/v3/steps/CitiesStep.tsx` (+ `.test.tsx`)
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json`

**Interfaces:**
- Consumes: `useSheetImport` (Task A4), `useDatesSource` (existing), `mapSheetRows`/`isSheetMapComplete` (Task A2), `useCities`/`useAllCities` for city linking (existing hooks — read how `CitiesStep` uses `useAirtableConsole` today and provide the analogous sheet inputs).
- Produces: with `source === "sheet"`, each step renders a real body; the get_dates phase advances through them exactly as the Airtable path does.

Design note: keep the sheet path **lean** (this phase's theme is backend). Deep "Sources console" parity — generalizing `AirtableSyncTab` to display sheet runs, rich city pre-linking — is Phase 5 (spec §8). Sheet runs already write the sync-log rows (Task A3), so the data is captured; surfacing it in Settings is Phase 5. State this in the PR.

- [ ] **Step 1: Enable `sheet` in `SourceStep` (copy first, then code, then test)**

Copy: in `getRunningV3.json` (EN then DE) the `body.source.sheet` subtree already exists (`title`/`desc`/`badge`). Change `badge` to an empty/removed state or repurpose it. Simplest: remove the `badge` key usage in code and drop the `StatusPill`; keep `title`/`desc`. (If keyParity requires the key to stay in both locales, leave the JSON key present but stop rendering it, and note it for a Phase 5 cleanup — do NOT delete from one locale only.)

Code: in `SourceStep.tsx`, change `CHOOSABLE` to include `"sheet"`:
```ts
const CHOOSABLE: ReadonlySet<SelectableSource> = new Set(["airtable", "sheet", "manual"]);
```
Remove the `{src === "sheet" && <StatusPill …>}` roadmap badge and update the two comments (lines 17-19 and the "Google Sheet is displayed for the roadmap but stays disabled" docblock) to state all three sources are now real.

Test: update `SourceStep.test.tsx` — the sheet radio is now enabled and selectable; picking it and Continue calls `save("sheet", …)` → `onDone`. Remove/adjust any assertion that the sheet card is disabled.

- [ ] **Step 2: `ConnectStep` sheet branch**

Add `isSheet = source === "sheet"`. Its body: a URL text input (bound to `useSheetImport().settings.url`), a short helper line ("Paste the published CSV link"), and a "Load columns" action that calls `loadHeaders(url)` and stores headers in local state / advances. Save the URL via `saveSettings`. Continue enabled once a valid `docs.google.com …format=csv` URL is entered (client can pre-check with the same predicate shape as `isAllowedSheetUrl`; a soft check is fine — the server re-validates). Copy under `body.connect.sheet.*`. Update the docblock (lines 22-25) that says sheet "has no dedicated connect flow this phase".

- [ ] **Step 3: `MapStep` sheet branch**

`isSheet` body: given the loaded headers, render a column-mapping form (selects for program [required], sub-program, date [required], city, session 1-3, venue), bound to `useSheetImport().settings.map`; save via `saveSettings`; Continue gated on `isSheetMapComplete(map)`. Copy under `body.map.sheet.*`.

- [ ] **Step 4: `CitiesStep` sheet branch + the actual import trigger**

`isSheet` body: a "Import dates now" action that (a) fetches CSV (`fetchPublicSheetCsv` via the hook / `loadHeaders` already cached the rows — prefer caching parsed rows in the hook so this does not re-fetch), (b) `mapSheetRows(parsed, map)`, (c) `runImport(rows)`, then shows the `result` (imported / new / updated / held) via `Metric`/`StatusPill`. Held cities surface as a short list with a note to link them in the city catalog (link to the existing cities catalog surface; deep inline linking is Phase 5). Continue enabled once an import has run with `new_dates + updated > 0`. Copy under `body.cities.sheet.*`.

- [ ] **Step 5: Tests for Connect/Map/Cities sheet branches**

For each, mirror the existing test file's wrapper; stub `useSheetImport` (or seed the fake) and `useDatesSource` to `source: "sheet"`; assert the sheet body renders and Continue gating behaves. Keep the Airtable-branch tests intact (do not regress them).

- [ ] **Step 6: i18n gates + typecheck + full unit run for the four steps**

Run: `npx vitest run src/components/getRunning/v3/steps/ src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts` and `npx tsc -p tsconfig.app.json --noEmit`. Expected green.

- [ ] **Step 7: Commit**

```bash
git add src/components/getRunning/v3/steps/SourceStep.tsx src/components/getRunning/v3/steps/SourceStep.test.tsx src/components/getRunning/v3/steps/ConnectStep.tsx src/components/getRunning/v3/steps/ConnectStep.test.tsx src/components/getRunning/v3/steps/MapStep.tsx src/components/getRunning/v3/steps/MapStep.test.tsx src/components/getRunning/v3/steps/CitiesStep.tsx src/components/getRunning/v3/steps/CitiesStep.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 phase 4: real Google Sheet wizard path (source/connect/map/cities)"
```

---

# PART B — per-(cast × production) fee

## Task B1: Migration + RLS + pgTAP — `cast_production_fees`

**Files:**
- Create: `supabase/migrations/<ts>_cast_production_fees.sql`
- Create: `supabase/tests/rls/cast_production_fees.sql`
- Modify (regenerate): `src/integrations/supabase/types.ts`, `supabase/functions/_shared/database.types.ts`

**Interfaces:**
- Produces: table `public.cast_production_fees (id uuid PK, org_id uuid NOT NULL REFERENCES organizations, cast_id uuid NOT NULL REFERENCES casts ON DELETE CASCADE, show_id uuid NOT NULL REFERENCES shows ON DELETE CASCADE, fee_amount numeric NULL, currency text NOT NULL DEFAULT 'EUR', fee_basis text NOT NULL DEFAULT 'per_date', created_at timestamptz, updated_at timestamptz, UNIQUE(cast_id, show_id))`. Columns mirror `OrderDefaultsCard`'s `{default_fee, currency, default_fee_basis}` → `{fee_amount, currency, fee_basis}`. RLS: member SELECT, admin/producer write, RESTRICTIVE `org_isolation`. `fee_basis` values `'per_date' | 'total'` (a CHECK is optional — the app validates via `isFeeBasis`; if you add a CHECK, widen it in the same migration as any future basis change per memory [[enum-check-vs-freeform-id-mismatch]]).

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/rls/cast_production_fees.sql`, mirroring `supabase/tests/rls/casts_capabilities.sql` + `org_isolation.sql`. Plan (~8 assertions): admin of org A can INSERT/SELECT a fee; producer of org A can INSERT; an artist of org A cannot INSERT (RLS drops → `is_empty`/`throws_ok`); a member of org B cannot SELECT org A's fee (cross-org isolation → empty); the `UNIQUE(cast_id, show_id)` holds. Seed `auth.users`, two `organizations`, `org_memberships` (admin/producer/artist in A; a member in B), `casts` + `shows` (with `org_id`) in each org. Use `set_config('request.jwt.claims', …)` + `SET LOCAL ROLE authenticated` to impersonate.

- [ ] **Step 2: Run red** — `supabase test db` → FAIL (table missing).

- [ ] **Step 3: Write the migration** (mirror `20260812190000_show_date_skill_drops.sql` verbatim in structure):

```sql
-- Phase 4 (wireflow v3): per-(cast x production) fee. Inherits the org OrderDefaultsCard
-- defaults; generate-hire-orders resolves this over the org default (below the booking/manual fee).

CREATE TABLE public.cast_production_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cast_id uuid NOT NULL REFERENCES public.casts(id) ON DELETE CASCADE,
  show_id uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  fee_amount numeric,
  currency text NOT NULL DEFAULT 'EUR',
  fee_basis text NOT NULL DEFAULT 'per_date',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cast_id, show_id)
);

-- org_id derivation: BEFORE INSERT, from show_id (a fee's org is its production's org).
-- Reuse the existing generic derive fn if one keys on show_id; else add a small one here.
CREATE OR REPLACE FUNCTION public.derive_org_id_for_cast_production_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_show_org uuid; v_cast_org uuid;
BEGIN
  SELECT org_id INTO v_show_org FROM public.shows WHERE id = NEW.show_id;
  SELECT org_id INTO v_cast_org FROM public.casts WHERE id = NEW.cast_id;
  IF v_show_org IS NULL THEN RAISE EXCEPTION 'show % not found', NEW.show_id; END IF;
  IF v_cast_org IS DISTINCT FROM v_show_org THEN
    RAISE EXCEPTION 'cast and production belong to different orgs'; END IF;
  NEW.org_id := v_show_org;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_derive_org_id ON public.cast_production_fees;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT ON public.cast_production_fees
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_for_cast_production_fee();

CREATE TRIGGER update_cast_production_fees_updated_at
  BEFORE UPDATE ON public.cast_production_fees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.cast_production_fees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view cast production fees"
  ON public.cast_production_fees FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins and producers manage cast production fees"
  ON public.cast_production_fees FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR public.has_org_role(auth.uid(), org_id, 'producer'::app_role));

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS org_isolation ON public.cast_production_fees';
  EXECUTE 'CREATE POLICY org_isolation ON public.cast_production_fees AS RESTRICTIVE FOR ALL TO authenticated '
    || 'USING (public.is_org_member(auth.uid(), org_id)) '
    || 'WITH CHECK (public.is_org_member(auth.uid(), org_id))';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cast_production_fees'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.cast_production_fees';
  END IF;
END $$;
```

Before writing, confirm whether a generic `derive_org_id_from_show_id` already exists (grep `20260604130000_org_id_derivation_triggers.sql`); if it does and it also validates, reuse it instead of the bespoke fn above. Keep the cross-org guard either way.

- [ ] **Step 4: Apply locally, run pgTAP green, regenerate + mirror**

Apply locally (rename to the recorded version if MCP restamps — distinct from A1's). `supabase test db` → PASS. Then regenerate types + `npm run sync:mirrors` + `sync:mirrors:check` + `npx tsc -p tsconfig.app.json --noEmit`. `Database["public"]["Tables"]["cast_production_fees"]` now exists.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/rls/cast_production_fees.sql src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts
git commit -m "v3 phase 4: cast_production_fees table + RLS (migration + pgTAP)"
```

---

## Task B2: Data access + hook — `castProductionFees`

**Files:**
- Create: `src/data/castProductionFees.ts`, `src/data/castProductionFees.test.ts`
- Create: `src/hooks/useCastProductionFees.ts`, `src/hooks/useCastProductionFees.test.tsx`

**Interfaces:**
- `src/data/castProductionFees.ts` (follow the `src/data/hireOrders.ts` `fetchShowDatesLite`/upsert idiom, and `upsertOrgSetting`'s `onConflict` style):
  ```ts
  export interface CastProductionFee {
    id: string; cast_id: string; show_id: string;
    fee_amount: number | null; currency: string; fee_basis: FeeBasis; // FeeBasis from @/lib/hireOrders/feeBasis
  }
  export async function fetchCastProductionFees(client, orgId): Promise<CastProductionFee[]>;   // .eq("org_id", orgId)
  export async function upsertCastProductionFee(client, args: { orgId; castId; showId; feeAmount: number|null; currency: string; feeBasis: FeeBasis }): Promise<void>; // onConflict "cast_id,show_id"
  export async function deleteCastProductionFee(client, id: string): Promise<void>;
  ```
- `src/hooks/useCastProductionFees.ts`: `useCastProductionFees(orgId)` (query key `["cast-production-fees", orgId]`) + `useUpsertCastProductionFee()` / `useDeleteCastProductionFee()` mutations that invalidate `["cast-production-fees", orgId]`. (Do NOT invalidate `["app-settings", …]` — `feeDone` stays keyed on the org default row per the decision below.)

- [ ] **Step 1-4: TDD the data-access functions** with `src/test/supabaseFake.ts` (fetch returns rows for the org; upsert records the `onConflict` payload; delete records the `eq("id", …)`). Red → implement → green → typecheck.

- [ ] **Step 5-6: TDD the hook** with the query wrapper. Red → implement → green → typecheck.

- [ ] **Step 7: Commit**

```bash
git add src/data/castProductionFees.ts src/data/castProductionFees.test.ts src/hooks/useCastProductionFees.ts src/hooks/useCastProductionFees.test.tsx
git commit -m "v3 phase 4: cast_production_fees data access + hook"
```

---

## Task B3: `FeeStep` — real per-cast fee list (replace the static shell)

**Files:**
- Modify: `src/components/getRunning/v3/steps/FeeStep.tsx` (+ `.test.tsx`)
- Modify: `src/i18n/locales/{en,de}/getRunningV3.json`

**Interfaces:**
- Consumes: `useCastProductionFees`/`useUpsertCastProductionFee` (B2); `useCasts` (existing — read how casts are listed elsewhere, e.g. the coverage step) for the cast list; `useShows` for productions; `OrderDefaultsCard` (kept — the org default stays above the list); `useCan("edit_hire_order_settings")`.
- Produces: `FeeStep` unchanged signature `({ orgId, onDone })`. The dashed static shell (`body.fee.shellTitle`/`shellBody`) is **replaced** by: (a) an amber "no casts yet" gate linking to the `coverage` step when the org has zero casts; (b) otherwise a per-(cast × production) fee list/editor — one row per `(cast, production)` the user chooses to override, each with fee amount + currency + basis, saved via `useUpsertCastProductionFee`, inheriting the org default shown above when unset.

- [ ] **Step 1: Copy** — in `getRunningV3.json` (EN then DE) under `body.fee`, replace `shellTitle`/`shellBody` usage with new keys: `listTitle`, `listHint`, `noCasts` ("You have no casts yet. Set them up in Casts and the ladder, then set fees per production and cast here."), `addFee`, `castLabel`, `productionLabel`, `feeLabel`, `save`, and a deep-link label to `coverage`. Keep `heading`/`sub`/`continue`/`readOnly`. Du-form, no dashes. Reuse the `TERMS` contract term.

- [ ] **Step 2: Failing test** (`FeeStep.test.tsx`, extend the existing file — it already mocks the supabase singleton + `useCan`). Add: with zero casts, the "no casts yet" note + coverage link render and no fee-list editor; with casts present, a fee row can be added/saved (assert `useUpsertCastProductionFee` mutate called with the chosen cast/production/amount). Keep the existing OrderDefaultsCard + read-only-viewer assertions.

- [ ] **Step 3-4: Implement + green.** Replace the dashed `<div>` block with the gate/list. Reuse `Metric` for amounts, `Eyebrow` for the section label, `Select` for currency/basis (mirror `OrderDefaultsCard`'s currency/basis selects). The coverage deep-link is an in-board step jump — use the same mechanism ConnectStep/others use to point at another step (read how the board navigates between steps; if there is no in-board step link yet, a plain note naming "Casts and the ladder" is acceptable this phase — do not invent a new navigation API).

- [ ] **Step 5: i18n gates + typecheck** — `npx vitest run src/components/getRunning/v3/steps/FeeStep.test.tsx src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts` + `npx tsc -p tsconfig.app.json --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/components/getRunning/v3/steps/FeeStep.tsx src/components/getRunning/v3/steps/FeeStep.test.tsx src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json
git commit -m "v3 phase 4: FeeStep real per-(cast x production) fee list"
```

---

## Task B4: Contract generation — cast derivation + fee precedence

**Files:**
- Modify: `supabase/functions/generate-hire-orders/index.ts` (+ `index.di.test.ts`)
- Modify (if a shared helper is cleaner): `supabase/functions/_shared/hireOrders.ts`

**Interfaces:**
- Consumes: existing `resolveFields` (`_shared/hireOrders.ts`), `resolveOrderDefaults(admin, org)` (`index.ts:165`), the show-date query (has `show_id`), the bookings query (has `artist_id`). New: a `resolveCastProductionFee(admin, orgId, showDateId, artistId, showId): Promise<{ amount: number|null }>` helper that (1) finds the artist's cast memberships (`cast_members` where `artist_id = artistId` and `org_id = orgId`), (2) intersects with the show_date's eligible casts (`show_date_cast_eligibility` for `showDateId`, falling back to `show_cast_eligibility` for the `(show_id, city_id)` if the per-date table is empty — read the two tables' shapes), (3) if **exactly one** cast results, looks up `cast_production_fees` for `(cast_id, show_id)` and returns its `fee_amount`; otherwise returns `{ amount: null }` (ambiguous/none → org default wins).
- Produces: in each of the three fee-resolving handlers (draft-batch ~L577-637, manual/wizard ~L871-919, aggregate multi-date ~L1382-1428), insert the cast-fee as a layer between the booking/manual fee and the default: set the resolved cast fee (when non-null) as the value used in place of `defaults.default_fee` in the `defaults` layer's `fee` — i.e. `assign(defLayer, "fee", castFee.amount ?? defaults.default_fee)`. This preserves precedence **booking/manual (higher layer) → cast fee → org default**, since `resolveFields` already prefers the higher `showflow`/`manual` layer. Currency/basis stay from the org default (the `(cast × production)` fee inherits them per spec §6.2) unless the cast-fee row carries its own; keep it simple this phase — use the cast fee's **amount** only, org default currency/basis, and document that.

- [ ] **Step 1: Write failing DI tests** in `generate-hire-orders/index.di.test.ts` (large existing file — add a focused `Deno.test` block). Seed: org default fee 100; a `cast_production_fees` row (cast C1 × show S1) fee 250; `cast_members` linking artist A1→C1; `show_date_cast_eligibility` making C1 the sole eligible cast for the date. Assert: a draft for A1's booking on that date snapshots `fee_amount = 250` (cast fee beats default). Second case: artist A2 in TWO eligible casts → ambiguous → `fee_amount = 100` (org default). Third case: booking carries its own `fee_amount = 400` → wins over the cast fee (400).

- [ ] **Step 2: Run red** — `deno test --allow-all supabase/functions/generate-hire-orders/`.

- [ ] **Step 3: Implement** the helper + wire it into all three handlers. Keep the org-default read (`resolveOrderDefaults`) as-is; add the cast-fee resolution per booking/date. Reuse existing query patterns in the file for `cast_members`/eligibility reads.

- [ ] **Step 4: Run the WHOLE Deno suite + edge typecheck** — `deno test --allow-all supabase/functions/` (memory [[edge-fn-multi-test-files]] — the aggregate/manual/draft paths share code; run all) + `deno check --node-modules-dir=none supabase/functions/generate-hire-orders/index.ts`. Expected green.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-hire-orders src/../supabase/functions/_shared/hireOrders.ts
git commit -m "v3 phase 4: contract generation resolves per-(cast x production) fee"
```

---

## Task C1: Help center + terms + full verification gate

**Files:**
- Modify (if needed): `src/lib/help/items.ts` (EN+DE), `src/i18n/terms.ts`
- No new production code; consolidated verification before the PR.

- [ ] **Step 1: Help + terms impact.** Phase 4 adds a real Google Sheet import path and per-cast fees. Review `src/lib/help/items.ts`: does an admin/producer now ask "how do I import dates from a sheet" or "how do I set a fee per cast"? If yes, add/adjust items (Du, no dashes) in this PR; else state "No help center impact." Move any new shared term (e.g. a sheet-import term) into `src/i18n/terms.ts` `TERMS`. State "No page mini (get-running board has none)." in the PR.

- [ ] **Step 2: Full fast verification** — `npm run verify:fast` (lint `--max-warnings 0`, the three typecheck projects, build, unit + coverage, Deno). Fix any raw-value/dash/key-parity/coverage-threshold failures (new files need their tests to clear coverage — every task above adds them).

- [ ] **Step 3: Full verification incl. DB + e2e** — `npm run verify:full` (adds pgTAP + Playwright; needs the local stack). Confirm both new pgTAP files pass and no e2e regressed.

- [ ] **Step 4: Live visual verification (dev harness).** `npm run local:up` then `npm run dev` (flag on in `.env.development`; harness `/dev/get-running`, DEV-only). In the Browser preview, in BOTH light and dark:
  - **Get dates → Google Sheet:** source now offers Sheet as a real choice; enter a published test CSV URL, load columns, map them, run the import, see imported/new/updated/held counts; a held city shows in the held list.
  - **Contracts → fee:** with no casts, the amber "no casts yet" gate shows and links to Casts and the ladder; with casts, add a per-(cast × production) fee and save it; the org default card still saves and marks the step done.
  Compare against the design screens (`SourceImport`, `Run3Steps`·fee; Claude Design project `02c15575-91a6-4acd-92fc-e006a5cf1b88`). Capture screenshots. Interaction/layout matches the design; copy follows app terminology. Fix divergences, re-run steps 2-3.

- [ ] **Step 5: Commit any copy/help changes**

```bash
git add src/lib/help/items.ts src/i18n/terms.ts
git commit -m "help + terms for v3 phase 4 (or: no help impact)"
```

---

## Self-Review (run before handing off to execution)

**1. Spec coverage** — Phase 4 scope (spec §6, §10):
- §6.1 `import-sheet-dates` edge fn (`requireOrgRole(['producer','admin'])` + `requireFeature(booking_flow)`) → Task A3 ✓
- §6.1 set-based RPC `import_sheet_dates(p_org, p_rows)` with Airtable-parity city-hold + dedupe → Task A1 (RPC + partial-unique dedupe) + A3 (city-hold in resolution) ✓
- §6.1 reads CSV via `fetch-remote-sheet`, parses/maps client-side → Task A2 (`mapSheetRows`) + A4 (`fetchSheetHeaders`/`fetchPublicSheetCsv`) ✓
- §6.1 source/connect/map/cities parameterize on `source ∈ {airtable, sheet, manual}` → Task A5 ✓
- §6.1 sheet imports write the same sync-log shape → Task A3 (`airtable_sync_log` `sync_type='sheet_import'` + record log). **Displaying** sheet runs in `AirtableSyncTab` is deferred to Phase 5 (spec §8) — noted, data captured now ✓
- §6.1 `[functions.import-sheet-dates]` in config.toml → Task A3 ✓
- §6.1 "keeps re-reading on the org's poll schedule" → **deferred by owner decision (manual only, no cron)** — recorded in plan header ✓
- §6.2 `cast_production_fees` table (org_id, cast_id, show_id, fee, currency, fee_basis; unique (cast_id, show_id); RLS) → Task B1 ✓ (columns mirror OrderDefaultsCard's actual `{default_fee, currency, default_fee_basis}`; the spec's VAT/travel/payment-terms do not exist on that card, so they are not added — noted)
- §6.2 fee step: org defaults + per-(cast × production) list; amber "no casts yet → coverage" gate → Task B3 ✓
- §6.2 `generate-hire-orders resolveFields` reads the (cast × production) fee else org default; data access in `src/data/*` + hook; pgTAP for RLS + resolution precedence → Tasks B2, B4 (Deno DI for precedence; pgTAP for RLS in B1) ✓
- §9 Testing: pure (`mapRows`, fee precedence), component (steps, FeeStep), edge (import-sheet-dates DI, generate-hire-orders DI), DB (both pgTAP files), live verify → covered across A1-A5, B1-B4, C1 ✓

**2. Placeholder scan** — no "TBD"/"handle edge cases"/"similar to Task N". Every task carries real SQL/TS/test code or names an exact existing file to mirror (`casts_capabilities.sql`, `show_date_skill_drops.sql`, `airtable-poll/index.di.test.ts`, `fetch-remote-sheet/index.di.test.ts`, `SourceStep.tsx`, `OrderDefaultsCard.tsx`, `triggerAirtableSyncNow`) — those are project-harness patterns that must be read for exact shapes, not hidden design work. The one genuinely deferred sub-decision (new-date ids: extend the RPC vs re-select) is called out explicitly in Task A3 step 5 with instructions to keep the RPC + pgTAP in sync whichever is chosen.

**3. Type consistency** — `SheetColumnMap`/`SheetDateRaw` defined in Task A2 are consumed by A4 (`importSheetDates(rows)`), A5 (`mapSheetRows`), and match the edge fn body `{ org_id, rows }` in A3. `SheetImportResult { processed, new_dates, updated, held, tiers_opened }` is identical in A3 (response), A4 (`importSheetDates` return), and the FeeStep-independent CitiesStep result render (A5). `CastProductionFee { id, cast_id, show_id, fee_amount, currency, fee_basis }` in B2 matches the table columns in B1 and the `resolveCastProductionFee` lookup in B4. `FeeBasis` is imported from the existing `@/lib/hireOrders/feeBasis` everywhere (B1 default `'per_date'`, B2, B3). The RPC contract `import_sheet_dates(p_org uuid, p_rows jsonb) → { new_count, updated_count[, new_ids] }` is identical in A1 (definition + pgTAP) and A3 (call site) — if A3 step 5 extends it with `new_ids`, A1's pgTAP is updated in the same cycle.

## Execution notes

- **Part A and Part B are independent** and can be built in parallel by two workers; within each, tasks are mostly sequential (A1→A2→A3→A4→A5; B1→B2→B3, with B4 depending only on B1). Task C1 is last and depends on everything.
- **Migrations first within each part** (A1, B1) so types regenerate before the data-access/edge tasks that consume the new schema. Give the two migrations distinct version timestamps; regenerate + `sync:mirrors` after each; never hand-apply to prod.
- After each task: run that task's tests + the relevant typecheck (`tsc -p tsconfig.app.json` for `src/`, `deno check` for edge); two-stage review (correctness + convention) gates each commit.
- Do not flip the `getrunning_v3` flag, do not touch v1 files or `HireOrderSetupStatus`/`useHireOrderSetup`, and do not open the PR until C1's `verify:full` + live visual verification are green. The owner opens/approves the PR (`main` requires review approval).
