# ADR-0001: Airtable is the system of record; Showflow mirrors and maps

**Status:** Accepted
**Date:** 2026-06-16
**Deciders:** Stefan Schaal (platform owner / org admin)

## Context

Producers author the show schedule — **events**: a date, program, sub-program, city, venue,
and session times — in **Airtable**. Showflow's own domain is *booking*: artists, blocked
dates, casts, eligibility, offers/tiers, bookings, chat, and notifications. Airtable models
none of that.

The `airtable-poll` cron is meant to pull Airtable → `show_dates`. Validated against the live
"SFP Test Airtable" base (via the Airtable MCP), the sync is currently a **silent no-op**: the
edge function reads hardcoded English field names (`Date`, `Show`, `Session 1`) that do not
exist in the real base (the fields are `Datum`, `Program`, `Sub-Programm`, `1. Show`). Every
record is dropped at the first lookup, and the run records `status: 'success', records_processed: 0`.
The entire Airtable↔DB contract — field names *and* program/city values — is stringly-typed and
unvalidated, so a total mismatch reports success.

Two forces shape the decision:
1. We want a **foolproof** sync: a schema-driven mapping the admin can see and pick from, and a
   guarantee that **no date is ever silently lost**.
2. A fair question was raised: *if everything is synced from Airtable, do we even need `shows` /
   `cities` tables — can we remove more?*

## Decision

**Airtable is the system of record for event/catalog data. Showflow mirrors and maps that data
into its own persisted tables, and never authors or creates catalog data itself.**

Concretely:

1. **Persisted tables are justified by what FKs to them, not by where the data originates.**
   `show_dates`, `shows`, and `cities` stay as tables because Showflow-only logic references
   them by foreign key — bookings, offer tiers, and chat point at `show_date_id`; cast
   eligibility points at `show_id`; offer-wave priority (`cast_city_priority`) and producer
   routing (`show_assignments`) point at `city_id`. **You cannot put a foreign key on an
   Airtable record.** "Synced from Airtable" and "needs a table" are independent questions.

2. **`shows` is the canonical program entity.** Slot capacity (main cast / understudies) moves
   onto `shows` columns; the `app_settings.sub_program_slots_defaults` JSON retires. **No
   separate `programs` table is introduced.** `venue` stays as **synced text** on `show_dates`
   because nothing joins on it.

3. **Mapping is schema-driven, with a manual fallback.** Showflow reads the Airtable base list and schema
   (tables, fields, single-select option sets) **server-side** — the Personal Access Token stays
   in Supabase Vault and is never exposed to the browser — and presents the admin dropdowns to
   bind each Showflow field to an Airtable field. **Manually typed field names are the fallback**,
   used only when the PAT lacks the `schema.bases:read` scope.

4. **Nothing is created; unmatched values are held and reported.** The catalog (`shows`,
   `cities`) is populated by the admin **linking Airtable single-select options** to Showflow
   entities. A record whose program/city value is not linked is **held as unresolved and
   surfaced in a report**, never auto-created and never silently dropped.

5. **The sync is observable.** The existing `airtable_sync_log` gains structured counts
   (imported / new / updated / held) plus a `details` summary, **and** a queryable per-record
   child table records the outcome of every row of every run.

## Options Considered

### Option A: Airtable system-of-record; Showflow mirrors into persisted tables *(CHOSEN)*

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — needs a mapping/linking step and a schema-read path |
| Cost | Low — reuses existing tables; one new child table |
| Scalability | Good — booking-engine joins stay on indexed FKs |
| Team familiarity | High — producers already live in Airtable |

**Pros:** typed joins for eligibility/offer-tiering; one source of truth (no merge conflicts);
every record's fate is reportable; matches the existing producer workflow.
**Cons:** requires a one-time mapping/linking step per base; catalog freshness depends on a sync
having run; a value renamed in Airtable must be re-linked.

### Option B: Denormalize Airtable values inline on `show_dates` (no reference tables)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low to write, high to live with |
| Cost | Low upfront |
| Scalability | Poor — string matching on hot paths |
| Team familiarity | High |

**Pros:** fewest tables; no matching step.
**Cons:** re-introduces stringly-typed joins for `cast_city_priority` and `show_cast_eligibility`
— a city or program typo misfires offers; nowhere to store Showflow-side production state (slot
counts, archive status); it is the exact fragility that broke the sync in the first place.

### Option C: Showflow is the system of record (author catalog in-app, push to Airtable)

| Dimension | Assessment |
|-----------|------------|
| Complexity | High — two-way sync |
| Cost | High |
| Scalability | Fine |
| Team familiarity | Low — fights the current workflow |

**Pros:** full in-app control; independent of Airtable field naming.
**Cons:** duplicates Airtable's role; producers already author in Airtable; two-way sync invites
merge conflicts; much larger build.

## Trade-off Analysis

The real question is *where catalog data is authored* and *how Showflow references it*. Option B's
table savings are illusory: it does not remove the join keys, it just moves them from foreign keys
to fragile strings — which is precisely what silently broke the sync. Option C is a larger system
that fights how producers already work. Option A accepts one schema-guided mapping/linking step in
exchange for typed joins, a single source of truth, and the ability to report every record's
outcome. The "do we even need the tables" instinct is correct *in spirit* — Showflow should not
hand-maintain catalogs — but the tables must persist as join targets; what changes is that their
**contents become projections of Airtable** rather than independently-authored data.

## Consequences

**Easier:** a foolproof, observable sync; typed eligibility/offer joins; slot config lives with the
program it describes; no silent data loss; the silent `success / 0 rows` failure becomes impossible.

**Harder:** there is now an explicit mapping/linking step per base; catalog freshness depends on a
sync having run; renaming a value in Airtable requires re-linking (surfaced through the
held-and-reported path, so it is visible rather than silent).

**Revisit if:** producers want to author shows inside Showflow (revisit Option C); or `venue`
grows real attributes such as address or capacity (promote the synced text to a `venues` table).

## Action Items

1. [ ] Spec the sync engine — `docs/superpowers/specs/2026-06-16-airtable-sync-engine-design.md`.
2. [ ] **Phase 1:** add slot columns to `shows`; migrate `sub_program_slots_defaults` → `shows`;
   retire the JSON and its recompute trigger; add the `bookings` duplicate guard and the
   artist↔org consistency guard.
3. [ ] **Phase 2:** schema-read edge function + mapping/linking UI in Settings (replacing the dead
   "Filter Mappings" box); manual-typed fallback when scope is missing.
4. [ ] **Phase 3:** rewrite `airtable-poll` off the saved mapping; extend `airtable_sync_log` +
   add the per-record child table + the in-app sync report / notification.
5. [ ] **Phase 4:** cities normalization via linking; confirm `venue` + `session_2` carry through.
6. [ ] **Phase 5:** identity/contact deduplication (`profiles` / `artists`).
7. [ ] Update `CLAUDE.md` and `docs/app-logic.md` (including the stale `availability` / `user_roles`
   / approval-flow sections).
