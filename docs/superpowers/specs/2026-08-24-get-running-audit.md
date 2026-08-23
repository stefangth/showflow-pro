# Get Running audit: findings and required behaviour

**Date:** 2026-08-24 · **Build:** v1.17.2 · **Surface:** `/get-running` (v3 board) · **Role:** org admin
**Published report:** https://claude.ai/code/artifact/86911f5e-1fec-4111-a376-3fd5ae588303
**Plan:** [`../plans/2026-08-24-get-running-truthful-completion.md`](../plans/2026-08-24-get-running-truthful-completion.md)

## Method

The Bootstrap org was emptied to zero rows (login, org membership and module entitlements
preserved), then every step of all three onboarding wizards was completed through the UI as
a first-time admin, entering realistic data: one production with a 2 main plus 1 understudy
breakdown, five artists, four skills, three cities, two casts, one dated show in Bremen.
Every figure below was read from the database or the live DOM, not from a screenshot.

## Headline

The board reached **14 of 14 done** and showed its retired "Everything here is set up" state
on an org that cannot send a single ask. One click away, the Dates page read
"At risk, under-cast" and "Nobody who can be asked for this date."

Ground truth at that moment: 5 artists, **0 artist-skill links**, 2 casts, **0 cast members**,
1 date, 0 possible asks. The first-choice ranked cast was empty.

## Required behaviour

A step reports done only when the thing it names is true. Absence of a counter-example is
not completion. Concretely:

1. A phase whose job is to get dates in cannot complete with zero dates.
2. "Every date has a city" is false when there are no dates, not true.
3. A cast with no members does not cover a city, however it is ranked.
4. The skills step reflects whether artists are actually eligible for the parts that
   require skills, not merely whether a skill catalog exists.
5. A step that reports itself blocking must offer a way to clear that block, or say
   plainly where the block is cleared.
6. A primary action either does what it says or is disabled with the reason visible.

## Findings

| # | Severity | Finding |
|---|---|---|
| 01 | Critical | Completion certified without the underlying work. 14 of 14 on an org with 0 artist-skill links and 0 cast members. Three vacuous completions compound: "Set a city on every date" (green with 0 dates), "Set skills on your artists" (green with 4 skills defined and 0 assigned), "Rank your casts" (green with a 0-member cast ranked first). Once all three pass, the "Your first ask is shut" warning disappears, removing the one signal that could have caught it. |
| 02 | Critical | The cities step is a dead end. Flagged "Blocks your first ask", but its body reads "No cities to resolve yet" even with three cities created and a date genuinely missing one; it only maps imported Airtable city strings. Continue collapses the wizard without completing the step or explaining anything. The real fix path (Dates, open date, Setup tab, City) is never mentioned. |
| 03 | Major | Progress runs backwards. Adding the first date moved the counter 5 of 14 to 3 of 14 and un-ticked two green steps. |
| 04 | Major | "Get dates in" completed at 3 of 3 with one production and zero dates. |
| 05 | Major | Letterhead claims values are "pulled from your organization profile" while all three fields are empty placeholders; Confirm is enabled empty and silently advances without saving, completing or warning. |
| 06 | Minor | Auto-advance is inconsistent. Explicit saves advance (dates source, terms, letterhead, cast ranking, booking flow); implicit completions do not (add artists, skills, default fee). |
| 07 | Minor | Finishing a phase collapses the wizard with no confirmation and no handoff to the next phase. |
| 08 | Minor | Past dates are freely selectable. 0 of 42 day cells disabled; a show date was created for 28/07/2026 while today was 24/08/2026, with no warning. |
| 09 | Minor | Fabricated sample data on real empty screens. The page-mini illustrations render invented tiers, people and audit entries ("Tier 1: Berlin Principal", "Ines Vermeer", "Sam Producer changed…") on an org that has none, with nothing marking them as examples. |
| 10 | Minor | The step counter jumps from "Step 1 of 5" to "Step 3 of 3" when a manual source hides two steps. |
| 11 | Minor | No way to add a city from the New date dialog and no pointer to where cities live. The casting breakdown has the same shape for skills. |
| 12 | Minor | Copy mismatches. The date cockpit reports "Anyone can be asked" with zero eligible artists and no missing-city warning; the countersignature guide describes "who signs on behalf of the org" while the controls choose how the artist signs. |

## Owner feature request

> When adding a production and casting breakdown, skills could currently only be assigned
> later, once they have been added to artists. Fix this by allowing users to add skills and
> mark them required while adding parts, showing existing skills as well.

Reference UI supplied by the owner: a rounded chip carrying a leading check and the skill
name, in the accent tint, for a selected skill.

**Existing state, established during planning:** `CastingBreakdownFields.tsx:141-147` already
gives every part a `SkillPicker` bound to `row.skillIds`, so marking an *existing* skill
required on a part works today. Two things block the described flow:

- `SkillPicker` short-circuits to a plain paragraph when the catalog is empty
  ("No skills yet. Add skills on artist profiles first."), leaving no interactive element,
  which is the wall a new producer hits.
- There is no way to create a skill that does not exist yet without leaving for Settings.

So the work is inline creation plus an actionable empty state, not a new picker.

## Out of scope

Anything not reachable from the three onboarding wizards, and the artist-facing surfaces.
