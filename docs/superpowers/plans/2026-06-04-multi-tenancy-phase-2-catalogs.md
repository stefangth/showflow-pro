# Multi-Tenancy Phase 2 — Catalogs, Per-Org Settings & Editor Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Validated **CI-driven** (no local Supabase/Docker/Node on the authoring box): author → push → GitHub Actions (`gh pr checks <PR#>`) is the oracle. Deno is available locally; pgTAP/Vitest/tsc run in CI.

**Goal:** Make settings, catalogs, and editor config truly **per-org** — turn `app_settings.org_id` into the nullable platform-default mechanism (`NULL` = platform baseline), add an org-aware settings resolver (DB + frontend), scope the editor config and catalog writes to the active org, swap the deferred `app_settings`/`artists` uniqueness (plus `skills`/`cities`), and ship a `seed_org_starter_catalog()` function so a newly-provisioned org starts with a usable catalog.

**Architecture:** One resolver rule everywhere — `effective(org, key) = app_settings[org_id = org] ?? app_settings[org_id IS NULL]`. The DB encodes it in `get_org_setting(_org, _key)` (used by the status triggers); the frontend encodes it in `resolveOrgSetting(client, orgId, key, fallback)`. Writes from the org-scoped UI always carry `org_id = currentOrg` and upsert on `(org_id, key)`; platform defaults (`org_id IS NULL`) are operator/super-admin-managed. A RESTRICTIVE policy fix lets every member **read** platform defaults but only super-admin **write** them. The seed function copies a platform-default `starter_catalog_template` JSON blob into a new org's `skills`/`cities`/`casts` and seeds its slot defaults.

**Tech Stack:** Supabase Postgres 17 + RLS + pgTAP (`supabase test db`, CLI pinned 2.98.2), React 18 + Vite + TS, `@tanstack/react-query` v5, Vitest (`src/test/supabaseFake.ts` fake client + `src/test/fixtures.ts`), generated `src/integrations/supabase/types.ts`.

**Spec:** `docs/superpowers/specs/2026-06-03-multi-tenancy-design.md` — §3 (per-org catalogs), §4.3 (`app_settings` nullable `org_id`, `artists` uniqueness), §5.2–5.3 (RLS), §7.2 (settings resolver), §8 (`seed`/starter template), §11 Phase 2.
**Builds on:** Phase 0 (`…-phase-0-foundation.md`) + Phase 1 (`…-phase-1-auth-switcher.md`), both merged to `dev`.

---

## Current-state ground truth (verified live against project `epweartpzwvcasrzyueh`, 2026-06-04)

All multi-tenancy migrations through `20260603150000` are applied. Before writing code, know exactly what exists:

- **`app_settings`**: `org_id uuid NOT NULL DEFAULT '…b007'` (bootstrap); still `UNIQUE(key)` (`app_settings_key_key`); index `idx_app_settings_org`. **All 14 rows are `org_id = bootstrap`; zero `NULL` (platform) rows.** No `sub_program_slots_defaults` or `editor_*` rows exist in prod yet (UI falls back to code defaults).
- **RLS on `app_settings`** (live): RESTRICTIVE `org_isolation` `USING/CHECK (is_org_member(auth.uid(), org_id))`; PERMISSIVE `SELECT USING (true)`; PERMISSIVE INSERT/UPDATE/DELETE `has_org_role(auth.uid(), org_id, 'admin')`. ⇒ **`org_id IS NULL` rows are currently unreadable** by non-super-admins (`is_org_member(uid, NULL)` is false). This must be fixed for the resolver to work.
- **`is_org_member`** is the clean form (no `user_roles`/bootstrap fallback): `is_super_admin(_uid) OR EXISTS(org_memberships WHERE user_id=_uid AND org_id=_org)`. `is_super_admin`, `has_org_role(uid, org, role)` exist.
- **Every tenant table still has `org_id DEFAULT '…b007'`** (shows, artists, bookings, skills, cities, casts, cast_members, app_settings, …). Phase 1 did **not** remove the defaults — the app is still org-unaware on the write side; inserts that omit `org_id` land in the bootstrap org.
- **Status triggers read slot defaults with NO org filter** (source: `20260514000000_slots_from_settings.sql`):
  - `compute_show_date_status(p_show_date_id)` does `SELECT value INTO v_settings FROM app_settings WHERE key='sub_program_slots_defaults'`.
  - `sync_show_dates_on_settings_update()` (trigger `AFTER UPDATE ON app_settings`) loops **all** `show_dates` when `NEW.key='sub_program_slots_defaults'`.
- **Catalog uniqueness is global**: `skills_name_key UNIQUE(name)`, `cities_name_key UNIQUE(name)`. `artists_user_id_key UNIQUE(user_id)` is global. `casts` has no name-unique. `cast_members(cast_id,artist_id)`, `artist_skills(artist_id,skill_id)`, `cast_city_priority(cast_id,city_id)` + `(city_id,priority)` are already naturally org-consistent (their FKs are org-scoped).
- **Frontend settings/editor surface**:
  - `src/data/settings.ts` — `fetchSlotDefaults(client)` (`.eq('key',…).maybeSingle()`, no org) + `fetchProgramSubProgramPairs(client)`.
  - `src/hooks/useSubProgramSlots.ts` — inline slot-defaults read (no org) + `effectiveSlots()` helper.
  - `src/hooks/useSettingsWarnings.ts` — uses `fetchSlotDefaults` + pairs.
  - `src/components/filters/useFilterVisibility.ts` — reads `filters_visibility` (no org).
  - `src/features/editor/EditorContext.tsx` — reads `editor_page_access`/`editor_column_templates`/`editor_table_permissions` via `.in('key',[…])` (no org); writes via `upsertSetting(key,value)` → `.upsert({key,value},{onConflict:'key'})` (no org). Imports `useAuth()` but only uses `roles`.
  - `src/pages/SettingsPage.tsx` — reads all settings `.select('*').order('key')`; saves per-key `.update({value}).eq('key',K)`; catalog CRUD: `addCity` (`cities.insert({name})`), `addCastPriority` (`cast_city_priority.insert({…})`).
  - `src/data/skills.ts` — `createSkill(client, name)` → `skills.insert({name})`. `src/components/casts/CastDialog.tsx` — `casts.insert({name,description,created_by})`. `src/components/casts/CastDetailsSheet.tsx` — `cast_members.insert({cast_id,artist_id})`.
  - **Edge functions only READ `app_settings`** (no writes) — they are **Phase 3**, out of scope here. ⚠️ See the "Edge-function safety invariant" below.
- **`AuthContext`** exposes `currentOrg: Organization | null` (+ `currentOrgId` internal, `switchOrg`, `memberships`, `orgs`). `switchOrg` calls `queryClient.invalidateQueries()` (everything). localStorage key `showflow.currentOrg`.
- **Test harness**: `src/test/supabaseFake.ts` records calls; array-seed `when` matches recorded `.eq()` args; `.or`/`.is` are recorded but **not** used for filtering (so resolver tests seed exact rows and let the function's JS pick). `src/test/fixtures.ts` has `anArtist/aShowDate/aBooking/anOrganization/aMembership`.
- **CI gates** (`.github/workflows/ci.yml`) on a `dev`-targeted PR: **Lint**, **Typecheck** (`tsc -p tsconfig.app.json --noEmit`), **Unit** (`npm test`), **DB** (`supabase test db`, CLI 2.98.2), **Edge** (`deno test --node-modules-dir=none supabase/functions/`). **e2e is `main`-only** — not run here.

### Decisions locked with the owner (2026-06-04)

1. **Artists uniqueness swap is IN Phase 2** (bundled with the `app_settings` swap — its sibling Phase-0 deferral).
2. **Starter-catalog template = a platform-default `app_settings` row** (`starter_catalog_template`, `org_id IS NULL`), read by the seed function. No phantom template org.
3. **Catalog write-awareness IS in Phase 2** — interactive `skills`/`cities`/`casts`/`cast_members`/`cast_city_priority` inserts set `org_id = currentOrg`, so no catalog table is left on the bootstrap crutch. (Owner flagged a manual bootstrap `org_memberships` insert done in Phase 1 — that is the documented bootstrap-admin procedure and is required for the app to work post-Phase-1; it does not affect this plan. Note: after 2A, editing **platform** defaults needs `platform_admins` membership; a bootstrap **org** admin edit creates a bootstrap-org override, which is correct.)

### Two invariants this plan must preserve

- **Edge-function safety invariant.** The Phase-3 edge functions still read `sub_program_slots_defaults` (and other keys) via `.eq('key',K).maybeSingle()`, which **throws if more than one row** matches. Phase 2 converts the existing rows to a **single** platform-default row per key and creates **no** per-org rows (the seed function exists but is only called by Phase-4 provisioning). So `.maybeSingle()` keeps matching exactly one row. **Do not call `seed_org_starter_catalog` from any code path in Phase 2**, and do not create per-org `app_settings` rows for any org other than through the org-scoped UI save (which targets the current/bootstrap org and is still ≤1 row per key per org). Phase 3 makes the edge functions loop orgs before Phase 4 provisions real second orgs.
- **App-still-works invariant.** A single bootstrap org backs the running app through Phase 2. Converting existing settings to platform defaults keeps the bootstrap org resolving to the same values; catalog reads stay correct via RLS; catalog writes set `org_id = currentOrg` (= bootstrap today, so no behavior change now, correct later).

---

## Sub-iterations (each its own CI-green push on the Phase-2 PR → `dev`)

| # | Delivers | CI gate | Risk |
|---|----------|---------|------|
| **2A** | **DB settings core.** Migration: `app_settings.org_id` → nullable, drop default, convert existing rows → platform (`NULL`), swap `UNIQUE(key)` → `UNIQUE NULLS NOT DISTINCT (org_id, key)`, asymmetric RESTRICTIVE RLS (read NULL ok, write NULL super-admin only). `get_org_setting(_org,_key)`. Org-aware `compute_show_date_status` + `sync_show_dates_on_settings_update` (fire on INSERT/UPDATE/DELETE). New pgTAP `per_org_settings.sql` + `per_org_slot_resolution.sql`; migrate the 2 trigger tests' `ON CONFLICT`; types regen. | pgTAP + Typecheck (regen types) | **High** — coupled schema/RLS/trigger change |
| **2B** | **Frontend settings resolver + write path.** `resolveOrgSetting`/`upsertOrgSetting` in `src/data/settings.ts`; rewire `fetchSlotDefaults`, `useSubProgramSlots`, `useSettingsWarnings`, `useFilterVisibility`, and `SettingsPage` settings read/save to be org-scoped. | Vitest + Typecheck + Lint | Medium |
| **2C** | **Per-org editor config.** `EditorContext` reads/writes the 3 `editor_*` keys via the resolver, scoped to `currentOrg`; query keys include `orgId`. | Vitest + Typecheck + Lint | Low |
| **2D** | **Catalogs: per-org uniqueness + seed + CRUD org-awareness.** Migration: `skills`/`cities` → `UNIQUE(org_id,name)`; `artists` → `UNIQUE(org_id,user_id) WHERE user_id IS NOT NULL`; seed `starter_catalog_template` platform row; `seed_org_starter_catalog(_org)`. Rewire `createSkill`/`addCity`/cast/`cast_members`/`cast_city_priority` inserts to set `org_id`. pgTAP `seed_and_catalog_isolation.sql`; types regen. | pgTAP + Vitest + Typecheck + Lint | Medium |

**Order matters:** 2A lands the schema + resolver + RLS before 2B/2C consume them; 2D depends on 2A's `get_org_setting` (template read) and the platform-row mechanism. Author 2A, get it CI-green, then 2B → 2C → 2D. e2e for the org-scoped flows is validated only at the `dev → main` promotion (e2e is main-only) — flagged, not silently skipped.

---

## Conventions for every task

- **One PR → `dev`** (e.g. branch `feature/multi-tenancy-phase-2`). Each sub-iteration is one or more commits pushed to that PR; wait for green before the next.
- **Migrations are new timestamped files, never hand-edits of existing ones.** Name them `2026060412NNNN_<slug>.sql` under `supabase/migrations/` (after the last migration `20260603150000`). No local CLI: create the file directly. If you need the regenerated `types.ts`, apply the migration to the PR's Supabase **preview branch** via the Supabase MCP `apply_migration`, then `generate_typescript_types` against that branch ref and write the result to `src/integrations/supabase/types.ts` (never hand-edit it).
- **pgTAP red/green is observed in CI** (the `db-tests` job runs `supabase test db`). A "failing test" = `supabase test db` reports failures/errors. Watch it via `gh pr checks <PR#>` / the Actions log.
- **Bootstrap org UUID** constant: `00000000-0000-0000-0000-00000000b007`.
- **Vitest data-access pattern:** put reads/writes in `src/data/*.ts` taking `client` as a param; test with `createFakeSupabase` from `src/test/supabaseFake.ts`. Never hand-roll `vi.mock` of the client.
- **Commit after each task** with the message in its final step; end commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File structure

**Migrations created:**
- `…_app_settings_per_org.sql` (2A) — `app_settings` nullability/default/uniqueness/RLS; `get_org_setting`; org-aware `compute_show_date_status` + `sync_show_dates_on_settings_update`.
- `…_per_org_catalogs_and_seed.sql` (2D) — `skills`/`cities`/`artists` uniqueness; `starter_catalog_template` seed row; `seed_org_starter_catalog`.

**pgTAP tests created:**
- `supabase/tests/rls/per_org_settings.sql` (2A) — nullable-org reads/writes, uniqueness, `get_org_setting`.
- `supabase/tests/triggers/per_org_slot_resolution.sql` (2A) — per-org slot resolution drives `show_dates.status`.
- `supabase/tests/db/seed_and_catalog_isolation.sql` (2D) — seed copies template per-org; catalog isolation; per-org uniqueness.

**pgTAP tests modified (2A):**
- **All five** trigger tests that insert `sub_program_slots_defaults` via `ON CONFLICT (key)` → `ON CONFLICT (org_id, key)`: `compute_show_date_status.sql`, `recompute_and_timestamps.sql`, `promote_understudy_on_cancellation.sql`, `notify_booking_transition.sql`, `auto_cancel_on_slot_fill.sql`. (The latter three were found during execution — each inserts the slot-defaults row before any `show_dates` exist, so the new INSERT-firing cascade is a no-op.)
- `supabase/tests/rls/reference_tables.sql` — add a "member reads platform default" assertion if the file asserts `app_settings` reads (verify in 2A Task 5).

**Frontend created/modified:**
- `src/data/settings.ts` (2B) — add `resolveOrgSetting`, `upsertOrgSetting`; refactor `fetchSlotDefaults(client, orgId)`. + `src/data/settings.test.ts` (new).
- `src/hooks/useSubProgramSlots.ts`, `src/hooks/useSettingsWarnings.ts`, `src/components/filters/useFilterVisibility.ts` (2B) — pass `currentOrg.id`.
- `src/pages/SettingsPage.tsx` (2B settings read/save; 2D catalog inserts).
- `src/features/editor/EditorContext.tsx` (2C) + `src/features/editor/orgEditorConfig.test.ts` (new, if a pure helper is extracted).
- `src/data/skills.ts`, `src/components/casts/CastDialog.tsx`, `src/components/casts/CastDetailsSheet.tsx` (2D) — set `org_id`.

**Generated (not hand-edited):** `src/integrations/supabase/types.ts` (regen in 2A and 2D).

---

# Sub-iteration 2A — DB settings core

## Task 2A.1: pgTAP for per-org `app_settings` (resolver, nullability, uniqueness, RLS)

**Files:** Create `supabase/tests/rls/per_org_settings.sql`.

- [ ] **Step 1: Write the failing pgTAP test.** Create `supabase/tests/rls/per_org_settings.sql`:

```sql
-- Per-org app_settings: platform default (org_id IS NULL) is readable by any member,
-- a per-org row overrides it, members cannot WRITE platform rows, super-admin can,
-- get_org_setting() resolves org ?? platform, and the (org_id,key) unique allows the
-- same key across orgs + one platform row.
--
--   aaaa…0001 super-admin   aaaa…00a2 org-A admin   aaaa…00b2 org-B admin
--   0000…a000 org A         0000…b000 org B
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-aaaa-0001-0000-000000000000','authenticated','authenticated','s-super@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-00a2-0000-000000000000','authenticated','authenticated','s-aadmin@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-aaaa-00b2-0000-000000000000','authenticated','authenticated','s-badmin@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000a000','S A','s-a'),
  ('00000000-0000-0000-0000-00000000b000','S B','s-b');
INSERT INTO public.platform_admins (user_id) VALUES ('aaaaaaaa-aaaa-0001-0000-000000000000');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000a000','aaaaaaaa-aaaa-00a2-0000-000000000000','admin'),
  ('00000000-0000-0000-0000-00000000b000','aaaaaaaa-aaaa-00b2-0000-000000000000','admin');

-- platform default + an org-A override of the same key
INSERT INTO public.app_settings (org_id, key, value) VALUES
  (NULL, 'demo_key', '"platform"'::jsonb),
  ('00000000-0000-0000-0000-00000000a000', 'demo_key', '"orgA"'::jsonb);
SET session_replication_role = DEFAULT;

-- get_org_setting resolves org override, else platform, else null (definer; call directly)
SELECT is( public.get_org_setting('00000000-0000-0000-0000-00000000a000','demo_key'), '"orgA"'::jsonb, 'org A override wins');
SELECT is( public.get_org_setting('00000000-0000-0000-0000-00000000b000','demo_key'), '"platform"'::jsonb, 'org B falls back to platform default');
SELECT is( public.get_org_setting('00000000-0000-0000-0000-00000000b000','missing'), NULL, 'unknown key resolves to null');

-- ── reads under RLS ──
-- org-B admin sees the platform row (org_id IS NULL) and NOT org A's override
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-00b2-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.app_settings WHERE key='demo_key' AND org_id IS NULL),1,'member reads platform default');
SELECT is((SELECT count(*)::int FROM public.app_settings WHERE key='demo_key' AND org_id='00000000-0000-0000-0000-00000000a000'),0,'member cannot read another org override');
-- write-side: member admin cannot create a platform (NULL) row
SELECT throws_ok(
  $$INSERT INTO public.app_settings (org_id, key, value) VALUES (NULL,'sneak','"x"'::jsonb)$$,
  '42501', NULL, 'member admin cannot write a platform default');
-- member admin CAN upsert their own org row
SELECT lives_ok(
  $$INSERT INTO public.app_settings (org_id, key, value)
    VALUES ('00000000-0000-0000-0000-00000000b000','demo_key','"orgB"'::jsonb)
    ON CONFLICT (org_id, key) DO UPDATE SET value=EXCLUDED.value$$,
  'member admin upserts own org setting');
RESET ROLE;

-- super-admin CAN write a platform default
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-0001-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO public.app_settings (org_id, key, value) VALUES (NULL,'plat2','"y"'::jsonb)$$,
  'super-admin writes a platform default');
RESET ROLE;

-- ── uniqueness ──
-- same key allowed across two different orgs + the platform row (3 rows total)
SELECT is((SELECT count(*)::int FROM public.app_settings WHERE key='demo_key'),3,'demo_key exists for NULL, org A, org B');
-- duplicate platform row for a key is rejected (NULLS NOT DISTINCT)
SELECT throws_ok(
  $$INSERT INTO public.app_settings (org_id, key, value) VALUES (NULL,'demo_key','"dup"'::jsonb)$$,
  '23505', NULL, 'duplicate platform row for a key is rejected');
-- duplicate per-org row for a key is rejected
SELECT throws_ok(
  $$INSERT INTO public.app_settings (org_id, key, value) VALUES ('00000000-0000-0000-0000-00000000a000','demo_key','"dup"'::jsonb)$$,
  '23505', NULL, 'duplicate per-org row for a key is rejected');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Confirm it fails** (CI `db-tests`, or note for the run). Expected RED: `function public.get_org_setting(uuid, text) does not exist`, and (before the RLS fix) the "member reads platform default" / NULL-write assertions misbehave.

- [ ] **Step 3: Commit the test.**

```bash
git add supabase/tests/rls/per_org_settings.sql
git commit -m "test(p2): failing pgTAP for per-org app_settings + get_org_setting" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2A.2: Migration — `app_settings` per-org schema, RLS, resolver, org-aware triggers

**Files:** Create `supabase/migrations/2026060412 0000_app_settings_per_org.sql` (pick a concrete timestamp after `20260603150000`, e.g. `20260604120000_app_settings_per_org.sql`).

- [ ] **Step 1: Write the migration.**

```sql
-- Phase 2 (2A): make app_settings per-org with a platform-default tier.
--   • org_id becomes NULLABLE; NULL = platform default. Drop the bootstrap DEFAULT so
--     the org-scoped UI must set org_id explicitly (writers updated in 2B/2C).
--   • Existing bootstrap-org rows BECOME platform defaults (org_id → NULL): the bootstrap
--     org then resolves to them, and every future org inherits them with zero config.
--   • UNIQUE(key) → UNIQUE NULLS NOT DISTINCT (org_id, key): one platform row per key,
--     one row per (org,key). NULLS NOT DISTINCT (PG15+; project is PG17) makes the
--     single NULL platform row enforceable AND lets supabase-js upsert infer it via
--     onConflict:'org_id,key'.
--   • RLS: members may READ platform rows (org_id IS NULL) but only super-admin may WRITE
--     them (asymmetric RESTRICTIVE policy — read allows NULL, write does not).
--   • get_org_setting(org,key): org override ?? platform default. Used by the triggers.
--   • compute_show_date_status / sync_show_dates_on_settings_update become org-aware.

-- 1) Nullability + default.
alter table public.app_settings alter column org_id drop default;
alter table public.app_settings alter column org_id drop not null;

-- 2) Existing global settings rows become platform defaults.
update public.app_settings
  set org_id = null
  where org_id = '00000000-0000-0000-0000-00000000b007';

-- 3) Uniqueness swap. (Confirmed live constraint name: app_settings_key_key.)
alter table public.app_settings drop constraint app_settings_key_key;
alter table public.app_settings
  add constraint app_settings_org_key_uniq unique nulls not distinct (org_id, key);

-- 4) RLS: replace app_settings' restrictive isolation so platform (NULL) rows are
--    READABLE by members but only WRITABLE by super-admin. Other tables' org_isolation
--    is untouched (only app_settings has nullable org_id / platform defaults).
drop policy if exists org_isolation on public.app_settings;
create policy org_isolation on public.app_settings as restrictive for all to authenticated
  using      ( org_id is null or public.is_org_member(auth.uid(), org_id) )
  with check ( public.is_org_member(auth.uid(), org_id) );  -- NULL org ⇒ super-admin only

-- 5) Resolver: org override ?? platform default. SECURITY DEFINER so callers (incl. the
--    status triggers) resolve correctly regardless of RLS. (org_id IS NULL) sorts last.
create or replace function public.get_org_setting(_org uuid, _key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.app_settings
  where key = _key and (org_id = _org or org_id is null)
  order by (org_id is null)
  limit 1
$$;

-- 6) compute_show_date_status: resolve slot defaults for the show_date's OWN org.
create or replace function public.compute_show_date_status(p_show_date_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_current      show_date_status;
  v_program      text;
  v_sub_program  text;
  v_org          uuid;
  v_settings     jsonb;
  v_main_cap     int;
  v_us_cap       int;
  v_conf_main    int;
  v_conf_us      int;
  v_active       int;
  v_new          show_date_status;
begin
  select sd.status, s.program, s.sub_program, sd.org_id
    into v_current, v_program, v_sub_program, v_org
  from show_dates sd join shows s on s.id = sd.show_id
  where sd.id = p_show_date_id;

  if not found or v_current = 'cancelled' then
    return;
  end if;

  v_settings := public.get_org_setting(v_org, 'sub_program_slots_defaults');

  if v_program is not null and v_sub_program is not null and v_settings is not null then
    v_main_cap := nullif(v_settings -> v_program -> v_sub_program ->> 'main_cast', '')::int;
    v_us_cap   := nullif(v_settings -> v_program -> v_sub_program ->> 'understudies', '')::int;
  end if;

  select
    count(*) filter (where status = 'confirmed' and not is_understudy),
    count(*) filter (where status = 'confirmed' and is_understudy),
    count(*) filter (where status != 'cancelled')
  into v_conf_main, v_conf_us, v_active
  from bookings where show_date_id = p_show_date_id;

  if v_main_cap is null or v_us_cap is null then
    v_new := case when v_active > 0 then 'partially_filled' else 'open' end;
  elsif v_conf_main >= v_main_cap and v_conf_us >= v_us_cap then
    v_new := 'fully_filled';
  elsif v_active > 0 then
    v_new := 'partially_filled';
  else
    v_new := 'open';
  end if;

  update show_dates set status = v_new where id = p_show_date_id;
end;
$$;

-- 7) Settings-cascade: recompute the AFFECTED org's show_dates (or all, when the platform
--    default changes — every date resolves its own effective value). Fire on I/U/D so
--    creating/removing a per-org override also recomputes.
create or replace function public.sync_show_dates_on_settings_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_key text; v_org uuid;
begin
  v_key := coalesce(NEW.key, OLD.key);
  v_org := coalesce(NEW.org_id, OLD.org_id);
  if v_key is distinct from 'sub_program_slots_defaults' then
    return null;
  end if;
  if v_org is not null then
    for r in select id from show_dates where org_id = v_org loop
      perform public.compute_show_date_status(r.id);
    end loop;
  else
    for r in select id from show_dates loop
      perform public.compute_show_date_status(r.id);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists sync_show_dates_on_settings_update_trigger on public.app_settings;
create trigger sync_show_dates_on_settings_update_trigger
  after insert or update or delete on public.app_settings
  for each row execute function public.sync_show_dates_on_settings_update();
```

- [ ] **Step 2: (Type regen prep)** Apply this migration to the PR's Supabase preview branch via the MCP `apply_migration` (name `app_settings_per_org`, the SQL above), so 2A Step 5 can regen types. If no preview branch is wired, defer regen to Task 2A.6 and rely on CI's `db-tests` to apply it.

- [ ] **Step 3: Confirm `per_org_settings.sql` now passes** (CI `db-tests`). Expected: all 11 green. The legacy trigger tests `compute_show_date_status.sql` / `recompute_and_timestamps.sql` now **fail** on `ON CONFLICT (key)` (the unique is gone) — fixed in Task 2A.4.

- [ ] **Step 4: Commit.**

```bash
git add supabase/migrations
git commit -m "feat(p2): app_settings per-org schema, RLS, get_org_setting, org-aware triggers" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2A.3: pgTAP — per-org slot resolution drives `show_dates.status`

**Files:** Create `supabase/tests/triggers/per_org_slot_resolution.sql`.

This is Phase 2's headline DB proof: two orgs, different effective slot caps, independent `show_dates.status`.

- [ ] **Step 1: Write the test.**

```sql
-- Per-org slot resolution: org A overrides sub_program_slots_defaults; org B inherits the
-- platform default. The SAME (program, sub_program) + one confirmed main booking yields
-- DIFFERENT status per org because each show_date resolves its own org's effective caps.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000a000','Slot A','slot-a'),
  ('00000000-0000-0000-0000-00000000b000','Slot B','slot-b');

-- platform default: theatre/musical needs main_cast=1 (one confirmed main ⇒ fully_filled)
INSERT INTO public.app_settings (org_id, key, value) VALUES
  (NULL, 'sub_program_slots_defaults', '{"theatre":{"musical":{"main_cast":1,"understudies":0}}}'::jsonb),
-- org A override: needs main_cast=2 (one confirmed main ⇒ only partially_filled)
  ('00000000-0000-0000-0000-00000000a000','sub_program_slots_defaults','{"theatre":{"musical":{"main_cast":2,"understudies":0}}}'::jsonb);

INSERT INTO public.shows (id, program, sub_program, org_id) VALUES
  ('cccccccc-aa00-0000-0000-000000000000','theatre','musical','00000000-0000-0000-0000-00000000a000'),
  ('cccccccc-bb00-0000-0000-000000000000','theatre','musical','00000000-0000-0000-0000-00000000b000');
INSERT INTO public.artists (id, name, org_id) VALUES
  ('bbbbbbbb-aa00-0000-0000-000000000000','A artist','00000000-0000-0000-0000-00000000a000'),
  ('bbbbbbbb-bb00-0000-0000-000000000000','B artist','00000000-0000-0000-0000-00000000b000');
INSERT INTO public.show_dates (id, show_id, date, session_1, org_id) VALUES
  ('dddddddd-aa00-0000-0000-000000000000','cccccccc-aa00-0000-0000-000000000000','2099-09-01','19:00','00000000-0000-0000-0000-00000000a000'),
  ('dddddddd-bb00-0000-0000-000000000000','cccccccc-bb00-0000-0000-000000000000','2099-09-01','19:00','00000000-0000-0000-0000-00000000b000');
SET session_replication_role = DEFAULT;

-- one confirmed main booking on each org's date (bookings trigger recomputes status)
INSERT INTO public.bookings (show_date_id, artist_id, status, is_understudy, org_id) VALUES
  ('dddddddd-aa00-0000-0000-000000000000','bbbbbbbb-aa00-0000-0000-000000000000','confirmed',false,'00000000-0000-0000-0000-00000000a000'),
  ('dddddddd-bb00-0000-0000-000000000000','bbbbbbbb-bb00-0000-0000-000000000000','confirmed',false,'00000000-0000-0000-0000-00000000b000');

SELECT is((SELECT status::text FROM public.show_dates WHERE id='dddddddd-bb00-0000-0000-000000000000'),
          'fully_filled', 'org B (platform default cap=1) → fully_filled');
SELECT is((SELECT status::text FROM public.show_dates WHERE id='dddddddd-aa00-0000-0000-000000000000'),
          'partially_filled', 'org A (override cap=2) → partially_filled with one main');

-- updating org A's override to cap=1 cascades to A's date only → fully_filled
UPDATE public.app_settings
  SET value='{"theatre":{"musical":{"main_cast":1,"understudies":0}}}'::jsonb
  WHERE org_id='00000000-0000-0000-0000-00000000a000' AND key='sub_program_slots_defaults';
SELECT is((SELECT status::text FROM public.show_dates WHERE id='dddddddd-aa00-0000-0000-000000000000'),
          'fully_filled', 'lowering org A override recomputes A''s date to fully_filled');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Confirm it passes** (CI `db-tests`, after 2A.2 is applied). Expected: 3 green.

- [ ] **Step 3: Commit.**

```bash
git add supabase/tests/triggers/per_org_slot_resolution.sql
git commit -m "test(p2): per-org slot resolution drives show_date status" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2A.4: Migrate the two legacy trigger tests off `ON CONFLICT (key)`

**Files:** Modify `supabase/tests/triggers/compute_show_date_status.sql`, `supabase/tests/triggers/recompute_and_timestamps.sql`.

After the uniqueness swap there is no `UNIQUE(key)`, so `ON CONFLICT (key)` errors. Both files insert slot defaults with `org_id` omitted → now lands as a **platform default** (`org_id IS NULL`), which the bootstrap-org show_dates resolve to. Only the conflict target changes.

- [ ] **Step 1: `compute_show_date_status.sql`** — replace the fixture insert (lines ~27–32):

```sql
INSERT INTO public.app_settings (key, value)
VALUES (
  'sub_program_slots_defaults',
  '{"theatre": {"musical": {"main_cast": 2, "understudies": 1}}}'::jsonb
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

with:

```sql
INSERT INTO public.app_settings (key, value)
VALUES (
  'sub_program_slots_defaults',
  '{"theatre": {"musical": {"main_cast": 2, "understudies": 1}}}'::jsonb
)
ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value;
```

- [ ] **Step 2: `recompute_and_timestamps.sql`** — make the same `ON CONFLICT (key)` → `ON CONFLICT (org_id, key)` change in its fixture insert (lines ~38–43). The two later `UPDATE … WHERE key='sub_program_slots_defaults'` statements (lines ~87–89, ~100–102) are unchanged — they match the single platform row and the (now I/U/D, org-aware) cascade recomputes the bootstrap org's dates.

- [ ] **Step 3: Confirm both files pass** (CI `db-tests`). Expected: `compute_show_date_status.sql` 8 green, `recompute_and_timestamps.sql` 5 green, plus the org-coverage/isolation/helpers suites still green.

- [ ] **Step 4: Commit.**

```bash
git add supabase/tests/triggers/compute_show_date_status.sql supabase/tests/triggers/recompute_and_timestamps.sql
git commit -m "test(p2): migrate trigger fixtures to ON CONFLICT (org_id, key)" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2A.5: Reconcile `reference_tables.sql` + confirm full suite green

**Files:** Possibly modify `supabase/tests/rls/reference_tables.sql`.

- [ ] **Step 1: Inspect** `supabase/tests/rls/reference_tables.sql` for any `app_settings` assertions. Its inserts that omit `org_id` previously defaulted to bootstrap; they now insert `org_id IS NULL` (platform). If it asserts an authenticated member can read an `app_settings` row, that still holds (platform rows are member-readable). If it inserts an `app_settings` row and then asserts a non-admin **cannot write**, that holds. **Only** change an assertion if it breaks *because of* the intended platform-default semantics — and if so, add a focused assertion that a member reads the platform default (mirroring `per_org_settings.sql`). Do not weaken the admin-write guard.

- [ ] **Step 2: Confirm the entire pgTAP suite is green** (CI `db-tests`): `per_org_settings`, `per_org_slot_resolution`, `compute_show_date_status`, `recompute_and_timestamps`, `org_coverage`, `org_isolation`, `org_helpers_and_platform`, `reference_tables`, and the rest.

- [ ] **Step 3: Commit** (only if `reference_tables.sql` changed).

```bash
git add supabase/tests/rls/reference_tables.sql
git commit -m "test(p2): reconcile reference_tables app_settings reads to platform defaults" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2A.6: Regenerate types; confirm Typecheck/Vitest still green

**Files:** Modify (generated) `src/integrations/supabase/types.ts`.

- [ ] **Step 1: Regenerate** via MCP `generate_typescript_types` (preview branch ref) → write to `src/integrations/supabase/types.ts`. Confirm `app_settings.Row.org_id` is now `string | null` and `app_settings.Insert.org_id` is optional/nullable; `get_org_setting` appears under `Functions`.

- [ ] **Step 2: Confirm Typecheck + Vitest green** (CI `typecheck` + `unit-tests`). The frontend still reads `app_settings` without `org_id` (rewired in 2B); the nullable `org_id` on `Row` does not break reads. If `tsc` flags a now-`null`-able `org_id` somewhere that destructures it, that call site is rewired in 2B/2C — note it, don't patch ad hoc.

- [ ] **Step 3: Commit.**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(p2): regenerate types for nullable app_settings.org_id + get_org_setting" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

**Push → confirm the full dev-PR gate (Lint, Typecheck, Vitest, pgTAP, Deno) is green before 2B.**

---

# Sub-iteration 2B — Frontend settings resolver + write path

## Task 2B.1: `resolveOrgSetting` + `upsertOrgSetting` (data-access, test-first)

**Files:** Create `src/data/settings.test.ts`; Modify `src/data/settings.ts`.

- [ ] **Step 1: Write the failing test.** Create `src/data/settings.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { resolveOrgSetting, upsertOrgSetting } from "./settings";

describe("resolveOrgSetting", () => {
  it("returns the org override when present", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: "o1", value: "orgA" }, { org_id: null, value: "plat" }], error: null },
    });
    expect(await resolveOrgSetting(fake as never, "o1", "k", "def")).toBe("orgA");
  });

  it("falls back to the platform default (org_id null) when no override", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: null, value: "plat" }], error: null },
    });
    expect(await resolveOrgSetting(fake as never, "o1", "k", "def")).toBe("plat");
  });

  it("returns the fallback when no row matches", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    expect(await resolveOrgSetting(fake as never, "o1", "k", "def")).toBe("def");
  });

  it("queries platform-only with .is when orgId is null", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [{ org_id: null, value: "plat" }], error: null } });
    expect(await resolveOrgSetting(fake as never, null, "k", "def")).toBe("plat");
    expect(fake.calls).toContainEqual({ table: "app_settings", method: "is", args: ["org_id", null] });
  });

  it("throws on query error", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: { message: "boom" } } });
    await expect(resolveOrgSetting(fake as never, "o1", "k", "def")).rejects.toBeTruthy();
  });
});

describe("upsertOrgSetting", () => {
  it("upserts with org_id + key and conflict target org_id,key", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: null } });
    await upsertOrgSetting(fake as never, "o1", "k", { a: 1 } as never);
    expect(fake.calls).toContainEqual({
      table: "app_settings", method: "upsert",
      args: [{ org_id: "o1", key: "k", value: { a: 1 } }, { onConflict: "org_id,key" }],
    });
  });

  it("throws on upsert error", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: { message: "no" } } });
    await expect(upsertOrgSetting(fake as never, "o1", "k", {} as never)).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `resolveOrgSetting`/`upsertOrgSetting` not exported.

- [ ] **Step 3: Implement** in `src/data/settings.ts` (append + refactor). Add imports at top: `import type { Json } from "@/integrations/supabase/types";`

```typescript
interface SettingRow { org_id: string | null; value: unknown }

/**
 * Effective value for a setting: the org's own row if present, else the platform
 * default (org_id IS NULL), else `fallback`. One round-trip. Mirrors get_org_setting()
 * in the DB. When orgId is null, only the platform default is consulted.
 */
export async function resolveOrgSetting<T>(
  client: SupabaseClient<Database>,
  orgId: string | null,
  key: string,
  fallback: T,
): Promise<T> {
  let q = client.from("app_settings").select("org_id, value").eq("key", key);
  q = orgId ? q.or(`org_id.eq.${orgId},org_id.is.null`) : q.is("org_id", null);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as SettingRow[];
  const orgRow = orgId ? rows.find((r) => r.org_id === orgId) : undefined;
  const platformRow = rows.find((r) => r.org_id === null);
  const chosen = orgRow ?? platformRow;
  return (chosen ? (chosen.value as T) : fallback);
}

/** Upsert a per-org setting override (org_id,key). Platform defaults are super-admin-only. */
export async function upsertOrgSetting(
  client: SupabaseClient<Database>,
  orgId: string,
  key: string,
  value: Json,
): Promise<void> {
  const { error } = await client
    .from("app_settings")
    .upsert({ org_id: orgId, key, value }, { onConflict: "org_id,key" });
  if (error) throw error;
}
```

Refactor `fetchSlotDefaults` to take `orgId` and use the resolver:

```typescript
/** The sub_program_slots_defaults effective for an org (or {}). */
export async function fetchSlotDefaults(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<NestedSlotDefaults> {
  return resolveOrgSetting<NestedSlotDefaults>(client, orgId, "sub_program_slots_defaults", {});
}
```

- [ ] **Step 4: Run, expect PASS.** Commit.

```bash
git add src/data/settings.ts src/data/settings.test.ts
git commit -m "feat(p2): org-aware settings resolver (resolveOrgSetting/upsertOrgSetting)" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2B.2: Thread `currentOrg` through the settings read hooks

**Files:** Modify `src/hooks/useSubProgramSlots.ts`, `src/hooks/useSettingsWarnings.ts`, `src/components/filters/useFilterVisibility.ts`.

- [ ] **Step 1: `useSubProgramSlots.ts`** — use the resolver, keyed by org. Replace the hook body (keep `SubProgramSlotConfig`, `NestedSlotDefaults`, `effectiveSlots` exactly as-is):

```typescript
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { fetchSlotDefaults } from '@/data/settings';

// …SubProgramSlotConfig + NestedSlotDefaults unchanged…

export function useSubProgramSlots(): NestedSlotDefaults {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const { data } = useQuery({
    queryKey: ['app-settings', 'sub_program_slots_defaults', orgId],
    queryFn: () => fetchSlotDefaults(supabase, orgId),
  });
  return data ?? {};
}
```

> Note: `effectiveSlots()` is unchanged — `src/data/settings.ts` imports `NestedSlotDefaults` from this file, so keep the type export here.

- [ ] **Step 2: `useSettingsWarnings.ts`** — pass org to `fetchSlotDefaults`, key by org:

```typescript
export function useSettingsWarnings(): SettingsWarnings {
  const { hasRole, currentOrg } = useAuth();
  const canView = hasRole('admin') || hasRole('producer');
  const orgId = currentOrg?.id ?? null;

  const { data: pairs } = useQuery({
    queryKey: ['shows-program-sub-programs'],
    enabled: canView,
    queryFn: () => fetchProgramSubProgramPairs(supabase),
    staleTime: 60_000,
  });

  const { data: slotsSetting } = useQuery({
    queryKey: ['app-settings', 'sub_program_slots_defaults', orgId],
    enabled: canView,
    queryFn: () => fetchSlotDefaults(supabase, orgId),
    staleTime: 30_000,
  });

  return useMemo(() => computeSchedulingWarnings(pairs, slotsSetting), [pairs, slotsSetting]);
}
```

- [ ] **Step 3: `useFilterVisibility.ts`** — resolve `filters_visibility` per org. Replace its query:

```typescript
import { useAuth } from '@/features/auth/AuthContext';
import { resolveOrgSetting } from '@/data/settings';
// …
const { currentOrg } = useAuth();
const orgId = currentOrg?.id ?? null;
const { data, error } = useQuery({
  queryKey: ['app-settings', 'filters_visibility', orgId],
  queryFn: () => resolveOrgSetting(supabase, orgId, 'filters_visibility', /* existing default shape */ {} as FiltersVisibility),
});
// …use `data` exactly as before (same default fallback semantics)…
```

> Match the existing default-value type for `filters_visibility` already used in this file; pass it as the `fallback`, replacing the old `data?.value ?? <default>` logic.

- [ ] **Step 4:** Typecheck + Vitest green (CI). These hooks have no dedicated unit tests today; their data path (`fetchSlotDefaults` → `resolveOrgSetting`) is covered by 2B.1. Commit.

```bash
git add src/hooks/useSubProgramSlots.ts src/hooks/useSettingsWarnings.ts src/components/filters/useFilterVisibility.ts
git commit -m "feat(p2): scope slot-defaults + filter-visibility reads to the active org" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2B.3: `SettingsPage` — read effective values, save per-org overrides

**Files:** Modify `src/pages/SettingsPage.tsx`.

The current page reads every row (`.select('*')`) and saves with `.update({value}).eq('key',K)`. After 2A the global rows are platform defaults (`org_id IS NULL`); a bare `UPDATE … WHERE key=K` would either no-op or (for super-admins) clobber the platform default. The org-scoped Settings UI must **read the effective value** and **save an org override**.

- [ ] **Step 1: Read** — scope the settings load to the current org's effective view. Replace the settings query (lines ~409–416) so it fetches the org's rows **and** the platform rows, then resolves per key in-memory:

```typescript
const { currentOrg } = useAuth();
const orgId = currentOrg?.id ?? null;

const { data: settings, error } = useQuery({
  queryKey: ['app-settings', 'all', orgId],
  queryFn: async () => {
    let q = supabase.from('app_settings').select('key, value, org_id');
    q = orgId ? q.or(`org_id.eq.${orgId},org_id.is.null`) : q.is('org_id', null);
    const { data, error } = await q;
    if (error) throw error;
    // resolve: org row wins over platform row, per key
    const byKey = new Map<string, { value: unknown; org_id: string | null }>();
    for (const r of (data ?? []) as { key: string; value: unknown; org_id: string | null }[]) {
      const prev = byKey.get(r.key);
      if (!prev || (r.org_id !== null && prev.org_id === null)) byKey.set(r.key, { value: r.value, org_id: r.org_id });
    }
    return Array.from(byKey.entries()).map(([key, v]) => ({ key, value: v.value }));
  },
});
```

> Preserve whatever downstream shape the page expects (`settings` as `{key, value}[]`). If the page relied on other columns from `select('*')` (e.g. `id`, `updated_at`), confirm they are unused for the settings editor; the draft/save flow keys off `key`.

- [ ] **Step 2: Save** — replace the per-key `.update().eq('key', …)` mutation (lines ~428–436) with a per-org upsert:

```typescript
import { upsertOrgSetting } from '@/data/settings';
// …inside the save mutation…
mutationFn: async (updates: { key: string; value: Json }[]) => {
  if (!orgId) throw new Error('No active organization');
  for (const u of updates) {
    await upsertOrgSetting(supabase, orgId, u.key, u.value);
  }
},
```

- [ ] **Step 3: Invalidate** — on save success, invalidate `['app-settings']` (prefix-matches all org-scoped subkeys incl. `['app-settings','all',orgId]`, `['app-settings','sub_program_slots_defaults',orgId]`, editor keys). Keep/replace the existing `qc.invalidateQueries({ queryKey: ['app-settings'] })`.

- [ ] **Step 4:** Typecheck + Vitest + Lint green (CI). If a component test for `SettingsPage` exists, update its fake seed to the `{key,value,org_id}` shape; otherwise this path is exercised by 2B.1's data-access tests. Commit.

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat(p2): SettingsPage reads effective settings, saves per-org overrides" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **Behavioral note for the executor:** As a bootstrap-org admin, saving here creates bootstrap-org override rows (`org_id = bootstrap`); the platform defaults (`org_id IS NULL`) are untouched and continue to back every other org. Editing the *platform* defaults themselves requires `platform_admins` membership (Phase-4 console) — there is intentionally no UI to mutate `org_id IS NULL` rows here.

---

# Sub-iteration 2C — Per-org editor config

## Task 2C.1: Scope `EditorContext` reads/writes to the active org

**Files:** Modify `src/features/editor/EditorContext.tsx`.

- [ ] **Step 1: Read** — resolve the three editor keys for the current org (override ?? platform), keyed by org. Replace the config query (lines ~74–89):

```typescript
const { roles, currentOrg } = useAuth();
const orgId = currentOrg?.id ?? null;
// …
const { data: rawSettings, isLoading: isConfigLoading } = useQuery({
  queryKey: ['app-settings', 'editor', orgId],
  queryFn: async () => {
    let q = supabase.from('app_settings').select('key, value, org_id')
      .in('key', ['editor_page_access', 'editor_column_templates', 'editor_table_permissions']);
    q = orgId ? q.or(`org_id.eq.${orgId},org_id.is.null`) : q.is('org_id', null);
    const { data } = await q;
    // org row wins over platform row, per key
    const byKey = new Map<string, unknown>();
    for (const r of (data ?? []) as { key: string; value: unknown; org_id: string | null }[]) {
      if (!byKey.has(r.key) || r.org_id !== null) byKey.set(r.key, r.value);
    }
    return {
      pageAccess: (byKey.get('editor_page_access') ?? {}) as PageAccessConfig,
      columnTemplates: (byKey.get('editor_column_templates') ?? {}) as ColumnTemplates,
      tablePermissions: (byKey.get('editor_table_permissions') ?? {}) as TablePermissions,
    };
  },
  staleTime: 30_000,
});
```

> The `byKey` rule "org row wins" relies on at most one org row + one platform row per key (guaranteed by the `(org_id,key)` unique + the org-scoped `.or` filter). If a platform row is seen first then the org row overwrites it; if the org row is seen first, the platform row is skipped (`!has || org!==null` → for an already-set org value, `r.org_id!==null` is the platform row's check which is false, so it won't overwrite). ✔

- [ ] **Step 2: Write** — replace `upsertSetting` (lines ~95–101) to use the per-org upsert + the org-keyed cache:

```typescript
import { upsertOrgSetting } from '@/data/settings';
// …
const upsertSetting = useCallback(async (key: string, value: unknown) => {
  if (!orgId) throw new Error('No active organization');
  await upsertOrgSetting(supabase, orgId, key, value as Json);
  qc.invalidateQueries({ queryKey: ['app-settings', 'editor', orgId] });
}, [qc, orgId]);
```

- [ ] **Step 3:** Typecheck + Lint green (CI). Commit.

```bash
git add src/features/editor/EditorContext.tsx
git commit -m "feat(p2): per-org editor config (read effective, write org override)" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## Task 2C.2: Unit-test the editor key-resolution rule

**Files:** Create `src/features/editor/orgEditorConfig.ts`; Create `src/features/editor/orgEditorConfig.test.ts`; Modify `src/features/editor/EditorContext.tsx` to use the extracted helper.

Extract the in-memory "org row wins per key" reducer so it is unit-tested rather than buried in a `queryFn`.

- [ ] **Step 1: Failing test** (`orgEditorConfig.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { resolveEditorRows } from "./orgEditorConfig";

describe("resolveEditorRows", () => {
  it("prefers the org row over the platform row per key", () => {
    const rows = [
      { key: "editor_page_access", value: { "/x": ["admin"] }, org_id: null },
      { key: "editor_page_access", value: { "/x": ["producer"] }, org_id: "o1" },
    ];
    expect(resolveEditorRows(rows).pageAccess).toEqual({ "/x": ["producer"] });
  });
  it("falls back to platform when no org row", () => {
    const rows = [{ key: "editor_table_permissions", value: { t: { admin: "edit" } }, org_id: null }];
    expect(resolveEditorRows(rows).tablePermissions).toEqual({ t: { admin: "edit" } });
  });
  it("defaults to empty objects when absent", () => {
    expect(resolveEditorRows([])).toEqual({ pageAccess: {}, columnTemplates: {}, tablePermissions: {} });
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (`orgEditorConfig.ts`):

```typescript
import type { PageAccessConfig, ColumnTemplates, TablePermissions } from './types';

export interface EditorSettingRow { key: string; value: unknown; org_id: string | null }

/** Reduce org+platform app_settings rows to the effective editor config (org row wins per key). */
export function resolveEditorRows(rows: EditorSettingRow[]): {
  pageAccess: PageAccessConfig; columnTemplates: ColumnTemplates; tablePermissions: TablePermissions;
} {
  const byKey = new Map<string, unknown>();
  for (const r of rows) if (!byKey.has(r.key) || r.org_id !== null) byKey.set(r.key, r.value);
  return {
    pageAccess: (byKey.get('editor_page_access') ?? {}) as PageAccessConfig,
    columnTemplates: (byKey.get('editor_column_templates') ?? {}) as ColumnTemplates,
    tablePermissions: (byKey.get('editor_table_permissions') ?? {}) as TablePermissions,
  };
}
```

- [ ] **Step 4: Run, expect PASS.** Then refactor `EditorContext.tsx`'s `queryFn` (2C.1 Step 1) to `return resolveEditorRows((data ?? []) as EditorSettingRow[])`. Typecheck + Vitest green. Commit.

```bash
git add src/features/editor/orgEditorConfig.ts src/features/editor/orgEditorConfig.test.ts src/features/editor/EditorContext.tsx
git commit -m "feat(p2): extract + test per-org editor config resolution" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

**Push → confirm Lint, Typecheck, Vitest, pgTAP, Deno green before 2D.**

---

# Sub-iteration 2D — Catalogs: per-org uniqueness, seeding, CRUD org-awareness

## Task 2D.1: pgTAP — seed function + catalog isolation + per-org uniqueness

**Files:** Create `supabase/tests/db/seed_and_catalog_isolation.sql`.

- [ ] **Step 1: Write the failing test.**

```sql
-- seed_org_starter_catalog copies the platform starter template into ONE org's catalog;
-- per-org name uniqueness lets two orgs share a name; the seed is idempotent.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-0000000ca000','Cat A','cat-a'),
  ('00000000-0000-0000-0000-0000000cb000','Cat B','cat-b');
-- Platform starter template + slot defaults. The 2D migration ALREADY seeds a
-- starter_catalog_template platform row, so UPSERT to override it with this test's
-- deterministic 2-skill template (keeps the count assertions below exact). Unique is
-- (org_id,key) NULLS NOT DISTINCT, so a plain INSERT of (NULL,'starter_catalog_template')
-- would 23505 against the migration's seed.
INSERT INTO public.app_settings (org_id, key, value) VALUES
  (NULL, 'starter_catalog_template',
   '{"skills":["Vocals","Dance"],"cities":[],"casts":[{"name":"Main Cast","description":null}]}'::jsonb),
  (NULL, 'sub_program_slots_defaults', '{"theatre":{"musical":{"main_cast":1,"understudies":0}}}'::jsonb)
ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value;
SET session_replication_role = DEFAULT;

SELECT public.seed_org_starter_catalog('00000000-0000-0000-0000-0000000ca000');
SELECT public.seed_org_starter_catalog('00000000-0000-0000-0000-0000000cb000');
-- idempotent: a second call adds nothing
SELECT public.seed_org_starter_catalog('00000000-0000-0000-0000-0000000ca000');

SELECT is((SELECT count(*)::int FROM public.skills WHERE org_id='00000000-0000-0000-0000-0000000ca000'),2,'org A seeded 2 skills');
SELECT is((SELECT count(*)::int FROM public.skills WHERE org_id='00000000-0000-0000-0000-0000000ca000' AND name='Vocals'),1,'idempotent: still one Vocals in org A');
SELECT is((SELECT count(*)::int FROM public.casts WHERE org_id='00000000-0000-0000-0000-0000000ca000' AND name='Main Cast'),1,'org A seeded Main Cast');
-- both orgs can hold the SAME skill name (per-org uniqueness)
SELECT is((SELECT count(*)::int FROM public.skills WHERE name='Vocals'),2,'Vocals exists in BOTH orgs');
-- per-org slot defaults seeded for org A (a copy of the platform default)
SELECT is( public.get_org_setting('00000000-0000-0000-0000-0000000ca000','sub_program_slots_defaults')
             -> 'theatre' -> 'musical' ->> 'main_cast', '1', 'org A got its own slot defaults');
-- per-org name uniqueness rejects a duplicate WITHIN an org…
SELECT throws_ok(
  $$INSERT INTO public.skills (org_id, name) VALUES ('00000000-0000-0000-0000-0000000ca000','Vocals')$$,
  '23505', NULL, 'duplicate skill name within an org is rejected');
-- …but artists uniqueness is per (org,user): same user can be an artist in both orgs
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('aaaaaaaa-aaaa-0cu1-0000-000000000000','authenticated','authenticated','cu1@test.com',now(),'{"provider":"email"}','{}',now(),now());
SET session_replication_role = DEFAULT;
SELECT lives_ok(
  $$INSERT INTO public.artists (org_id, user_id, name) VALUES
      ('00000000-0000-0000-0000-0000000ca000','aaaaaaaa-aaaa-0cu1-0000-000000000000','A'),
      ('00000000-0000-0000-0000-0000000cb000','aaaaaaaa-aaaa-0cu1-0000-000000000000','A')$$,
  'same user can be an artist in two orgs');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Confirm it fails** (CI). Expected: `function public.seed_org_starter_catalog(uuid) does not exist` + the uniqueness assertions fail (global uniques still present).

- [ ] **Step 3: Commit the test.**

```bash
git add supabase/tests/db/seed_and_catalog_isolation.sql
git commit -m "test(p2): failing pgTAP for seed_org_starter_catalog + catalog isolation" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## Task 2D.2: Migration — per-org catalog/artist uniqueness, starter template, seed function

**Files:** Create `supabase/migrations/20260604121000_per_org_catalogs_and_seed.sql`.

- [ ] **Step 1: Write the migration.**

```sql
-- Phase 2 (2D): per-org catalogs.
--   • skills/cities name uniqueness becomes per-org so each org owns its own catalog.
--   • artists uniqueness becomes per (org, user) — the deferred Phase-0 swap — so one
--     person can be a separate artist per org (user_id stays nullable for unclaimed rows).
--   • A platform-default starter_catalog_template drives seeding.
--   • seed_org_starter_catalog(_org) copies the template into one org + seeds its slot
--     defaults. SECURITY DEFINER + idempotent. NOT called anywhere in Phase 2 (Phase-4
--     provisioning calls it) — see the edge-function safety invariant.

-- 1) Per-org catalog name uniqueness. (Confirmed live: skills_name_key, cities_name_key.)
alter table public.skills drop constraint if exists skills_name_key;
drop index if exists public.skills_name_key;
create unique index skills_org_name_uniq on public.skills(org_id, name);

alter table public.cities drop constraint if exists cities_name_key;
drop index if exists public.cities_name_key;
create unique index cities_org_name_uniq on public.cities(org_id, name);

-- 2) artists: per-(org,user) uniqueness (partial — unclaimed rows have NULL user_id).
alter table public.artists drop constraint if exists artists_user_id_key;
drop index if exists public.artists_user_id_key;
create unique index artists_org_user_uniq on public.artists(org_id, user_id) where user_id is not null;

-- 3) Platform starter template (product-agnostic; edit via the settings infra / SQL).
--    cities intentionally empty (venue cities are customer-specific).
insert into public.app_settings (org_id, key, value)
values (null, 'starter_catalog_template', '{
  "skills": ["Vocals","Dance","Acrobatics","Aerial","Juggling","Comedy","Magic","Live Music"],
  "cities": [],
  "casts": [{"name":"Main Cast","description":"Default cast"}]
}'::jsonb)
on conflict (org_id, key) do nothing;

-- 4) Seed function.
create or replace function public.seed_org_starter_catalog(_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tmpl jsonb; v_name text; v_cast jsonb; v_slots jsonb;
begin
  tmpl := public.get_org_setting(null, 'starter_catalog_template');
  if tmpl is null then return; end if;

  for v_name in select jsonb_array_elements_text(coalesce(tmpl->'skills','[]'::jsonb)) loop
    insert into public.skills (org_id, name) values (_org, v_name)
    on conflict (org_id, name) do nothing;
  end loop;

  for v_name in select jsonb_array_elements_text(coalesce(tmpl->'cities','[]'::jsonb)) loop
    insert into public.cities (org_id, name) values (_org, v_name)
    on conflict (org_id, name) do nothing;
  end loop;

  for v_cast in select * from jsonb_array_elements(coalesce(tmpl->'casts','[]'::jsonb)) loop
    insert into public.casts (org_id, name, description)
    select _org, v_cast->>'name', v_cast->>'description'
    where not exists (
      select 1 from public.casts c where c.org_id = _org and c.name = v_cast->>'name'
    );
  end loop;

  -- Give the org its own editable slot defaults (a copy of the platform default).
  v_slots := public.get_org_setting(null, 'sub_program_slots_defaults');
  if v_slots is not null then
    insert into public.app_settings (org_id, key, value)
    values (_org, 'sub_program_slots_defaults', v_slots)
    on conflict (org_id, key) do nothing;
  end if;
end;
$$;

-- Callable by service-role / definer flows (Phase-4 provision_org). Not granted to authenticated.
revoke all on function public.seed_org_starter_catalog(uuid) from public;
```

- [ ] **Step 2: Apply to the preview branch** via MCP `apply_migration` (for type regen in 2D.5) or rely on CI.
- [ ] **Step 3: Confirm `seed_and_catalog_isolation.sql` passes** (CI). Expected: 7 green. `org_coverage`/`org_isolation` still green (uniqueness changes don't touch `org_id`/RLS coverage).
- [ ] **Step 4: Commit.**

```bash
git add supabase/migrations
git commit -m "feat(p2): per-org catalog/artist uniqueness + seed_org_starter_catalog" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## Task 2D.3: Make `createSkill` org-aware (test-first)

**Files:** Modify `src/data/skills.ts`; Modify/extend `src/data/skills.test.ts` (create if absent).

- [ ] **Step 1: Failing test** — `createSkill` must send `org_id`:

```typescript
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { createSkill } from "./skills";

it("inserts a skill scoped to the given org", async () => {
  const fake = createFakeSupabase({ skills: { data: { id: "s1", name: "Vocals" }, error: null } });
  await createSkill(fake as never, "Vocals", "o1");
  expect(fake.calls).toContainEqual({ table: "skills", method: "insert", args: [{ name: "Vocals", org_id: "o1" }] });
});
```

- [ ] **Step 2: Run, expect FAIL** (signature/arg mismatch).
- [ ] **Step 3: Implement** — add an `orgId` param:

```typescript
export async function createSkill(
  client: SupabaseClient<Database>,
  name: string,
  orgId: string,
): Promise<Skill> {
  const trimmed = name.trim();
  const { data, error } = await client
    .from("skills")
    .insert({ name: trimmed, org_id: orgId })
    .select("id, name")
    .single();
  if (error) throw error;
  return data as Skill;
}
```

- [ ] **Step 4:** Update `useSkills`/its `useCreateSkill` mutation (in `src/hooks/useSkills.ts`) and the call site in `ArtistProfileSheet.tsx` to pass `currentOrg.id` from `useAuth()` (guard: throw/disable when no `currentOrg`). Run, expect PASS. Typecheck green. Commit.

```bash
git add src/data/skills.ts src/data/skills.test.ts src/hooks/useSkills.ts src/components/artists/ArtistProfileSheet.tsx
git commit -m "feat(p2): create skills scoped to the active org" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## Task 2D.4: Make the remaining catalog inserts org-aware

**Files:** Modify `src/pages/SettingsPage.tsx` (`addCity`, `addCastPriority`), `src/components/casts/CastDialog.tsx` (`casts`), `src/components/casts/CastDetailsSheet.tsx` (`cast_members`).

These are inline mutations, not `src/data/*` functions; set `org_id` explicitly using `currentOrg.id` from `useAuth()`. (`cast_members.cast_id` already implies the org, but stamping `org_id` keeps the row self-consistent and satisfies the parent-consistency rule in spec §12.)

- [ ] **Step 1: `SettingsPage.addCity`** — `supabase.from('cities').insert({ name })` → `insert({ name, org_id: orgId })` (reuse `orgId` from 2B.3; guard no-org).
- [ ] **Step 2: `SettingsPage.addCastPriority`** — add `org_id: orgId` to the `cast_city_priority` insert payload.
- [ ] **Step 3: `CastDialog`** — `casts.insert({ name, description, created_by })` → add `org_id: currentOrg.id` (pull `currentOrg` from `useAuth()`; disable submit when null).
- [ ] **Step 4: `CastDetailsSheet.addMember`** — `cast_members.insert({ cast_id, artist_id })` → add `org_id: currentOrg.id`.
- [ ] **Step 5:** Typecheck + Lint + Vitest green (CI). Commit.

```bash
git add src/pages/SettingsPage.tsx src/components/casts/CastDialog.tsx src/components/casts/CastDetailsSheet.tsx
git commit -m "feat(p2): stamp org_id on city/cast/cast_member/priority inserts" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## Task 2D.5: Regenerate types; final Phase-2 verification

**Files:** Modify (generated) `src/integrations/supabase/types.ts`.

- [ ] **Step 1: Regenerate** via MCP (preview branch) → write to `types.ts`. Confirm `seed_org_starter_catalog` appears under `Functions`; `skills`/`cities`/`artists` row shapes unchanged (only indexes changed).
- [ ] **Step 2: Final gate** — push and confirm **all** dev-PR checks green: Lint, Typecheck, Vitest, pgTAP (incl. `per_org_settings`, `per_org_slot_resolution`, `seed_and_catalog_isolation`, migrated trigger tests, unchanged `org_isolation`/`org_coverage`), Deno.
- [ ] **Step 3: Commit.**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(p2): regenerate types for seed function + per-org catalog indexes" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (run during planning)

**1. Spec coverage (§11 Phase 2 = "Starter-template seeding · per-org settings resolver · per-org editor config", gate "Vitest (resolver) + pgTAP (per-org settings)"):**
- Starter-template seeding → 2D.2 (`seed_org_starter_catalog` + `starter_catalog_template`) + pgTAP 2D.1. ✓
- Per-org settings resolver → DB `get_org_setting` (2A.2) + frontend `resolveOrgSetting` (2B.1, Vitest); applied to hooks (2B.2) + SettingsPage (2B.3). ✓
- Per-org editor config → 2C. ✓
- Gate: Vitest(resolver) = 2B.1; pgTAP(per-org settings) = 2A.1/2A.3. ✓
- Deferred Phase-0 items folded in per owner: `app_settings` uniqueness/nullability (2A.2), `artists` uniqueness (2D.2). ✓
- Spec §7.2 resolver, §5.3 (isolation never depends on the client filter — RLS still guards; the resolver's `.or(org,null)` only *selects*, never grants) ✓; §12 parent-consistency (org_id stamped server-trigger-side for status; client stamps catalog org_id) ✓.

**2. Failure-mode checks (spec §1):**
- *Data leak* — the asymmetric RLS (2A.2) allows reading platform (NULL) rows but blocks members writing them; `per_org_settings.sql` proves a member can't read another org's override nor write a platform row; `org_isolation` (unchanged on other tables) still green. ✓
- *Migration pain* — additive, mechanical migrations; the one risky coupling (drop default ⇄ writers set org_id) is bundled within 2A+2B and called out. ✓

**3. Invariants:** Edge-function `.maybeSingle()` safety — Phase 2 leaves exactly one platform row per key and creates no per-org rows except via the org-scoped UI (≤1 per (org,key)); `seed_org_starter_catalog` is defined but never invoked in Phase 2 (and `REVOKE`d from public). Documented at top + on 2D.2. ✓

**4. Type/name consistency:** `get_org_setting(_org uuid,_key text)`, `resolveOrgSetting(client,orgId,key,fallback)`, `upsertOrgSetting(client,orgId,key,value)`, `seed_org_starter_catalog(_org uuid)`, constraint `app_settings_org_key_uniq` (`UNIQUE NULLS NOT DISTINCT (org_id,key)`), indexes `skills_org_name_uniq`/`cities_org_name_uniq`/`artists_org_user_uniq`, template key `starter_catalog_template`, query-key prefix `['app-settings', …, orgId]` — used identically across DB, frontend, and tests. ✓

**5. Placeholder scan:** every code step carries full SQL/TS; the only "verify-then-edit" notes (constraint name `app_settings_key_key`, `reference_tables.sql` reconciliation, `filters_visibility` default shape) are guarded by confirmed live values or explicit inspection steps. ✓

**6. Known intentional change:** existing global settings become **platform defaults** (`org_id IS NULL`); the bootstrap org keeps working by inheriting them. Editing platform defaults now needs super-admin — flagged for the owner (2B.3 note). If the owner instead wants the bootstrap org's settings to remain org-scoped, that's a one-line change to 2A.2 Step 2 (set `org_id = bootstrap` rows aside) — raise before executing.

**7. Out of scope (correctly deferred):** edge functions looping orgs + per-(org,artist) digests (Phase 3); `/platform` console, `provision_org` calling the seed function, suspend/Enter/metrics (Phase 4); removing the bootstrap `org_id` DEFAULT from non-catalog tables (those inserts — shows/show_dates/bookings/chats — are Phase-3/Airtable/engine territory).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-04-multi-tenancy-phase-2-catalogs.md`. Sub-iterations 2A → 2B → 2C → 2D each land CI-green on one Phase-2 PR → `dev` (e2e is `main`-only, validated at promotion).

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task (using `superpowers:subagent-driven-development`), review each diff against this plan between tasks. Fits the established "Opus orchestrates, Sonnet/Haiku execute" pattern: Sonnet writes the migration/test/TS tasks; Opus reviews against the spec and the ground-truth facts above; the mechanical pgTAP-fixture and catalog-CRUD edits suit Haiku.
2. **Inline Execution** — I execute the tasks in this session using `superpowers:executing-plans`, batching with checkpoints for your review.

**Which approach — and shall I open the Phase-2 PR (branch `feature/multi-tenancy-phase-2`) to wire up CI first?**
