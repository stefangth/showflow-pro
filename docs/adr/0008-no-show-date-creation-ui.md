# ADR-0008: No in-app UI for creating show dates

**Status:** Superseded 2026-06-23 — in-app show-date creation shipped (see Amendment below)
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
captured PR window. *(Historical — no longer accurate; this decision has since been reversed, see the Amendment below.)*

## Amendment — 2026-06-23 (Superseded)

This decision is **reversed**. Showflow now ships an in-app create flow for show dates —
`ShowDateFormDialog` (create), with edit/cancel/delete via `ShowDateDetailSheet` — delivered by
**PR #118** ("in-app show & show-date management", merged 2026-06-22). This is exactly the
*"revisit for customers who author shows in-app"* trigger the Decision named.

The two authoring surfaces now **coexist**: Airtable-synced rows stay locked for the fields the poll
manages (date/sessions/venue/city read-only) while manually-created rows are fully editable; deletes
are gated (a date hard-deletes only with zero bookings, otherwise Cancel; a show only with zero
dates, otherwise Archive). Current behavior lives in CLAUDE.md → *"In-app catalog & date
management"*.

[ADR-0001](0001-airtable-system-of-record.md) is unaffected: Airtable remains *a* system of record
for orgs that author there, but is no longer the *only* path to creating show dates.

> Per this directory's README, a reversal would normally be recorded as a **new** superseding ADR
> rather than edited in place. It is recorded here in-place at the owner's direction.
