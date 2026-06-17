# ADR-0006: `show_dates.status` is computed in the database by triggers

**Status:** Accepted
**Date:** ~2026-05-13 *(recorded retroactively 2026-06-16; the design rationale below is
reconstructed — the original migrations document the mechanism, not the "why")*
**Deciders:** Stefan Schaal (platform owner)

## Context

A show date's fill state — `open | partially_filled | fully_filled | cancelled` — is a function of
how many confirmed bookings it has versus its capacity. That value could be written by client code
on every booking mutation, or derived in the database.

## Decision

Status is **computed in the database**. `compute_show_date_status(p_show_date_id)` (SECURITY
DEFINER) sets `open | partially_filled | fully_filled` from confirmed-booking counts vs capacity and
*"Never overwrites a 'cancelled' status — that is set explicitly by mutations."* It is driven by
`sync_show_date_status_trigger` on `bookings`, and recomputed by triggers on `app_settings` (slot
defaults) and `shows` (program/sub_program). Client code must **not** set status directly.

## Options Considered

**Client-set status** is the implied alternative but is **not documented** as an explicit
comparison. The rationale for computing in the DB is **reconstructed**: a single source of truth
regardless of which client or edge function mutates bookings; correct under the service-role/offer
engine paths that bypass the client; and consistent with Supabase Realtime (subscribers see the
trigger-updated value).

## Trade-off Analysis

Computing in the DB centralizes the rule at the one place all writes pass through, at the cost of
business logic living in SQL triggers (harder to change and to read than TypeScript). The project
mitigates that with pgTAP coverage of the trigger.

## Consequences

- **Easier:** status is always consistent no matter who writes a booking (UI, offer engine, cron).
- **Harder:** logic in triggers is heavier to evolve/test.
- **Capacity source has evolved (the decision itself is stable):** originally a `slots_per_date`
  column (`COALESCE(sd.slots_per_date, s.slots_per_date)`), then moved to
  `app_settings.sub_program_slots_defaults` (`20260514000000_slots_from_settings.sql`; "there is no
  `slots_per_date` column"), and **planned** to move onto `shows` columns per
  [ADR-0001](0001-airtable-system-of-record.md) and the sync-engine spec. Only the *capacity input*
  changed; *computed-in-DB* did not.

## Implementation (delivered)

`20260513130000_booking_status_trigger.sql`, `20260514000000_slots_from_settings.sql`. Codified in
CLAUDE.md ("`show_dates.status` is DB-computed").
