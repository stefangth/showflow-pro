# Calendar surface i18n migration

**Branch:** `claude/calendar-surface-i18n` · **Date:** 2026-08-16
**Spec:** `docs/superpowers/specs/2026-08-15-calendar-integrated-surface-design.md` §8

## Goal

Route every hardcoded user-facing English string in `src/components/calendar/surface/`
and `src/lib/calendar/` through react-i18next `t()`, with EN canonical and DE
key-for-key. Keep `keyParity`, `copyLint`, `translationCompleteness`, and `terms`
green, plus `tsc` (typed keys), `lint`, and the ~20 existing surface unit tests.

## The invariant that keeps tests green

`src/test/setup.ts` imports `@/i18n`, so bare `render()` resolves `t()` to English.
Therefore **every EN key value must byte-match the current literal** (including
`…`, `·`, arrows, and casing). Do not "improve" English wording in this pass.

## Namespace routing (honors the task's bookings/availability instruction)

- **Producer-only** components → `bookings:calendar.*`
  (CalendarSurface producer branch, NeedsYouLens, QueueRail, AgendaLens, SeasonLens,
  SeasonKpis, SeasonStripMobile, WeekLens, DayDetail/DayRail producer branches).
- **Artist-only** components → `availability:calendar.*`
  (extends the existing `availability.calendar` object; OffersLens, AllDatesLens,
  CalendarSurface/DayDetail/DayRail artist branches).
- **Role-agnostic shared chrome** (PeriodNavigator, SelectionBar, FillMeter aria,
  MonthGrid "+n more") → `common:calendar.*`. Deliberate: these leaf components are
  reused in both surfaces and carry no role; a `common` sub-key avoids duplicating
  identical strings into both catalogs or threading props through every call site.
  Noted as a minor, documented deviation from "only bookings/availability".
- Components branching on role load both needed namespaces:
  `useTranslation(['bookings','availability','common'])`, key via `t('bookings:…')`.

## Weekday headers → date-fns locale, NOT t()

`MonthGrid`/`WeekLens` `WEEKDAYS` and `SeasonLens` `WEEKDAY_INITIALS` are calendrical.
`src/lib/dates.ts` already exposes an active-language date-fns locale helper
("a language switch reformats weekday names"). Generate Monday-first weekday
labels from that locale instead of hardcoded English arrays. This matches app
convention and localizes DE for free. No catalog keys for weekdays.

## Pure modules (no hooks) — per-module decision

- **tone.ts** — NO structural change. Keep `PRODUCER_TONES`/`ARTIST_TONES` `label`
  fields (English) as the in-module anchor (tone.test.ts asserts them) and
  `artistStatusLabel(status, overrides)`. Components stop reading `.label` for
  display and resolve `t('…producerStatus.'+status)` / `t('…artistStatus.'+status)`.
  Producer statuses get a new `producerStatusLabels(t)` helper mirroring
  `flowCopy.bookingStatusLabels`.
- **needsYou.ts** — delete `NEEDS_YOU_GROUP_LABELS` (its test does not assert it);
  QueueRail + NeedsYouLens resolve `t('…needsYouGroups.'+key)`.
- **producerPrimary.ts** — keep `label` (producerPrimary.test.ts asserts the object
  shape); components display via `kind` → `t('…primary.'+kind)`.
- **artistData.ts** — NO change; `flag.text` stays the discriminant `'answer'|'blocked'`
  (artistData.test.ts asserts it). MonthGrid maps it via `t('…flag.'+flag.text)`
  (EN values are the lowercase words "answer"/"blocked" to byte-match).
- **seasonData.ts** — change `rowLabel` to signal the empty fallback (return `''`
  + `labelFallback: true`, or `null`) instead of the literal `'Untitled'`;
  SeasonLens/SeasonStripMobile render `t('…season.untitled')`. Update seasonData.test.ts.

## Pluralization

Convert inline `n === 1 ? '' : 's'` / `plural()` / `dateWord()` to i18next
`_one`/`_other` keys (NeedsYouLens, AgendaLens, SeasonKpis, SeasonLens,
SeasonStripMobile, DayDetail, SelectionBar). Rendered output must match the old
concatenation for each count.

## Sequence

1. Author EN catalog keys in `bookings.json`, `availability.json`, `common.json`
   (byte-matching literals), then DE mirror (reserved terms: Hold→Vormerkung,
   Hire order→Engagementvertrag, Blocked→Gesperrt, Digest→Tagesübersicht,
   Offer→Angebot, producer role→Produktionsteam; informal Du; no em/en dashes;
   DE ≠ EN unless allowlisted).
2. Pure modules + their unit tests (tone/needsYou/producerPrimary/artistData/seasonData).
3. Weekday date-fns helper + wire MonthGrid/WeekLens/SeasonLens.
4. Component wiring, file by file (useTranslation, replace literals).
5. Review each mounting page's PageMini + Help center (`src/lib/help/items.ts`)
   for calendar-surface impact; update copy if it references renamed/changed surface.
6. Add a one-line i18n rule to CLAUDE.md Conventions ("new user-facing surfaces
   must route copy through `t()`").
7. Verify gates: `npx vitest run src/i18n` (parity/lint/completeness/terms),
   `npx vitest run src/components/calendar src/lib/calendar`, full
   `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`.

## Risks

- Missing a string → shipped English literal. Mitigate: the inventory list is the
  checklist; grep the surface for capitalized-word JSX literals after wiring.
- Wrong/near-miss EN key value → breaks a getByText test. Mitigate: byte-match.
- Unknown `t()` key → tsc error (typed catalog). Strong safety net.
- DE == EN paste-through → completeness test fails. Mitigate: translate every leaf.
