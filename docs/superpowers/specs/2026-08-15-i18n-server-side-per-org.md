# Per-Org Server-Side Localization (Emails + Hire-Order PDFs) — Spec

**Date:** 2026-08-15
**Initiative:** i18n Phase 3 (server-side). See `docs/superpowers/plans/2026-08-14-i18n-remaining-handoff.md` §C.
**Decision (owner, 2026-08-15):** localize server-generated content **per organization**, not per user. One org = one language for everything it sends/renders.

---

## Problem

The app *screen* is going bilingual (EN/DE), but everything the platform *generates and sends* is English-only:

- **13 transactional emails** (offer digests, confirmations, hire-order notices, invitations, …).
- **Hire-order PDF contracts** (~55 copy strings + fee/date formatting).

A German org that turns German on would see a German app but receive English offer emails and English contract PDFs. This spec closes that gap at the **organization** level.

## Non-goals (explicitly out of scope)

- **Per-user language.** Recipients get their org's language, full stop. No `preferred_language` column, no profile setting, no DB migration.
- **Localizing the copy *editors*** (Email Templates editor / Hire-order Template editor authoring surface). Admin-authored per-org copy overrides stay in the language the admin typed them in (see "Override interaction" below). A read-only **preview** in the other language is in scope; authoring German overrides is not.
- **Auth/account emails without an org context** (`magic-link`, `account-email-changed`) and **platform/super-admin emails** (`cron-health-alert`): these have no single org, so they resolve to English in v1. Their German strings are still authored (key parity requires it) and become live for free if per-user language ever lands.
- `trust.json` DE, `systemMap.ts`/docs bodies — separate passes.

## Guiding decision: reuse the existing override mechanism, don't build an edge i18n framework

Both server surfaces already resolve copy as **"per-org sparse override merged over a complete English default map"** (`resolveEmailCopy`, `resolveHireOrderCopy`). The Deno edge runtime **cannot** import `src/i18n/locales/*.json` and there is no `t()` there. So we do **not** port i18next to the edge. Instead:

> German is a second **complete default map** in the same (already-mirrored) file, selected by a `locale` parameter that **defaults to `"en"`** so every existing call stays byte-identical.

This is the exact pattern `money.ts` already uses (optional `locale`, `en-US` default keeps edge output byte-identical).

## Requirements

### R1 — Per-org language setting
- New `app_settings` key **`org_language`**, values `"en" | "de"`, code fallback `"en"`. No migration (table exists; code fallback + optional platform-default row cover it).
- Editable in **Settings → Organization** (`OrganizationTab`) via a language `Select`, **gated by the `language_packages` entitlement** (hidden when off) and the existing admin capability gate (`readOnly`). Reuses `SUPPORTED_LANGUAGES` from `src/i18n/config.ts`.

### R2 — Locale resolution is entitlement-gated (mirrors `AppLayout`)
A single edge helper `resolveOrgLocale(admin, orgId)` returns `"de"` **only if** `org_language === "de"` **and** `language_packages` is enabled for that org (checked via `checkFeature`, which already fails closed for `language_packages`). Otherwise `"en"`. `orgId == null` ⇒ `"en"`. This guarantees translated content never leaks to an org without the module, exactly like `AppLayout`'s force-English guard.

### R3 — Emails render in the org's language
- `EMAIL_COPY_DE: EmailCopy` added to `src/lib/emailTemplates/emailCopy.ts` (all ~200 keys). `resolveEmailCopy(override, locale = "en")` selects the base by locale; sparse per-org override still layers on top; legacy carry-forward unchanged.
- `resolveTemplatePresentation(name, data, { locale })` threads locale into `resolveEmailCopy`; subjects (`SUBJECT_RESOLVERS` read from `copy`) follow automatically.
- `EmailShell` renders `<Html lang={locale}>` (was hardcoded `"en"`), fed via a `_emailLocale` prop.
- **Delivery:** `send-transactional-email` calls `resolveOrgLocale(admin, orgId)` and passes `locale`. This is the sole choke point for all senders (digests, offers, hire-order notices) — no per-sender changes.
- The fee label formatted inline in the `hire-order-issued` send path (`generate-hire-orders` index.ts:~1957) passes the resolved money locale.

### R4 — Hire-order PDFs render in the org's language
- `HIRE_ORDER_COPY_DE: HireOrderCopy` added to `src/lib/hireOrders/pdf/pdfCopy.ts` (all ~55 keys). `resolveHireOrderCopy(overrides, locale = "en")` selects the base by locale.
- `generate-hire-orders` resolves org locale at the **issue** and **preview** render sites and passes: German copy base, `de-DE` money locale, and German date formatting into `render.tsx`. (Issued PDFs freeze copy into `issue_snapshot` and store bytes, so locale bakes in once at issue — re-downloads are unchanged.)
- Org-authored **terms clause text** stays as authored (org data, not product copy) — unchanged.

### R5 — `referenceLabel` fallback
`referenceLabel(args, locale = "en")` localizes only its `"Untitled show"` fallback (the rest is org data). Both mirror twins updated together.

### R6 — Preview both languages
`preview-transactional-email` accepts an explicit `body.locale` (`"en" | "de"`, **not** entitlement-gated — it's admin QA) so the Email Templates editor can preview German. A minimal EN/DE preview toggle is added to the editor, gated by `language_packages`.

### R7 — German copy quality gates (same as Phases 1–2)
All German strings: informal **"Du"**, **no em/en dashes**, reuse `src/i18n/terms.ts` `TERMS` glossary (Engagementvertrag, Antwortfrist, Tagesübersicht, Besetzung, Zweitbesetzung, …), preserve every `{{token}}` placeholder exactly. Enforced by new co-located tests: key parity (DE map keys == EN map keys), placeholder parity, dash lint, "Du"/no-"Sie" lint — for **both** the email and PDF German maps.

### R8 — Byte-identical English
Every English path stays byte-identical: `locale` defaults to `"en"`, `EMAIL_COPY_DEFAULTS`/`HIRE_ORDER_COPY_DEFAULTS` untouched, all existing callers that pass no locale unchanged. Mirror `--check` and the existing `pdfCopyMirror`/`emailCopy` mirror tests must stay green after `npm run sync:mirrors`.

## Override interaction (documented v1 behavior)

For a German org, `resolveEmailCopy(sparseOverride, "de")` merges the org's **sparse** override over the **German** base. Overrides are stored sparse (only keys the admin changed — `compactEmailCopy` strips defaults), so uncustomized keys show German. A key the admin explicitly customized (in English, since the editor is English-only for now) renders that English text — which is honoring an explicit choice, not a bug. Authoring German overrides is a later editor-localization pass.

## Affected files (map)

| Area | File | Change |
|---|---|---|
| Email copy | `src/lib/emailTemplates/emailCopy.ts` (mirrored) | `EMAIL_COPY_DE`, `Locale`, locale param |
| Email render | `.../transactional-email-templates/registry.ts` (edge) | `options.locale` threading |
| Email shell | `.../_shell/EmailShell.tsx` (edge-only) | `<Html lang={locale}>` |
| Email delivery | `send-transactional-email/index.ts` | resolve + pass locale |
| Email preview | `preview-transactional-email/index.ts` | accept `body.locale` |
| Email editor | `EmailTemplateEditorPage.tsx` | EN/DE preview toggle (gated) |
| Locale gate | `supabase/functions/_shared/orgLocale.ts` (new, edge) | `resolveOrgLocale` |
| Setting key | `src/lib/i18n/orgLanguage.ts` (new, pure) | key constant + `coerceLocale` |
| PDF copy | `src/lib/hireOrders/pdf/pdfCopy.ts` (mirrored) | `HIRE_ORDER_COPY_DE`, locale param |
| PDF render | `src/lib/hireOrders/pdf/render.tsx` (mirrored) | date + money locale |
| PDF engine | `generate-hire-orders/index.ts` | resolve + pass locale at issue/preview |
| referenceLabel | `src/lib/bookingFlow.ts` (+ edge mirror) | fallback locale |
| Settings UI | `src/components/settings/OrganizationTab.tsx` | language Select |
| Settings data | `src/data/settings.ts` | thin `org_language` read/write helpers |
| i18n catalog | `src/i18n/locales/{en,de}/settings.json` | picker label keys |
| Docs | `public/changelog.md/.json`, help items | customer-facing + help |

## Acceptance

1. A `language_packages`-entitled org set to `de` receives German offer/confirmation/hire-order emails and a German hire-order PDF with `de-DE` fees and German dates.
2. The same org **without** the entitlement receives English (gate holds).
3. English orgs are byte-identical to today (mirror check + English render tests green).
4. All German maps pass key-parity, placeholder-parity, dash, and "Du" gates.
5. `verify:fast` green (lint, typecheck ×2, build, unit+coverage, deno check+test, mirror check).
