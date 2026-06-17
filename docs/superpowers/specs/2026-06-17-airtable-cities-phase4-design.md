# Airtable Sync — Phase 4: Cities polish + dedup tooling (design)

**Date:** 2026-06-17
**Author:** Stefan Schaal (with Claude Code)
**Status:** Approved — ready for implementation plan
**Parent spec:** [`2026-06-16-airtable-sync-engine-design.md`](2026-06-16-airtable-sync-engine-design.md) (§5 data model, §8 Settings UI, §12 phasing — Phase 4)
**Relevant ADRs:** [`0001`](../../adr/0001-airtable-system-of-record.md) (system of record; venue stays text), [`0010`](../../adr/0010-catalog-link-keys.md) (catalog-link keys; poll⇄UI parity)

---

## 1. Problem & context

Phase 4 in the parent spec is *"cities normalization via linking; confirm venue + sessions carry
through"* (ADR-0001 item 5; master §12). Most of it already shipped incidentally:

- **City linking** — import-all + unlink, strict key resolution, unlinked → `city_id = NULL`
  (non-fatal). Shipped in Phase 2b/3.
- **Venue carry-through** — the Phase 3 poll writes `show_dates.venue` as text.
- **Sessions 1/2/3 carry-through** — the Phase 3 poll parses all mapped session fields.
- **Per-org unique index** on `cities.airtable_city_key` (Phase 2b-DB).

**The one real gap:** the catalog-links UI can only *create new* cities or *unlink* — there is **no
way to link an Airtable option to an existing city**. An org provisioned with a seeded "Berlin"
(`airtable_city_key = NULL`) whose admin then runs Import-all on an Airtable "Berlin" option ends up
with **two Berlin rows** — the per-org unique index does not catch it (`NULL` vs `"berlin"` are
distinct keys). Pre-existing bookings / `cast_city_priority` point at the seeded row; new synced
`show_dates` point at the duplicate. This is exactly the "normalization via linking" item, deferred
in Phase 2b ("manual link-to-existing deferred").

**Production state (read 2026-06-17, project `epweartpzwvcasrzyueh`):** 5 cities in 1 org, **0 linked**
to Airtable, 0 with an `airtable_record_id`, **no duplicates**. So: a clean slate. The duplicate risk
is entirely *future* — it triggers on the first Import-all whose option names collide with the seeded
cities. Two consequences drive the design: (a) the city link-key normalization can be **changed safely
now** (no existing keys to migrate); (b) the merge tool is a **safety net**, not a cleanup of an
existing mess (tiny scale, admin-triggered, not a batch job).

**Scope decision (user, 2026-06-17):** "Polish + dedup tooling" — beyond the preventive link-to-existing,
build an active **merge-duplicate-cities** tool and case-insensitive normalization.

## 2. Goal & boundaries

**Goal:** make city catalog hygiene foolproof — sync-driven duplicates become structurally impossible,
a safety-net merge cleans up any that arise by other means, and linking is case-insensitive. Confirm
venue + sessions carry through end-to-end. Update docs.

**Non-goals (unchanged):**
- A `venues` table — venue stays synced text until it grows real attributes (ADR-0001 "revisit if").
- Program-key normalization — **cities only**; `buildProgramKey` and `shows.airtable_program_key` are
  untouched.
- Identity/contact dedup (`profiles`/`artists`) — Phase 5.
- Custom (extensible) synced fields — Phase 6 (ADR-0009).
- The composite (Program + Sub-Programm) program-key grain — still deferred.

## 3. Decisions

1. **One normalization function.** `normalizeCityName(s)` = trim + **locale-independent** lowercase
   (`toLowerCase`, not `toLocaleLowerCase` — deterministic across the Deno poll and the browser UI,
   avoiding the Turkish dotted/dotless-I divergence that would break ADR-0010 parity), defined
   once in `supabase/functions/_shared/airtableKey.ts`, drives all three of: the link key
   (`buildCityKey`), auto-link matching, and duplicate detection. The shared module keeps the poll's
   resolution and the UI's link step byte-identical (ADR-0010).
2. **`buildCityKey` becomes case-insensitive** (trim+lowercase, was trim-only). Safe to change now
   because prod has **0 linked cities** — no `airtable_city_key` values to migrate. `cities.name`
   keeps its original case for display.
3. **Import-all auto-links to existing cities by normalized name** (preventive) — it only creates a
   new row for genuinely-new options. Sync-driven duplicates can no longer occur. A manual per-row
   "link to existing" handles same-city/different-name cases auto-link can't catch.
4. **The merge tool is a transactional `merge_cities` RPC**, not an edge function — it is pure FK
   surgery, naturally org-scoped, and pgTAP-testable. Surfaced via an auto-detect duplicate panel in
   `AirtableSyncTab` (the catalog-links surface), default survivor = the linked row.
5. **Phase 4 splits into 4a (preventive) and 4b (merge tool)**, matching the established 1a/1b,
   2b-DB/2b-UI rhythm. 4a ships independently and de-risks; 4b is the heavier FK-surgery piece.

## 4. Architecture & components

```
supabase/functions/_shared/airtableKey.ts   EDIT  add normalizeCityName; buildCityKey → trim+lowercase
src/data/airtableMapping.ts                  EDIT  re-export normalizeCityName; add pure planners
src/data/cities.ts                           EDIT  add mergeCities (RPC wrapper); reuse link/import fns
src/components/settings/AirtableSyncTab.tsx  EDIT  auto-link import; per-row link-to-existing; dup panel
supabase/migrations/<ts>_merge_cities.sql    NEW   merge_cities(uuid, uuid[]) SECURITY DEFINER + grants
supabase/tests/db/merge_cities.sql           NEW   pgTAP: repoint all FKs, junction conflict, authz
supabase/functions/airtable-poll/index*.test.ts EDIT assert case-insensitive link + venue/session carry
src/integrations/supabase/types.ts           REGEN after the migration (RPC appears under Functions)
```

Pure, unit-testable units (no client): `normalizeCityName`, `planCityReconciliation`,
`groupDuplicateCities`. Data-access units (client-as-param): `mergeCities`, plus the existing
`fetchCitiesForLinking` / `linkCityAirtableKey` / `importCitiesFromOptions`. UI: `AirtableSyncTab`.
DB: the `merge_cities` function. Each has one purpose and a clear interface.

## 5. Normalization (`normalizeCityName`)

```ts
// supabase/functions/_shared/airtableKey.ts
export function normalizeCityName(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase(); // locale-independent — see Decision 1 (ADR-0010 parity)
}
export function buildCityKey(city: string | null | undefined): string | null {
  const n = normalizeCityName(city);
  return n.length ? n : null;
}
```

- The poll already imports `buildCityKey`; it now resolves cities case-insensitively with no other
  change. `src/data/airtableMapping.ts` re-exports both (the existing cross-boundary `.ts` re-export).
- **Existing test update:** `airtableMapping.test.ts` currently asserts `buildCityKey(" Berlin ")
  === "Berlin"`; it changes to `=== "berlin"`, plus a case-folding case (`buildCityKey("BERLIN") ===
  "berlin"`).

*Considered & rejected:* a DB unique index on `(org_id, lower(name))`. Too rigid — it would
hard-reject legitimately-distinct cities that normalize alike and complicate seeding. Code-level
normalization + an opt-in merge is the softer, reversible choice.

## 6. Import-all auto-link + link-to-existing (4a, preventive)

**Pure planner** (in `src/data/airtableMapping.ts`, unit-tested):

```ts
planCityReconciliation(options: string[], existing: {id; name; airtable_city_key}[])
  -> { toLink: {cityId: string; key: string}[]; toCreate: {name: string; key: string}[] }
```

Per Airtable city option:
- `key = buildCityKey(option)`; skip if falsy.
- if some existing city has `airtable_city_key === key` → **skip** (already linked, idempotent).
- else if some existing **unlinked** city has `normalizeCityName(name) === key` → **toLink** (attach
  the key to that existing row).
- else → **toCreate**.

The Import-all mutation applies the plan via the existing `linkCityAirtableKey` (for `toLink`) and
`importCitiesFromOptions` (for `toCreate`). If two existing unlinked cities match the same key
(pre-existing dupes), link the first deterministically and leave the rest for the merge panel.

**Per-row link-to-existing:** each *unlinked* Airtable city option row in catalog-links gets a small
"Link to existing city…" combobox listing the org's unlinked cities; selecting one calls
`linkCityAirtableKey(client, cityId, key)`. Covers same-city/different-name cases.

## 7. Merge tool (4b, safety net)

### 7.1 `merge_cities(p_survivor uuid, p_losers uuid[])` — SECURITY DEFINER, `set search_path = public`

**AuthZ (fail-loud `RAISE`):**
- `has_org_role(auth.uid(), (select org_id from cities where id = p_survivor), 'admin')`;
- every loser shares the survivor's `org_id`;
- `p_survivor <> all(p_losers)` and `p_losers` non-empty.

**Repoint then delete (one implicit transaction).** The four FKs to `cities.id` and their delete rules
(verified 2026-06-17):

| Referencing table | Column | On delete |
|---|---|---|
| `cast_city_priority` | `city_id` | CASCADE |
| `show_cast_eligibility` | `city_id` | CASCADE |
| `show_dates` | `city_id` | SET NULL |
| `show_assignments` | `city_id` | SET NULL |

A naive `DELETE` would cascade-delete priority/eligibility rows and null out dates — so we **repoint
first**:
- **Planning step 1 — enumerate every UNIQUE constraint involving `city_id`** across all four tables
  (the CASCADE junctions almost certainly have a unique on `(<entity>, city_id)`; confirm exact
  columns, and check `show_assignments`).
- For each referencing table **with** such a unique: delete the loser-side rows whose
  `(<entity-cols>, p_survivor)` already exists, then `UPDATE … SET city_id = p_survivor WHERE city_id
  = ANY(p_losers)` for the remainder (no duplicate, no constraint violation).
- For each referencing table **without** such a unique (`show_dates`, and `show_assignments` if it has
  none): plain `UPDATE … SET city_id = p_survivor WHERE city_id = ANY(p_losers)`.
- `DELETE FROM cities WHERE id = ANY(p_losers)`.
- Return a small summary (e.g. counts repointed per table) for the toast.

`GRANT EXECUTE … TO authenticated`; authority is the in-function admin check (mirrors the project's
other SECURITY DEFINER RPCs).

### 7.2 Detection + UI

- **Pure** `groupDuplicateCities(cities)` → groups of >1 sharing `normalizeCityName(name)`, fed by the
  existing `fetchCitiesForLinking`.
- **`mergeCities(client, survivorId, loserIds)`** in `src/data/cities.ts` wraps `rpc('merge_cities', …)`.
- **"Duplicate cities" panel** in `AirtableSyncTab` catalog-links: per group, list members (mark which
  are linked / referenced), **default survivor = a linked row if present** (the most-referenced if
  more than one is linked), else the oldest — keeps synced dates pointed correctly. A confirm dialog,
  then `mergeCities`. On success invalidate `['cities']` and the
  `['bookings']` prefix (eligibility/priority consumers) per the CLAUDE.md invalidation rule.

## 8. Confirm venue + sessions (the spec's "carry through" item)

- Extend the Phase 3 Deno `airtable-poll` regression: assert mapped `venue`, `session_2`, `session_3`
  land on `show_dates`, and that a city option differing only in case from a linked key still resolves
  (case-insensitive `buildCityKey`).
- Fold the live confirmation into the **still-pending Phase 3 live validation** against the German base
  (`appKg8xpplxd49Bo6` / `Events`) — one run proves both the Phase 3 0-row fix and Phase 4 venue/session
  carry-through. No separate live step.

## 9. Edge cases

- **Two existing unlinked cities match one option** (pre-existing dupes): auto-link the first
  deterministically; the rest surface in the duplicate panel for an explicit merge. No silent guess
  beyond the first link.
- **Merge with overlapping junction rows:** handled by the delete-then-update conflict path (§7.1) —
  the survivor keeps one row per `(entity)`, the loser's redundant row is dropped, never duplicated.
- **Survivor unlinked, loser linked:** allowed; the admin may pick any survivor. If the chosen survivor
  is unlinked and a loser carried the `airtable_city_key`, the key is on the loser row being
  deleted — document that merging *onto an unlinked survivor* drops the link (admin re-links, or
  defaults to the linked row as survivor, which the UI does).
- **Concurrent poll during merge:** the poll resolves by key; if the key moves to the survivor before
  the poll runs, dates resolve to the survivor; the transaction makes the window atomic.
- **Cross-org / non-admin / empty losers:** rejected by the RPC's `RAISE` guards.

## 10. Testing (five layers)

- **Unit (vitest):** `normalizeCityName`; `buildCityKey` case-folding (updated existing test);
  `planCityReconciliation` (skip-linked / link-existing / create-new / first-of-duplicates);
  `groupDuplicateCities`.
- **DB (pgTAP, `supabase/tests/db/merge_cities.sql`):** repoint all four FKs loser→survivor; junction
  unique-conflict drops the redundant loser row (no error, no dup); `show_dates`/`show_assignments`
  nulls are repointed not lost; losers deleted; survivor untouched; cross-org loser rejected; non-admin
  rejected; survivor-in-losers rejected; empty losers rejected.
- **Edge (Deno):** the §8 `airtable-poll` regression — case-insensitive city link + venue/session
  carry-through.
- **Component (vitest + RTL):** Import-all auto-links a name-matching seeded city instead of creating;
  per-row link-to-existing; duplicate panel renders groups and calls `mergeCities`.
- **E2E (Playwright):** *optional / may defer* — import cities (auto-link a seeded match) → force a
  duplicate via a non-matching link → merge → one city remains. Note in the plan if deferred.

## 11. Verification

1. **Unit + component (CI):** Typecheck (validates the cross-boundary re-export), Unit, Lint green.
2. **DB (CI pgTAP):** `merge_cities` test green.
3. **Edge (local Deno):** `deno test --allow-all supabase/functions/airtable-poll/` green.
4. **Migration** applied via Supabase MCP `apply_migration`; file named to the recorded version;
   `types.ts` regenerated and committed.
5. **Manual smoke (post-merge):** in a scratch org, seed a "Berlin", Import-all an Airtable "Berlin"
   option → it links (no duplicate); then construct two rows and merge → FKs repoint, one row remains.
6. Folded into the **Phase 3 live validation** (§8): a real poll lands venue/sessions and resolves
   cities case-insensitively.

## 12. Phasing

- **4a — preventive (data/frontend, no DB migration):** `normalizeCityName` + `buildCityKey`
  case-insensitive; `planCityReconciliation`; Import-all auto-link; per-row link-to-existing; updated
  unit/component tests; venue/session assertions in the Deno regression. Ships independently.
- **4b — merge tool (DB + UI):** `merge_cities` migration + grants; pgTAP; `groupDuplicateCities` +
  `mergeCities`; duplicate panel; `types.ts` regen. Builds on 4a.
- **Docs (in each PR):** CLAUDE.md Airtable-sync section (auto-link + merge behavior) and
  `docs/app-logic.md` cities notes.

## 13. Out of scope (later phases / explicitly deferred)

`venues` table; program-key normalization; identity/contact dedup (Phase 5); custom synced fields
(Phase 6, ADR-0009); composite program-key grain. None are touched here.
