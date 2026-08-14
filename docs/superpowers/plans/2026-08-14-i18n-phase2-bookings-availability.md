# i18n Phase 2 — `bookings` + `availability` Namespaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the booking-flow view surfaces (producer Shows & Bookings + artist Availability/offers) from hardcoded English JSX strings to typed react-i18next `t('ns.key')` calls under two new namespaces, `bookings` and `availability`, each with hand-authored English + German catalogs.

**Architecture:** Follow the established `dashboard`-namespace pattern exactly: add typed JSON catalogs under `src/i18n/locales/{en,de}/`, register them in `src/i18n/index.ts` and `src/i18n/react-i18next.d.ts`, extend the `keyParity` test's namespace loop, and swap component strings for `t()` via `const { t } = useTranslation('<ns>')`. English catalog values are byte-identical to the current hardcoded strings so existing `getByText`/`findByText` component tests stay green with zero test-copy churn. German is authored per the project copy rules (informal *Du*, no em/en dashes, terms drawn from the `TERMS` glossary), and is auto-enforced by the existing `copyLint` + `keyParity` tests, which read straight from the `resources` object.

**Tech Stack:** React 18 + TypeScript, react-i18next (already bootstrapped in `src/i18n/`), Vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-14-i18n-and-help-page-design.md` (Phase 2, "Whole-app rollout strategy", §181-203). `dashboard` was the first Phase-2 namespace; this plan is the second and third, batched as the two sides of one booking flow.

## Global Constraints

- **English is canonical; German must match key-for-key.** `keyParity.test.ts` fails CI on any missing/extra German key (`fallbackLng: 'en'` would otherwise silently render English in prod). Add every new namespace to its `for (const ns of [...])` loop.
- **English catalog values MUST be byte-identical to the current hardcoded string** (same punctuation, same `…` ellipsis char, same `&`), so existing component tests that query by visible text keep passing untouched. Do not "improve" copy during migration.
- **No em dashes or en dashes** (`—` / `–`) anywhere in EN or DE copy — `copyLint.test.ts` fails on them. (The existing code already uses `·`, `…`, and `↑/↓`; keep those.)
- **German uses informal *Du*** address; `copyLint.test.ts` rejects mid-sentence formal `Sie/Ihr…`.
- **Reuse `TERMS` for domain terms** (`src/i18n/terms.ts`): Hold→Vormerkung, Soft-booked→Vorläufig gebucht, Cast→Besetzung, Understudy→Zweitbesetzung, Hire order→Engagementvertrag, Blocked date→Gesperrter Termin, Response window→Antwortfrist, Digest→Tagesübersicht. Do not re-translate a glossary term inline with a different word.
- **i18next interpolation** is `{{var}}`; **pluralization** uses `_one` / `_other` sibling keys with a `count` variable.
- **`any` is banned** (CI `--max-warnings 0`). Not expected to arise; these are string swaps.
- **Do NOT migrate shared flow-copy modules** in this PR: `@/lib/flowCopy` (`bookingsViewCopy`, `availabilityPageCopy`, `bookingStatusLabels`), `@/lib/bookingFlow` (`referenceLabel`), `@/lib/bookings/timingCopy` (`describeTonightStandalone`), `@/lib/bookings/actionCopy` (`acceptConsequenceNote`), `@/lib/bookingCockpit` (`computeDatePeek`/DatePeek). These produce org-flow-configurable copy consumed across multiple domains (incl. dashboard); leave every `pageCopy.*`, `statusLabels[...]`, `referenceLabel(...)`, `note.*`, `peek.headline`, and `tonight` value sourced from them exactly as-is. They are recorded in the Handoff section.
- **Do NOT migrate date/weekday formatting** (weekday-header arrays, `date-fns format(...)`, `.toLocaleDateString('en-GB', …)`). These are a date-locale concern deferred to the `dates.ts` locale-aware work (Handoff). Leave them English.
- **Verification per task** (run from repo root): the touched component's own test file(s), plus the two i18n gate tests:
  ```bash
  npx vitest run src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts <touched-component-test-glob>
  npx tsc -p tsconfig.app.json --noEmit
  ```

---

## File Structure

**Created:**
- `src/i18n/locales/en/bookings.json` — English catalog, `bookings` namespace (ShowsBookingsPage, ArtistBookingsView, RowPeek).
- `src/i18n/locales/de/bookings.json` — German catalog, `bookings` namespace.
- `src/i18n/locales/en/availability.json` — English catalog, `availability` namespace (AvailabilityPage, ArtistAvailabilityCalendar, AvailabilityPicker, OfferResponseButtons).
- `src/i18n/locales/de/availability.json` — German catalog, `availability` namespace.

**Modified (infra):**
- `src/i18n/index.ts` — import the 4 JSON files, add to `resources.{en,de}`, add `'bookings'`/`'availability'` to the `ns` array.
- `src/i18n/react-i18next.d.ts` — import EN types, add `bookings`/`availability` to the `resources` interface.
- `src/i18n/keyParity.test.ts` — add `'bookings'`, `'availability'` to the namespace loop.

**Modified (components — string swaps):**
- `src/components/availability/OfferResponseButtons.tsx`
- `src/components/availability/AvailabilityPicker.tsx`
- `src/components/availability/ArtistAvailabilityCalendar.tsx`
- `src/pages/AvailabilityPage.tsx`
- `src/components/bookings/RowPeek.tsx`
- `src/components/bookings/ArtistBookingsView.tsx`
- `src/pages/ShowsBookingsPage.tsx`

Task order migrates `availability` smallest-to-largest first (builds confidence on the smaller surface), then `bookings`. Namespace registration (Task 1) is a prerequisite for all component tasks.

---

## Task 1: Register the two namespaces (infra scaffold)

**Files:**
- Create: `src/i18n/locales/en/bookings.json`, `src/i18n/locales/de/bookings.json`, `src/i18n/locales/en/availability.json`, `src/i18n/locales/de/availability.json`
- Modify: `src/i18n/index.ts`, `src/i18n/react-i18next.d.ts`, `src/i18n/keyParity.test.ts`

**Interfaces:**
- Produces: two registered i18next namespaces, `'bookings'` and `'availability'`, typed and parity-checked. Component tasks consume them via `useTranslation('bookings')` / `useTranslation('availability')`.

Seed each JSON with a single throwaway namespace-level key so the catalogs are non-empty and the typed-key machinery has something to resolve; component tasks replace/extend it. (An empty `{}` also parity-passes, but a seed key exercises the type wiring in this task.)

- [ ] **Step 1: Create the four JSON catalogs (seeded, parity-equal)**

`src/i18n/locales/en/bookings.json`:
```json
{
  "_ns": "bookings"
}
```
`src/i18n/locales/de/bookings.json`:
```json
{
  "_ns": "bookings"
}
```
`src/i18n/locales/en/availability.json`:
```json
{
  "_ns": "availability"
}
```
`src/i18n/locales/de/availability.json`:
```json
{
  "_ns": "availability"
}
```

- [ ] **Step 2: Register in `src/i18n/index.ts`**

Add imports after the existing dashboard imports:
```ts
import enBookings from './locales/en/bookings.json';
import deBookings from './locales/de/bookings.json';
import enAvailability from './locales/en/availability.json';
import deAvailability from './locales/de/availability.json';
```
Extend `resources`:
```ts
export const resources = {
  en: { common: enCommon, help: enHelp, dashboard: enDashboard, bookings: enBookings, availability: enAvailability },
  de: { common: deCommon, help: deHelp, dashboard: deDashboard, bookings: deBookings, availability: deAvailability },
} as const;
```
Extend the `ns` array in `.init(...)`:
```ts
  ns: ['common', 'help', 'dashboard', 'bookings', 'availability'],
```

- [ ] **Step 3: Register types in `src/i18n/react-i18next.d.ts`**

```ts
import type enBookings from './locales/en/bookings.json';
import type enAvailability from './locales/en/availability.json';
```
Add to the `resources` interface:
```ts
      bookings: typeof enBookings;
      availability: typeof enAvailability;
```

- [ ] **Step 4: Extend the key-parity loop in `src/i18n/keyParity.test.ts`**

```ts
  for (const ns of ['common', 'help', 'dashboard', 'bookings', 'availability'] as const) {
```

- [ ] **Step 5: Verify infra is green**

Run:
```bash
npx vitest run src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts src/i18n/config.test.ts src/i18n/index.test.ts
npx tsc -p tsconfig.app.json --noEmit
```
Expected: PASS (both namespaces registered, parity holds on the seed key, types compile).

- [ ] **Step 6: Commit**

```bash
git add src/i18n/locales/en/bookings.json src/i18n/locales/de/bookings.json src/i18n/locales/en/availability.json src/i18n/locales/de/availability.json src/i18n/index.ts src/i18n/react-i18next.d.ts src/i18n/keyParity.test.ts
git commit -m "i18n: register bookings and availability namespaces"
```

---

## Task 2: Migrate `OfferResponseButtons.tsx` (availability)

**Files:**
- Modify: `src/components/availability/OfferResponseButtons.tsx`
- Modify: `src/i18n/locales/en/availability.json`, `src/i18n/locales/de/availability.json`
- Test (existing, must stay green): `src/components/availability/OfferResponseButtons.test.tsx`

**Interfaces:**
- Consumes: `useTranslation('availability')` from Task 1.
- Produces: `availability.offer.*` keys.

Strings to migrate (English verbatim → key). Leave `acceptConsequenceNote(flow)` `note.title`/`note.description` and `e.message` untouched.

| English (verbatim) | Key |
|---|---|
| `This offer is no longer available` | `offer.toast.unavailableTitle` |
| `It may have been withdrawn or expired. Refresh to see the latest.` | `offer.toast.unavailableDesc` |
| `Offer declined` | `offer.toast.declinedTitle` |
| `This just cancels this one offer. It will not affect future offers.` | `offer.toast.declinedDesc` |
| `Error` | `offer.toast.errorTitle` |
| `Accept` | `offer.accept` |
| `Decline` | `offer.decline` |

- [ ] **Step 1: Add EN + DE keys to the catalogs**

Into `src/i18n/locales/en/availability.json` (replace the `_ns` seed):
```json
{
  "offer": {
    "accept": "Accept",
    "decline": "Decline",
    "toast": {
      "unavailableTitle": "This offer is no longer available",
      "unavailableDesc": "It may have been withdrawn or expired. Refresh to see the latest.",
      "declinedTitle": "Offer declined",
      "declinedDesc": "This just cancels this one offer. It will not affect future offers.",
      "errorTitle": "Error"
    }
  }
}
```
Into `src/i18n/locales/de/availability.json` (informal *Du*, no dashes; model German for this file):
```json
{
  "offer": {
    "accept": "Annehmen",
    "decline": "Ablehnen",
    "toast": {
      "unavailableTitle": "Dieses Angebot ist nicht mehr verfügbar",
      "unavailableDesc": "Es wurde vielleicht zurückgezogen oder ist abgelaufen. Aktualisiere, um den aktuellen Stand zu sehen.",
      "declinedTitle": "Angebot abgelehnt",
      "declinedDesc": "Damit sagst du nur dieses eine Angebot ab. Zukünftige Angebote sind nicht betroffen.",
      "errorTitle": "Fehler"
    }
  }
}
```

- [ ] **Step 2: Run the existing component test to confirm current green baseline**

Run: `npx vitest run src/components/availability/OfferResponseButtons.test.tsx`
Expected: PASS (baseline before the swap).

- [ ] **Step 3: Swap the strings in `OfferResponseButtons.tsx`**

Add `import { useTranslation } from 'react-i18next';` and, inside the component, `const { t } = useTranslation('availability');`. Replace each literal with the matching `t('offer....')` call (toast title/description args and the `Accept`/`Decline` button labels).

- [ ] **Step 4: Verify — component test + i18n gates + types**

Run:
```bash
npx vitest run src/components/availability/OfferResponseButtons.test.tsx src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts
npx tsc -p tsconfig.app.json --noEmit
```
Expected: PASS. If a test queries the toast/button by English text it still matches (English unchanged). If any test renders without the i18n provider and now fails, wrap it with the shared render helper (`src/test/renderWithProviders.tsx`) or ensure `src/i18n` is imported in `src/test/setup.ts` (it already initializes i18n globally for jsdom) — do NOT change the English copy to fix a test.

- [ ] **Step 5: Commit**

```bash
git add src/components/availability/OfferResponseButtons.tsx src/i18n/locales/en/availability.json src/i18n/locales/de/availability.json
git commit -m "i18n: localize OfferResponseButtons (availability ns)"
```

---

## Task 3: Migrate `AvailabilityPicker.tsx` (availability)

**Files:**
- Modify: `src/components/availability/AvailabilityPicker.tsx`
- Modify: `src/i18n/locales/{en,de}/availability.json`
- Test (existing, if present): none dedicated; covered via `AvailabilityPage.blockPicker.test.tsx`.

**Interfaces:**
- Produces: `availability.picker.*` keys.

Strings (leave `throw new Error('No active organization')` as-is):

| English | Key |
|---|---|
| `Couldn't load` | `picker.loadError` |
| `Blocked` | `picker.blocked` |
| `Block date` | `picker.blockDate` |

- [ ] **Step 1: Add EN + DE keys**

EN (merge into `availability.json`):
```json
"picker": {
  "loadError": "Couldn't load",
  "blocked": "Blocked",
  "blockDate": "Block date"
}
```
DE:
```json
"picker": {
  "loadError": "Konnte nicht geladen werden",
  "blocked": "Gesperrt",
  "blockDate": "Termin sperren"
}
```
(*Blocked date* → *Gesperrter Termin* per `TERMS`; the standalone verb/adjective forms above stay consistent with it.)

- [ ] **Step 2: Swap strings**

Add `useTranslation('availability')`; replace the three literals with `t('picker.loadError')`, `t('picker.blocked')`, `t('picker.blockDate')` (the last two are the conditional button label).

- [ ] **Step 3: Verify**

Run:
```bash
npx vitest run src/pages/AvailabilityPage.blockPicker.test.tsx src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts
npx tsc -p tsconfig.app.json --noEmit
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/availability/AvailabilityPicker.tsx src/i18n/locales/en/availability.json src/i18n/locales/de/availability.json
git commit -m "i18n: localize AvailabilityPicker (availability ns)"
```

---

## Task 4: Migrate `ArtistAvailabilityCalendar.tsx` (availability)

**Files:**
- Modify: `src/components/availability/ArtistAvailabilityCalendar.tsx`
- Modify: `src/i18n/locales/{en,de}/availability.json`
- Test (existing): `src/components/availability/ArtistAvailabilityCalendar.test.tsx`

**Interfaces:**
- Produces: `availability.calendar.*` keys.

Strings (do NOT migrate the `['Mon',…,'Sun']` weekday header array or any `format(...)` output — deferred to date-locale work). Keep the `title`-attr reason and the sr-only text as two distinct keys (intentional wording difference).

| English (verbatim) | Key |
|---|---|
| `This date is not offered to you. Offered dates come from your casts and their required skills.` | `calendar.ineligibleReason` |
| `Previous month` | `calendar.prevMonth` |
| `Next month` | `calendar.nextMonth` |
| `Couldn't load your bookings or blocked dates — statuses may be incomplete. Please refresh.` | `calendar.loadError` ⚠ contains an em dash in the current source? verify: it uses ` — ` |
| `No eligible dates yet. Once you are added to a cast, offered dates appear here.` | `calendar.empty` |
| `Booked` | `calendar.label.booked` |
| `Hold` | `calendar.label.hold` |
| `Offer` | `calendar.label.offer` |
| `Blocked` | `calendar.label.blocked` |
| `Booking confirmed` | `calendar.popover.confirmed` |
| `Hold placed — awaiting producer confirmation` | `calendar.popover.hold` ⚠ verify dash char |
| `Legend:` | `calendar.legend.title` |
| `Eligible` | `calendar.legend.eligible` |
| `Confirmed` | `calendar.legend.confirmed` |
| `Hold` | `calendar.legend.hold` |
| `Offer pending` | `calendar.legend.offerPending` |
| `Blocked` | `calendar.legend.blocked` |
| `Dimmed dates are not offered to you. Offered dates come from your casts and their required skills.` | `calendar.srIneligible` |

⚠ **Dash check:** two current strings appear to use ` — ` (em/en dash), which would fail `copyLint` the moment they enter the catalog. Inspect the exact character in the source first. If it is an em/en dash, the English is being changed *only* to satisfy the pre-existing lint rule that already governs catalog copy — replace ` — ` with ` · ` or a comma in BOTH the source render and the catalog value, and update the corresponding assertion in `ArtistAvailabilityCalendar.test.tsx` if it queries that exact text. Note this deviation from "byte-identical English" in the commit message. If the source uses a plain hyphen `-`, keep it verbatim.

- [ ] **Step 1: Confirm the dash characters**

Run: `grep -nP '[\x{2013}\x{2014}]' src/components/availability/ArtistAvailabilityCalendar.tsx`
If it prints lines, those are en/em dashes needing the treatment above. If empty, all clear — use English verbatim.

- [ ] **Step 2: Add EN + DE keys**

Author `calendar.*` in both catalogs. EN verbatim from the table (with the dash resolution from Step 1). German, informal *Du*, terms from glossary (Hold→Vormerkung, Blocked→Gesperrt, Understudy N/A here). Example anchors:
```json
"calendar": {
  "ineligibleReason": "This date is not offered to you. Offered dates come from your casts and their required skills.",
  "prevMonth": "Previous month",
  "nextMonth": "Next month",
  "label": { "booked": "Booked", "hold": "Hold", "offer": "Offer", "blocked": "Blocked" },
  "legend": { "title": "Legend:", "eligible": "Eligible", "confirmed": "Confirmed", "hold": "Hold", "offerPending": "Offer pending", "blocked": "Blocked" }
}
```
DE anchors:
```json
"calendar": {
  "ineligibleReason": "Dieser Termin wird dir nicht angeboten. Angebotene Termine ergeben sich aus deinen Besetzungen und den dafür nötigen Skills.",
  "prevMonth": "Voriger Monat",
  "nextMonth": "Nächster Monat",
  "label": { "booked": "Gebucht", "hold": "Vormerkung", "offer": "Angebot", "blocked": "Gesperrt" },
  "legend": { "title": "Legende:", "eligible": "Verfügbar", "confirmed": "Bestätigt", "hold": "Vormerkung", "offerPending": "Angebot offen", "blocked": "Gesperrt" }
}
```
(Author the remaining `empty`, `loadError`, `popover.*`, `srIneligible` keys the same way.)

- [ ] **Step 3: Swap strings**

Add `useTranslation('availability')`. Replace the `INELIGIBLE_DAY_REASON` const usage, tooltip labels + aria-labels (`prevMonth`/`nextMonth` each used twice — one key each), cell labels, popover text, legend, error, empty, and sr-only text with `t('calendar....')`. Leave the weekday-header array and `format(...)` calls untouched.

- [ ] **Step 4: Verify**

Run:
```bash
npx vitest run src/components/availability/ArtistAvailabilityCalendar.test.tsx src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts
npx tsc -p tsconfig.app.json --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/availability/ArtistAvailabilityCalendar.tsx src/i18n/locales/en/availability.json src/i18n/locales/de/availability.json
git commit -m "i18n: localize ArtistAvailabilityCalendar (availability ns)"
```

---

## Task 5: Migrate `AvailabilityPage.tsx` (availability)

**Files:**
- Modify: `src/pages/AvailabilityPage.tsx`
- Modify: `src/i18n/locales/{en,de}/availability.json`
- Test (existing): `src/pages/AvailabilityPage.blockPicker.test.tsx`, `.error.test.tsx`, `.flowCopy.test.tsx`, `.pastBookings.test.tsx`, `.queryGating.test.tsx`, `.unlinked.test.tsx`

**Interfaces:**
- Produces: `availability.toast.*`, `availability.filter.*`, `availability.blocked.*`, `availability.sortChronoLabel`, `availability.offersLoadError`, and (optional) `availability.error.noOrg`.

Do NOT touch: `availabilityPageCopy(flow)` `pageCopy.*`, `bookingStatusLabels(flow)` `statusLabels[...]`, `describeTonightStandalone(...)` `tonight`, `formatDateDMY`/`toLocaleDateString('en-GB', …)` date formatting, and `e.message`. `.flowCopy.test.tsx` asserts the shared flow copy — it must remain byte-identical, which it will since we are not touching `flowCopy`.

| English (verbatim) | Key |
|---|---|
| `Date blocked` | `toast.dateBlocked` |
| `Error` | `toast.errorTitle` |
| `Block removed` | `toast.blockRemoved` |
| `All offers` | `filter.allOffers` |
| `Unanswered` | `filter.unanswered` |
| `Date` | `sortChronoLabel` |
| `Failed to load your offers. Please refresh — don't block dates until this loads, as pending offers may not be shown.` | `offersLoadError` ⚠ dash check |
| `No unanswered offers — great work!` | `emptyUnanswered` ⚠ dash check |
| `No eligible dates yet.` | `emptyAll` |
| `Blocked Dates` | `blocked.title` |
| `Mark dates you cannot play so the system will not send you offers for them. Dates you are already booked for are not affected.` | `blocked.description` |
| `Date` | `blocked.dateLabel` |
| `Block date` | `blocked.selectAriaLabel` |
| `No eligible dates` | `blocked.noEligibleOption` |
| `Select a date…` | `blocked.selectPlaceholder` |
| `Reason (optional)` | `blocked.reasonLabel` |
| `Vacation, other work…` | `blocked.reasonPlaceholder` |
| `Block` | `blocked.blockButton` |
| `Failed to load your blocked dates.` | `blocked.loadError` |
| `Remove block` | `blocked.removeTooltip` |
| `Remove block` | `blocked.removeTooltip` (reuse same key for the aria-label) |
| `No blocked dates yet.` | `blocked.empty` |
| `No active organization` | `error.noOrg` (optional — surfaces via toast description) |

- [ ] **Step 1: Dash check**

Run: `grep -nP '[\x{2013}\x{2014}]' src/pages/AvailabilityPage.tsx`
Apply the same dash-resolution rule as Task 4 to `offersLoadError` and `emptyUnanswered` if they contain en/em dashes (replace with `·`/comma in source + catalog + any asserting test; note in commit).

- [ ] **Step 2: Add EN + DE keys** (merge under the existing `availability` catalog; author DE with informal *Du*, `Gesperrte Termine` for the blocked-dates card title, drawing on `blockedDate`→`Gesperrter Termin`).

- [ ] **Step 3: Baseline the page tests green**

Run: `npx vitest run src/pages/AvailabilityPage.blockPicker.test.tsx src/pages/AvailabilityPage.error.test.tsx src/pages/AvailabilityPage.flowCopy.test.tsx`
Expected: PASS (pre-swap baseline).

- [ ] **Step 4: Swap strings** with `useTranslation('availability')`; leave shared-copy and date calls intact.

- [ ] **Step 5: Verify**

Run:
```bash
npx vitest run "src/pages/AvailabilityPage.*.test.tsx" src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts
npx tsc -p tsconfig.app.json --noEmit
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/AvailabilityPage.tsx src/i18n/locales/en/availability.json src/i18n/locales/de/availability.json
git commit -m "i18n: localize AvailabilityPage (availability ns)"
```

---

## Task 6: Migrate `RowPeek.tsx` (bookings)

**Files:**
- Modify: `src/components/bookings/RowPeek.tsx`
- Modify: `src/i18n/locales/{en,de}/bookings.json`
- Test (existing): `src/components/bookings/RowPeek.test.tsx`

**Interfaces:**
- Consumes: `useTranslation('bookings')`.
- Produces: `bookings.rowPeek.*` keys.

Do NOT touch `peek.headline`, `peek.eyebrowSuffix`, `peek.acceptedWaiting` (from `computeDatePeek`, `@/lib/bookingCockpit`) — only the inline literals and the `·`-joined separator wrapper.

| English (verbatim / pattern) | Key | Interp/plural |
|---|---|---|
| `unconfigured` (the literal in `{dateLabel} · unconfigured`) | `rowPeek.eyebrowUnconfigured` | — |
| `Set cast slots in Settings to track fill.` | `rowPeek.noConfig` | — |
| `Confirming…` | `rowPeek.confirming` | — |
| `Confirm {{count}}` (from `` `Confirm ${peek.acceptedWaiting}` ``) | `rowPeek.confirm` | `{{count}}` = acceptedWaiting |
| `Open date` | `rowPeek.openDate` | — |
| `Space to peek · Enter to open` | `rowPeek.keyHint` | — |

- [ ] **Step 1: Add EN + DE keys**

EN:
```json
"rowPeek": {
  "eyebrowUnconfigured": "unconfigured",
  "noConfig": "Set cast slots in Settings to track fill.",
  "confirming": "Confirming…",
  "confirm": "Confirm {{count}}",
  "openDate": "Open date",
  "keyHint": "Space to peek · Enter to open"
}
```
DE:
```json
"rowPeek": {
  "eyebrowUnconfigured": "nicht konfiguriert",
  "noConfig": "Lege in den Einstellungen Besetzungsplätze fest, um den Füllstand zu verfolgen.",
  "confirming": "Wird bestätigt…",
  "confirm": "{{count}} bestätigen",
  "openDate": "Termin öffnen",
  "keyHint": "Leertaste für Vorschau · Enter zum Öffnen"
}
```

- [ ] **Step 2: Swap strings**

Add `useTranslation('bookings')`. Replace the eyebrow separator/`unconfigured` literal, `noConfig`, the pending `Confirming…` label, the `Confirm N` template (→ `t('rowPeek.confirm', { count: peek.acceptedWaiting })`), `Open date`, and the key hint. Keep the `peek.headline` render and the `·` separator glue.

- [ ] **Step 3: Verify**

Run:
```bash
npx vitest run src/components/bookings/RowPeek.test.tsx src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts
npx tsc -p tsconfig.app.json --noEmit
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/bookings/RowPeek.tsx src/i18n/locales/en/bookings.json src/i18n/locales/de/bookings.json
git commit -m "i18n: localize RowPeek (bookings ns)"
```

---

## Task 7: Migrate `ArtistBookingsView.tsx` (bookings)

**Files:**
- Modify: `src/components/bookings/ArtistBookingsView.tsx`
- Modify: `src/i18n/locales/{en,de}/bookings.json`
- Test (existing): `src/components/bookings/ArtistBookingsView.flowCopy.test.tsx`, `.hireOrders.test.tsx`, `.pastBookings.test.tsx`

**Interfaces:**
- Produces: `bookings.artist.*` keys.

Do NOT touch `bookingsViewCopy(flow)` `pageCopy.*`, `bookingStatusLabels(flow)` `statusLabels[...]`, `referenceLabel(...)`, `d.cancellation_reason`. `.flowCopy.test.tsx` covers the shared copy and must stay green (untouched).

| English (verbatim) | Key |
|---|---|
| `Need to cancel a date you confirmed? Message your producer in the date's chat and they will update the booking.` | `artist.cancelHint` |
| `Date` | `artist.sortChronoLabel` |
| `Failed to load your bookings. Please refresh.` | `artist.loadError` |
| `Hire order` | `artist.hireOrderLink` |
| `No eligible dates yet. Once you're added to a cast, offered dates appear here.` | `artist.emptyState` |
| `No eligible dates` | `artist.calendarEmpty` |

- [ ] **Step 1: Add EN + DE keys** (EN verbatim; DE informal *Du*; *Hire order* → *Engagementvertrag* per `TERMS`, so `artist.hireOrderLink` = `"Engagementvertrag"`; "production team"/"producer" render per `ROLE_LABELS` — in DE prose use *Produktionsteam*).

EN:
```json
"artist": {
  "cancelHint": "Need to cancel a date you confirmed? Message your producer in the date's chat and they will update the booking.",
  "sortChronoLabel": "Date",
  "loadError": "Failed to load your bookings. Please refresh.",
  "hireOrderLink": "Hire order",
  "emptyState": "No eligible dates yet. Once you're added to a cast, offered dates appear here.",
  "calendarEmpty": "No eligible dates"
}
```
DE:
```json
"artist": {
  "cancelHint": "Du musst einen bestätigten Termin absagen? Schreib deinem Produktionsteam im Chat des Termins, dann aktualisieren sie die Buchung.",
  "sortChronoLabel": "Datum",
  "loadError": "Deine Buchungen konnten nicht geladen werden. Bitte aktualisiere.",
  "hireOrderLink": "Engagementvertrag",
  "emptyState": "Noch keine passenden Termine. Sobald du einer Besetzung hinzugefügt wirst, erscheinen angebotene Termine hier.",
  "calendarEmpty": "Keine passenden Termine"
}
```

- [ ] **Step 2: Swap strings** with `useTranslation('bookings')`; leave shared flow-copy and `referenceLabel` intact.

- [ ] **Step 3: Verify**

Run:
```bash
npx vitest run "src/components/bookings/ArtistBookingsView.*.test.tsx" src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts
npx tsc -p tsconfig.app.json --noEmit
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/bookings/ArtistBookingsView.tsx src/i18n/locales/en/bookings.json src/i18n/locales/de/bookings.json
git commit -m "i18n: localize ArtistBookingsView (bookings ns)"
```

---

## Task 8: Migrate `ShowsBookingsPage.tsx` (bookings)

**Files:**
- Modify: `src/pages/ShowsBookingsPage.tsx`
- Modify: `src/i18n/locales/{en,de}/bookings.json`
- Test (existing): `src/pages/ShowsBookingsPage.test.tsx`, `src/pages/ShowsBookingsPage.peek.test.tsx`

**Interfaces:**
- Produces: `bookings.status.*`, `bookings.producer.*` keys.

Do NOT touch: `referenceLabel(...)`, the `dayAbbr` weekday array, `format(...)` date patterns, `(e as Error).message`. Reuse a single `bookings.status.*` group for the `STATUS_LABEL` map AND the filter `SelectItem`s.

Status labels:
| English | Key |
|---|---|
| `Open` | `status.open` |
| `Partially Filled` | `status.partiallyFilled` |
| `Fully Filled` | `status.fullyFilled` |
| `Cancelled` | `status.cancelled` |
| `Unconfigured` | `status.unconfigured` |

Producer surface:
| English (verbatim / pattern) | Key | Interp/plural |
|---|---|---|
| `Confirmed {{count}}` (from `` `Confirmed ${affected}` ``) | `producer.toast.confirmed` | `{{count}}` |
| `Nothing to confirm, it moved on` | `producer.toast.nothingToConfirm` | — |
| `Shows & Bookings` | `producer.title` | — (`&` literal, not `&amp;`) |
| `All scheduled dates and cast status in one place.` | `producer.subtitle` | — |
| `Setup checklist` | `producer.setupChecklist` | — |
| `New date` | `producer.newDate` | — |
| (hire-order-ready banner title) | `producer.hireOrderReady.title_one` / `_other` | `{{count}}` |
| `Create the orders to confirm the engagements and send them for countersignature.` | `producer.hireOrderReady.description` | — |
| `Generate hire orders` | `producer.hireOrderReady.cta` | — |
| `You don't have permission to generate hire orders` | `producer.noHireOrderPermission` | — (used twice — one key) |
| `Search program, venue, city…` | `producer.searchPlaceholder` | — |
| `Status` | `producer.statusPlaceholder` | — |
| `All statuses` | `producer.allStatuses` | — |
| `Date` | `producer.sortChronoLabel` | — |
| `{{label}} ↑` / `{{label}} ↓` | `producer.sortAsc` / `producer.sortDesc` | `{{label}}` |
| `Generate hire order` | `producer.generateHireOrder` | — |
| `No show dates match the current filters.` | `producer.emptyState` | — |
| `No show dates scheduled` | `producer.calendarEmpty` | — |

**Hire-order-ready banner plural.** Current source builds `` `${readyCount} ${dateVerb} fully filled. Ready for hire order${s}.` `` with two co-varying axes. Collapse to a single count-driven pair:
```json
"producer": {
  "hireOrderReady": {
    "title_one": "{{count}} date is fully filled. Ready for hire order.",
    "title_other": "{{count}} dates are fully filled. Ready for hire orders."
  }
}
```
Call site: `t('producer.hireOrderReady.title', { count: readyCount })`. This preserves the exact English wording for both the singular and plural cases the original ternary produced. If a test asserts the exact banner text, it will match one of these two forms.

- [ ] **Step 1: Dash check**

Run: `grep -nP '[\x{2013}\x{2014}]' src/pages/ShowsBookingsPage.tsx`
Resolve any en/em dash per the Task 4 rule (none expected — the page uses `·`, `…`, `↑/↓`).

- [ ] **Step 2: Add EN + DE keys**

Author `status.*` and `producer.*` in both catalogs. DE anchors: `status` → `Offen` / `Teilweise besetzt` / `Voll besetzt` / `Storniert` / `Nicht konfiguriert`; `producer.title` = `"Shows & Buchungen"`, `producer.subtitle` = `"Alle geplanten Termine und der Besetzungsstatus an einem Ort."`, `producer.newDate` = `"Neuer Termin"`, `producer.hireOrderReady.cta` = `"Engagementverträge erstellen"` (Hire order → Engagementvertrag). Author the rest with informal *Du* and no dashes. `producer.sortAsc` = `"{{label}} ↑"`, `producer.sortDesc` = `"{{label}} ↓"` in both languages (the arrow is language-neutral).

- [ ] **Step 3: Baseline the page tests**

Run: `npx vitest run src/pages/ShowsBookingsPage.test.tsx src/pages/ShowsBookingsPage.peek.test.tsx`
Expected: PASS (pre-swap).

- [ ] **Step 4: Swap strings** with `useTranslation('bookings')`. Replace the `STATUS_LABEL` map values, toast templates, header/buttons, hire-order-ready banner (via the `count` plural), permission title (twice → one key), filter placeholders + `SelectItem`s (reuse `status.*`), sort labels (via `{{label}}` interp), per-row button, and both empty states. Leave `referenceLabel`, `dayAbbr`, `format(...)`, and `(e as Error).message` untouched.

- [ ] **Step 5: Verify**

Run:
```bash
npx vitest run src/pages/ShowsBookingsPage.test.tsx src/pages/ShowsBookingsPage.peek.test.tsx src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts
npx tsc -p tsconfig.app.json --noEmit
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ShowsBookingsPage.tsx src/i18n/locales/en/bookings.json src/i18n/locales/de/bookings.json
git commit -m "i18n: localize ShowsBookingsPage (bookings ns)"
```

---

## Task 9: Full-suite verification + drop the seed keys

**Files:**
- Modify: `src/i18n/locales/{en,de}/bookings.json`, `src/i18n/locales/{en,de}/availability.json` (remove the `_ns` seed keys from Task 1 if any remain)

- [ ] **Step 1: Remove leftover seed keys**

Ensure no `"_ns"` seed keys linger in any of the four catalogs (they were placeholders for Task 1). Both languages must still be parity-equal after removal.

- [ ] **Step 2: Full frontend gate**

Run:
```bash
npx vitest run
npx tsc -p tsconfig.app.json --noEmit
npm run lint
```
Expected: PASS across the board. `keyParity` and `copyLint` cover the new namespaces; `npm run lint` enforces the zero-warning gate.

- [ ] **Step 3: Manual smoke (optional, previewable)**

If verifying in the browser: `npm run local:up && npm run dev`, sign in as the seeded artist (`artist@example.com`) to see the Availability page + offer buttons, and as the producer (`producer@example.com`) to see Shows & Bookings. Toggle language in the account menu (requires the `language_packages` entitlement enabled for the dev org) and confirm German renders with no English leakage and no missing-key fallbacks.

- [ ] **Step 4: Help-center impact check**

Per the project's new-page checklist item 5: this migration changes *how* strings render but not *what* the app does or what a user would ask, so the Help content needs no change. State **"No help center impact."** in the PR description.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales
git commit -m "i18n: drop namespace seed keys; finalize bookings + availability catalogs"
```

---

## Handoff — deferred items (NOT in this PR)

Recorded here so the foundation stays aimed at them; each is its own future PR.

**Phase-2 remaining, still to do:**
1. **Add `i18next-parser` to CI.** Generates/updates key skeletons from `t()` usage and flags missing + orphaned keys, so a stray/never-added key is caught mechanically instead of by review. (Spec §193.)
2. **Make `src/lib/dates.ts` locale-aware.** Route all dates/times/numbers **and fees (Gage)** through a locale-aware formatter, and localize the currently-hardcoded weekday-header arrays (`ShowsBookingsPage` `dayAbbr`, `ArtistAvailabilityCalendar` `['Mon',…,'Sun']`), the `date-fns format(...)` month/weekday output, and `AvailabilityPage`'s `.toLocaleDateString('en-GB', …)`. These were intentionally left English in this PR. (Spec §194.)
3. **Persist `preferred_language` server-side** (on the user), so the language choice is known outside the browser (currently localStorage-only via `showflow.lang.v1`). Precondition for Phase 3. (Spec §196.)
4. **Migrate the shared flow-copy modules** — `@/lib/flowCopy` (`bookingsViewCopy`, `availabilityPageCopy`, `bookingStatusLabels`), `@/lib/bookingFlow` (`referenceLabel`), `@/lib/bookings/timingCopy` (`describeTonightStandalone`), `@/lib/bookings/actionCopy` (`acceptConsequenceNote`), `@/lib/bookingCockpit` (DatePeek copy). They are org-flow-configurable and cross-domain (also feed the dashboard), so they warrant a dedicated pass rather than inline duplication into these catalogs.
5. **Remaining domain namespaces** per spec order: `settings` (23 components — its own PR), then `hireOrders`, `admin`, `auth`, and the shared **`onboarding`** namespace (unblocks the deliberately-deferred hardcoded English in `src/lib/dashboard/stageChain.ts` + `moduleOnboarding.ts` and the bookings + hire-orders setup rails).

**Phase 3 — localize transactional emails off the server preference:**
Once `preferred_language` is persisted (item 3), render the transactional email templates (`supabase/functions/_shared/transactional-email-templates/`) in the recipient's language off that server-known preference, so offer/confirmation digests, invitations, magic-link, and hire-order emails go out in the recipient's chosen language rather than English-only. (Spec §196-197.) This is server-side (Deno edge runtime), so the email templates need their own bilingual copy source mirrored for the edge runtime (the frontend `src/i18n` catalogs are not imported there) — scope that mirror as part of the Phase 3 PR.
