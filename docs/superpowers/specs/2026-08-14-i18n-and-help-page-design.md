# i18n foundation + Help center page — design

Date: 2026-08-14
Branch: `claude/artist-help-faq-navbar-d1f920`
Status: approved mockup, spec under review

## Goal

Two shipped things, in order:

1. A **page-wide global language setting** (English / German), defaulting to the browser
   language, living in the **account menu** (gear icon, sidebar footer, bottom-left).
2. A new **Help center page** (`ROUTES.HELP`), built from the approved design, rendered
   fully in **both languages**, with the design's **"still open" state removed**.

German copy uses the informal **"Du"** form and contains **no em/en dashes**. The approved
interactive mockup is the copy spec: it carries the final EN + DE text for all 65 FAQ items,
the glossary, and every chrome string.

## Decisions (locked)

| Decision | Choice | Notes |
|---|---|---|
| Library | **react-i18next** (+ `i18next`, `i18next-browser-languagedetector`) | Owner-approved. Typed resources; no macro/build step. |
| Scope (first pass) | Help page **fully bilingual** + **visible shell chrome** (sidebar nav, breadcrumb, account menu, theme/language labels) | Rest of app stays English, ready to migrate incrementally. |
| German term policy | **Translate product terms to German** (clean, no English in parens) via a canonical bilingual `TERMS` glossary: Besetzung, Stufe/Rangfolge, Zweitbesetzung, Antwortfrist, Tagesübersicht, Engagementvertrag, Vormerkung, Vorläufig gebucht, Ungültig machen, Gesperrter Termin. | Owner confirmed the app UI is being Germanized right after (and possibly a 3rd language later), so no lasting Help-vs-UI mismatch. `TERMS` keeps the English side for that UI localization + the English Help view. Role names stay: Admin / Produktionsteam / Artist. |
| "Still open" | **Removed**: filter chip, amber badge, and count segment gone. The one `open` item (`A5.1`) is reclassified `ok` (Answered). | Statuses reduce to `new` (New answer) and `ok` (Answered). |
| Producer role label (DE) | **"Produktionsteam"** | Matches `ROLE_LABELS` producer → "Production Team". Never compare against the label; the DB role stays `producer`. |
| Default language | Browser language (`navigator.language`), clamped to a supported `Lang`, else `en` | Overridable in the account-menu setting; persisted to localStorage. |

## Architecture

### `src/i18n/` — single home

```
src/i18n/
  index.ts              # creates + configures the i18next instance (side-effect import at app entry)
  config.ts             # Lang type, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, STORAGE_KEY, detectInitialLang()
  react-i18next.d.ts    # module augmentation: typed `resources` -> compile-time key safety
  locales/
    en/common.json      # shell chrome: nav labels, section labels, breadcrumb, account menu
    de/common.json
    en/help.json        # Help-PAGE chrome: hero, lede, filter labels, badges, count line,
    de/help.json        #   empty state, glossary heading, still-stuck, support, footnote
  terms.ts              # canonical bilingual domain glossary TERMS: Record<TermKey, Record<Lang,string>>
                        #   (Besetzung, Stufe, Engagementvertrag...). Used by Help now; the whole UI in phase 2.
  keyParity.test.ts     # CI: keyset(de) === keyset(en) for the JSON namespaces (common, help)
  copyLint.test.ts      # CI: no em/en dashes in any catalog OR content module; DE flagged for "Sie"-form

src/lib/help/           # structured Help CONTENT (bilingual data) + pure logic
  items.ts              # HELP_ITEMS: typed bilingual FAQ records (en+de co-located per item)
  stages.ts             # STAGES: 6 journey stages, { en:[title,moment], de:[title,moment] }
  glossary.ts           # GLOSSARY cards: entries reference TERMS[key] for the per-language title + bilingual definition
  filter.ts             # pure filter/group/count derivation, unit-tested without rendering
```

German product terms are translated (clean, no parens). The **canonical `TERMS` glossary**
(`src/i18n/terms.ts`) defines each domain noun once in both languages; Help's glossary cards and
prose draw from it now, and every namespace localized in phase 2 draws from the same map, so the
whole German UI stays terminologically consistent. Role names (Admin / Produktionsteam / Artist)
and proper nouns (ShowFlow, Airtable) are not translated.

Two i18next JSON namespaces carry all flat chrome: **`common`** (shell) and **`help`**
(help-page chrome). All *structured* Help content — items, stages, glossary — lives in
`src/lib/help/` as typed bilingual modules (`Record<Lang, string>` fields), so their EN/DE
parity is enforced by the **type system**, while the JSON namespaces' parity is enforced by
`keyParity.test.ts`. `copyLint.test.ts` scans both.

- `Lang = 'en' | 'de'`. `SUPPORTED_LANGUAGES: readonly Lang[]`. `DEFAULT_LANGUAGE: Lang = 'en'`.
- **i18next config:** `fallbackLng: 'en'`, `supportedLngs: ['en','de']`, `returnEmptyString: false`,
  `interpolation.escapeValue: false` (React escapes), namespaces `['common','help']`.
- **Detection order:** localStorage (`showflow.lang.v1`) → `navigator.language` prefix → `en`.
  We drive this ourselves in `detectInitialLang()` rather than relying only on the detector plugin,
  so the order is explicit and testable.

### Language setting — thin context over i18next

react-i18next needs no provider to *read* translations, but the **setting UI** needs a
current-language value + a persisting setter. A thin `LanguageProvider` (modeled on
`ConsentContext`) wraps `i18n.changeLanguage` and localStorage:

```ts
// src/features/i18n/LanguageContext.tsx  (mirrors ConsentContext shape)
useLanguage(): { lang: Lang; setLang: (l: Lang) => void; }
// setLang -> i18n.changeLanguage(l) + persist(STORAGE_KEY, l)
```

Placement in `App.tsx`: inside `BrowserRouter`, wrapping `ConsentProvider`
(outermost app provider) so all chrome — and later the consent banner — can translate.
`import './i18n'` runs at entry (`main.tsx`) so the instance exists before first render.

### Help content as a typed bilingual data module

The FAQ is structured records, not flat strings. One item type, both languages inline:

```ts
export type HelpRole = 'admin' | 'producer' | 'artist';
export type HelpStatus = 'new' | 'ok';        // 'open' removed
export interface HelpItem {
  id: string;                 // e.g. 'A0.1' — stable
  role: HelpRole;
  stage: number;              // 0..5 index into STAGES
  status: HelpStatus;
  surface: string;            // the "where" chip; a stable surface key (see Convention 2)
  updated: string;            // ISO date, provenance
  q: Record<Lang, string>;
  a: Record<Lang, string>;
}
export const HELP_ITEMS: HelpItem[] = [ /* 65 items, copy from approved mockup */ ];
```

The page reads `i18n.language` (via `useTranslation`) and renders `item.q[lang]` / `item.a[lang]`.
Chrome strings go through `t('...')`. This hybrid is deliberate: small flat chrome suits i18next
JSON; large structured content suits a typed module that can't structurally drift.

### `HelpPage` (`src/pages/HelpPage.tsx`)

Pure client page, no server data. State: `role`, `q` (search), `filter` ('all' | 'new'),
`open` (accordion set). Derivation mirrors the mockup:

- `mine = HELP_ITEMS.filter(role)`; `matched` applies filter + case-insensitive search over
  `q/a/surface` in **both** languages (so a German user can still match an English product term).
- Group by `STAGES`, drop empty groups; empty-all → empty state with "clear filters".
- Count line: unfiltered → `{count} questions · {new} newly answered` (i18next plural keys);
  filtered → `{m} of {n} questions`.
- Glossary section + "Still stuck" card (role-specific escalate label) + support-address card + footnote.
- Extract sub-components for testability: `HelpRoleTabs`, `HelpFilters`, `HelpStageSection`,
  `HelpItemRow`, `HelpGlossary`, `HelpFooterCards`. Pure filter/group logic lives in
  `src/lib/help/filter.ts` (unit-tested without rendering).

### Route / nav / removal wiring

1. `ROUTES.HELP = '/help'` in `app.config.ts`.
2. `src/pages/HelpPage.tsx` (default export).
3. `App.tsx`: `<Route path={ROUTES.HELP} element={<ProtectedRoute><AppLayout><HelpPage/></AppLayout></ProtectedRoute>}>`
   — all authenticated roles, no `requiredRoles`, no feature gate.
4. `navItems.ts`: add `{ to: ROUTES.HELP, icon: HelpCircle, label: t-driven, section: 'workspace' }`.
   Nav labels become `t()` lookups; `SECTION_LABELS` and `ROUTE_TO_LABEL` breadcrumb map become
   language-aware (resolved at render, not module load).
5. **Account menu** (`AppLayout.tsx` profile Popover): add a "Language / Sprache" group above
   Profile / Sign out, with English · Deutsch and a check on the active one, calling `setLang`.

### Design tokens

Map the design comp's raw vars to the app's existing semantic Tailwind tokens + accent scale
(`bg-card`, `text-muted-foreground`, `border-border`, `bg-accent-100`, `text-accent-700`,
green/amber semantic tints for badges). No new raw tokens; obey CLAUDE.md "semantic tokens only".
Week-start and other conventions are not relevant here (no calendar).

## Convention 1 — maintainable translations (to encode in CLAUDE.md + tests)

1. **English is the canonical shape.** Every DE catalog mirrors an EN catalog.
2. **Typed keys.** `react-i18next.d.ts` augments `resources` from the EN catalogs, so unknown
   `t()` keys are `tsc` errors (fits the `any`-banned, typed-everything ethos).
3. **Key-parity CI test** (`keyParity.test.ts`): `keyset(de) deepEquals keyset(en)` per namespace.
   Prevents a missing DE key from silently shipping as English via `fallbackLng`.
4. **Copy-lint CI test** (`copyLint.test.ts`): no `—`/`–` in any catalog; DE Help copy flagged for
   obvious `Sie`-form tokens (`Sie `, `Ihre`, `Ihnen`) so "Du" discipline is enforced.
5. **Chrome vs. content split:** flat i18next JSON for shell chrome; typed bilingual data module
   for structured Help content (en+de co-located per record so they can't drift).
6. **Interpolation, never concatenation:** counts via i18next plurals; org name interpolated;
   `Intl` for any future numbers/dates.

## Convention 2 — help copy authored at spec time (to encode in the spec/PRD workflow + CLAUDE.md)

1. **Mandatory "Help center impact" section in every spec/PRD.** The author answers *"does this
   change what a role asks, or how the app answers it?"* and either drafts the affected Help
   items inline (**id + updated Q/A in EN and DE, Du**) or writes **"No help center impact."**
   The spec is incomplete until filled — same bar as the changelog.
2. **Help items are traceable.** `HelpItem.surface` is a stable surface key from a small registry;
   `HelpItem.updated` records provenance. Answers "which help items does this surface own?"
3. **Same-PR rule.** A user-facing behavior change and its Help delta ship in the same PR.
4. **Guards.** PR-template checkbox ("Help center: updated / N/A") for the human; the key-parity +
   copy-lint tests for the machine.
5. **Phase-2 (optional, not built now).** A `// @help-surface: <key>` code annotation near feature
   code that CI cross-references against the Help registry to nudge on untouched help.

Add these as: a new short section in `docs/adr/` (or the operational summary), a bullet in
CLAUDE.md's "New page / route checklist", and a line in the changelog discipline.

## Whole-app rollout strategy (this is phase 1 of a full-app, multi-language i18n)

The owner will Germanize the whole app UI right after this, and may add a third language later.
This spec builds the foundation to support that; the primitives below (namespaces, typed keys,
parity enforcement, shared `TERMS`) are exactly what the full rollout needs, so nothing here is throwaway.

- **Phase 1 (this PR):** `src/i18n/` foundation, `TERMS` glossary, parity + copy-lint CI tests,
  the account-menu setting, the Help page, and the visible shell chrome (`common` namespace).
- **Phase 2 (right after):** migrate the app UI **one namespace per domain, one PR at a time**
  (`dashboard`, `bookings`, `settings`, `hireOrders`, `availability`, `admin`, `auth`...). Each PR
  swaps hardcoded JSX strings for `t('ns.key')`, adds that namespace's `en`/`de`, lazy-loads it.
  `fallbackLng: 'en'` keeps un-migrated screens rendering in English, so the app is always shippable
  mid-migration. Add **`i18next-parser`** to CI (generates/updates key skeletons, flags missing +
  orphaned keys). Make `src/lib/dates.ts` locale-aware and route all dates/times/numbers/**fees (Gage)**
  through `Intl` with the active locale. Add an ESLint `no-literal-string` rule scoped to migrated dirs.
- **Phase 3:** persist `preferred_language` on the user (server-known), so transactional emails
  (`_shared/transactional-email-templates`) render in the recipient's language off that preference;
  the setting then writes both localStorage and the server. A third language is "add a locale +
  translate" — the key-parity test blocks the merge until every key exists; i18next applies each
  language's CLDR plural rules automatically. RTL (`dir` + CSS logical properties) is a future concern
  if an RTL language is ever added; avoid hardcoded `left`/`right` where cheap.

Phases 2–3 are **out of scope for this PR** but documented so the foundation is built to fit them.

## Testing plan

- **Unit (Vitest):**
  - `config.ts` `detectInitialLang()` — localStorage > navigator > en; clamps unsupported.
  - `LanguageContext` — setLang persists + calls changeLanguage; initial from detection.
  - `src/lib/help/filter.ts` — role filter, new filter, bilingual search match, grouping,
    empty-state, count-line strings (EN + DE) — **including that no item resolves to a "still open"
    status** (regression for the removal).
  - `HelpPage` render — toggling language swaps chrome + item copy; toggling role swaps set;
    accordion open/close; account-menu language control calls setLang.
- **CI catalog tests:** `keyParity.test.ts`, `copyLint.test.ts` (Convention 1).
- **Typecheck:** all three tsconfig projects; `react-i18next.d.ts` must not break type-gen.
- No new edge functions, no DB changes, no migrations. No pgTAP/e2e required (a light Playwright
  smoke that `/help` loads and the language toggle flips a heading is optional).

## File change list

- `src/config/app.config.ts` — `ROUTES.HELP`.
- `src/i18n/**` — new (config, instance, augmentation, locales, catalog tests).
- `src/features/i18n/LanguageContext.tsx` — new; `App.tsx` provider wiring; `main.tsx` `import './i18n'`.
- `src/pages/HelpPage.tsx` + `src/components/help/**` + `src/lib/help/filter.ts` — new.
- `src/components/layout/AppLayout.tsx` — account-menu language control; breadcrumb via `t()`.
- `src/components/layout/navItems.ts` — Help item; labels via `t()` (or a label-key indirection).
- `package.json` — add `i18next`, `react-i18next`, `i18next-browser-languagedetector`.
- `CLAUDE.md` + `docs/adr/` + PR template — Conventions 1 & 2.
- `public/changelog.md` / `.json` — user-facing entry (Help center + language switch); bump version.

## Out of scope (explicit)

- Translating the rest of the app (dashboards, settings, hire orders, dialogs, **emails**).
- Germanizing product term labels themselves.
- Persisting language server-side per user (localStorage only for now).
- The phase-2 `@help-surface` CI cross-reference.
- Any "still open" / unanswered-question surface.
