# Productions configurable columns + Airtable linked-record sync — Design

- **Date:** 2026-06-24
- **Status:** Approved (design); ready for implementation plan
- **Branch:** `claude/cool-kare-dffca8`
- **Related:** [[airtable-sync-initiative]], [[multi-tenancy-initiative]]; prior specs `2026-06-17-airtable-cities-phase4-design.md`, `2026-06-18-airtable-sync-phase6-custom-fields-design.md`, `2026-06-22-airtable-sync-fix-and-key-management-design.md`

## Context

Six issues were reported against the `/productions` page and **Settings → Airtable Sync**, validated against the live DB (`epweartpzwvcasrzyueh`) and the connected Airtable base (`SFP Test Airtable` / `appKg8xpplxd49Bo6`):

| # | Symptom | Verified root cause |
|---|---------|---------------------|
| 1 | `/productions` columns not configurable | Page renders a hardcoded `renderRow()` ([ProductionsPage.tsx:64-111](../../../src/pages/ProductionsPage.tsx)); does not use the `useColumnTemplate` system the other tables use. |
| 2 | Program/sub-program column empty for synced shows | `showLabel()` ([types/index.ts:47](../../../src/types/index.ts)) returns `program ?? '—'`. Synced shows are sub-program-only (`program=null`, `sub_program="TJE: Murder"`), so it renders `—`. |
| 3 | Cannot link individual programs | Programs section has only "Import all" + Unlink; no per-option "Link to existing" (Cities has one). |
| 4 | Cities not linked despite active mapping | Airtable `City` is a `multipleRecordLinks` field. `optionNames()` ([AirtableSyncTab.tsx:220](../../../src/components/settings/AirtableSyncTab.tsx)) reads `options.choices`, which links fields lack → Cities section shows "No options" and nothing is linkable. The poll also stores the raw record-ID array, so even a manual catalog city would never match. |
| 5 | Field-mapping card ambiguous | No headers distinguishing the Showflow field from the Airtable column. |
| 6 | Venue shows `["rechFJEZWxNXsJIN7"]` | Airtable `Venue` is a `multipleRecordLinks` field; the poll passes the raw ID array through into the text `venue` column. |

**Key facts that shape the design:**
- The Airtable `Events` table has `City` and `Venue` as **`multipleRecordLinks`** (→ `Cities` table primary field `City`; `Venues` table primary field `Venues`). `Program` / `Sub-Programm` are `singleSelect` (these already work).
- There is **no Venues catalog table** in Showflow — `show_dates.venue` is a plain text display column. So venue needs **sync-side name resolution only** (no linking UI). City needs **both** resolution and a working linking UI (it maps to the `cities` catalog via `city_id`).
- Editing editor configs is **admin-only** ([EditorContext.tsx:53](../../../src/features/editor/EditorContext.tsx)); column templates are **per-role** and consumed by producers/artists via `useColumnTemplate`. The chosen model for #1 keeps this unchanged.

## Decisions (from brainstorming)

1. **#1 = configurable columns** (which fields show + order), not row filtering.
2. **Admins set per role** — no change to editor permissions. Producers/platform-admins consume their configured layout.
3. **#4/#6 = auto-resolve linked-record names during sync** (no Airtable changes required).
4. Defaults accepted: `/productions` exposes Program and Sub-program as separate configurable columns; multiple linked venues join with `", "`; city takes the first linked record (`city_id` is a single FK).

## Goals / Non-goals

**Goals:** Fix the 6 reported issues with changes that follow existing patterns and require no manual Airtable reconfiguration.

**Non-goals:** A Venues catalog table; opening the editor to non-admins; per-user personal column preferences; row-level filtering on `/productions`; changing the `singleSelect` program/city path (only *adding* linked-record support).

---

## Item designs

### #2 — `showLabel` fallback (one-line, broad benefit)

```ts
// src/types/index.ts
export function showLabel(show: { program: string | null; sub_program: string | null }): string {
  if (show.program && show.sub_program) return `${show.program} – ${show.sub_program}`;
  return show.program ?? show.sub_program ?? '—';
}
```
Fixes the empty name on `/productions` **and** every other surface that renders synced shows (bookings, dashboards, casts, chats). Pure function — covered by a unit test for the sub-program-only case.

### #5 — Field-mapping card headers

Add a header row above the mapping rows in the "3 · Field mapping" card, using the existing `grid grid-cols-1 sm:grid-cols-[160px_1fr]`: left **"Showflow field"**, right **"Airtable column"** (muted, small). No logic change.

### #1 — Configurable `/productions` columns

Adopt the established pattern (ShowsBookingsPage / AvailabilityPage):

1. **Register the page** in `PAGE_COLUMN_SPECS` ([columnRegistries.ts](../../../src/features/editor/columnRegistries.ts)) under key `shows-productions`:
   - `tables`: `['shows', '_computed']`
   - `rendered` (default-visible, in order): `shows.program`, `shows.sub_program`, `shows.category`, `_computed.slots`, `_computed.date_count`, `shows.status`
   - Additional available (hidden by default): `shows.created_at`, `shows.sort_order`, `shows.main_cast_slots`, `shows.understudy_slots`, `_computed.synced`
   - Add any new `_computed` ids to `COMPUTED_LABELS` (`slots` → "Slots", `date_count` → "Dates", `synced` → "Synced").
2. **Consume** in `ProductionsPage`: `const { orderedColumns } = useColumnTemplate('shows-productions')` + `useColumnHeaders(orderedColumns)`.
3. **Refactor `renderRow`** to a `cellFor(colId)` switch over `columnHeaders`. The first visible column renders bold (the row's identity). **Fixed, non-configurable** elements remain: the leading drag handle (active filter only) and the trailing actions (edit/archive/delete). A matching header row renders the column labels.
4. **Preserve drag-reorder**: keep `Reorder.Group`/`Reorder.Item`; the configurable cells live inside each row. `ColumnLayoutEditor` is a separate config panel and does not require a semantic `<table>`.
5. **Render** `<ColumnLayoutEditor pageKey="shows-productions" />` (visible only in admin editor mode).

No change to `ProtectedRoute` roles or editor gating. Synced shows will now display the Sub-program column (value present), directly satisfying #2 on this page; once an admin also maps the `Program` singleSelect, the Program column fills in too.

### #3 — Link individual programs

Mirror the Cities "Link to existing…" control in the Programs section ([AirtableSyncTab.tsx:609-627](../../../src/components/settings/AirtableSyncTab.tsx)):
- Add `unlinkedShows = shows.filter(s => !s.airtable_program_key)` (active, non-synced).
- For each **unlinked** program option, render a `Select` "Link to existing…" listing `unlinkedShows`; on change call a `linkShow` mutation → `linkShowAirtableKey(supabase, showId, key)` (the primitive already exists; `unlinkShow` already calls it with `null`).
- Invalidate `['shows']` on success. The linked option then resolves on the next poll.

### #6 + #4 — Linked-record resolution (core backend work)

**A. `airtable-schema` — new "linked records" mode.** Add Mode C: body `{ org_id, baseId, linkedTableId }` → `{ schemaAccessible: true, records: [{ id, name }] }`, where `name` is the linked table's primary-field value. Reuses the existing auth (`requireOrgRole(org_id, ['admin'])`), the Vault PAT, `airtableFailure()` mapping, and a paginated records fetch (`GET /v0/{baseId}/{linkedTableId}`), with the same `MAX_*_PAGES` guard style. The primary field is resolved from the table schema's `primaryFieldId` (fetch with `returnFieldsByFieldId=true` and read `fields[primaryFieldId]`).

**B. AirtableSyncTab — cities from linked records.** When the mapped City field's type is `multipleRecordLinks`, derive `cityOptions` from Mode C records (the field's `options.linkedTableId` is already returned by Mode B) instead of `optionNames()`. A new data fn `fetchAirtableLinkedRecords(client, { orgId, baseId, linkedTableId })` (in `src/data/airtableSchema.ts`) wraps the function invoke; a `useQuery` enabled only when the city field is a link type feeds `cityOptions`. The existing Import-all / Link-to-existing / `planCityReconciliation` flow then works unchanged (keys via `buildCityKey(name)`).

**C. `airtable-poll` — resolve link fields before mapping.** Per run, after loading the field map:
1. Fetch the base schema (`meta/bases/{baseId}/tables`) → build `fieldName → { type, linkedTableId, primaryFieldId-of-linked-table }` for the mapped fields.
2. For each **mapped** field whose type is `multipleRecordLinks` (currently `venue`, `city`), fetch the linked table's records once → `Map<recordId, primaryName>`.
3. When processing each Events record, if a mapped field value is an array of record IDs, resolve via the map:
   - **venue** → joined names (`", "`), stored in `show_dates.venue`.
   - **city** → first resolved name → `buildCityKey` → existing `cityByKey` match → `city_id` (unchanged downstream).
4. Non-link fields keep the current passthrough. Unresolvable IDs (deleted linked record) fall back to `null` for that field with a logged note (non-fatal, consistent with current city behavior).

**Backfill:** none required. The next poll UPDATEs existing rows (matched by `airtable_record_id`), overwriting `["rec…"]` with the resolved venue name and (once cities are linked) setting `city_id`.

**Shared helper:** the "fetch a linked table's id→primaryName map" logic is used by both the poll and (conceptually) Mode C; factor a small helper into `_shared` for the poll, keeping Mode C self-contained in the edge function. Exact placement finalized in the plan.

---

## Data flow (linked-record resolution)

```
Airtable Events record
  fields["City"]  = ["recAAA"]        fields["Venue"] = ["recBBB","recCCC"]
        │                                    │
   base schema (meta) → City.type=multipleRecordLinks, linkedTableId=Cities
        │                                    │
   fetch Cities records → {recAAA:"Berlin"}  fetch Venues → {recBBB:"Hall A",recCCC:"Hall B"}
        │                                    │
   "Berlin" → buildCityKey → cityByKey       "Hall A, Hall B"
        │                                    │
   show_dates.city_id = <uuid|null>     show_dates.venue = "Hall A, Hall B"
```

## Testing strategy (test-first)

| Layer | Test |
|---|---|
| Unit | `showLabel` sub-program-only → returns `sub_program` (regression for #2). |
| Unit | Linked-record resolution helper: array of IDs → joined names; first-name-for-city; unknown ID → null. |
| Unit | `columnRegistries` resolves `shows-productions` defaults + role overrides. |
| Edge (Deno DI) | `airtable-poll`: venue link field → resolved string; city link field → matched `city_id`; non-link passthrough unchanged. Run the **whole** `supabase/functions/` suite (DI contract suite catches cross-fn regressions). |
| Edge (Deno DI) | `airtable-schema` Mode C: returns `{ records }`; 403 → `schemaAccessible:false`; auth rejects non-admins. |
| Component | `AirtableSyncTab`: program "Link to existing" sets key; city options sourced from linked records when field is `multipleRecordLinks`. |
| Component | `ProductionsPage` renders configured columns (default set) and preserves actions. |

## Sequencing

One feature branch, logical commits in this order (each green before the next):

1. `#2` showLabel fallback + test.
2. `#5` mapping-card headers.
3. `#1` configurable `/productions` columns.
4. `#3` link individual programs.
5. `#6`/`#4` backend: `airtable-schema` Mode C → `airtable-poll` resolution → AirtableSyncTab city link-record options.

**One PR.** The city feature spans poll + schema + UI and should ship together; `airtable-poll` and `airtable-schema` auto-deploy on merge to `main` (per CLAUDE.md). After merge, the user links cities in the UI; the next poll resolves venue names and sets `city_id`.

## Risks / mitigations

- **Extra Airtable API calls in the poll** (schema + linked tables): bounded by `MAX_*_PAGES`; linked tables (Cities/Venues) are small; fetched once per run, not per record.
- **`cellFormat=string` rejected** as the resolution mechanism — it would localize dates/numbers and break the existing date/session parsing. Linked-table fetch is the safe path.
- **Reorder + configurable cells**: kept inside `Reorder.Item`; verified the editor config panel is independent of table markup.
- **Multiple linked cities** (unusual): first wins for `city_id`; documented behavior.
