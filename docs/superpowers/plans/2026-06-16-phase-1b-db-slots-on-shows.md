# Phase 1b-DB — Slot Capacity Moves to `shows` (DB) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `shows.main_cast_slots` / `shows.understudy_slots` the source of truth for slot capacity at the DB level — `compute_show_date_status` reads the columns, slot edits on a show recompute its dates, and the `app_settings` slot-recompute trigger is retired.

**Architecture:** One additive migration on `shows`: two nullable `smallint` slot columns (NULL = unconfigured), a no-op-on-greenfield backfill from the old JSON, a rewrite of `compute_show_date_status()` to read the columns (preserving exact status semantics, with NULL caps → never `fully_filled`), the `shows` recompute trigger extended to fire on slot-column edits, and the `app_settings` recompute trigger + function dropped. pgTAP verifies status computation + the recompute path. **No frontend change** — the frontend still reads the (now-empty, harmless) `app_settings` JSON until Phase 1b-frontend swaps it; on greenfield (0 shows) there is no visible difference. Implements spec [§5 data model](../specs/2026-06-16-airtable-sync-engine-design.md) and supersedes the capacity-source half of [ADR-0006](../../adr/0006-db-computed-show-date-status.md).

**Tech Stack:** PostgreSQL (Supabase, project `epweartpzwvcasrzyueh`), pgTAP. No local Supabase CLI/Docker — **apply DDL with the Supabase MCP `apply_migration`, run pgTAP with the Supabase MCP `execute_sql`** (test files are `BEGIN … ROLLBACK`). CI runs `supabase test db`.

> **Migration-version note (learned in Phase 1a):** `apply_migration` records its OWN real-timestamp version, which won't match a hand-picked filename. So: apply first, then read `list_migrations`, then **name the repo migration file to the version that was actually recorded** — otherwise CI's preview re-runs the DDL on already-existing objects and fails.

---

## File Structure

- `supabase/migrations/<recorded_version>_slots_on_shows.sql` — **new.** Columns + backfill + `compute_show_date_status` rewrite + trigger changes. (`<recorded_version>` = the version `apply_migration` records; see Task 1 Step 4.)
- `supabase/tests/db/slots_on_shows.sql` — **new.** pgTAP for status computation + recompute-on-slot-edit + settings-trigger-removed.
- `CLAUDE.md` — **modify.** Update the two slot-related decision bullets (capacity source + status thresholds).
- `docs/app-logic.md` — **modify.** Update the "Slot counts and sub-program config" paragraph.

Fixture UUIDs (valid hex): org A `11111111…`, show w/ slots `22222222…`, its date `33333333…`, artist `44444444…`, NULL-slot show `88888888…`, its date `99999999…`, artist two `4b4b4b4b…`.

---

### Task 1: Move slot capacity to `shows` columns (DB)

**Files:**
- Create: `supabase/tests/db/slots_on_shows.sql`
- Create: `supabase/migrations/<recorded_version>_slots_on_shows.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/db/slots_on_shows.sql`:

```sql
-- Slot capacity lives on shows.main_cast_slots / understudy_slots; status is computed from them.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

INSERT INTO public.organizations (id, name, slug)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Org A', 'org-a-slots');
-- show with explicit slots: 1 main, 0 understudies
INSERT INTO public.shows (id, org_id, program, sub_program, status, main_cast_slots, understudy_slots)
  VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'TJE', 'TJE: Murder', 'active', 1, 0);
INSERT INTO public.show_dates (id, show_id, date, session_1)
  VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', '2026-07-01', '19:00');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Artist One', 'active');
-- show with NULL slots (unconfigured)
INSERT INTO public.shows (id, org_id, program, sub_program, status)
  VALUES ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'BOL', 'BOL: PP', 'active');
INSERT INTO public.show_dates (id, show_id, date, session_1)
  VALUES ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888', '2026-07-02', '19:00');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('4b4b4b4b-4b4b-4b4b-4b4b-4b4b4b4b4b4b', '11111111-1111-1111-1111-111111111111', 'Artist Two', 'active');

-- 1) configured date with no bookings is 'open'
SELECT is((SELECT status FROM public.show_dates WHERE id = '33333333-3333-3333-3333-333333333333'),
          'open'::show_date_status, 'configured date, no bookings -> open');

-- 2) confirming the single main slot -> fully_filled (status trigger on bookings)
INSERT INTO public.bookings (show_date_id, artist_id, status)
  VALUES ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'confirmed');
SELECT is((SELECT status FROM public.show_dates WHERE id = '33333333-3333-3333-3333-333333333333'),
          'fully_filled'::show_date_status, '1/1 main confirmed -> fully_filled');

-- 3) NULL-slot (unconfigured) date never reaches fully_filled
INSERT INTO public.bookings (show_date_id, artist_id, status)
  VALUES ('99999999-9999-9999-9999-999999999999', '4b4b4b4b-4b4b-4b4b-4b4b-4b4b4b4b4b4b', 'confirmed');
SELECT is((SELECT status FROM public.show_dates WHERE id = '99999999-9999-9999-9999-999999999999'),
          'partially_filled'::show_date_status, 'NULL slots -> partially_filled, never fully_filled');

-- 4) configuring slots on the show recomputes its dates (trigger fires on slot columns)
UPDATE public.shows SET main_cast_slots = 1, understudy_slots = 0
  WHERE id = '88888888-8888-8888-8888-888888888888';
SELECT is((SELECT status FROM public.show_dates WHERE id = '99999999-9999-9999-9999-999999999999'),
          'fully_filled'::show_date_status, 'setting slots on the show recomputes its dates -> fully_filled');

-- 5) the app_settings slot-recompute trigger is gone
SELECT is((SELECT count(*) FROM pg_trigger WHERE tgname = 'sync_show_dates_on_settings_update_trigger'),
          0::bigint, 'app_settings slot-recompute trigger dropped');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test and confirm it fails**

Run via the Supabase MCP `execute_sql` (project `epweartpzwvcasrzyueh`) with the whole test file.
Expected: it ERRORS on the fixture inserts — `column "main_cast_slots" of relation "shows" does not exist` (the columns don't exist yet). That missing-column error is the RED state. (Equivalently: assertion 4 + the recompute can't pass before the function reads the columns.)

- [ ] **Step 3: Write the migration**

Create the migration SQL (filename set in Step 4). Content:

```sql
-- Phase 1b (DB): slot capacity moves from app_settings.sub_program_slots_defaults
-- (JSON keyed by program/sub_program) onto typed columns on `shows`.
-- compute_show_date_status reads the columns; the app_settings recompute trigger is
-- retired; the shows recompute trigger also fires on slot-column edits.

-- 1. Typed slot columns (nullable: NULL = unconfigured).
ALTER TABLE public.shows
  ADD COLUMN IF NOT EXISTS main_cast_slots  smallint CHECK (main_cast_slots  IS NULL OR main_cast_slots  >= 0),
  ADD COLUMN IF NOT EXISTS understudy_slots smallint CHECK (understudy_slots IS NULL OR understudy_slots >= 0);

-- 2. Backfill from the org-resolved JSON. No-op when the setting is absent (greenfield).
UPDATE public.shows s SET
  main_cast_slots  = nullif(public.get_org_setting(s.org_id, 'sub_program_slots_defaults') -> s.program -> s.sub_program ->> 'main_cast',  '')::smallint,
  understudy_slots = nullif(public.get_org_setting(s.org_id, 'sub_program_slots_defaults') -> s.program -> s.sub_program ->> 'understudies','')::smallint
WHERE s.program IS NOT NULL AND s.sub_program IS NOT NULL
  AND public.get_org_setting(s.org_id, 'sub_program_slots_defaults') -> s.program -> s.sub_program IS NOT NULL;

-- 3. compute_show_date_status reads the columns instead of the JSON.
CREATE OR REPLACE FUNCTION public.compute_show_date_status(p_show_date_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_current   show_date_status;
  v_main_cap  int;
  v_us_cap    int;
  v_conf_main int;
  v_conf_us   int;
  v_active    int;
  v_new       show_date_status;
begin
  select sd.status, s.main_cast_slots, s.understudy_slots
    into v_current, v_main_cap, v_us_cap
  from show_dates sd join shows s on s.id = sd.show_id
  where sd.id = p_show_date_id;

  if not found or v_current = 'cancelled' then
    return;
  end if;

  select
    count(*) filter (where status = 'confirmed' and not is_understudy),
    count(*) filter (where status = 'confirmed' and is_understudy),
    count(*) filter (where status <> 'cancelled')
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
$function$;

-- 4. Slot edits on a show recompute its dates' status (add slot columns to the OF list).
DROP TRIGGER IF EXISTS sync_show_dates_on_show_update_trigger ON public.shows;
CREATE TRIGGER sync_show_dates_on_show_update_trigger
  AFTER UPDATE OF program, sub_program, main_cast_slots, understudy_slots ON public.shows
  FOR EACH ROW EXECUTE FUNCTION public.sync_show_dates_on_show_update();

-- 5. Retire the app_settings slot-recompute trigger + function (slots no longer live there).
DROP TRIGGER IF EXISTS sync_show_dates_on_settings_update_trigger ON public.app_settings;
DROP FUNCTION IF EXISTS public.sync_show_dates_on_settings_update();
```

- [ ] **Step 4: Apply via the MCP, then name the file to the recorded version**

Apply via the Supabase MCP `apply_migration` (project `epweartpzwvcasrzyueh`, name `slots_on_shows`, `query` = the SQL above). Then call `list_migrations` and read the version it recorded for `slots_on_shows` (a real timestamp like `2026061617xxxx`). **Create the repo file as `supabase/migrations/<that-exact-version>_slots_on_shows.sql`** with the same SQL, so the repo matches the project's migration history (avoids the Phase 1a drift).

- [ ] **Step 5: Run the test and confirm it passes**

Run the test file via `execute_sql` again. Expected: `ok 1`…`ok 5`, no `not ok`. (pgTAP can't `CREATE EXTENSION pgtap` on the remote — if that line errors, run an equivalent PL/pgSQL harness of the same 5 assertions via `execute_sql` in a `BEGIN…ROLLBACK`, and keep the pgTAP file for CI.)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_slots_on_shows.sql supabase/tests/db/slots_on_shows.sql
git commit -m "feat(db): move slot capacity to shows.main_cast_slots/understudy_slots" \
  -m "compute_show_date_status reads the columns; shows recompute trigger fires on slot edits; app_settings slot-recompute trigger retired. NULL slots = unconfigured (never fully_filled)." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Update docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/app-logic.md`

- [ ] **Step 1: CLAUDE.md — fix the two slot bullets**

In `CLAUDE.md`, in the "Key decisions" list:
- In the **`show_dates.status` is DB-computed** bullet, replace the phrase `based on confirmed booking counts vs the \`main_cast\` + \`understudies\` thresholds in \`app_settings.sub_program_slots_defaults\` (keyed by \`(program, sub_program)\`)` with: `based on confirmed booking counts vs the \`main_cast_slots\` + \`understudy_slots\` columns on \`shows\``. In the same bullet, replace `A second trigger on \`app_settings\` recomputes all show_dates when slot defaults change; a third on \`shows\` does so when a show's \`program\` or \`sub_program\` is updated.` with: `A trigger on \`shows\` recomputes that show's dates when its \`program\`, \`sub_program\`, \`main_cast_slots\`, or \`understudy_slots\` change.`
- Replace the **Slot capacity comes from settings, not columns** bullet wholesale with:
  `- **Slot capacity lives on \`shows\`.** Each show row (one \`(program, sub_program)\`) carries \`main_cast_slots\` and \`understudy_slots\` (nullable smallint; \`NULL\` = unconfigured → the date never reaches \`fully_filled\` and the UI shows an "Unconfigured" badge). There is no \`slots_per_date\` column and no \`app_settings.sub_program_slots_defaults\` (retired in Phase 1b). *(Frontend note: the slot-reader hooks still read the old setting until Phase 1b-frontend; on greenfield this is inert.)*`

- [ ] **Step 2: app-logic.md — fix the slot-counts paragraph**

In `docs/app-logic.md`, in "Slot counts and sub-program config", replace the sentence that says each sub-program must have a configured count in `app_settings` (key `sub_program_slots_defaults`) with: each **show** carries `main_cast_slots` / `understudy_slots`; if a show's slots are `NULL` the date never reaches `fully_filled` and the UI shows an "Unconfigured" badge — set them on the show (Settings → Scheduling).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/app-logic.md
git commit -m "docs: slot capacity now lives on shows columns (Phase 1b-DB)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- **Status semantics preserved:** NULL caps → `open`/`partially_filled` (never `fully_filled`), exactly as the old JSON-reading function did when a pair was unconfigured. The one intended change: with typed columns, an explicit `0` is now distinct from `NULL` (0 = zero slots needed; NULL = unconfigured), removing the old JSON-era `0/0 → unconfigured` heuristic.
- **No types regeneration needed for this DB-only slice's frontend** — but note `shows` gained two columns, so when Phase 1b-frontend runs, regenerate `src/integrations/supabase/types.ts` via the MCP `generate_typescript_types` (out of scope here).
- **Do not delete the `app_settings.sub_program_slots_defaults` data here** — the frontend still reads it (harmlessly; it's empty) until Phase 1b-frontend removes the read path.
- Apply order is single-migration; run the pgTAP RED before applying, GREEN after.
