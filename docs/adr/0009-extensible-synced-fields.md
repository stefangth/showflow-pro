# ADR-0009: Extensible synced fields via per-entity JSONB + a custom-field registry (not dynamic DDL)

**Status:** Accepted
**Date:** 2026-06-16
**Deciders:** Stefan Schaal (platform owner)

## Context

An Airtable base carries more fields than Showflow's core schema (Fever's "Events" table has
`Status`, `Berechnung`, and others Showflow doesn't model). Admins and org admins want to **capture
extra Airtable fields** into Showflow — and have them be **typed, filterable, and sortable**, not
just displayed — with the design **built to generalize** to other record types (artists, shows)
later, starting with `show_dates`.

This sits on top of two existing constraints: the **pooled multi-tenant** schema
([ADR-0003](0003-pooled-multi-tenancy-isolation.md) — one shared table per entity for all orgs) and
the project rule that **schema changes go through the migration tool** and `types.ts` is never
hand-edited.

## Decision

Add custom fields as a **per-entity JSONB value bag plus a per-org typed definition registry** —
surfaced through Showflow's existing editor column system. Do **not** add per-tenant database
columns.

- **Values:** a `custom jsonb` column per entity (`show_dates.custom` first; `artists.custom` /
  `shows.custom` added additively later). Per-row JSONB is naturally org-scoped.
- **Definitions:** a `custom_field_definitions` table (per-org, per-entity, typed; `UNIQUE(org_id,
  entity, key)`; `filterable`/`sortable` flags; `source`/`source_field` for the Airtable origin).
- **Typed / filterable / sortable:** each definition carries a `type`, defaulted from the Airtable
  field's type (via the §7 schema read) and overridable; filter/sort cast JSONB values by `type`,
  backed by a GIN index plus optional per-field expression indexes.
- **Surfaced via the existing editor:** custom fields extend `pageColumnDefs` /
  `resolveColumnTemplate` as a new column kind, reusing the visibility/order/role machinery and
  per-org `orgEditorConfig` — no parallel system.
- **Boundary:** custom fields are display/filter/sort **metadata; they do not drive booking logic**.
  A field that becomes load-bearing is **promoted to a real typed column** via a normal migration.

See the sync-engine spec §14 (Phase 6) for the implementation shape.

## Options Considered

### Option A: JSONB value bag + typed definition registry *(CHOSEN)*
| Dimension | Assessment |
|-----------|------------|
| Tenant safety | High — per-row keys, zero shared-schema pollution |
| Complexity | Medium — registry + filter/sort wiring + indexes |
| Type/query power | Medium — typed by convention + casts/indexes, not first-class columns |

**Pros:** self-service; tenant-safe in a pooled schema; reuses the editor; generalizes across
entities; respects the no-dynamic-DDL rule.
**Cons:** JSONB is not as queryable/constrained as real columns (mitigated by declared types,
indexes, and the promotion escape hatch).

### Option B: Dynamic per-tenant columns (`ALTER TABLE … ADD COLUMN` from app input) *(REJECTED)*
**Pros:** first-class typed/indexed columns.
**Cons:** in a pooled schema a per-org column lands on **every org's rows** — a tenant-bleed of
schema; breaks the auto-generated `types.ts` and the "schema changes go through the migration tool"
rule; dynamic DDL from user input is an injection / migration-drift hazard. Disqualified by
ADR-0003.

### Option C: No custom fields / hardcode each new field *(REJECTED)*
**Cons:** doesn't meet the need; every customer's extra field becomes an engineering task.

## Trade-off Analysis

The decision trades the first-classness of real columns (typing, constraints, effortless
indexing/joins) for tenant safety, self-service, and convention-compliance. The cost is bounded:
declared types + casts + indexes recover most filter/sort capability, and any field that genuinely
needs to be first-class can be **promoted to a real column** by a developer. JSONB for the long
tail; a column when it earns it.

## Consequences

- **Easier:** org admins capture extra Airtable fields without engineering; tenant-safe by
  construction; reuses the editor and filter system.
- **Harder / accepted:** custom data is JSONB-grade (not FK'd, not first-class for heavy reporting)
  until promoted; custom fields deliberately do **not** participate in booking logic.
- **Relates to:** [ADR-0001](0001-airtable-system-of-record.md) (this extends the sync's mapping —
  values still come *from* Airtable, only the definitions are admin-authored) and
  [ADR-0003](0003-pooled-multi-tenancy-isolation.md) (why per-tenant columns are disqualified).

## Action Items

1. [ ] Implement per spec §14 (Phase 6): `custom` columns, `custom_field_definitions`, capture
   toggle in the mapping UI, editor + filter/sort integration.
2. [ ] Document the "promote a custom field to a real column" path for developers.
