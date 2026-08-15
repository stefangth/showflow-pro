# i18n Initiative — Remaining Work Handoff

**Purpose:** track what is left to make ShowFlow a fully bilingual (EN/DE) app, after the Phase-1 foundation and the Phase-2 domain migrations. Living checklist; update as PRs land.

**Spec:** `docs/superpowers/specs/2026-08-14-i18n-and-help-page-design.md` ("Whole-app rollout strategy", §181-203).
**Pattern to follow for every domain PR:** the settings plan `docs/superpowers/plans/2026-08-14-i18n-phase2-settings.md` (byte-identical EN, `Du`/no-dash/TERMS DE, keyParity + copyLint + translationCompleteness gates, dark behind `language_packages`).

> **Explicitly OUT OF SCOPE — will NOT be done:** the **`platform` / super-admin console** (`PlatformPage` + `src/components/platform/*`). Decision (2026-08-14): we are not localizing the super-admin surface. Do not add a `platform` namespace.

---

## Done

- **Foundation:** `src/i18n/` (config, typed resources, `TERMS`), keyParity + copyLint + translationCompleteness CI gates, `LanguageContext`, account-menu language switcher, `language_packages` entitlement (dark). *(PR #280, awaiting merge.)*
- **`common` + `help`** shell chrome + Help center. *(PR #280.)*
- **`dashboard`** namespace + language gating. *(#281, merged.)*
- **`bookings` + `availability`** namespaces. *(PR #282, awaiting merge.)*
- **`settings` surface** — 11 namespaces, whole surface, deferrals folded in. *(PR #287, awaiting merge.)*

---

## Remaining work

### A. UI domain namespaces (each ≈ one PR, settings pattern)
> **All of A landed together** in one parallel wave (8 namespaces, one subagent per domain) on branch `claude/i18n-handoff-parallelize-ff2c07`, commits `2ea61aae` (register empty catalogs) + `f262b99c` (localize). ~1,238 keys/language; `verify:fast` all-green. **Deferred within these domains** (tracked in B): `flowCopy`-family call sites (showsDetail), module-scope zod validation messages (ShowFormDialog / ShowDateFormDialog / ProfilePage / ProductionsPage), `AcceptInvitePage` exported copy constants, and all date/currency formatting.
- [x] **auth** — LoginPage, AcceptInvitePage, AuthCallbackPage, ResetPasswordPage, NoOrgScreen, SuspendedOrgScreen, FeatureDisabledScreen, NotFound. *(95 keys.)*
- [x] **admin** — AdminPage + `src/components/admin/people/*` (People pane, invites, bulk). *(105 keys.)*
- [x] **artists** — ArtistsPage + `src/components/artists/*`. Import-wizard PURE modules (`src/lib/artistImport/*`, `buildImportRows`/`guessMapping`/`parseSheet`) left as-is (logic, not display copy). *(124 keys.)*
- [x] **productions** — ProductionsPage + `src/components/catalog/*` (ShowFormDialog). *(62 keys.)*
- [x] **hireOrdersPages** — HireOrdersPage, HireOrderDetailPage, HireOrderEditPage + `src/components/hireOrders/*` (viewer/import/setup) + `src/components/shows/hireOrders/*`. SignHireOrderDialog `CONSENT_TEXT` left untouched (dual-homed mirror w/ generate-hire-orders). *(419 keys.)*
- [x] **showsDetail** — ShowDateDetailSheet + `src/components/shows/date/*` cockpit, `src/components/casts/*`, ShowDateFormDialog. *(270 keys.)*
- [x] **chats** — ChatsListPage + `src/components/chat/*`. *(15 keys.)*
- [x] **profile** — ProfilePage. *(48 keys.)*
- [ ] ~~platform~~ — **OUT OF SCOPE (see banner above).**

### B. Cross-cutting client infra
- [x] **`onboarding` namespace (shared)** — `src/lib/dashboard/stageChain.ts`, `moduleOnboarding.ts`, setup rails, dashboard `firstRun`. *(PR #290.)*
- [x] **`flowCopy` family** — *(PR #289.)*
- [~] **Locale-aware `src/lib/dates.ts`** — DONE for the app-wide date helpers in **PR #289**. THREE residual cockpit sites remain, and on investigation (2026-08-15) they are NOT a standalone fix: `src/lib/cockpitCast.ts:12` and `src/components/shows/date/CockpitRail.tsx:38,40` hardcode `Intl.DateTimeFormat("en-GB"/"en-CA", { timeZone: "Europe/Berlin" })`. Only the day+short-month sites (`cockpitCast.ts:12`, `CockpitRail.tsx:40`) differ visibly in German (month abbreviations); the numeric ISO date (`:36`) and 24h time (`:38`) are locale-neutral. **BUT `cockpitCast.ts` is an entirely un-localized English lib** (returns `"Tier"`, `"confirmed"`, `"accepted"`, `"Main cast"`, `"No booking yet"`, `"N of M"`, `"Artist"` as display strings). Localizing only its date abbreviation is incoherent. **Proper home:** a cockpit-lib i18n pass (a `showsDetail`/cockpit follow-up that moves these display strings out of `src/lib` into the component `t()` layer), OR fold the two date sites into #289 once its `dfLocale`/`i18n.language` infra is available. Do NOT localize the dates in isolation.
- [ ] **`i18next-parser` in CI** — Investigated 2026-08-15: NOT a quick `--fail-on-update` tweak. The parser rebuilds each catalog from a single flat key-rank table, which cannot reproduce on-disk order across namespaces whose sibling groups disagree (e.g. `dashboard` orders `artist` before `producer`; `help` the reverse), so `i18n:check` exits non-zero even when catalogs are correct (see the header comment in `i18next-parser.config.js`). The real fix is a **toolchain migration to i18next-cli** with real per-namespace extraction — its own scoped project, not a config change. Catalog correctness is already CI-enforced by `keyParity` + `copyLint` + `translationCompleteness` (+ the placeholder-parity guard added for the DE server maps), so this gate is low marginal value until the migration is done.

### C. Server-side / Phase 3 (not client `t()`)
> **DECISION (2026-08-15): server content is localized PER ORGANIZATION, not per user.** One org = one language for everything it sends. This dropped the `preferred_language` prerequisite entirely and needs **no DB migration** (`org_language` is an `app_settings` row). Shipped in **PR #292** (spec/plan: `docs/superpowers/{specs,plans}/2026-08-15-i18n-server-side-per-org.md`).
- [x] **Transactional emails** — `EMAIL_COPY_DE` (~200 keys) inside the mirrored `emailCopy.ts`; `resolveTemplatePresentation` threads a `locale`; `send-transactional-email` resolves it via `resolveOrgLocale` (entitlement-gated); `<html lang>` follows. *(PR #292.)*
- [x] **Hire-order PDFs** — `HIRE_ORDER_COPY_DE` (~55 keys) in mirrored `pdfCopy.ts`; `render.tsx` localizes weekday + `de-DE` money; `generate-hire-orders` resolves locale at issue/preview and **freezes it into `issue_snapshot`** (countersign/resend reproduce it). *(PR #292.)*
- [x] **`capabilities.ts` `CAPABILITY_DEFS` labels** — done CLIENT-side earlier via the `settingsRolesRights` catalog *(PR #291)*; registry stays the English source, so the edge/SQL auth mirror is untouched.
- [ ] **`bookingFlow.referenceLabel` fallback** — deferred (see #292): returns real show names (org data, already correct); its only English fallback renders for a malformed null-program show, and templates already carry localized `showFallback` copy. Negative-ROI to wire 4 senders. Revisit only if a real gap appears.
- [ ] **Email/PDF copy EDITORS authoring German overrides** — deferred (#292): a German org's per-org copy *overrides* (email_copy/hire_order_copy) are still authored in English and layer over the German base. Localizing the authoring editors (so admins can write German overrides) is a follow-up. Email editor already has an EN/DE *preview* toggle; the hire-order template editor's German preview toggle is also deferred.
- [ ] **`trust/facts.ts` → `trust.json`** — cross-repo build consumed by the landing page; add a DE column / bilingual build.
- [ ] **`systemMap.ts` + `docs/*.md` bodies** — canvas data + markdown document content.

### D. Ship gates (not code)
- [ ] **Merge the open i18n PRs (owner review required):** #280 (foundation + common/help), #282 (bookings + availability), #287 (settings surface), #289 (flowCopy + locale-aware dates.ts), #290 (onboarding namespace), #291 (Section C safe copy: money + capability labels), #292 (Section C server-side: per-org emails + PDFs). All four newest (#289-#292) passed a CI/auto-review sweep on 2026-08-15 (see below); each is green.
  - **Merge-order note:** #291 and #292 both carry the same byte-identical `money.ts` locale param, and #289/#290/#291/#292 each touch the 4 shared i18n registration files (`index.ts`, `react-i18next.d.ts`, `keyParity.test.ts`, `translationCompleteness.test.ts`) plus this handoff doc + changelog/version — expect trivial additive conflicts; resolve by keeping both sides. Only #291 and #292 bump the app version (both to 1.17.0); pick one at merge.
  - **CI/auto-review sweep (2026-08-15, one subagent per PR):** #291 no-op (all green; the dynamic-`t()`-key review comment was a confirmed false positive, tsc passes). #290 restored design-rationale doc comments dropped when copy moved into JSON (`moduleOnboarding.ts`). #289 fixed a REAL bug: `formatTimestampLocal` used `i18n.language || undefined` which collapses to bare `'en'` -> `Intl` US month-first, flipping hire-order timestamps DD/MM -> MM/DD for English users; pinned to `en-GB`/`de-DE` + added tests. #292 fixed a REAL bug: resending a German-issued hire order rendered German fee digits inside an English wrapper because `send-transactional-email` re-resolved the live org locale; now threads an explicit `locale` through `EmailMessage` -> a gated `override` param on `resolveOrgLocale`, so wrapper + fee agree (still entitlement-gated); also cleared 2 CodeQL URL-substring alerts + a redundant cast.
- [ ] **Native-speaker QA of the German.** `translationCompleteness` only catches paste-throughs (DE == EN), **not mistranslations**; ~1,000+ client DE strings plus the ~255 server DE strings (email + PDF copy maps, #292) are unproofed.
- [ ] Enable `language_packages` per org (super-admin) once a workspace's German is signed off. This one entitlement now gates BOTH the in-app language switcher AND all server-generated German (emails + PDFs, via `resolveOrgLocale`).

---

## Parallelization

The migration is embarrassingly parallel at the **file** level: each domain owns disjoint components + its own catalog pair. The only true coupling is the **4 shared i18n registration files** (`index.ts`, `react-i18next.d.ts`, `keyParity.test.ts`, `translationCompleteness.test.ts`). Two ways to exploit it:

- **Within one PR/session:** register all target namespaces up front (one serial infra commit), then fan out one subagent per domain — exactly how the settings PR ran 13 subagents.
- **Across separate branches/PRs:** components merge cleanly, but the 4 registration files conflict. Either (a) land a single "register namespaces N…M" infra PR first and branch each domain off it, or (b) accept trivial re-registration conflicts and resolve on merge.

### Can run fully in parallel (disjoint files, no ordering dependency)
- **All of A** (auth, admin, artists, productions, hireOrdersPages, showsDetail, chats, profile) — mutually independent.
- **B → `i18next-parser` CI** — isolated (package.json/CI/scripts), independent of everything.
- **B → `flowCopy`** — independent of A (its consumers are the *already-migrated* dashboard/bookings/availability pages, not the un-migrated A domains).
- **B → `onboarding`** — independent of A (setup-rail files are disjoint from the A domain components).
- **C → transactional emails, hire-order PDFs, `trust.json`, `systemMap`** — separate runtime/build/files; independent of all client work. (Emails + PDFs are *feature*-blocked by `preferred_language` for real per-user targeting, but the template localization itself can be built in parallel.)

### Must be coordinated / effectively serial
- **B → `dates.ts`** — changes date/number call sites **app-wide**, so it collides with essentially every other in-flight domain PR. Do it **alone**, ideally after the domain PRs settle (or first, then rebase domains onto it).
- **The 4 shared registration files** — one writer at a time (see above).
- **C → `preferred_language`** — do **before** wiring emails/PDFs to a user's language (it's their targeting key). The email/PDF *template* work can proceed in parallel; only the "pick the recipient's language" wiring waits on it.
- **C → `capabilities` bilingual** — coordinate with any rolesRights follow-up (shared registry, edge mirror).

### Suggested waves
1. **Wave 1 (max fan-out):** all A domains + `flowCopy` + `onboarding` + `i18next-parser` CI + (server) email/PDF/`trust.json`/`systemMap` templates + `preferred_language` DB.
2. **Wave 2 (after Wave 1 settles):** `dates.ts` (alone), then wire emails/PDFs to `preferred_language`, `capabilities` bilingual.
3. **Wave 3 (ship):** native-speaker QA, merge, enable entitlement per org.

**Recommended first up:** `auth` (small, high-visibility) + `flowCopy` (finishes the pages already touched).
