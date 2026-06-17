# ADR-0010: Catalog links are per-org opaque-key columns; the link grain lives in the mapping layer, not the schema

**Status:** Accepted
**Date:** 2026-06-17
**Deciders:** Stefan Schaal (platform owner)

## Context

The sync must resolve each Airtable record to exactly one Showflow `shows` / `cities` row
([ADR-0001](0001-airtable-system-of-record.md) — Airtable is the system of record; Showflow mirrors
and maps, never creates). Producers' bases differ in **what identifies a program**: some carry a
single "Sub-Programm" controlled field; others split it across "Program" + "Sub-Programm". So the
**grain** of the link (one field vs a composite) is not fixed across orgs.

Two things consume this link:
1. The **mapping UI** (Phase 2b, `AirtableSyncTab`) where an admin links Airtable options to catalog
   rows and bulk-imports new ones.
2. The **`airtable-poll` rewrite** (Phase 3) where, per record, the sync builds the link key from the
   record's mapped field value(s) and looks up the catalog row.

These two MUST agree on how the key is built, or records silently fail to resolve — the exact class
of failure this whole initiative exists to kill (the live poll currently imports 0 rows silently).

This also sits on the pooled multi-tenant schema ([ADR-0003](0003-pooled-multi-tenancy-isolation.md))
and the rule that schema changes go through the migration tool.

## Decision

Store the catalog link as a **per-org-unique, opaque `text` key column** on the catalog row, and
**compose that key in a shared mapping-layer helper** — never encode the grain in the database.

- **Columns:** `shows.airtable_program_key` and `cities.airtable_city_key` (`text`, nullable), each
  with a **partial unique index per org** (`UNIQUE (org_id, …_key) WHERE …_key IS NOT NULL`). A key
  identifies at most one row within an org; it is free across orgs; unlinked rows stay NULL. (Shipped
  in PR #100, migration `20260617110532_airtable_link_columns`.)
- **Opaque value:** the column stores whatever string the mapping layer produces. The DB does not
  know whether that is a single sub-program option or a `program|sub_program` composite — there is no
  CHECK, no FK to a normalized grain.
- **Single source of key composition:** `buildProgramKey(program, subProgram)` / `buildCityKey(city)`
  in `src/data/airtableMapping.ts`. `buildProgramKey(null, name)` → `name` (sub-program-only);
  `buildProgramKey(p, s)` → `"p|s"` (composite). **Both the UI and the Phase 3 poll MUST call this
  same helper (or an exact server-side port).**
- **Field map vs link, deliberately different stores:** *which Airtable field feeds each Showflow
  field* is org-level config and stays JSON in `app_settings.airtable_field_map`. The *option→row
  link* is relational, FK-adjacent, per-row, needs a uniqueness constraint, and is read per-record by
  the poll — so it is a column, not JSON.
- **Grain shipped:** Phase 2b links **sub-program-only**. The composite grain is **deferred** and is
  addable **without a migration** (extend the helper's usage + the poll; the column is already
  opaque).

## Options Considered

### Option A: Opaque per-org key columns, grain composed in a shared helper *(CHOSEN)*
| Dimension | Assessment |
|-----------|------------|
| Grain flexibility | High — admin/mapping chooses grain; composite addable with no migration |
| UI↔poll agreement | Enforced by one shared helper (single point of truth) |
| Constraint power | Per-org uniqueness via partial index; resolution is a plain indexed lookup |

**Pros:** one resolution path; grain is a mapping concern, not a schema migration; composite is purely
additive; partial-unique index guarantees ≤1 row per key per org.
**Cons:** the DB can't validate the grain; UI and poll must share the *exact* key-composition logic —
a divergence is a silent-resolution bug (mitigated by the single shared helper).

### Option B: Encode the grain in the schema (normalized link, or per-grain columns) *(REJECTED)*
**Pros:** DB-level structure; the grain is explicit.
**Cons:** rigid — changing or mixing grains needs a migration and per-grain code; couples the UI and
poll to a fixed grain; over-models a moving target while the sync is still being built.

### Option C: Store links in `app_settings` JSON (like the field map) *(REJECTED)*
**Cons:** no uniqueness constraint (two rows could claim one option); not FK-adjacent; per-record
poll resolution against a JSON blob is O(n) and awkward; the link is relational data, not config.

## Trade-off Analysis

The decision trades **DB-enforced grain structure** for **flexibility + a single resolution path**.
The principal risk — UI and poll composing the key differently — is contained by funnelling *all* key
composition through one helper (`buildProgramKey`/`buildCityKey`); Phase 3 is required to reuse it
rather than re-derive the key. The payoff is large: the grain becomes a per-org mapping choice, the
common (sub-program-only) base works today, and the composite grain ships later with zero migration.

## Consequences

- **Phase 3 (poll rewrite) is bound by this:** its per-record resolution MUST build the key via the
  same `buildProgramKey`/`buildCityKey` and look up `airtable_program_key`/`airtable_city_key`. Any
  divergence in composition resolves nothing — and (by the fail-loud design) such records are **held
  and reported**, never silently dropped.
- **Composite grain is additive:** enabling Program+Sub-Programm linking later changes only the
  helper's inputs in the UI and poll — no migration, no column change.
- **Per-org uniqueness is guaranteed** by the partial indexes; the same option value may map to
  different rows in different orgs.
- **A renamed Airtable option** yields a new key → its records become *unresolved/held* until re-linked
  — visible in the Phase 3 sync report, never a silent drop.
- **Relates to:** [ADR-0001](0001-airtable-system-of-record.md) (this is the concrete linking
  mechanism for "mirror and map") and [ADR-0009](0009-extensible-synced-fields.md) (custom fields ride
  the same field-map read but are non-load-bearing; the link key *is* load-bearing).

## Action Items

1. [ ] **Phase 3:** the `airtable-poll` rewrite resolves records via the shared
   `buildProgramKey`/`buildCityKey` helper (import it or port it exactly server-side) against the
   `airtable_program_key`/`airtable_city_key` columns. Add a test asserting UI and poll produce the
   same key for the same input.
2. [ ] If/when composite grain is needed: extend the helper's usage in `AirtableSyncTab` (map Program
   too) and in the poll — **no migration**.

See the sync-engine spec [§5/§6](../superpowers/specs/2026-06-16-airtable-sync-engine-design.md) and
the [Phase 2b design](../superpowers/specs/2026-06-17-airtable-mapping-model-phase-2b-design.md).
