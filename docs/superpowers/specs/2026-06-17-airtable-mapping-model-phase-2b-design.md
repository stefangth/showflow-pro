# Airtable Mapping Model (Phase 2b) — Design Spec

**Status:** Draft for review
**Date:** 2026-06-17
**Owner:** Stefan Schaal
**Implements:** [Airtable sync engine design](2026-06-16-airtable-sync-engine-design.md) §5 (data model), §6 (mapping model), §8 (Settings UI); [ADR-0001](../../adr/0001-airtable-system-of-record.md)
**Builds on:** Phase 2 — the `airtable-schema` edge function ([PR #99](https://github.com/stefangth/showflow-pro/pull/99))

---

## 1. Summary

Phase 2 shipped `airtable-schema` (server-side schema read). Phase 2b delivers the rest of the
"mapping model": the **catalog-link DB columns** and the **Settings mapping/linking UI** that calls
`airtable-schema` to offer base/table/field dropdowns and links Airtable's controlled options to
Showflow's `shows`/`cities`. It replaces the dead "Filter Mappings (Airtable)" card.

It is split into two independently-shippable plans, built in order:

- **2b-DB** — a small migration adding the two link columns (+ pgTAP). Lands and CI-validates first.
- **2b-UI** — the data-access layer + the Settings → Airtable Sync tab rewrite, on top of 2b-DB.

This mirrors the 1a/1b (DB-then-frontend) rhythm.

## 2. Decisions (confirmed this session)

1. **Split** into 2b-DB then 2b-UI (not one combined plan).
2. **Grain-agnostic link key.** `shows.airtable_program_key` is a plain `text` string — it stores
   whatever the admin's field mapping produces (a single Sub-Programm option *or* a composite of
   Program + Sub-Programm). The **admin chooses the grain in the UI** (by which field(s) they map);
   the database does not bake it in. Same for `cities.airtable_city_key`.
3. **Option-linking UX:** bulk **"import all"** (create + link every option) **plus** manual
   link/unlink/edit per row.
4. **Slots on import:** imported shows get **NULL** `main_cast_slots`/`understudy_slots`
   ("needs config" — drives the existing "Unconfigured" badge), forcing a deliberate config step.

## 3. 2b-DB — catalog-link columns (first plan)

**Migration** (one file, additive, no data backfill):
- `ALTER TABLE public.shows ADD COLUMN airtable_program_key text;`
- `ALTER TABLE public.cities ADD COLUMN airtable_city_key text;`
- Partial-unique index per org on each (a key is unique *within* an org, free across orgs, and many
  rows may be unlinked):
  - `CREATE UNIQUE INDEX shows_airtable_program_key_org_uniq ON public.shows (org_id, airtable_program_key) WHERE airtable_program_key IS NOT NULL;`
  - `CREATE UNIQUE INDEX cities_airtable_city_key_org_uniq ON public.cities (org_id, airtable_city_key) WHERE airtable_city_key IS NOT NULL;`
- Both keys are **grain-agnostic** opaque strings (§2.2). No CHECK on format.

**No RLS changes** — the columns ride the existing `shows`/`cities` org-isolation policies. **No
trigger changes.** Regenerate `src/integrations/supabase/types.ts` after the migration.

**Why columns, not `app_settings` JSON:** the link is relational and FK-adjacent (a show *is* the
catalog row); it is read per-record by the Phase 3 poll resolve, and needs a uniqueness constraint —
none of which JSON gives us. (Contrast `airtable_field_map`, which is org-level config → stays an
`app_settings` key.)

**pgTAP** (`supabase/tests/db/`):
- `shows`: two orgs may hold the same `airtable_program_key` (no collision); a duplicate within one
  org is rejected (`23505`); multiple `NULL` keys in one org are allowed.
- `cities`: same three assertions for `airtable_city_key`.

## 4. 2b-UI — Settings mapping/linking (second plan)

### 4.1 Data-access (`src/data/`, client-param functions, tested with `supabaseFake`)

- **Field map** — reuse `resolveOrgSetting(client, orgId, 'airtable_field_map', {})` /
  `upsertOrgSetting(client, orgId, 'airtable_field_map', map)`. Add a typed `AirtableFieldMap`
  shape (`{ date, program, sub_program, city, venue, session_1, session_2, session_3 }`, values =
  Airtable field names or null).
- **Shows** — extend `fetchShowsWithSlots` (or add a sibling) to also select `airtable_program_key`;
  add `linkShowAirtableKey(client, showId, key | null)`.
- **Cities** — `fetchCitiesForLinking(client, orgId)` (id, name, airtable_city_key);
  `linkCityAirtableKey(client, cityId, key | null)`.
- **Bulk import** — `importShowsFromOptions(client, orgId, rows)` and
  `importCitiesFromOptions(client, orgId, rows)`: insert new `shows`/`cities` from the selected
  field's options, setting `airtable_program_key`/`airtable_city_key`, deriving `program`/
  `sub_program`/`name` from the option(s), and leaving slots **NULL**. Idempotent on the link key
  (skip options already linked).

### 4.2 Settings → Airtable Sync tab (rewrite + extract)

Extract the tab out of `SettingsPage.tsx` (currently 1205 lines) into a focused component
(`src/components/settings/AirtableSyncTab.tsx`). Sections:

1. **Connection** — the enable toggle (existing); **base + table dropdowns** populated by
   `supabase.functions.invoke('airtable-schema', { body: { org_id } })` then `{ org_id, baseId }`.
   When the function returns `{ schemaAccessible: false }`, fall back to the **typed** `base_id` /
   `table_name` inputs (today's behavior) with a banner explaining the `schema.bases:read` scope
   unlocks the guided selector. The write-only Vault key field stays as-is.
2. **Field mapping** — a dropdown per Showflow field (Date, Program, Sub-program, City, Venue,
   Session 1, Session 2, Session 3 *optional*); options = the selected table's fields from
   `airtable-schema`. Saves to `airtable_field_map`. **This is where the link grain is chosen:** the
   admin maps which field(s) identify a show — map Sub-Programm only → link on sub-program; map
   Program *and* Sub-Programm → composite. Fallback: typed field-name inputs.
3. **Catalog links** — list the mapped Program field's and City field's options (from the schema
   read). **"Import all"** creates + links every option (shows/cities, NULL slots); each row also
   supports manual link/unlink and slot inputs (shows). Unlinked options are flagged.
4. **Remove** the "Filter Mappings (Airtable)" card and the `filter_mappings` get/set calls.

### 4.3 Deferred to Phase 3

The §8.4 "Last sync report" with **per-record** history needs `airtable_sync_record_log`, which is
created in Phase 3 (the `airtable-poll` rewrite). 2b-UI may surface the existing
`airtable_sync_log` summary row, but not the per-record table — call this out in the UI plan so it
isn't mistaken for missing scope.

## 5. Testing

- **2b-DB:** pgTAP for the two partial-unique indexes (§3).
- **2b-UI:** data-access unit tests (`supabaseFake`) for field-map read/write, link/unlink, and bulk
  import (NULL slots, idempotency); component tests (RTL) for schema-loaded dropdowns vs the typed
  fallback, "import all" + manual link, and the Filter-Mappings card being gone.

## 6. Build order

1. **2b-DB plan** → migration + types + pgTAP → PR (lands the columns, CI-green).
2. **2b-UI plan** → data-access + tab rewrite → PR on top.

## 7. Open items to lock in the plans

- **Composite-key format.** When the admin maps Program *and* Sub-Programm, define one canonical
  join string (e.g. `"<program>|<sub_program>"`, trimmed) used by *both* the UI link-builder and the
  Phase 3 poll's per-record resolve, so they always agree. Decide and document in the 2b-UI plan.
- **Stale `filter_mappings` rows.** Removing the UI stops new writes; existing `app_settings`
  rows with `key='filter_mappings'` become inert (nothing reads them). A one-line cleanup
  (delete those rows) is optional — decide in the 2b-UI plan.
- **`venue`/`session_*` carry-through** is exercised by the Phase 3 poll rewrite, not 2b. 2b only
  maps the fields; it does not import dates.
