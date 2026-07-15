# Configurable Eligibility (Booking Flow Phase 4) Design

**Date:** 2026-07-15
**Status:** Approved (user, 2026-07-15)
**Predecessors:** `2026-07-14-booking-flow-editor-design.md` (Phases 1+2), `2026-07-15-flow-aware-surfaces-design.md` (Phase 3). Handoff: `docs/superpowers/plans/2026-07-14-booking-flow-followups.md`, item 9.

## Problem

The offer engine's tiering axis is hardwired to city: `cast_city_priority` maps (city, priority) to exactly one cast, identically for every show. Skills (`skills`, `artist_skills`) exist as artist-profile metadata but nothing reads them. And the engine has a latent incoherence: tiers 1..N never consult the show eligibility gate (`show_cast_eligibility` / `show_date_cast_eligibility`), so opening a city tier can offer to artists the direct-book list and the artist calendar would refuse.

## Decisions (from brainstorm, 2026-07-15)

1. **Tiering upgrade: per-show priorities.** A show can carry its own cast priority ladder per city, falling back to the org-wide city list when it has none. No other axis work (no venue entity, no org-picks-axis, no multiple casts per tier).
2. **Skills: hard requirement per show, with per-date additions.** The offer engine, the direct-book list, and the artist availability calendar all filter to artists holding ALL required skills.
3. **Approach A: generalize existing tables.** Priority column on `show_cast_eligibility`; two new skills-requirement tables; shared Deno module for ladder logic. No SQL resolver RPC, no policy-JSON rules engine.
4. **Gate fix: yes.** Tier candidates are intersected with the show eligibility gate when one exists, matching the documented rule that eligibility defines who can be booked at all.
5. **Priority UI lives in Settings.** Settings > Casts & Cities > "Cast Priority by City" gains a scope selector (organization default vs a specific show). Org-wide editing is unchanged.
6. **Skill-scoped opens: yes. Slot profiles: deferred.** Required skills are uniform by design: every offered/booked artist must hold all of them. Coverage needs (e.g. at least one judge among five slots) are NOT modeled in this phase. Instead, producers get a per-open skill filter on manual tier opens and skill filter chips in the direct-book list, which covers the "open more offers, judges only" workflow by hand. Slot profiles and per-profile fill math are explicitly deferred (see Non-goals).
7. **Understudy promotion becomes skill-aware.** When a confirmed main-cast artist cancels, promotion prefers the understudy whose skills best cover the cancelled artist's skills (see "Skill-aware understudy promotion"). Promotion is never blocked by skills: someone still gets promoted whenever a candidate exists.

## Data model (two migrations: one additive schema migration, one function replacement for skill-aware promotion)

### `show_cast_eligibility.priority`

- `ALTER TABLE show_cast_eligibility ADD COLUMN priority integer` with `CHECK (priority >= 1)`, nullable.
- Partial unique index: `UNIQUE (show_id, city_id, priority) WHERE priority IS NOT NULL`. Mirrors the org-level `UNIQUE (city_id, priority)`: one cast per tier per (show, city).
- `priority IS NULL` keeps today's meaning exactly: eligible for the show, untiered (reachable via direct booking and ad-hoc tier 99).
- Existing rows, RLS policies, and the `UNIQUE (show_id, city_id, cast_id)` constraint are untouched.

### `show_required_skills`

- Columns: `id uuid pk`, `org_id` (derived), `show_id` FK -> `shows(id) ON DELETE CASCADE`, `skill_id` FK -> `skills(id) ON DELETE CASCADE`, `created_at`. `UNIQUE (show_id, skill_id)`.

### `show_date_required_skills`

- Columns: `id uuid pk`, `org_id` (derived), `show_date_id` FK -> `show_dates(id) ON DELETE CASCADE`, `skill_id` FK -> `skills(id) ON DELETE CASCADE`, `created_at`. `UNIQUE (show_date_id, skill_id)`.

### Shared for both new tables

- `org_id` derived server-side via BEFORE INSERT trigger from the FK parent (`shows.org_id` / `show_dates.org_id`), reusing the existing derivation-trigger family (create the parent-specific derive function only if one does not already exist).
- RLS: enable; member reads via `is_org_member(auth.uid(), org_id)`; writes via `has_org_role(auth.uid(), org_id, ...)` for admin and producer (matching `show_cast_eligibility`); plus the RESTRICTIVE `org_isolation` policy. No `WITH CHECK (true)` anywhere.
- A skill referenced by a requirement must belong to the same org as the show/date. Enforce with a trigger-level check analogous to the booking org-coherence trigger (cheapest correct option; a cross-org insert raises).

`cast_city_priority`, `skills`, and `artist_skills` are not modified.

## Resolution semantics

### Effective ladder

For a (show, city) pair:

1. If any `show_cast_eligibility` rows exist for that `show_id` + `city_id` with `priority IS NOT NULL`, the ladder is those rows: tier N = the cast with priority N. The org list is ignored entirely for that pair.
2. Otherwise the ladder is the org-wide `cast_city_priority` rows for that city (today's behavior).

Resolution is per (show, city): a show may override Berlin and inherit Hamburg. A date without a city has no ladder (benign exit, as today).

### Tier 99 (ad-hoc)

Unchanged source (`show_date_cast_eligibility` for the date), but deduped against the *effective* ladder for (show, city) instead of always against `cast_city_priority`. A cast in the show ladder is not also offered as ad-hoc.

### Required skills

- Required skill set for a date = `show_required_skills` rows for its show UNION `show_date_required_skills` rows for the date. Dates add requirements; they never remove show-level ones.
- An artist qualifies only when they hold ALL required skills (subset test against `artist_skills`).
- Empty union = no skills filtering (today's behavior).

### Candidate pipeline (`open-offer-tier`)

Filters run in this order, each counting what it removes for the dry-run summary:

1. Effective-ladder cast(s) for the requested tier -> `cast_members` -> candidate artist ids.
2. `status = 'active'` (counts `inactive`).
3. Not already actively booked for the date (counts `already_booked`).
4. Not blocked on the date via `blocked_dates` (counts `blocked`).
5. **Gate (new):** if the union of show-level gate rows (`show_cast_eligibility` for show + city) and date-level gate rows (`show_date_cast_eligibility`) is non-empty, the candidate must belong to one of those casts; empty union = unrestricted. Exactly `useEligibleArtists` semantics. Counts `not_eligible`. (When the effective ladder IS the show ladder, its casts are gate rows by construction, so this can only exclude candidates when the org ladder is in effect.)
6. **Skills (new):** candidate must hold all skills in the effective required set. Counts `missing_skills`.

### Per-open skill filter (new)

The `open-offer-tier` request body gains an optional `skill_filter_ids: string[]`. When present, those skill ids are UNIONED into the required set for that invocation only (step 6 above), so only artists holding all of requirement-plus-filter receive offers. Rules:

- Applies to manual opens and dry-runs (the dry-run preview reflects the filter in its `missing_skills` count).
- Never passed by automation: `airtable-poll` auto-open of tier 1 and the `expire-offers` auto-escalation always open unfiltered.
- Not persisted: `show_date_offer_tiers` does not record the filter. Re-opening the same tier without a filter later offers to the remaining (already-booked artists are always skipped), so a scoped open composes with a later full open.

Dry-run response gains `not_eligible` and `missing_skills` in `excluded`. Everything downstream (insert shape, tier upsert, immediate delivery) is unchanged.

### Escalation (`expire-offers`)

The auto-escalate branch resolves the next tier as the smallest ladder entry strictly greater than the current tier **in the same effective ladder** (show ladder if the show has one for that city, else org ladder). Tier 99 remains excluded from escalation. All skip conditions are unchanged. `auto_open_tier1` still opens literal tier 1; ladders are expected to start at 1 (the editors keep the existing 1 to 5 tier dropdown convention).

### Skill-aware understudy promotion

`promote_understudy_on_cancellation()` (DB trigger function, currently defined in migration `20260714182625`) keeps all of its existing behavior: the show-date-cancellation guard, the `understudy_promotion` and `artist_acceptance` flow gates, accepted-understudies-only candidacy, the blocked-dates exclusion, `FOR UPDATE SKIP LOCKED`, the GUC suppression, audit log, and notifications. Only the candidate ORDER BY changes:

1. Coverage of the cancelled artist's skills, descending: `count` of skills shared between the candidate understudy (`artist_skills`) and the cancelled booking's artist. Full coverage beats partial beats none.
2. `created_at ASC` (the existing tie-break).

Consequences:

- A judge cancels: a judge-skilled understudy is promoted ahead of an older understudy without the skill.
- The cancelled artist has no skills: every candidate ties at zero and the ordering is exactly today's (oldest accepted understudy). Zero behavior change for orgs that do not use skills.
- Skills never block promotion; they only reorder preference.

The new migration follows the established pattern: a verbatim copy of the latest function body with only the ORDER BY amended, plus pgTAP coverage of the new ordering.

### Non-retroactivity

Priority and skill changes affect only future tier opens and escalations. Existing bookings and open offers are never modified by config edits.

## Where the logic lives

### Deno: `supabase/functions/_shared/eligibility.ts` (new)

Single home for the shared resolution logic, consumed by `open-offer-tier` and `expire-offers`, DI-tested via `makeFakeDeps`:

```ts
resolveTierLadder(admin, showId, cityId): Promise<{ source: "show" | "org"; tiers: { tier: number; castId: string }[] }>
nextTierAfter(ladder, currentTier): number | null            // pure
fetchGateArtistIds(admin, showId, cityId, showDateId): Promise<Set<string> | null>   // null = unrestricted
fetchRequiredSkillIds(admin, showId, showDateId): Promise<string[]>
filterArtistsBySkills(admin, artistIds, requiredSkillIds): Promise<string[]>          // ids holding all
```

### Frontend

- `src/data/eligibility.ts` (new): `fetchRequiredSkillIds(client, { showId, showDateId })`, `fetchSkillEligibleArtistIds(client, { requiredSkillIds })` returning `null` when there are no requirements (unrestricted) else the set of artist ids holding all of them, plus mutation helpers for the requirement tables and the priority column.
- `src/lib/eligibility.ts` (new): pure helpers (subset test, ladder-option derivation) shared by hooks and components, unit-tested.
- `deriveDirectBookList` (`src/lib/bookings.ts`) gains a fourth input, `skillEligibleIds: Set<string> | null | undefined`, with the existing fail-closed contract: `undefined` (unresolved) yields `[]`, `null` means unrestricted, a `Set` filters.
- `useArtistEligibleDates` filters out dates whose required skills the artist does not fully hold (hard-requirement semantics: the artist does not see the date in their availability calendar). One extra fetch of the artist's own `artist_skills` plus the requirement rows for candidate shows/dates, joined client-side.
- `fetchOfferTiers` (`src/data/bookings.ts`) resolves the effective ladder (show rows first, else org rows) and reports which source applied, so `buildOfferTierOptions` and `TierTimeline` present the correct tier numbers.
- Query keys follow the hierarchical convention (new `['eligibility', ...]` domain for requirement/priority reads). Mutations to priorities or requirements invalidate the `['eligibility']` prefix plus the existing `['eligible-artists']`, `['artist-eligible-dates']`, and offer-tier keys.

## UI

### Settings > Casts & Cities: scoped priority editor

The "Cast Priority by City" section gains a scope select at the top: **"Organization default"** (the current editor, unchanged, still backed by `cast_city_priority`) or a specific show (searchable select of the catalog). In show scope:

- The section lists that show's ladder per city, from `show_cast_eligibility` rows with `priority IS NOT NULL`.
- The add form picks City -> Cast -> Tier (1 to 5 dropdown, as today). Assigning a tier to a cast with no eligibility row for that (show, city) creates the row with the priority set (a prioritized cast is by definition eligible).
- Clearing a tier sets `priority = NULL` and keeps the eligibility row (the cast stays bookable directly). Deleting eligibility rows remains CastDetailsSheet's job; this editor never deletes rows.
- Helper copy in show scope: "Overrides the organization default for this show only. Cities without show priorities keep the organization default."

### Required skills editors

- **ShowFormDialog** (Productions page): a "Required skills" multi-select using the existing tag-picker pattern from ArtistProfileSheet, including create-on-the-fly. Helper copy: "Artists must have all of these skills to receive offers or be booked."
- **ShowDateDetailSheet**: a "Required skills" block showing inherited show-level skills as read-only chips labeled "From show", and date-level additions as removable chips with an add picker.

### Cockpit surfaces

- `TierTimeline` shows a small hint when the show ladder is in effect: "Using show-specific priorities".
- The tier open controls gain an optional skill picker labeled "Only offer to artists with", feeding `skill_filter_ids` on both the dry-run and the real open. Empty selection = unfiltered (default).
- The dry-run preview ("Preview who gets offers") lists the two new exclusion counts with labels "not eligible for this show" and "missing required skills".
- The direct-book list (`EligibilityBookList` in ShowDateDetailSheet) gains skill filter chips: selecting skills narrows the list to artists holding all of them, reusing `fetchSkillEligibleArtistIds` with the selected ids. Client-side view filter only; nothing persisted.

All copy uses no em or en dashes (standing rule).

## Testing

- **Vitest:** pure helpers in `src/lib/eligibility.ts`; data-access functions in `src/data/eligibility.ts` and the extended `fetchOfferTiers` via `supabaseFake`; `deriveDirectBookList` skills fail-closed behavior; `useArtistEligibleDates` skill filtering; priority-editor, skills-editor, tier-open skill-picker, and direct-book filter-chip component tests.
- **Deno:** unit tests for `_shared/eligibility.ts`; extended `open-offer-tier` contract suite (show-ladder resolution, org fallback, gate intersection, skills exclusion, `skill_filter_ids` union semantics on open and dry-run, dry-run counts, tier 99 dedup vs effective ladder); extended `expire-offers` suite (escalation walks the show ladder; falls back to org ladder; escalation opens unfiltered; manual path when the ladder is exhausted). Run the whole `supabase/functions/` suite.
- **pgTAP:** RLS on both new tables (member read, producer/admin write, cross-org denied); the partial unique index on (show_id, city_id, priority); org-derivation triggers; the same-org skill check; promotion ordering (skill match promoted over older non-match; no-skills cancellation keeps oldest-first as a regression guard; ties broken by age).
- **e2e (one spec):** show ladder overrides org ladder (opening tier 1 creates offers only for the override cast) and a skill requirement excludes an unskilled artist from the direct-book list.

## Docs (same PR)

- `docs/app-logic.md`: rewrite the Eligibility section around the effective-ladder rule and required skills; fix the stale escalation description (it predates the auto-escalate next-tier auto-open in `expire-offers`).
- `docs/system-map.md` **and** `src/data/systemMap.ts`: update the `open-offer-tier` and `expire-offers` entries (gate + skills filters, ladder-aware escalation) and the `promote_understudy_on_cancellation` trigger row (skill-aware ordering), per the standing same-PR rule.

## Behavior changes and rollout

- **Gate fix:** a show that restricts casts while org city tiers point outside them now offers to fewer artists (possibly zero, which is the benign "no candidates" exit). Dry-run makes the exclusions visible before opening a tier. This is the documented intent; the old behavior was the bug.
- **Promotion ordering:** when a cancelled artist has skills and understudies differ in coverage, the promoted understudy can differ from the pre-change (oldest-first) pick. Orgs whose artists carry no skills see no change.
- Everything else is opt-in: with no priorities set and no required skills, the engine behaves exactly as before.
- Migration is additive; frontend, edge functions, and migration ship in one PR (functions auto-deploy on merge; the migration is applied to prod via the established MCP flow with explicit user approval naming the project).
- Release: new user-facing features, so MINOR bump (1.10.0) at release time per the changelog conventions.

## Non-goals

- **Skill slot profiles (coverage requirements).** "At least one judge among five slots" is not modeled: fill math (`tierFill`, dashboards, the tier-at-risk watcher, confirm gating) remains skill-blind, so nothing detects a missing profile automatically. The per-open skill filter and skill-aware promotion are the mitigations. Full slot profiles are the leading candidate for the next phase.
- Multiple casts per tier (the one-cast-per-tier constraint stays, at both scopes).
- Org-configurable axis (venue, global, program-as-axis); no venues entity.
- Skills as soft ranking or scoring (the engine keeps "all eligible artists in the tier get an offer").
- Per-show booking-flow overrides.
- Retroactive enforcement of new requirements against existing bookings or open offers.
- Airtable sync involvement (priorities and skills are in-app config only).
