# ADR-0007: Drop the `availability` table in favour of `blocked_dates`

**Status:** Accepted
**Date:** 2026-05-14 *(recorded retroactively 2026-06-16)*
**Deciders:** Stefan Schaal (platform owner)

## Context

Artists originally declared per-day availability (`available | tentative | unavailable`) in an
`availability` table — an **opt-in** model where an artist had to positively mark free days.

## Decision

Drop `availability` and move to an **opt-out** model: the offer engine covers offered dates, and
`blocked_dates` records explicit conflict windows. Verbatim migration rationale:

- *"Drop the availability table. The offer engine (bookings.status = 'suggested') now covers offered
  dates; blocked_dates covers conflict windows."*
- *"Replaces the narrow 'I'm unavailable on date X' use-case from the old availability table. No
  recurrence — artists enter dates individually."*

## Options Considered

**Not documented** beyond the migration comments. The retained model (offers + `blocked_dates`) was
chosen over keeping the positive-availability table; no other alternative is recorded.

## Trade-off Analysis

Opt-out means artists only act when they have a conflict (block a date) or when an offer arrives,
rather than maintaining a standing calendar. Less data entry and no stale "I'm free" rows, traded
against losing a positive free-signal the booking side could have read.

## Consequences

- **Easier:** artists act only on offers + block exceptions; no stale availability to keep current.
- **Harder:** there is no positive "available" signal; eligibility + offers carry that role.
- **Documentation drift to fix:** CLAUDE.md and `docs/app-logic.md` still describe the
  `availability` table and `['availability', …]` query keys. This is stale — the live schema has
  `blocked_dates`, not `availability`. Folded into the docs pass in
  [ADR-0001](0001-airtable-system-of-record.md)'s spec (Phase 1).

## Implementation (delivered)

`20260514190000_blocked_dates.sql`, `20260514200000_drop_availability.sql`.
