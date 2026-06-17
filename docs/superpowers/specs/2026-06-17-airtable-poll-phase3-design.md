# Airtable Sync — Phase 3: `airtable-poll` rewrite (design)

**Date:** 2026-06-17
**Author:** Stefan Schaal (with Claude Code)
**Status:** Approved — ready for implementation plan
**Parent spec:** [`2026-06-16-airtable-sync-engine-design.md`](2026-06-16-airtable-sync-engine-design.md) (§5 data model, §8.4 report, §9 poll, §10 edge cases, §11 tests)
**Relevant ADRs:** [`0001`](../../adr/0001-airtable-system-of-record.md) (system of record), [`0010`](../../adr/0010-catalog-link-keys.md) (catalog-link keys)

---

## 1. Problem

The live `airtable-poll` edge function **silently imports 0 rows** from the production German Airtable
base. It reads hardcoded English field names (`Date` / `Show` / `Session 1`) and resolves shows by a
lowercased `program|sub_program` **name match** — it ignores both the Phase-2 field map
(`app_settings.airtable_field_map`) and the catalog-link columns (`shows.airtable_program_key`,
`cities.airtable_city_key`) that the mapping UI now populates. The German base uses `Datum` /
`Program` / `Sub-Programm` / `1. Show` / `2. Show`, so every record fails to resolve and the run logs
`success / 0 rows` — the exact silent-loss failure this whole initiative exists to kill.

## 2. Goal

Rewrite the poll **in place** (same function, same `*/5 * * * *` cron, same `X-Cron-Secret` auth,
same per-org loop and Vault key fetch) so it consumes the Phase-2 config, resolves strictly by the
linked catalog keys, and makes the silent `success / 0 rows` outcome **structurally impossible**:
unresolved records are held, logged per-record, surfaced in a report UI, and admins are notified when
the held set changes. No parallel function, no cron change.

## 3. Decisions

1. **Single source of truth for the link-key helper.** `buildProgramKey` / `buildCityKey` move into a
   pure, import-free `supabase/functions/_shared/airtableKey.ts`. The Deno poll imports it directly;
   the frontend `src/data/airtableMapping.ts` **re-exports** from it. One implementation, no drift —
   the byte-parity that ADR-0010 requires between the UI's link step and the poll's resolution step.
2. **Strict key-only resolution.** Resolve shows/cities solely by `airtable_program_key` /
   `airtable_city_key`. No name-match fallback. Unlinked program → `held_unresolved`; unlinked city →
   `city_id = NULL` (non-fatal, noted on the record log). Fail-loud per §9 + ADR-0001: an org that
   hasn't linked yet sees all-held in the report, which is the intended signal, not silent loss.
3. **Notify admins on change only.** The held-records admin notification fires only when the held set
   changes vs. the previous run (a new held `airtable_record_id` appears, or `held_count` rose) — not
   on every 5-minute tick. The report UI always shows the current full held list regardless.
4. **The "Last sync report" UI ships in Phase 3** (not deferred to a 3b).

## 4. Architecture & components

```
supabase/functions/_shared/airtableKey.ts      NEW  pure key helpers (single source)
src/data/airtableMapping.ts                     EDIT re-export helpers from _shared
supabase/migrations/<ts>_airtable_sync_records.sql NEW extend log + new record-log table
supabase/tests/db/airtable_sync_record_log.sql  NEW  pgTAP: RLS + org-derive + CHECK + cascade
supabase/functions/airtable-poll/index.ts       EDIT the rewrite (syncOrg resolution + logging)
supabase/functions/airtable-poll/index*.test.ts EDIT German-field-names regression + contract update
src/data/airtableSync.ts                         NEW  fetchLatestSyncLog / fetchHeldRecords (+ test)
src/components/settings/AirtableSyncTab.tsx      EDIT add read-only "Last sync report" section (+ test)
src/integrations/supabase/types.ts              REGEN after migration
```

Each unit has one clear purpose: the key helper composes an opaque link key; the migration defines
the audit schema; the poll resolves + records; the data fns read the audit; the UI renders it.

## 5. Data model (parent spec §5)

**Extend `airtable_sync_log`** (additive, all nullable/defaulted — no backfill needed):
`imported_count int`, `new_count int`, `updated_count int`, `held_count int`, `details jsonb`.

**New table `airtable_sync_record_log`** (per-record history):

| column | type | notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `sync_log_id` | `uuid not null` | `references airtable_sync_log(id) on delete cascade` |
| `org_id` | `uuid not null` | set by derive trigger from the parent log |
| `airtable_record_id` | `text` | the Airtable record id |
| `action` | `text not null` | `check in ('imported_new','updated','held_unresolved','error')` |
| `show_date_id` | `uuid` | nullable, `references show_dates(id)` |
| `reason` | `text` | held/error explanation |
| `raw_fields` | `jsonb` | the record's raw `fields` for debugging |
| `created_at` | `timestamptz not null default now()` | |

- **Derive trigger:** `derive_org_id_from_sync_log_id()` (SECURITY DEFINER, `set search_path =
  public`, `select org_id into NEW.org_id from airtable_sync_log where id = NEW.sync_log_id`) +
  `before insert ... trg_derive_org_id`, mirroring `20260604130000_org_id_derivation_triggers.sql`.
- **RLS** (mirror `airtable_sync_log`): enable RLS; RESTRICTIVE `org_isolation` policy
  (`is_org_member(auth.uid(), org_id)`); admin SELECT policy (`has_org_role(auth.uid(), org_id,
  'admin')`); system INSERT policy (`with check (true)` for service-role writes).
- **Indexes:** `(sync_log_id)`, `(org_id, created_at)`, `(org_id, airtable_record_id)`.

`shows.airtable_program_key` and `cities.airtable_city_key` already exist (PR #100, migration
`20260617110532_airtable_link_columns`).

**Migration mechanics:** apply via the Supabase MCP `apply_migration` (which records a real-timestamp
version), then `list_migrations` and **name the local migration file to the recorded version** (avoids
the CI preview-branch orphan trap). Regenerate `types.ts` via `generate_typescript_types` — never
hand-edit.

## 6. Poll algorithm (parent spec §9)

**Unchanged:** cron entry + `X-Cron-Secret`, `getActiveOrgs` loop, per-org `resolveOrgSetting` for
`airtable_sync_enabled` / `airtable_base_id` / `airtable_table_name`, Vault key
(`get_org_airtable_key`), pagination + `MAX_PAGES` truncation flag, batched tier-1 offer opening
(`openOfferTierBatch`).

**`syncOrg` changes:**
- Read `airtable_field_map` via `resolveOrgSetting(admin, orgId, 'airtable_field_map', {})`.
- Build **key-keyed** lookup maps from `shows(id, airtable_program_key)` and
  `cities(id, airtable_city_key)` on the non-null key (no lowercasing — keys are stored verbatim).
- **Per record**, produce one outcome object:
  1. `date = fields[fieldMap.date]`; missing → `held_unresolved`, reason `"missing date"`.
  2. `key = buildProgramKey(null, fields[fieldMap.sub_program])`; look up `airtable_program_key`.
     No match → `held_unresolved`, reason `` `program '<value>' not linked` ``. *(Passing
     `program = null` matches the UI's shipped sub-program-only grain — the ADR-0010 call-args parity
     point; the helper itself is shared so it is byte-identical.)*
  3. `cityKey = buildCityKey(fields[fieldMap.city])`; look up `airtable_city_key`. No match →
     `city_id = NULL` (non-fatal; note on record-log reason).
  4. Carry `venue` (text); parse `session_1` / `session_2` / `session_3` for **mapped** fields only,
     reusing the existing `/T?(\d{2}:\d{2})(:\d{2})?/` regex. Preserve current `session_1` behavior
     (verify `show_dates` session-column nullability during implementation).
  5. Upsert `show_dates` on `airtable_record_id`: existing → `update` (`updated`); new → `insert`
     (`imported_new`); `org_id` set by its derive trigger. Track new date ids for offers.
  6. Record `{ action, show_date_id, reason, raw_fields: fields }`.
- **After the record loop:**
  - Insert the `airtable_sync_log` summary **returning `id`**: `imported_count`, `new_count`,
    `updated_count`, `held_count`, `details jsonb` (compact new/held summary); `status = 'success'`
    only when `held_count = 0`, else `'partial'`.
  - Bulk-insert the collected `airtable_sync_record_log` rows with that `sync_log_id`.
  - Open tier-1 offers for new dates (unchanged).
  - **Notify org admins on change only:** when `held_count > 0` **or** zero rows imported from a
    non-empty table, fetch the previous run's `airtable_sync_log` for this org + its held
    record-log `airtable_record_id`s; notify only if a new held record appears or `held_count` rose.
    Mirror `tier-at-risk-watcher`'s pattern (query `org_memberships` for `role='admin'`, insert
    `notifications`; in-app only, no email).

## 7. Edge cases (parent spec §10)

- **Misconfigured-but-active orgs** (sync disabled / no base / no table / no PAT): still write a
  visible `airtable_sync_log` row (today some skip before logging — fix so every active org leaves a
  trace).
- **Airtable API error / rate limit:** write the log (status `error`, body snippet) + record logs for
  already-processed records, flush already-imported dates to offers, continue other orgs.
- **Option renamed in Airtable:** records with the new value go `held_unresolved` until re-linked —
  visible in the report, never silently dropped.
- **single-select shape:** the raw v0 API returns option **names** as strings, so matching is on the
  string name (documented; a future switch to field-ID payloads is a conscious change).
- **Pagination / `MAX_PAGES`:** unchanged (still flags truncation).

## 8. "Last sync report" UI (parent spec §8.4)

- **Data fns** in `src/data/airtableSync.ts` (client-as-param pattern, tested with `supabaseFake`):
  `fetchLatestSyncLog(client, orgId)` (most recent log row) and `fetchHeldRecords(client, syncLogId)`
  (record-log rows where `action = 'held_unresolved'`).
- **`AirtableSyncTab` section:** read-only summary counts (`imported` / `new` / `updated` / `held`)
  + a held-records table (program value, reason, timestamp, best-effort deep link to the Airtable
  record built from `airtable_base_id` + record id; fall back to the base link if a table id isn't
  available). React Query reads with `Skeleton` / `Alert` states.

## 9. Testing (parent spec §11)

- **Deno regression (headline):** feed `handle` a fake Airtable page via `makeFakeDeps({ fetchImpl })`
  using the **real German field names** (`Datum` / `Program` / `Sub-Programm` / `1. Show` /
  `2. Show`), with `app_settings` seeding the matching `airtable_field_map` and `shows` / `cities`
  seeded with linked keys. Assert: linked records land in `show_dates`; an unlinked-program record is
  `held_unresolved` with the right reason; an `airtable_sync_log` summary row is written with correct
  counts; per-record `airtable_sync_record_log` rows are written. The regression test for today's
  silent no-op. Runs locally (Deno).
- Update existing `index.test.ts` / `index.di.test.ts` / `index.org.test.ts` to the new field-map +
  key-based contract.
- **pgTAP** (`supabase/tests/db/airtable_sync_record_log.sql`, CI): RLS enabled; org-isolation +
  admin-read policies; `action` CHECK; FK cascade; org-derive trigger stamps `org_id`.
- **Frontend** (CI): `airtableMapping.test.ts` still covers the helper; new `airtableSync` data-fn
  test; `AirtableSyncTab.test.tsx` renders the held-records report.

## 10. Verification

1. **Deno (local):** `deno test --allow-all supabase/functions/airtable-poll/` passes (regression +
   updated contract tests).
2. **Frontend (CI):** Typecheck (validates the cross-boundary re-export), Unit, Lint.
3. **DB (CI pgTAP):** `airtable_sync_record_log` test green.
4. **Migration applied** via Supabase MCP; `types.ts` regenerated and committed.
5. **End-to-end (post-merge, live German base via Airtable MCP / Settings):** trigger a poll; confirm
   non-zero `imported_count`, unresolved records appear as `held_unresolved` in the report, and admins
   get a held-count notification — the silent `success / 0 rows` outcome is gone.

## 11. Out of scope (later phases)

City/venue dedup, identity/contact dedup, custom fields (ADR-0009, Phase 6). The composite
program-key grain stays deferred — addable without a migration since the key column is opaque (just
extend the helper's call args at both the UI and the poll, together).
