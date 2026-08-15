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
- [ ] **`onboarding` namespace (shared)** — `src/lib/dashboard/stageChain.ts`, `moduleOnboarding.ts`, and the setup rails (`bookings/setup/*`, `hireOrders/setup/*`, dashboard `firstRun` copy). Deferred three times; spans domains, so its own PR.
- [ ] **`flowCopy` family** — `@/lib/flowCopy`, `bookingFlow.referenceLabel`, `bookings/timingCopy`, `bookings/actionCopy`, `bookingCockpit` DatePeek. **These still render English on the already-migrated dashboard/bookings/availability pages** — those domains aren't truly complete until this lands.
- [ ] **Locale-aware `src/lib/dates.ts`** — weekday-header arrays, `date-fns format(...)`, `toLocaleDateString('en-GB')`, fee/number formatting via `Intl`. Touches call sites app-wide.
- [ ] **`i18next-parser` in CI** — currently local-only (`i18n:extract`/`i18n:check`); resolve the `--fail-on-update` byte-identical-write quirk, then gate.

### C. Server-side / Phase 3 (not client `t()`)
> **Safe client-adjacent copy items landed as one PR (2026-08-15).** On investigation, only two of the originally-listed "safe" items were truly client-side and ready; the rest are edge-coupled or cross-repo and were reclassified (see below).
- [x] **`capabilities.ts` `CAPABILITY_DEFS` labels + descriptions + group headers** — DONE. Localized CLIENT-side via the `settingsRolesRights` catalog (new `capabilities` (29) + `capabilityGroups` (8) sections, EN generated from the registry, DE authored). `RolesRightsTab` resolves them at the single `allRows`/`groups` build points, falling back to the registry English; the registry stays the source of the capability set + its English wording (untouched, so the edge/SQL auth mirror is unaffected). A parity test pins EN catalog == registry (no drift) + `GROUP_LABEL_SLUG` coverage.
- [x] **`money.ts` locale-aware `Intl`** — DONE. Added an optional BCP-47 `locale` param (default `en-US`, empty-guarded), so the dual-homed body stays runtime-neutral and the edge PDF renderer is byte-identical. All CLIENT fee displays (NewOrderWizard, OrderSlideOver, OrdersTable, HireOrdersPage KPIs via `computeOrderKpis(orders, locale)`, HireOrderDetailPage, HireOrderEditPage) pass the active language.
- [ ] **`bookingFlow.referenceLabel`** — RECLASSIFIED: dual-homed and the **edge** copy feeds the `referenceLabel` interpolation var into artist emails (open-offer-tier / expire-offers / send-confirmation-digest). Belongs with the email chain below, NOT a client item. Localize when `preferred_language` lands.
- [ ] **`trust/facts.ts` → `trust.json`** — cross-repo build consumed by the landing page + legal-traceability tests (`facts.privacy.test.ts`); add a DE column / bilingual build. Its own careful pass.
- [ ] **Persist `preferred_language` on the user** (DB + auth/profile). **Prerequisite** for per-recipient localization below. New DB migration (auto-applies to prod on merge) + net-new edge-runtime i18n infra; needs a design pass.
- [ ] **Transactional emails** — `supabase/functions/_shared/transactional-email-templates/*` need an **edge-runtime bilingual mirror** to render per recipient language. Depends on `preferred_language`.
- [ ] **Hire-order PDFs** — `src/lib/hireOrders/pdf/pdfTheme.ts` + generation; same edge-runtime localization problem (and where `money.ts`'s edge `en-US` default gets a real locale to pass).
- [ ] **`systemMap.ts` + `docs/*.md` bodies** — canvas data + markdown document content.

### D. Ship gates (not code)
- [ ] Merge queued PRs (#280, #282, #287).
- [ ] **Native-speaker QA of the German.** `translationCompleteness` only catches paste-throughs (DE == EN), **not mistranslations**; ~1,000+ DE strings so far are unproofed.
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
