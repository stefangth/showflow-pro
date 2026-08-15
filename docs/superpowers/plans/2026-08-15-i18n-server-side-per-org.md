# Per-Org Server-Side Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** German-speaking, entitled orgs receive German transactional emails and German hire-order PDFs, resolved per organization, with English byte-identical.

**Architecture:** Add a second complete default copy map (German) inside each already-mirrored copy registry, selected by a `locale` param that defaults to `"en"`. A single entitlement-gated edge helper resolves an org's locale; delivery/preview/PDF sites pass it. No edge i18n framework, no DB migration.

**Tech Stack:** TypeScript, Deno edge functions, react-email, react-pdf, Vitest, existing mirror generator (`npm run sync:mirrors`).

**Spec:** `docs/superpowers/specs/2026-08-15-i18n-server-side-per-org.md`

## Global Constraints

- German copy: informal **"Du"**, **no em/en dashes** (`[—–]`), reuse `src/i18n/terms.ts` `TERMS` (Engagementvertrag, Antwortfrist, Tagesübersicht, Besetzung, Zweitbesetzung, Vormerkung, Vorläufig gebucht). "Artist"/"Production Team" role nouns not translated.
- Every `{{token}}` in an English string must appear verbatim in its German twin.
- English defaults (`EMAIL_COPY_DEFAULTS`, `HIRE_ORDER_COPY_DEFAULTS`) are **untouched**; `locale` defaults to `"en"`.
- Never hand-edit a mirror target; edit `src/`, run `npm run sync:mirrors`.
- Branch: `claude/i18n-server-per-org` off `main`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Gate `verify:fast` after copy-file edits (it runs `sync:mirrors:check`).

---

### Task 1: Locale primitive + entitlement-gated resolver

**Files:**
- Create: `src/lib/i18n/orgLanguage.ts` — `ORG_LANGUAGE_SETTING_KEY`, `ServerLocale` type, `coerceLocale`.
- Create: `src/lib/i18n/orgLanguage.test.ts`
- Create: `supabase/functions/_shared/orgLocale.ts` — `resolveOrgLocale(deps, orgId)`.
- Create: `supabase/functions/_shared/orgLocale.test.ts`

**Interfaces:**
- Produces: `ORG_LANGUAGE_SETTING_KEY = "org_language"`; `type ServerLocale = "en" | "de"`; `coerceLocale(v: unknown): ServerLocale` (returns `"de"` only for exactly `"de"`, else `"en"`); `resolveOrgLocale(deps: Deps, orgId: string | null): Promise<ServerLocale>`.
- Consumes: `resolveOrgSetting` (`_shared/settings.ts`), `checkFeature` (`_shared/entitlements.ts`).

- [ ] **Step 1: Write `orgLanguage.test.ts`** — `coerceLocale("de")==="de"`; `coerceLocale("en")/("fr")/(null)/(42)==="en"`; `ORG_LANGUAGE_SETTING_KEY==="org_language"`.
- [ ] **Step 2: Run, verify fail.** `npx vitest run src/lib/i18n/orgLanguage.test.ts`
- [ ] **Step 3: Implement `orgLanguage.ts`** (pure; no imports).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Write `orgLocale.test.ts`** using `makeFakeDeps`: (a) `org_language=de` + entitlement on ⇒ `"de"`; (b) `=de` + entitlement off ⇒ `"en"`; (c) `=en` + on ⇒ `"en"`; (d) `orgId=null` ⇒ `"en"` (no setting/entitlement calls); (e) setting unset ⇒ `"en"`.
- [ ] **Step 6: Run, verify fail.** `deno test --allow-all supabase/functions/_shared/orgLocale.test.ts`
- [ ] **Step 7: Implement `resolveOrgLocale`** — `if (!orgId) return "en"; const lang = coerceLocale(await resolveOrgSetting(admin, orgId, "org_language", "en")); if (lang !== "de") return "en"; return (await checkFeature(admin, orgId, "language_packages")) ? "de" : "en";`. Import `coerceLocale`/key from a hand-kept edge copy of the constant (edge can't import `src/`) — inline the 3-line `coerceLocale` + key in `orgLocale.ts` (documented as the runtime twin; guard with a test asserting the two agree — import both in a Vitest test under `src/` via a relative path is not possible across the boundary, so instead assert the literal `"org_language"` in both test files).
- [ ] **Step 8: Run, verify pass** (Deno + vitest).
- [ ] **Step 9: Commit** `feat: org locale resolver (entitlement-gated, per-org)`.

---

### Task 2: German email copy map + locale-aware `resolveEmailCopy`

**Files:**
- Modify: `src/lib/emailTemplates/emailCopy.ts`
- Modify/Create: `src/lib/emailTemplates/emailCopy.test.ts` (add locale + parity cases)
- Regenerate: `supabase/functions/_shared/transactional-email-templates/_shell/emailCopy.ts` via `npm run sync:mirrors`

**Interfaces:**
- Produces: `export type EmailLocale = "en" | "de"`; `export const EMAIL_COPY_DE: EmailCopy`; `resolveEmailCopy(override?, locale: EmailLocale = "en"): EmailCopy`.

- [ ] **Step 1: Write parity/lint tests first** in `emailCopy.test.ts`:
  - `Object.keys(EMAIL_COPY_DE)` deep-equals `Object.keys(EMAIL_COPY_DEFAULTS)`.
  - For every key, the set of `{{token}}` names in DE equals that in EN (regex `/\{\{(\w+)\}\}/g`).
  - No `[—–]` in any DE value; no standalone "Sie"/"Ihre" (word-boundary) in DE values.
  - `resolveEmailCopy(undefined, "de")["offer-immediate.heading"]` === the DE heading; `resolveEmailCopy(undefined)` unchanged English; `resolveEmailCopy({"offer-immediate.heading":"X"}, "de")` ⇒ override wins.
- [ ] **Step 2: Run, verify fail.** `npx vitest run src/lib/emailTemplates/emailCopy.test.ts`
- [ ] **Step 3: Implement** — add `EmailLocale`, `EMAIL_COPY_DE` (translate all ~200 keys; **subagent-translated**, see Global Constraints), and change `resolveEmailCopy` to pick `const base = locale === "de" ? EMAIL_COPY_DE : EMAIL_COPY_DEFAULTS;` then run the existing legacy-carry-forward + override loop over `{ ...base }`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: `npm run sync:mirrors`**, then `npm run sync:mirrors:check`.
- [ ] **Step 6: Commit** `feat: german email copy map + locale-aware resolveEmailCopy`.

---

### Task 3: Email render + shell locale threading (edge)

**Files:**
- Modify: `.../transactional-email-templates/registry.ts`
- Modify: `.../transactional-email-templates/_shell/EmailShell.tsx`
- Modify: `.../transactional-email-templates/registry.test.ts` (or create Deno test)

**Interfaces:**
- Consumes: `EmailLocale` (from mirrored `emailCopy.ts`).
- Produces: `TemplatePresentationOptions.locale?: EmailLocale`; `props._emailLocale`.

- [ ] **Step 1: Write Deno test** — `resolveTemplatePresentation("offer-immediate", data, { locale: "de" })` returns a German `subject` and `props._emailCopy["offer-immediate.heading"]` German + `props._emailLocale === "de"`; default (no locale) stays English/byte-identical.
- [ ] **Step 2: Run, verify fail.** `deno test --allow-all supabase/functions/_shared/transactional-email-templates/`
- [ ] **Step 3: Implement** — add `locale` to `TemplatePresentationOptions`; `resolveEmailCopy(options.copyOverride, options.locale)`; add `_emailLocale: options.locale ?? "en"` to `props`; `EmailShell` reads `_emailLocale` (default `"en"`) → `<Html lang={locale}>`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat: thread locale through email presentation + shell lang`.

---

### Task 4: Email delivery + preview wiring (edge)

**Files:**
- Modify: `supabase/functions/send-transactional-email/index.ts`
- Modify: `supabase/functions/preview-transactional-email/index.ts`
- Modify: `supabase/functions/generate-hire-orders/index.ts` (fee label locale in the issued-email send only)
- Modify: co-located `*.di.test.ts` for send + preview.

- [ ] **Step 1: Write tests** — send: an entitled `de` org ⇒ `resolveTemplatePresentation` called with `locale:"de"` (assert rendered subject is German via fake render); non-entitled ⇒ English. preview: `body.locale:"de"` ⇒ German output regardless of entitlement.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — in send: `const locale = await resolveOrgLocale(deps, orgId); ...resolveTemplatePresentation(name, data, { ...opts, locale })`. In preview: `const locale = coerceLocale(body.locale); ...{ locale }`. In generate-hire-orders issued-email fee label: format with `locale === "de" ? "de-DE" : "en-US"`.
  - **Accepted cost (self-review):** `resolveOrgLocale` adds two DB reads (setting + entitlement) *per email send*. `send-transactional-email` already resolves `resolve_from_address`/`email_copy`/`email_theme` per send, so this is consistent with the existing per-send pattern, not a new one. A digest to N recipients of one org resolves the same locale N times (all recipients share the org's locale) — correct but redundant. Not optimized in v1; if it ever matters, add `locale` to `EmailMessage` so batch senders resolve once. Document in the PR.
- [ ] **Step 4: Run, verify pass** (whole `supabase/functions/` Deno suite — per memory, run the full suite, not single files).
- [ ] **Step 5: Commit** `feat: resolve per-org locale for email delivery + preview`.

---

### Task 5: German PDF copy map + locale-aware `resolveHireOrderCopy`

**Files:**
- Modify: `src/lib/hireOrders/pdf/pdfCopy.ts`
- Modify: `src/lib/hireOrders/pdf/pdfCopy.test.ts`
- Regenerate: `supabase/functions/_shared/hire-order-pdf/pdfCopy.ts` via `npm run sync:mirrors`

**Interfaces:**
- Produces: `export const HIRE_ORDER_COPY_DE: HireOrderCopy`; `resolveHireOrderCopy(overrides?, locale: "en" | "de" = "en"): HireOrderCopy`.

- [ ] **Step 1: Write parity/lint tests** (same four gates as Task 2, over `HIRE_ORDER_COPY_DE` vs `HIRE_ORDER_COPY_DEFAULTS`) + `resolveHireOrderCopy(undefined,"de")` returns German, `resolveHireOrderCopy(undefined)` byte-identical English, override still wins.
- [ ] **Step 2: Run, verify fail.** `npx vitest run src/lib/hireOrders/pdf/pdfCopy.test.ts`
- [ ] **Step 3: Implement** — `HIRE_ORDER_COPY_DE` (~55 keys, **subagent-translated**), `resolveHireOrderCopy` picks base by locale (`locale === "de" ? HIRE_ORDER_COPY_DE : HIRE_ORDER_COPY_DEFAULTS`).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: `npm run sync:mirrors` + `:check`.**
- [ ] **Step 6: Commit** `feat: german hire-order PDF copy + locale-aware resolveHireOrderCopy`.

---

### Task 6: PDF render locale (dates + money) + generate-hire-orders wiring

**Files:**
- Modify: `src/lib/hireOrders/pdf/render.tsx` (mirrored) + `render.test.tsx`
- Modify: `supabase/functions/generate-hire-orders/index.ts` (issue + preview render sites)
- Regenerate mirror.

**Interfaces:**
- `RenderInput.locale?: "en" | "de"` (in `docTypes.ts`, mirrored); render passes it to `formatMoney(...,  locale==="de"?"de-DE":"en-US")` and to date formatting.

- [ ] **Step 1: Write `render.test.tsx`** — rendering with `locale:"de"` + a German copy map produces German section headings and a `4.500,50`-style fee; default render byte-identical (snapshot/string contains English + `en-US` grouping).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — add `locale` to `RenderInput` (`docTypes.ts`); in `render.tsx` derive the money locale + date format from it (default `"en"`); confirm date formatting path (uses existing dd-MMM-yyyy formatter — switch to a de-aware format when `locale==="de"`).
- [ ] **Step 4: Wire `generate-hire-orders`** issue (index.ts:~1650) and preview (index.ts:~2190) — `const locale = await resolveOrgLocale(deps, org); const copy = resolveHireOrderCopy(copyOverride, locale);` and pass `locale` into the `renderHireOrderPdf({ ..., locale })` call. (Snapshot-replay download path at :2516 stays as stored — no locale, it renders the frozen snapshot.)
- [ ] **Step 5: `npm run sync:mirrors` + `:check`; run vitest + full Deno suite, verify pass.**
- [ ] **Step 6: Commit** `feat: render hire-order PDF in org locale (copy, fees, dates)`.

---

### Task 7: `referenceLabel` fallback locale

**Files:**
- Modify: `src/lib/bookingFlow.ts` + `supabase/functions/_shared/bookingFlow.ts` (mirror twin — hand-kept, edit both) + `bookingFlow.test.ts`.

- [ ] **Step 1: Test** — `referenceLabel({...program null...}, "de")` returns the German fallback ("Unbenannte Show"); default/`"en"` returns `"Untitled show"` (byte-identical).
- [ ] **Step 2–4: TDD** — add optional `locale` last param; only the `"Untitled show"` fallback branches on it. Keep both twins byte-identical (verified by their existing mirror test).
- [ ] **Step 5: Commit** `feat: localize referenceLabel fallback`.

---

### Task 8: Settings → Organization language picker

**Files:**
- Modify: `src/components/settings/OrganizationTab.tsx` + `OrganizationTab.test.tsx`
- Modify: `src/data/settings.ts` — `fetchOrgLanguage(client, orgId)` / `setOrgLanguage(client, orgId, locale)` thin wrappers over `resolveOrgSetting`/`upsertOrgSetting`.
- Modify: `src/i18n/locales/en/settings.json` + `de/settings.json` — `organization.language.*` keys (label, help, options handled via `SUPPORTED_LANGUAGES` endonyms).

**Interfaces:**
- Consumes: `useFeature('language_packages')`, `ORG_LANGUAGE_SETTING_KEY`, `coerceLocale`, `SUPPORTED_LANGUAGES`.

- [ ] **Step 1: Write component tests** — picker renders when entitled + not readOnly; hidden when `language_packages` off; selecting `Deutsch` calls `setOrgLanguage(_, orgId, "de")`; disabled when `readOnly`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — add a `Select` (shadcn) seeded from `fetchOrgLanguage`, saving via a `useMutation` → `setOrgLanguage` + invalidate + toast; wrap in `{languagePacksEnabled && ...}`. Add i18n keys (EN canonical, DE matching, "Du", no dashes).
- [ ] **Step 4: Run, verify pass** (+ `keyParity`/`copyLint`/`translationCompleteness`).
- [ ] **Step 5: Commit** `feat: per-org language picker in Settings > Organization`.

---

### Task 9: Editor preview toggle + docs + final verify

**Files:**
- Modify: `src/pages/EmailTemplateEditorPage.tsx` — EN/DE preview toggle (gated by `language_packages`), passes `locale` to the preview call.
- Modify: `public/changelog.md` + regenerate `public/changelog.json` (deno script).
- Modify: help items `src/lib/help/items.ts` (EN+DE) — "set your organization's language".

- [ ] **Step 1: Editor toggle (email only)** — small `Tabs`/`ToggleGroup` (EN/DE) shown only when entitled; wire selected locale into the existing preview request body. Test: toggle present when entitled, absent otherwise; changing it re-requests with `locale`.
  - **Scope line (self-review):** the **hire-order Template editor** (`TemplateEditorPage.tsx:129`, browser `resolveHireOrderCopy(copyDraft)`) gets a symmetric German preview toggle only as a **deferred fast-follow**, NOT in this PR. Acceptance is that *issued* PDFs render German (Task 6); previewing German copy inside the PDF template editor is QA polish. Note the deferral in the PR body.
- [ ] **Step 2: Changelog** — one `## X.Y.Z` block (bump `package.json` + `APP_META.VERSION`); customer-facing bullets ("German transactional emails and hire-order PDFs", "set your workspace language in Settings → Organization"); no super-admin/platform mentions. Regenerate JSON via `deno run --allow-read --allow-write scripts/changelog-to-json.ts`.
- [ ] **Step 3: Help item** — add an EN+DE entry on org language affecting emails/PDFs.
- [ ] **Step 4: System map** — no automation trigger changes ⇒ state "No system-map impact" in the PR. Page mini: no new route ⇒ "No mini."
- [ ] **Step 5: `npm run verify:fast`** — all green.
- [ ] **Step 6: Commit** `feat: german email preview toggle + changelog + help`.

---

## Self-review checklist (run before implementing)
1. **Spec coverage:** R1→T1/T8, R2→T1, R3→T2/T3/T4, R4→T5/T6, R5→T7, R6→T4/T9, R7→T2/T5, R8→all (locale defaults + mirror checks). ✓
2. **Placeholder scan:** translation steps say "subagent-translated" but the *acceptance* is the parity/placeholder/dash/Du tests written first (Steps 1 of T2/T5) — not a placeholder. ✓
3. **Type consistency:** `ServerLocale`/`EmailLocale`/PDF `"en"|"de"` are the same 2-value union; resolver returns it; every consumer defaults to `"en"`. `RenderInput.locale`, `TemplatePresentationOptions.locale` optional. ✓
