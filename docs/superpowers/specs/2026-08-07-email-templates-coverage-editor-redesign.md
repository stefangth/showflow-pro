# Email templates: coverage, editor & redesign — Design Spec

- **Date:** 2026-08-07
- **Status:** Approved for implementation (brainstorming complete)
- **Implementation branch:** `codex/email-templates-coverage`
- **Handoff:** Written to be executed by another agent (Codex) with no prior context. Everything needed is in this file; visual targets are in `assets/2026-08-07-email-templates/*.html` (open in a browser).

---

## 1. Summary

Showflow Pro sends transactional email through two systems: **(A)** 12 React-Email templates in `supabase/functions/_shared/transactional-email-templates/` sent via the `send-transactional-email` edge function, and **(B)** Supabase Auth's own password-reset email (rendered by GoTrue, configured only in the Supabase dashboard).

Today only **8** of the 12 templates are exposed for preview/edit (Settings → Booking Flow → `EmailTemplatesCard`), the override surface is 4 flat fields (subject/intro/cta/footer), there is **no shared layout** (all 12 templates hand-roll their own inline CSS), and **2 of the "editable" 8 are dead code** (never sent).

This initiative delivers three things over one shared foundation:

1. **A best-in-class coverage surface** — a Settings registry listing every email, its real trigger ("when"), its recipient ("to whom"), and its status. Deletes the 2 orphans; makes the currently-hidden templates first-class.
2. **A brandable, themeable email redesign** — one shared `EmailShell` (design direction **B**, "jewel-tone hero") with a per-family accent echoing the marketing site's "What it does" cards, built with email-client-safe HTML.
3. **A per-email editor** — the existing hire-order PDF template editor's three-pane workspace and controls, **extracted into a shared kit (Approach A)** and reused to edit email copy + theme.

---

## 2. Goals / non-goals

### Goals
- Every email ShowFlow sends is visible in one Settings surface with accurate trigger + recipient metadata.
- Every customer-facing template is previewable **and** editable (close the 3 preview-only gaps).
- One shared, on-brand, email-client-robust layout; templates become content-only.
- Producers/admins edit copy + theme through a reused three-pane editor, not a form stack.
- Zero regression to the shipped hire-order PDF template editor (guarded by its existing suite).

### Non-goals
- Bringing the Supabase Auth password-reset email in-house (explicitly deferred; it stays external and is shown in the surface as a labelled, non-editable "External" row).
- Per-recipient / per-locale template variants (single locale, `lang="en"`, as today).
- Changing *when* any email fires or *who* receives it (triggers and recipients are unchanged; only presentation, coverage, and editability change).
- A public super-admin/platform surface for these (org-scoped only).

---

## 3. Decisions locked

| # | Decision | Choice | Notes |
|---|----------|--------|-------|
| D1 | Design direction | **B — jewel-tone hero** | Gradient header hero with **solid Outlook fallback**; per-family accent. Light, bulletproof body. See §6, §7. |
| D2 | Password-reset (Supabase Auth) | **Leave in Supabase** | Shown in surface as `External`, non-editable. Out of Phases B/C. |
| D3 | Coverage-surface IA | **Grouped registry** | Groups: Booking engine · Hire orders · Accounts & access · System · External. Row → full-page editor. |
| D4 | The 2 orphans | **Delete** | `signup-decision`, `new-signup-admin-notification`. Verified dead (§5.1). |
| D5 | The 3 preview-only gaps | **Make fully editable** | `org-invitation`, `hire-order-countersigned`, `account-email-changed`. `cron-health-alert` stays `Internal` (super-admin only, not editable). |
| D6 | Editor code reuse | **Approach A — shared kit** | Extract reusable controls/shell/outline into `src/components/settings/templateEditor/`; refactor BOTH editors to consume them. §8.2. |
| D7 | Theme scope | **Org-wide role styling + per-template copy** *(default, reversible)* | Style is one system across all emails (no ransom-note drift); wording is per template. If the owner later wants per-template typography, `email_theme` can grow a per-template overrides layer without schema change. |
| D8 | Who can edit | **Admin-only by default, producer-grantable** *(default, reversible)* | New capability `edit_email_templates` mirrors `edit_hire_order_settings`: admins always; producers only if the org grants `producer_can_edit_email_templates` (defaults false). Super-admins bypass. |

> **D7 and D8 were chosen per recommendation when the owner said "write the spec" without overriding them. Both are cheap to reverse — flag to the owner at review.**

---

## 4. Real-world email constraints (implementer reference)

The marketing "What it does" cards (`showflow-pro.landingpage/src/sections/ProductFeatures.tsx`) use dark gradients, glass blur, and Geist. Email clients — **Outlook Windows (Word rendering engine) is the hard floor** — treat these very differently. Ground every email-HTML decision in this:

- **Layout:** tables, not flexbox/grid. Use `role="presentation"` tables. React-Email's primitives (`<Container>`, `<Section>`, `<Row>`, `<Column>`, `<Button>`) already emit table-based, bulletproof markup — use them; do not hand-roll `<div>` flex layouts.
- **Gradients:** work in Apple Mail / iOS / Gmail; **Outlook renders nothing** → always set a **solid `bgcolor`** on the hero cell as the fallback, with the gradient as `background-image` layered on top. (Optional: VML rectangle for a true Outlook gradient — not required for v1.)
- **Web fonts (Geist):** render only in Apple Mail / iOS Mail; Gmail & Outlook fall back. Always specify a **system fallback stack** (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`); treat Geist as progressive enhancement via `@font-face` in a `<style>` block (ignored where unsupported, never breaks).
- **Glass / `backdrop-filter`:** unsupported everywhere; **do not use.** Fake "glass" tiles with solid fills only.
- **Dark mode:** Apple Mail respects `prefers-color-scheme`; Gmail & Outlook.com force-invert unpredictably. Design **light**, with sufficient contrast; add `<meta name="color-scheme" content="light">` + `<meta name="supported-color-schemes" content="light">`. Do not ship a dark-background email (this is why direction C was rejected).
- **CSS support:** `border-radius`, `box-shadow` ignored by Outlook (degrade gracefully — square corners are fine). No `padding` on `<p>`/`<div>` in Outlook → pad with table cells. Inline the critical styles; `<style>` head blocks are for `@font-face` and `@media` only and are stripped by some Gmail contexts.
- **Images:** blocked by default in many clients until "load images" → the message must read with images off; every `<img>` needs `alt`. Prefer a CSS/solid brand mark over an image logo where possible; if an image mark is used, host it and provide alt text.
- **Width:** ~600px max content width, centered; fluid below.

The upshot that shaped direction **B**: the risky brand cue (the gradient hero) lives in **one** cell that **fails safe to a solid brand colour**, and the body stays a bulletproof light card every client renders identically.

---

## 5. Current-state findings (evidence)

### 5.1 The 2 orphans are conclusively dead (verified before deletion)
- **Code:** `signup-decision` / `new-signup-admin-notification` appear only in their own template files, `registry.ts`, `EmailTemplatesCard.tsx`, and test files. No `deps.sendEmail({ template_name })`, no frontend `invoke('send-transactional-email')`.
- **DB:** live query on prod (`epweartpzwvcasrzyueh`) — no `pg_proc` body and no `cron.job` command references either name.
- **Send log:** `email_send_log` holds 25 real sends across 6 templates; **neither orphan has ever been sent.** (Sends observed: `cron-health-alert`×15, `org-invitation`×4, `artist-offer-digest`×2, `hire-order-issued`×2, `cast-escalation-requested`×1, `hire-order-countersigned`×1.)
- No Supabase Auth "Send Email" hook is configured (password reset is still GoTrue's default).

### 5.2 Preview/edit gap
`src/components/settings/EmailTemplatesCard.tsx` lists 8 keys (`EMAIL_TEMPLATE_KEYS`); `registry.ts` has 12. `preview-transactional-email` already renders **all 12** (it defaults to every key). `send-transactional-email` already applies per-org `email_template_overrides` for **any** key. So exposing the missing templates is mostly UI + registry work — the render + override plumbing already exists.

### 5.3 No shared layout
All 12 templates redefine their own `main`/`container`/`h1`/`button`/`text` inline style objects (see `org-invitation.tsx` lines 68–76). Restyling today means editing 12 files; brand drift is trivial. Phase B fixes this.

### 5.4 Current override mechanism
`send-transactional-email/index.ts` (~lines 250–268) reads the org setting `email_template_overrides`, then merges `overrides[templateName]` fields `subject` → subject, `intro`→`_intro`, `cta_label`→`_cta_label`, `footer`→`_footer` into the template data. Templates read `_intro/_cta_label/_footer` props. This is the model Phase C generalises into `email_copy` + `email_theme`.

---

## 6. Target design — direction B ("jewel-tone hero")

Reference mockup: `assets/2026-08-07-email-templates/01-design-directions.html` (option B).

Anatomy of every email:
1. **Hero header cell** — solid family `bgcolor` (Outlook) + radial-glow + `linear-gradient` `background-image` on top; brand mark + wordmark in white; heading (white) + optional sub-line. This is the only element carrying the brand's jewel-tone identity, and it degrades to a flat brand band.
2. **Body card** — white, ~600px, rounded (ignored gracefully by Outlook); intro paragraph, optional **data tiles** (a table of label/value cells; numeric values in a mono stack), and a **bulletproof CTA button** (react-email `<Button>`).
3. **Footer** — muted, small; unsubscribe / context line where applicable.

**Per-family accent** (mirrors the marketing cards, jewel tones):

| Family | Gradient (from → to) | Solid fallback | Applies to (group/category) |
|--------|----------------------|----------------|------------------------------|
| violet | `#4738B0 → #1E175A` | `#322685` | Booking offers/confirmations, org-invitation |
| ember | `#883A24 → #3A1B14` | `#5F2A1C` | At-risk / cast escalation |
| cyan | `#0E5B73 → #062A38` | `#0B4154` | (reserved: casts / eligibility) |
| pine | `#1C5A44 → #0B2820` | `#133F31` | Hire order issued |
| steel | `#3B3F63 → #191B2E` | `#2A2D48` | Hire order countersigned; account/security |

(Values taken from `ProductFeatures.tsx` `CARDS[].grad/fade`. Materialised as literal hex in the shared theme, per §14 DS note.)

---

## 7. Design system usage (owner constraint: "use the DS strictly")

- **In-app surfaces (coverage page + editor):** semantic tokens ONLY — `bg-background`, `text-foreground`, `text-primary`, `border-border`, `bg-card`, etc.; `font-display` / `font-sans` / `font-mono`; shadcn primitives (`Card`, `Tabs`, `Button`, `Select`, `Slider`, `ScrollArea`, `ResizablePanelGroup`…). No hardcoded colors. Respect the **accent-scale opacity rule** (`accent-50..900` are hex, no `/alpha` modifier).
- **Email output:** mail clients cannot consume Tailwind/CSS variables, so email HTML uses literal hex + inline styles. The email theme's **default palette is sourced from the design-system brand values** (the same violet `#4738B0` family the cards use) but materialised as hex in `emailTheme.ts`. The app UI stays pure-DS; the emails mirror DS values by derivation, in one place.

---

## 8. Architecture

### 8.1 Rendering foundation — `EmailShell` + email theme (Phase B)

New shared module: `supabase/functions/_shared/transactional-email-templates/_shell/`.

- **`EmailShell.tsx`** — the one layout. Props: `{ family, theme, previewText, heading, subheading?, children, footer, cta? }`. Emits the hero (solid + gradient), body container, and footer as react-email primitives. Renders `<Head>` with `color-scheme` metas + optional `@font-face` for Geist. All 10 live templates render *through* it; a template file becomes ~content slots, no bespoke CSS.
- **`emailTheme.ts`** — schema + defaults + resolver, structured exactly like `pdfTheme.ts`:
  - `EmailThemeBase` — palette (heroText, heroSub, bodyText, muted, faint, accent, line, tileBg, buttonBg, buttonText, cardBg, pageBg), fonts (bodyFamily, headingFamily incl. system fallback), button radius, default footer text.
  - `EMAIL_FAMILY_ACCENTS` — `Record<Family, { from; to; glow; solid; buttonBg }>` (the §6 table).
  - `EMAIL_ROLE_DEFAULTS` — per-role `RoleStyle` for roles: `header`, `heading`, `subheading`, `body`, `dataLabel`, `dataValue`, `button`, `footer`.
  - `EmailThemeOverride` (`{ base?, roles? }`), `resolveEmailTheme(override)`, `compactEmailTheme(draft)` — same compact-override-map discipline as hire orders.
  - `CATEGORY_TO_FAMILY` — maps each template's group to a Family.
- **`emailCopy.ts`** — per-template copy registry (schema + defaults + resolver), structured like `pdfCopy.ts`:
  - `EMAIL_COPY_DEFAULTS` keyed `` `${templateKey}.${field}` `` (flat, string→string), where fields per template are declared in `emailTemplateMeta.ts` (subject, heading, intro, ctaLabel, footer + template-specific slots), each with token hints.
  - `resolveEmailCopy(override)`, `compactEmailCopy(draft)`.
- **Mirroring (important — differs from the PDF editor):**
  - `emailTheme.ts` and `emailCopy.ts` are **pure** (schema + defaults + resolvers, **no react-email imports**) and needed by both runtimes, so they follow `pdfTheme`/`pdfCopy`: **source in `src/lib/emailTemplates/`, generated target under `supabase/functions/_shared/transactional-email-templates/_shell/`**, via new `mirrors.manifest.json` entries. `npm run sync:mirrors` regenerates; `sync:mirrors:check` gates CI. Never hand-edit the generated targets.
  - `EmailShell.tsx` is **NOT mirrored** — it imports `npm:@react-email/...` (Deno specifiers, **not** browser-importable), so it is **edge-only**: it lives at `supabase/functions/_shared/transactional-email-templates/_shell/EmailShell.tsx`, imports the (mirrored) theme/copy, and the **frontend never imports it** (the editor previews via the `preview-transactional-email` edge function). This is the crucial difference from the PDF editor, whose `render.tsx` **is** mirrored precisely because `@react-pdf/renderer` renders in the browser and email's renderer cannot.
  - `emailTemplateMeta.ts` (editor role/copy grouping) is **frontend-only**, like `templateMeta.ts` / `pdfCopyMeta.ts` — the renderer needs none of it.

> **Divergence note:** the hire-order live preview renders a real PDF **client-side** via `renderHireOrderPdf` (dual-homed `render.tsx`). React-email templates import `npm:@react-email/...` (Deno specifiers) and are **not** browser-importable, so the email editor previews via the **`preview-transactional-email` edge function** (HTML → iframe `srcDoc`), exactly as `EmailTemplatesCard` does today. This is why the preview pane is per-domain, not shared (see 8.2).

### 8.2 Shared editor kit — Approach A

New: `src/components/settings/templateEditor/` (domain-agnostic). Extract from the hire-order editor and **refactor the hire-order editor to consume the extracts** (one implementation each):

**Shared (extracted):**
- `TemplateEditorShell.tsx` — the 3-pane `ResizablePanelGroup` frame + top bar (title, actions slot, Reset all, Save). Props: `{ title, breadcrumb, actions, outline, preview, inspector, readOnly }`.
- `TemplateOutline.tsx` — genericised from the current one: driven by a `sections: { title, roles: { key, label } }[]` registry + a `isModified(roleKey)` predicate + `selected`/`onSelect`. (Current version is already registry-shaped; parameterise the types.)
- `CopyFieldControl.tsx` — label + `Input`/`Textarea` (multiline) + token hint + `hasBadDash` warning + reset-when-modified. (Lift verbatim from `TemplateInspector.tsx`.)
- `RoleStyleControls.tsx` + `DocumentBaseControls.tsx` — font/size/weight/colour/case + base palette/fonts/scale, parameterised by `{ fonts, colorKeys, colorLabels, fields }` so PDF (margins, mono font) and email (no margins) can each pass their applicable set.
- `overrideMap.ts` — `hasOwnKeys`, `numericInputValue`, and generic `compactCopy`/`compactTheme` helpers.
- `RoleStyle` / `ThemeColorKey`-style shared types (both domains share the `{ family?, size?, weight?, color?, letterSpacing?, transform? }` shape).

**Per-domain (NOT shared):**
- Registry (`templateMeta.ts` / `emailTemplateMeta.ts`), theme (`pdfTheme` / `emailTheme`), copy (`pdfCopy` / `emailCopy`).
- Preview pane: `TemplateDocumentPane.tsx` (PDF, client render) vs new `EmailPreviewPane.tsx` (edge `preview-transactional-email` → iframe `srcDoc`, debounced, same monotonic-run-token guard as `TemplateDocumentPane`).
- Page shell wiring: `TemplateEditorPage.tsx` (hire orders) vs `EmailTemplateEditorPage.tsx`.

**Guard:** the hire-order editor's existing suite (`TemplateEditorPage.test.tsx`, `TemplateInspector.test.tsx`, `TemplateOutline.test.tsx`, `TemplateDocumentPane.test.tsx`) must stay green through the refactor.

### 8.3 Coverage surface + registry (Phase A)

- **`src/lib/emailTemplates/coverage.ts`** (frontend; named to avoid clashing with the edge `registry.ts`) — the metadata registry: `Record<templateKey, { displayName, group, family, trigger, recipient, status: 'editable'|'internal'|'external', category }>`. Hand-authored (triggers aren't machine-derivable). `category` reuses `EMAIL_TEMPLATE_CATEGORY` from `notificationCategories.ts`. A unit test asserts every non-external key ∈ edge `TEMPLATES` and vice-versa (prevents future orphans/drift).
- **`src/components/settings/emailTemplates/EmailTemplatesTab.tsx`** — renders the grouped registry (mockup `02-coverage-surface.html`): family dot, name, trigger, recipient, status chip; row → `Preview` (dialog, reuse existing `preview-transactional-email` call) and `Edit` (navigate to editor route, when C lands). External + Internal rows have no Edit; Internal is visible only to super-admins.
- **Move** email-template editing out of `BookingFlowTab` into this tab (see §11). Delete the 2 orphans across template files, `registry.ts` (edge), `EmailTemplatesCard`, and tests.

### 8.4 The email editor (Phase C)

- **`src/pages/EmailTemplateEditorPage.tsx`** (default export) at `ROUTES.EMAIL_TEMPLATE` (`/settings/email-templates/:templateKey`). Loads org settings `email_copy` + `email_theme` (seeded-ref draft pattern from `TemplateEditorPage`), builds `EmailPreviewPane` input, saves both via `upsertOrgSetting` (compacted). Uses the shared kit for shell/outline/inspector.
- Outline = `Document` (base theme + family) + shared **roles** (Header/Heading/Body/Data tiles/Button/Footer) with **Style** editing the org-wide role (labelled "applies to all emails") + this template's **copy** fields under Text.
- `Send test to me` action = call `send-transactional-email` with the current draft to the signed-in user (nice-to-have; can be a follow-up).

---

## 9. Data model & settings

- **New org settings** (via `resolveOrgSetting`/`upsertOrgSetting`, `app_settings` table): `email_theme` (`EmailThemeOverride`, org-wide) and `email_copy` (`Partial<Record<copyKey,string>>`, per-template flattened `templateKey.field`). Both compact override maps (absent key = default).
- **Migration of `email_template_overrides`:** existing rows carry `{ [templateKey]: { subject?, intro?, cta_label?, footer? } }`. Provide a one-time, idempotent data migration (or a resolver-time shim) mapping `subject→${key}.subject`, `intro→${key}.intro`, `cta_label→${key}.ctaLabel`, `footer→${key}.footer` into `email_copy`, then retire `email_template_overrides` reads. **Prefer a resolver-time backfill** (read old key if new absent) for one release, then a cleanup migration — safer than a hard cutover for a live setting. Only a handful of orgs have any overrides.
- No new tables; no RLS changes (reuses `app_settings`, already org-scoped + capability-gated on write).

---

## 10. Backend / edge changes

- **`send-transactional-email`** — replace the `email_template_overrides` read with `email_copy` + `email_theme` resolution; pass resolved `theme` + `family` into the template (which renders via `EmailShell`). Keep subject-override behavior. Keep the fail-closed `{success:false, reason}` contract and `isServiceRole` gate.
- **`preview-transactional-email`** — already renders all templates. Extend to accept `{ copyOverride, themeOverride, highlightRole? }` and render via `EmailShell` with the same resolvers, so the editor preview is byte-identical to what sends. `highlightRole` (optional) wraps the matching `EmailShell` slot in an outline ring for the direct-editing feel (parity with the PDF editor's `highlightRole`); acceptable to defer to a follow-up.
- **Templates** — refactor all 10 to render through `EmailShell`, reading copy from `emailCopy` defaults + overrides. No trigger/recipient changes.
- **Mirror** — regenerate + `sync:mirrors:check`. **Deno check** every touched edge function (`deno check --node-modules-dir=none supabase/functions/*/index.ts` and the `_shell` module).

---

## 11. Capability, routes, gating

- **Capability** — add to `src/lib/capabilities.ts` `CAPABILITY_DEFS` (then `npm run sync:mirrors` for the edge block):
  `{ key: "producer_can_edit_email_templates", action: "edit_email_templates", role: "producer", group: "Email", label: "Edit email templates", description: "Producers can change email copy and branding.", risk: "sensitive", defaultEnabled: false }`.
  Add the SQL twin in a new migration mirroring `20260723141017_capability_layered_resolver.sql` / `..._app_setting_capability*.sql` (guarded by `capabilityDefaultsSql.test.ts`). UI gates with `useCan('edit_email_templates')` (admins true; producers per-grant; super-admins bypass). Read-only floor applies (view always; edit gated).
- **Route** — add `ROUTES.EMAIL_TEMPLATE = '/settings/email-templates/:templateKey'` in `app.config.ts`; register in `App.tsx` next to `ROUTES.HIRE_ORDER_TEMPLATE` (line ~66) inside a `<ProtectedRoute requiredRoles={['admin','producer']}>` (capability further narrows edit).
- **Settings IA** — introduce an "Email templates" tab in `SettingsPage.tsx` hosting `EmailTemplatesTab`; **remove `EmailTemplatesCard` from `BookingFlowTab`** (lines ~19,176). Update `BookingFlowTab.test.tsx` / `SettingsPage.test.tsx` expectations (the from-address input stays in Booking Flow; email templates move out and are gated by the new capability, not the booking-flow capability — this is an intended behavior change, note it in the PR).

---

## 12. Phased task breakdown (build order B → A → C, test-first)

### Phase B — rendering foundation
1. `src/lib/emailTemplates/emailTheme.ts` — schema, `EMAIL_ROLE_DEFAULTS`, `EMAIL_FAMILY_ACCENTS`, `CATEGORY_TO_FAMILY`, `resolveEmailTheme`, `compactEmailTheme`. Unit tests first.
2. `src/lib/emailTemplates/emailCopy.ts` + `emailTemplateMeta.ts` — per-template copy fields, tokens, `resolveEmailCopy`, `compactEmailCopy`. Unit tests (incl. `hasBadDash` on defaults; no em-dashes).
3. `EmailShell.tsx` — **edge-only** (`supabase/functions/_shared/transactional-email-templates/_shell/`, NOT mirrored): hero (solid+gradient), body, footer, `<Head>` metas, Geist `@font-face`. Deno test asserting Outlook fallback `bgcolor` present + no `backdrop-filter`/flex.
4. Add **`emailTheme.ts` + `emailCopy.ts` only** (not `EmailShell`) to `mirrors.manifest.json`; `npm run sync:mirrors`; verify `sync:mirrors:check`.
5. Refactor each of the 10 live templates to render through `EmailShell` (violet/ember/pine/steel families per §6). Keep `previewData`. Update per-template tests + `app-links.test.ts`.
6. Deno check all touched edge fns.

### Phase A — coverage surface
7. Delete orphans (`signup-decision`, `new-signup-admin-notification`): template files, edge `registry.ts` entries, `EmailTemplatesCard` keys/labels, `preview-transactional-email/index.di.test.ts` cases, `app-links.test.ts`, `notificationCategories.test.ts` reference. Run edge suite.
8. `src/lib/emailTemplates/coverage.ts` (metadata) + a test asserting coverage↔`TEMPLATES` parity (no orphans, no missing).
9. `EmailTemplatesTab.tsx` (grouped surface, preview dialog). Component tests.
10. Wire the tab in `SettingsPage.tsx`; remove `EmailTemplatesCard` from `BookingFlowTab`; fix affected tests.

### Phase C — the editor
11. Extract shared kit into `src/components/settings/templateEditor/` (`TemplateEditorShell`, `TemplateOutline` generic, `CopyFieldControl`, `RoleStyleControls`, `DocumentBaseControls`, `overrideMap`, shared types). Port the hire-order editor onto them; keep its suite green.
12. `EmailPreviewPane.tsx` (edge preview → iframe, debounced, run-token guard).
13. `EmailTemplateEditorPage.tsx` at `ROUTES.EMAIL_TEMPLATE`; settings load/seed/save for `email_copy`+`email_theme`. Component tests (copy round-trip, style round-trip, readOnly).
14. Capability `edit_email_templates` (registry + mirror + SQL twin migration + tests). Gate the tab's Edit + the editor.
15. `send-transactional-email` + `preview-transactional-email`: switch to `email_copy`/`email_theme`, `EmailShell`, optional `highlightRole`. Edge DI tests. Resolver-time backfill from `email_template_overrides`.
16. Changelog + version bump; final full verification (§13, §14).

---

## 13. Testing plan (five layers, test-first)

- **Unit (vitest):** `emailTheme`/`emailCopy` resolve+compact; family→accent map; registry↔TEMPLATES parity; no-em-dash on defaults; shared-kit controls.
- **Data-access (vitest + `supabaseFake`):** `email_copy`/`email_theme` resolve/upsert; `email_template_overrides` backfill.
- **Edge (Deno):** `send-transactional-email` applies copy+theme and renders via `EmailShell`; `preview-transactional-email` renders all live templates + honors overrides + `highlightRole`; `EmailShell` Outlook-fallback assertions. Run the **whole** `supabase/functions/` suite (per repo note, single-file runs hide regressions).
- **Component (vitest + RTL):** coverage surface grouping/labels/gaps; editor round-trips; hire-order editor suite unchanged.
- **Typecheck matrix:** `tsc -p tsconfig.app.json`, `tsc -p tsconfig.tools.json`, `deno check --node-modules-dir=none` on touched edge fns. `npm run lint` (`--max-warnings 0`). `npm run sync:mirrors:check`.

---

## 14. Housekeeping & constraints

- **Design system strict** (§7). No hardcoded colors in app UI; emails derive DS values as hex in one module.
- **No em-dashes** in any copy (UI, email defaults, changelog): use period/comma/colon/middot. `hasBadDash` enforces in the editor.
- **Changelog:** add a newest-first block to `public/changelog.md` (customer-facing bullets only — the coverage surface, prettier emails, the editor; **never** mention cron-health/super-admin/internal), then regenerate JSON via `deno run --allow-read --allow-write scripts/changelog-to-json.ts`. Bump `package.json` `version` + `APP_META.VERSION`.
- **Migrations:** the merge applies them — never hand-apply. If a capability SQL migration must go out of band, rename the file to the recorded version (`scripts/check-migrations.mjs` gates this).
- **Mirror discipline:** never hand-edit generated targets; edit source + regenerate. The capability SQL twin and `is_feature_enabled`-style twins are hand-maintained in the same commit.
- **System map:** no automation trigger changes here, so `docs/system-map.md` / `src/data/systemMap.ts` need only a copy touch if the email-render path description changes (optional).

---

## 15. Risks & resolved owner decisions

- **R1 — hire-order editor regression** during kit extraction. Mitigation: extract mechanically, keep its suite green at each step, land Phase C behind the passing suite.
- **R2 — `email_template_overrides` migration** on a live setting. Mitigation: resolver-time backfill for one release before cleanup migration.
- **R3 — preview parity** (`preview-transactional-email` must render exactly what sends). Mitigation: both paths share `EmailShell` + resolvers; a Deno test renders both and diffs.
- **R4 — Outlook fidelity.** Accept square corners / flat hero in Outlook; the solid fallback + system fonts guarantee legibility. Optional VML gradient is a later polish, not v1.
- **D7/D8 confirmed for implementation:** org-wide theme; admin-only by default with an optional producer grant.
- **Orphan handling confirmed for implementation:** delete the 2 verified-dead templates outright.

---

## 16. Appendix — full template inventory

| Template | Group | Family | When (trigger) | To whom | Category (opt-out?) | Status |
|---|---|---|---|---|---|---|
| offer-immediate | Booking engine | violet | Offer tier opens (`open-offer-tier`) | Offered artist | booking_offers (opt-out) | editable |
| artist-offer-digest | Booking engine | violet | Daily 19:00 Berlin (`send-offer-digest`) | Artists w/ pending offers | booking_offers (opt-out) | editable |
| offer-expiry-reminder | Booking engine | violet | Before an offer expires (`expire-offers`) | Artist w/ pending offer | booking_offers (opt-out) | editable |
| artist-confirmation-digest | Booking engine | violet | Daily 20:00 Berlin (`send-confirmation-digest`) | Newly confirmed artists | booking_confirmations (opt-out) | editable |
| cast-escalation-requested | Booking engine | ember | Tier can't fill by deadline (`expire-offers`) | Producers | at_risk (opt-out) | editable |
| hire-order-issued | Hire orders | pine | Producer issues an order (`generate-hire-orders`) | Artist (PDF attached) | hire_orders (opt-out) | editable |
| hire-order-countersigned | Hire orders | steel | Order countersigned (`generate-hire-orders`) | Producer + artist | hire_orders (opt-out) | **editable (gap closed)** |
| org-invitation | Accounts & access | violet | Admin invites someone (`create-invitation`) | The invitee | critical (always) | **editable (gap closed)** |
| account-email-changed | Accounts & access | steel | A user's email is changed (`platform-manage-user`) | The user (security) | critical (always) | **editable (gap closed)** |
| password reset | Accounts & access | — | User requests a reset | The user | critical (always) | **External (Supabase, not editable)** |
| cron-health-alert | System | — | A scheduled job fails (`cron-health-watcher`) | Super-admins | internal | **Internal (not editable)** |
| ~~signup-decision~~ | — | — | never sent | — | — | **DELETE (orphan)** |
| ~~new-signup-admin-notification~~ | — | — | never sent | — | — | **DELETE (orphan)** |

## 17. Appendix — visual references
- `assets/2026-08-07-email-templates/01-design-directions.html` — the three email directions; **B** is the chosen target.
- `assets/2026-08-07-email-templates/02-coverage-surface.html` — the Settings coverage registry.
- `assets/2026-08-07-email-templates/03-editor.html` — the reused three-pane editor.
