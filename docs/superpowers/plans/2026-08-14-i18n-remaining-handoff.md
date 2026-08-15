# i18n Initiative — Remaining Work Handoff

**Purpose:** track what is left to make ShowFlow a fully bilingual (EN/DE) app, after the Phase-1 foundation and the Phase-2 domain migrations. Living checklist; update as PRs land.

**Spec:** `docs/superpowers/specs/2026-08-14-i18n-and-help-page-design.md` ("Whole-app rollout strategy", §181-203).
**Pattern to follow for every domain PR:** the settings plan `docs/superpowers/plans/2026-08-14-i18n-phase2-settings.md` (byte-identical EN, `Du`/no-dash/TERMS DE, keyParity + copyLint + translationCompleteness gates, dark behind `language_packages`).

> **Explicitly OUT OF SCOPE — will NOT be done:** the **`platform` / super-admin console** (`PlatformPage` + `src/components/platform/*`). Decision (2026-08-14): we are not localizing the super-admin surface. Do not add a `platform` namespace.

---

> **STATUS (2026-08-15): the i18n code migration is effectively COMPLETE.** Every code item below is now **done, deferred, or out of scope** — there is no remaining in-scope client-side `t()` work. The two genuinely-open threads are **not code**: (1) `trust/facts.ts` bilingual, deferred pending a legal-review design pass (Section C); and (2) the ship gates — **native-speaker German QA** and **enabling `language_packages` per org** (Section D). See each item for evidence.

## Done

- **Foundation:** `src/i18n/` (config, typed resources, `TERMS`), keyParity + copyLint + translationCompleteness CI gates, `LanguageContext`, account-menu language switcher, `language_packages` entitlement (dark). *(PR #280, merged.)*
- **`common` + `help`** shell chrome + Help center. *(PR #280, merged.)*
- **`dashboard`** namespace + language gating. *(#281, merged.)*
- **`bookings` + `availability`** namespaces. *(PR #282, merged.)*
- **`settings` surface** — 11 namespaces, whole surface, deferrals folded in. *(PR #287, merged.)*
- **All of Section A** (8 UI domains) + **`flowCopy` family** + **`onboarding`** (#290) + **`dates.ts`/`money.ts`/`capabilities` client copy** (#291) + **server-side per-org emails & hire-order PDFs** (#292). *(All merged.)*
- **`i18next-parser` CI gate** — closed as won't-do (redundant + v9-noisy); decision recorded in `i18next-parser.config.js`. *(2026-08-15.)*

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
- [x] **`onboarding` namespace (shared)** — **DONE (#290, merged).** The `onboarding` catalog pair exists and is registered; en/de parity + `translationCompleteness` are green on `main`. Original scoping notes retained below for history. — `src/lib/dashboard/stageChain.ts` (445), `moduleOnboarding.ts` (271), `firstRun.ts` (247), and the setup rails (`bookings/setup/*`, `hireOrders/setup/*`, dashboard `firstRun/*` — ~27 consumer components). Deferred three times; **its own PR / dedicated pass** (scoped 2026-08-15). **Why it's bigger than the flowCopy family:** `moduleOnboarding` is a *static data registry* (`steps`/`railHeader`/`rules` objects), and step titles live in a *separate* file (`STEP_TITLES` in `src/lib/bookings/setupStatus.ts`), so localizing means an architectural change — convert the registry to `t`-driven (functions or key-returning + consumer-resolved) and update all ~27 consumers + their tests + the `STEP_TITLES` source. `stageChain.composeStageChain` is the most complex branched sentence-builder in the app (its own `fmtDate`/`fmtHour`/`nDates` helpers). **Reusable pattern is proven** (flowCopy family): thread a namespace-bound `TFunction`, byte-identical EN, `_one`/`_other` + `{{interpolation}}`, tests rebind via `i18n.getFixedT('en', ...)`. `coverageCopy.ts` (68) + `scheduleChangeCopy.ts` (66) are small onboarding-adjacent lib modules that can ride the same pass. Recommended: subagent-driven, one lib module + its consumers per task.
- [x] **`flowCopy` family (client)** — DONE across four commits:
  - `@/lib/flowCopy` (`ff2faf9a`, `flowCopy` namespace)
  - `@/lib/bookings/actionCopy` (`9a1218a6`, shared `bookingCopy` namespace)
  - `@/lib/bookings/timingCopy` (`b55a78a9`, `bookingCopy`)
  - `@/lib/bookingCockpit` (`f250e47a`, `bookingCopy`)

  Pattern used: thread a namespace-bound `TFunction` through each pure function (literal keys for type-safety), keep the branching logic, exported string constants become `t`-taking functions, composed sentences become keyed `{{interpolation}}` + `_one`/`_other` plurals (never concatenation). EN byte-identical (a handful of source em dashes normalised to commas for copyLint); DE authored dark. Callers pass a `useTranslation('flowCopy'|'bookingCopy')` binding; direct-call tests rebind via `i18n.getFixedT('en', ...)`.

  **Still open (moved to Section C, not client `t()`):** `bookingFlow.referenceLabel` is an interpolation *variable* baked into the transactional **email** copy (`emailCopy.ts` / `emailTemplateMeta.ts`), so it belongs with the edge-runtime email localization, not this pass.
- [x] **Locale-aware `src/lib/dates.ts`** — **DONE.** Date side (`34f99ba2`) + number/fee side (`money.ts` locale param, #291 — see Section C). The only remaining `toLocaleString`/`Intl` sites are **platform** (out of scope) or shadcn `chart.tsx` (do not edit), so there is nothing in-scope left here. Original note below. — **date side DONE** (`34f99ba2`): `dates.ts` reads the active language from the i18n singleton at call time (date-fns `de` locale / `Intl` locale), so `formatDateWithWeekday`, `weekdayShort`, `weekdayShortLabels`, `formatDayMonthShortYear` and `formatTimestampLocal` localize weekday/month names with **zero call-site threading**; numeric `dd/MM/yyyy` / `yyyy-MM-dd` stay locale-invariant. Replaced the two hardcoded weekday-header arrays (`ArtistAvailabilityCalendar`, `ShowsBookingsPage`) and `AvailabilityPage`'s `en-GB` `toLocaleDateString`. German path covered by `dates.test.ts`. **Still open:** number/fee formatting (`src/lib/hireOrders/money.ts` `Intl.NumberFormat('en-US')` — feeds PDFs, Section C; and stray `toLocaleString()` for counts). Most remaining `toLocaleString` sites are **platform** (out of scope) or shadcn `chart.tsx` (do not edit).
- [x] **`i18next-parser` in CI** — **CLOSED (2026-08-15): will NOT be gated; parser stays local-only.** Investigation found the `--fail-on-update` quirk has *two* independent, unfixable-in-v9 noise sources — (1) cross-namespace key ordering (documented in the config), and (2) plural over-generation: the parser emits empty `key_one`/`key_other` for every `t(key, {count})` call even where the copy is a deliberate single form, and a genuinely-missing key is emitted the same way, so no heuristic can separate noise from signal. The gate would also be **redundant**: drift is already caught by `tsc` (resources typed via `typeof en<Namespace>`), `keyParity.test.ts` (en/de), and `translationCompleteness` + `copyLint`. Decision + evidence recorded in the `i18next-parser.config.js` header comment. `i18n:extract`/`i18n:check` remain local authoring conveniences.

### C. Server-side / Phase 3 (not client `t()`)
> **Safe client-adjacent copy items landed as one PR (2026-08-15).** On investigation, only two of the originally-listed "safe" items were truly client-side and ready; the rest are edge-coupled or cross-repo and were reclassified (see below).
- [x] **`capabilities.ts` `CAPABILITY_DEFS` labels + descriptions + group headers** — DONE. Localized CLIENT-side via the `settingsRolesRights` catalog (new `capabilities` (29) + `capabilityGroups` (8) sections, EN generated from the registry, DE authored). `RolesRightsTab` resolves them at the single `allRows`/`groups` build points, falling back to the registry English; the registry stays the source of the capability set + its English wording (untouched, so the edge/SQL auth mirror is unaffected). A parity test pins EN catalog == registry (no drift) + `GROUP_LABEL_SLUG` coverage.
- [x] **`money.ts` locale-aware `Intl`** — DONE. Added an optional BCP-47 `locale` param (default `en-US`, empty-guarded), so the dual-homed body stays runtime-neutral and the edge PDF renderer is byte-identical. All CLIENT fee displays (NewOrderWizard, OrderSlideOver, OrdersTable, HireOrdersPage KPIs via `computeOrderKpis(orders, locale)`, HireOrderDetailPage, HireOrderEditPage) pass the active language.
- [x] **`bookingFlow.referenceLabel`** — **DONE (#292).** The wrapping email copy that carries the `{{referenceLabel}}` interpolation (offer-immediate subject/intro/previewText, offer-expiry offerLine, etc.) is localized in both `EMAIL_COPY_DEFAULTS` and `EMAIL_COPY_DE` in `src/lib/emailTemplates/emailCopy.ts`, rendered per-org via the `orgLanguage` → `EmailLocale` path. The `referenceLabel` *value* itself is booking data (show / program / custom field), not static copy, so nothing further to translate.
- [ ] **`trust/facts.ts` → `trust.json`** — cross-repo build consumed by the landing page + legal-traceability tests (`facts.privacy.test.ts`); add a DE column / bilingual build. Its own careful pass. **DEFERRED (2026-08-15) pending a legal-review design pass.** Scope is larger than "add a DE column": `facts.ts` is 971 lines of legally load-bearing English pinned by ~10 test files (density caps, citations, privacy-policy diff, capability counts, URLs); the in-app claim tables (matrix/controls/retention/subprocessors) render `facts.ts` English directly while the chrome is already on the `settingsTrust` namespace; German is longer so the 110-char/45-word density caps need a redesign, not a translation; and the German legal claims need native-speaker legal QA (a `privacy-policy.de.md` exists to trace against). Do not bulk-translate this via subagents — it needs a design pass first.
- [x] ~~**Persist `preferred_language` on the user**~~ — **DROPPED (#292).** Superseded by the per-**org** language decision: recipients get their organisation's configured language, so there is no `preferred_language` column, profile setting, or DB migration. See `docs/superpowers/specs/2026-08-15-i18n-server-side-per-org.md`.
- [x] **Transactional emails** — **DONE (#292, per-org).** All 14 templates render in the org's language via `emailCopy.ts` (`EMAIL_COPY_DE`) + the `orgLanguage`→`EmailLocale` path; covered by `registry.locale.test.tsx` and per-template locale tests. (Per-*recipient* targeting is not built because `preferred_language` was dropped above.)
- [x] **Hire-order PDFs** — **DONE (#292, per-org).** `src/lib/hireOrders/pdf/*` (`pdfCopy.ts`, `render.tsx`) localize per org, with `money.ts` receiving a real locale; covered by `pdfCopy.test.ts` + `render.locale.test.ts`.
- [x] ~~**`systemMap.ts` + `docs/*.md` bodies**~~ — **OUT OF SCOPE (2026-08-15, confirmed with owner).** The System Map canvas (`src/data/systemMap.ts` + `docs/system-map.md`) and the App Logic / Documentation guides (`docs/app-logic.md`) render only inside **Settings → Documentation**, which is mounted **`isSuperAdmin`-only** (`SettingsPage.tsx` `show: isSuperAdmin` + `{isSuperAdmin && <DocumentationTab/>}`). That falls under the super-admin exclusion in the banner above. The content is also technical operator documentation (cron expressions, SQL migration filenames, function/identifier names), not end-user copy.

### D. Ship gates (not code)
- [x] Merge queued PRs (#280, #282, #287) — all merged; #289–#292 also merged.
- [ ] **Native-speaker QA of the German.** `translationCompleteness` only catches paste-throughs (DE == EN), **not mistranslations**; ~1,000+ DE strings so far are unproofed. **This is now the primary remaining gate.**
- [ ] Enable `language_packages` per org (super-admin) once a workspace's German is signed off.

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
