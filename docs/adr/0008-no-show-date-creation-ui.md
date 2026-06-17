# ADR-0008: No in-app UI for creating show dates

**Status:** Accepted
**Date:** removed pre-2026-06-03 *(the create flow was removed earlier; rationale recorded by the
owner 2026-06-16)*
**Deciders:** Stefan Schaal (platform owner)

## Context

`show_dates` are the centre of the booking engine. They can be created in two broad ways: an in-app
producer form, or ingestion from an external authoring surface. Showflow once had a create-show-date
flow; it was intentionally removed (and `ShowDetailPage` / `ShowDetailSheet` deleted with it).

## Decision

There is **no in-app create-show-date flow**. New `show_dates` arrive via the Airtable sync
([ADR-0001](0001-airtable-system-of-record.md)) or, failing that, the Supabase dashboard / a future
admin-only flow.

**Rationale (owner, 2026-06-16):** it was out of scope for the launch customer (Fever) because it is
not necessary — Fever authors the schedule in Airtable, which Showflow syncs. **Revisit for
customers who author shows in-app** rather than in Airtable.

## Options Considered

**Not documented** as a comparison at removal time. The decision is grounded in the customer's
workflow (Airtable is the authoring surface), not in a weighed set of alternatives.

## Trade-off Analysis

Having a single authoring surface (Airtable) removes a second create path that would otherwise have
to stay consistent with the sync's upsert/idempotency logic. The cost is that an org *not* using
Airtable has no self-serve way to add dates until a UI exists.

## Consequences

- **Easier:** one authoring surface; no duplicate create path to reconcile with the sync.
- **Harder / revisit trigger:** an org without Airtable depends on the Supabase dashboard until an
  admin create-flow is built. Tracked as a separate effort (multi-tenancy spec §13: *"a domain
  feature, not multi-tenancy … tracked as a separate effort"*). This is the natural counterpart to
  ADR-0001 — if a future customer authors in-app, both this and the "Airtable is system of record"
  stance get revisited together.

## Implementation (delivered)

The create-show-date flow and `ShowDetailPage` / `ShowDetailSheet` were removed prior to the
captured PR window; current state documented in CLAUDE.md ("No UI for creating show dates").
