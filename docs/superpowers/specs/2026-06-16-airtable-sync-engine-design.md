# Airtable Sync Engine — Design Spec

**Status:** Draft for review
**Date:** 2026-06-16
**Owner:** Stefan Schaal
**Implements:** [ADR-0001 — Airtable is the system of record; Showflow mirrors and maps](../../adr/0001-airtable-system-of-record.md)

---

## 1. Summary (plain language)

Producers keep the show schedule in Airtable. Showflow should pull that schedule in
**reliably and visibly**, instead of the current sync, which silently imports nothing because it
guesses English field names that don't match the real (German) base.

We will make the sync **foolproof**:

- The admin connects the Airtable key, and Showflow **reads the base's real schema** and offers
  **dropdowns** to say "our *Date* is your *Datum*, our *Program* is your *Program*," and so on.
  If the key isn't allowed to read schema, the dropdowns fall back to **typed field names**.
- Showflow **never invents** a program, city, or venue. The admin **imports/links** Airtable's
  controlled options into Showflow's catalog once; from then on the sync only resolves records
  against those links. Anything unlinked is **held and reported**, never dropped, never created.
- Every run writes a **sync report**: how many rows were imported, added, updated, or held — with
  a **per-record history** you can query later ("what landed on Tuesday's 14:05 run?").

Alongside the sync we make the data model match this reality: `shows` becomes the single home for
a program (including its slot counts), the dead "Filter Mappings" setting is removed, and a few
integrity gaps are closed.

## 2. Goals / Non-goals

**Goals**
- A schema-driven field-mapping UI with a manual-typed fallback.
- A sync that never silently loses a date and never creates catalog data on its own.
- Full observability: summary counts + queryable per-record history + an admin notification.
- Remove the stringly-typed coupling that caused the failure: `shows` owns slot counts; the
  catalog is linked to Airtable's controlled options.
- Close the related integrity gaps surfaced in review (duplicate bookings, artist↔org mismatch).

**Non-goals (this initiative)**
- Two-way sync / authoring shows inside Showflow (Airtable stays the system of record — ADR-0001).
- Touching the casts / eligibility model beyond what `shows` consolidation requires.
- Identity/contact ownership (`profiles`/`artists`) — it's Phase 5 (specced & built separately, ADR-0011) and largely independent.
- A `venues` table — `venue` stays synced text until it needs attributes (ADR-0001 "Revisit if").

## 3. Current state (what's broken — for context)

- `airtable-poll` reads hardcoded `fields['Date']`/`['Show']`/`['Session 1']`; the live base uses
  `Datum`/`Program`/`Sub-Programm`/`1. Show`/`2. Show`. Every record is dropped at the date lookup
  and the run logs `success / 0 rows`. Validated via the Airtable MCP against base
  `appKg8xpplxd49Bo6`, table `Events`.
- `shows` (0 rows) would also have to match Airtable's `Program` value as a lowercased string.
- Slot capacity lives in `app_settings.sub_program_slots_defaults` JSON, keyed by
  `(program, sub_program)` strings — a parallel stringly-typed contract.
- A "Filter Mappings (Airtable)" Settings box claims it feeds the poll; the poll ignores it.
- `airtable_sync_log` records only a processed count + an error string; the count of *new* rows is
  computed and thrown away.
- `bookings` has no DB guard against two active rows for the same (date, artist) — dedup is racy
  application code. A booking derives `org_id` from its show_date but nothing checks the artist is
  in the same org.

## 4. Architecture overview

```
Admin (Settings)                     Edge functions (service role)             Postgres
─────────────────                    ─────────────────────────────            ──────────
 1. paste PAT  ───────────────────▶  set_org_airtable_key  ───────────────▶  Vault (encrypted)
 2. "Load schema" ────────────────▶  airtable-schema
                                       └─ get_org_airtable_key (Vault)
                                       └─ Airtable Meta API (tables/fields/options)
                                     ◀─ {tables, fields, options, schemaAccessible}
 3. pick field map + link options ─────────────────────────────────────────▶  app_settings.airtable_field_map
                                                                               shows.airtable_program_key
                                                                               cities.airtable_city_key
 (cron */5)                          airtable-poll
                                       └─ resolve records via field_map + links
                                       └─ upsert show_dates (org_id via trigger)
                                       └─ write summary + per-record log ────▶  airtable_sync_log (+ record_log)
                                       └─ notify admins on held/partial
```

The PAT never reaches the browser. Both Airtable calls (schema read, record poll) happen
server-side with the Vault key.

## 5. Data model changes

**`shows` — becomes the canonical program entity**
- Add `main_cast_slots smallint` and `understudy_slots smallint`, both **nullable** (NULL =
  "needs config", drives an "Unconfigured" badge — same UX as today, but per-show not per-JSON-key).
- Add `airtable_program_key text` — the Airtable option this show is linked to. Unique per org
  (partial unique where not null). This is the catalog link.
- Keep `program`, `sub_program` (the human-readable values, sourced from Airtable on link).

**Retire the JSON slot config**
- `app_settings.sub_program_slots_defaults` is removed.
- The `sync_show_date_status` trigger reads `shows.main_cast_slots/understudy_slots` via
  `show_dates.show_id` instead of the JSON. The existing `sync_show_dates_on_show_update` trigger
  (which already recomputes a show's dates when its program changes) is extended to also fire on the
  slot columns; the `app_settings`-change recompute trigger (`sync_show_dates_on_settings_update`)
  is dropped.

**`cities`**
- Add `airtable_city_key text`, unique per org (partial unique where not null) — the catalog link.

**`show_dates`**
- Keep `session_1`, `session_2`, **and `session_3`** (all retained). `session_1`/`session_2` map
  from "1. Show"/"2. Show"; `session_3` maps only if a third session field is configured (it stays
  untouched for Fever's two-session base). `venue` stays synced text; the unique `airtable_record_id`
  remains the idempotent upsert key.

**`app_settings` (per-org keys)**
- New `airtable_field_map` (JSON), written by the mapping UI — never hand-edited as raw JSON: e.g.
  `{ "date": "Datum", "program": "Program", "sub_program": "Sub-Programm", "city": "City", "venue": "Venue", "session_1": "1. Show", "session_2": "2. Show", "session_3": null }` (`session_3` optional).
- Keep `airtable_base_id`, `airtable_table_name`, `airtable_sync_enabled` — but in the happy path
  `base_id`/`table_name` are **chosen from dropdowns populated from the PAT** (§7/§8), not typed.
- **Remove** the dead `filter_mappings` key and its Settings UI.
- All these per-org keys are edited through the Settings → Airtable Sync UI (§8); there is no
  raw-JSON editing surface.

**`airtable_sync_log` (summary — extended)**
- Add `imported_count int`, `new_count int`, `updated_count int`, `held_count int`,
  `details jsonb` (compact summary of new/held items). Keep `status`, `synced_at`, `org_id`.

**`airtable_sync_record_log` (new — per-record history)**
- `id uuid pk`, `sync_log_id uuid → airtable_sync_log(id) on delete cascade`, `org_id uuid`,
  `airtable_record_id text`, `action text` check in
  `('imported_new','updated','held_unresolved','error')`, `show_date_id uuid → show_dates(id)`
  nullable, `reason text`, `raw_fields jsonb`, `created_at timestamptz default now()`.
- RLS: org-isolation + admin read (mirrors `airtable_sync_log`). `org_id` set by a derive trigger
  from `sync_log_id`'s parent. Indexes on `(sync_log_id)`, `(org_id, created_at)`,
  `(org_id, airtable_record_id)`.

**Integrity guards**
- `bookings`: `CREATE UNIQUE INDEX … ON bookings (show_date_id, artist_id) WHERE status <> 'cancelled'`.
- `derive_org_id_from_show_date_id()` (bookings): also `RAISE` if the row's `artist_id` resolves to
  a different `org_id` than the derived one — closes the cross-org artist gap.

**Custom (extensible) fields (Phase 6 — see §14)**
- `show_dates.custom jsonb not null default '{}'` (synced extras bag; `artists`/`shows` get one
  later, additively).
- New `custom_field_definitions` table (per-org, per-entity, typed; `UNIQUE (org_id, entity, key)`).

## 6. The mapping model

Two tiers, both per-org:

1. **Field map** — which Airtable *field* feeds each Showflow field (stored in
   `app_settings.airtable_field_map`). Chosen via dropdowns from the live schema, or typed in the
   fallback.
2. **Option links** — which Airtable *option value* maps to which Showflow catalog row:
   - Each Airtable **Sub-Programm** option (the finer grain; e.g. "TJE: Murder") links to a `shows`
     row that stores its `program` + `sub_program` + slot counts (`shows.airtable_program_key`).
   - Each Airtable **City** option links to a `cities` row (`cities.airtable_city_key`).
   - **Venue** needs no link — it's carried as text.

**Nothing created automatically.** The admin imports/links options through the Settings UI (the
values originate in Airtable; Showflow only attaches its own config like slot counts). The
automated poll *never* creates a `shows` or `cities` row — it only resolves against existing links.

## 7. Schema-read edge function + fallback

**New function: `airtable-schema`** (`supabase/functions/airtable-schema/`)
- Auth: user JWT, `requireOrgRole(org_id, ['admin'])`. Reads the org PAT via `get_org_airtable_key`;
  the PAT is never returned to the client.
- Two modes — a single Airtable scope (`schema.bases:read`) gates both:
  - **No `baseId`** → `GET https://api.airtable.com/v0/meta/bases` →
    `{ schemaAccessible: true, bases: [{ id, name }] }`, so the admin never types a base ID.
  - **With `baseId`** → `GET …/meta/bases/{baseId}/tables` →
    `{ schemaAccessible: true, tables: [{ id, name, fields: [{ name, type, options? }] }] }`.
- On 403 / insufficient scope, return `{ schemaAccessible: false }` (expected fallback signal, not
  an error). Because one scope gates both calls, a PAT unlocks the whole guided flow (base → table →
  fields) or none of it → a single, unified manual fallback.
- Follows the project DI pattern: `handle(req, deps)` + `realDeps()`; shared `http.ts`/`auth.ts`.

**Fallback behavior:** when `schemaAccessible` is false, the mapping UI renders **typed inputs for
base ID, table name, and field names** (today's manual style) and skips option-linking dropdowns
(the admin types option values, or the run holds-and-reports until links exist). A banner explains
that granting the PAT `schema.bases:read` scope unlocks the guided selector (base / table / field
dropdowns).

## 8. Settings UI (Admin → Airtable Sync)

Replaces the current Airtable tab + deletes the "Filter Mappings" card.

1. **Connection** — paste the write-only key + enable toggle; then pick **base** and **table** from
   dropdowns populated by `airtable-schema` from the PAT (no typing base IDs). Falls back to typed
   base ID + table name only when scope is missing.
2. **Field mapping** — a dropdown per Showflow field (Date, Program, Sub-program, City, Venue,
   Session 1, Session 2, **Session 3 — optional**), options = the selected table's fields. Saves to
   `airtable_field_map`. Fallback: typed field-name inputs, with the scope banner.
3. **Catalog links** — lists the chosen Program/Sub-program and City fields' options; each row links
   to (or imports as) a Showflow show / city, with slot-count inputs on shows. Unlinked options are
   flagged.
4. **Last sync report** — reads `airtable_sync_log` + `airtable_sync_record_log`: counts, and a
   table of held records with their reason and a deep link to the Airtable record.

Any Airtable field *not* bound to a core field shows a **"capture as custom field"** toggle here
(type pre-filled from Airtable; filterable/sortable) — see §14.

## 9. Sync engine rewrite (`airtable-poll`)

**This replaces the current `airtable-poll` in place** — same function, same cron (`*/5 * * * *`),
same `X-Cron-Secret` auth, same per-org loop, the Vault key fetch (`get_org_airtable_key`),
pagination, and batched tier-1 offer opening are all **kept**. What changes: it reads
`airtable_field_map` + the selected base/table from `app_settings` (per-org via `resolveOrgSetting`),
resolves shows/cities against the **linked catalog keys** from §8, and writes the new sync records.
No parallel function, no cron change.

Per org, per record:
1. `date ← record[field_map.date]`. Missing → `held_unresolved` (reason "missing date").
2. Resolve show: look up `shows` by `airtable_program_key` built from the mapped
   program/sub-program option value(s). No linked show → `held_unresolved` (reason
   `"program '<value>' not linked"`).
3. Resolve city: `cities` by `airtable_city_key`. No link → import with `city_id = NULL` and note
   it on the record log (city is non-fatal; date still imports).
4. Carry `venue` (text), `session_1`, `session_2`, and `session_3` if mapped (parsed times).
5. Upsert `show_dates` on `airtable_record_id` (insert = `imported_new`, update = `updated`).
   `org_id` is set by the derive trigger.
6. Append an `airtable_sync_record_log` row for the outcome.

After the record loop: write the `airtable_sync_log` summary (counts + details), open tier-1 offers
for newly inserted dates (unchanged), and **notify admins** when `held_count > 0` or zero rows were
imported from a non-empty table. Run `status`: `success` only when `held_count = 0`; otherwise
`partial`. The silent `success / 0 rows` outcome becomes structurally impossible.

## 10. Error handling & edge cases

- **No PAT / sync disabled / no base/table:** skip the org, but log a visible `airtable_sync_log`
  row (today some of these skip *before* logging — fix so every active-but-misconfigured org leaves
  a trace).
- **Airtable API error / rate limit:** log `error` with status + body snippet (as today), flush
  already-imported dates, continue other orgs.
- **Option renamed in Airtable:** records with the new value go `held_unresolved` until re-linked —
  visible in the report, never silently dropped.
- **single-select value shape:** the raw v0 API returns option *names* as strings, so matching is on
  the string name; documented so a future switch to field-ID payloads is a conscious change.
- **Pagination / `MAX_PAGES`:** unchanged (still flags truncation).

## 11. Testing strategy (the five layers)

- **Unit (vitest):** field-map resolution + option-link resolution as pure functions
  (`src/data/airtableMapping.ts`), incl. missing-field, unlinked-option, null-city, time-parse.
- **Edge (Deno):** `airtable-schema.handle` with `makeFakeDeps` — list-bases mode, describe-base mode, 403 → 
  `schemaAccessible:false`, PAT never leaked. `airtable-poll.handle` fed a fake Airtable page using
  the **real** field names (`Datum`/`Program`/…) asserting rows land + held items logged + a sync
  report row written (the regression test for today's silent no-op).
- **DB (pgTAP):** `bookings` partial-unique guard; artist↔org consistency `RAISE`; status trigger
  reading `shows` slot columns; `airtable_sync_record_log` RLS + org derive.
- **Component (vitest + RTL):** Settings mapping UI — schema-loaded dropdowns vs fallback inputs;
  held-records report renders.
- **E2E (Playwright):** admin maps fields → triggers a sync → sees imported dates + a held entry in
  the report. (Uses a fake/seeded Airtable response, not the live base.)

## 12. Phasing (each ships independently)

1. **Foundation (DB):** slot columns on `shows`; migrate `sub_program_slots_defaults` → `shows`;
   retrofit `sync_show_date_status`; drop the JSON + its recompute trigger; `bookings` dup guard;
   artist↔org guard. Update CLAUDE.md/app-logic.md slot + booking sections.
2. **Mapping model:** `airtable-schema` function; `airtable_field_map` + `airtable_key`
   columns; Settings field-mapping + catalog-linking UI; delete `filter_mappings`. Docs.
3. **Sync rewrite + observability:** rewrite `airtable-poll` off the map/links; extend
   `airtable_sync_log`; add `airtable_sync_record_log`; sync report UI + admin notification. Docs.
4. **Cities & venue polish:** city linking UX; confirm `venue`/`session_2` carry through. Docs.
5. **Identity/contact ownership:** formalize the two-population model (no merge, no column drops);
   enforce the login-email-first rule in the digests; add a "Linked account" panel. See ADR-0011 +
   the Phase 5 design spec (`2026-06-17-phase-5-identity-contact-design.md`).
6. **Custom (extensible) synced fields:** `show_dates.custom jsonb` + `custom_field_definitions`
   table; the capture toggle in the mapping UI; typed/filterable/sortable via the editor + filter
   system; built to generalize to artists/shows (§14).

App-logic.md also needs its stale `availability` / `user_roles` / approval-flow sections corrected
(they describe dropped objects) — folded into Phase 1's docs pass.

## 13. Open questions

- **Bulk import of options:** "Import all Airtable options as shows/cities" in one click vs
  one-by-one linking. Lean: offer both (bulk import, then edit slots). Confirm in planning.
- **Sub-program uniqueness:** linking at the Sub-Programm grain assumes sub-program names are
  unique across programs (true in the sample). If not, link on the `(program, sub_program)` pair.
- **Slot defaults on bulk import:** import with NULL slots ("needs config") vs a default. Lean: NULL,
  so it's a deliberate, visible config step.

## 14. Custom (extensible) synced fields — Phase 6

Lets an org admin capture Airtable fields beyond Showflow's core schema as **typed, filterable,
sortable** custom fields — built to generalize across record types, starting with `show_dates`.
Records the decision in [ADR-0009](../../adr/0009-extensible-synced-fields.md).

**Storage**
- Per-entity value bag: `show_dates.custom jsonb not null default '{}'` (add `artists.custom` /
  `shows.custom` later, additively, when needed). Per-row JSONB is naturally org-scoped — a key only
  exists on the rows that have it, so there is **no shared-schema pollution across tenants**. That is
  the reason this is JSONB rather than per-tenant columns (ADR-0009 + the pooled model, ADR-0003).
- New table **`custom_field_definitions`** (per-org config): `id`, `org_id`, `entity`
  (`show_dates` | `artists` | `shows`), `key`, `label`, `type` (`text|number|date|boolean|select`),
  `source` (`airtable`), `source_field` (the Airtable field name), `options jsonb` (for `select`),
  `filterable bool`, `sortable bool`, timestamps. `UNIQUE (org_id, entity, key)`. Org-isolation RLS +
  admin write, same template as every tenant table. A table (not `app_settings` JSON like the other
  editor config) because definitions are relational and typed, need a uniqueness constraint, and are
  read by both the sync and the filter/sort layer.

**Typing (auto from Airtable)**
- §7's schema read already returns each Airtable field's type, so a captured field's `type` defaults
  from Airtable (`number`→number, `date`→date, `singleSelect`→select + its options, else text);
  the admin can override. Type drives correct sort/filter (numbers as numbers, dates as dates) —
  values are cast per `type`, e.g. `(custom->>'capacity')::numeric`.

**Surfacing (reuses the editor)**
- Custom fields extend the existing column system: `pageColumnDefs` gains a custom column per
  definition for the page's entity (a `{ kind: 'custom', key, type }` marker), flowing through the
  same `resolveColumnTemplate` + visibility/order/role machinery and the per-org `orgEditorConfig`.
  They render alongside core columns; cells read `row.custom[key]` and format by type. No parallel
  column system.

**Filter & sort**
- Filterable/sortable definitions wire into the existing filter controls; the filter builder reads
  `type` to produce the right predicate + cast. Performance: a GIN index on each `custom` column,
  plus optional expression indexes (`((custom->>'<key>')::<type>)`) for hot filtered/sorted fields.

**Sync wiring**
- After core resolution, `airtable-poll` loads the org's `custom_field_definitions` where
  `source='airtable'` and writes `record[source_field]` into `<entity>.custom[key]`, coerced by
  `type`. Custom fields are **non-fatal**: a missing/blank value just leaves the key absent — it
  never holds or drops a date.

**Boundary (unchanged from discussion)**
- Custom fields are **display/filter/sort metadata — they do not drive booking logic** (eligibility,
  offers, slots, status run on core columns). If one becomes load-bearing, a developer **promotes it
  to a real typed column** via the normal migration path. JSONB for the long tail; a real column when
  it earns it.

**Tests**
- pgTAP: `custom_field_definitions` RLS/org-isolation + `UNIQUE(org_id,entity,key)`; `custom` default.
  Unit: type coercion + filter-predicate building. Edge: `airtable-poll` writes the custom bag from
  defined fields. Component: editor lists custom columns; filter/sort honor type. E2E: admin captures
  an extra Airtable field → it appears, filters, and sorts.

**Generalization**
- `show_dates` ships first. Extending to `artists`/`shows` is additive: add a `custom jsonb` column
  to that table and allow its `entity` value — the definitions table, editor pathway, and filter/sort
  layer already handle it.
