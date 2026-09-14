# Workspace type (org_kind), PR 3: presentation and server. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the workspace-type feature so a `staffing` org reads and receives staffing content everywhere the words alone are not enough. Two halves: R5 (client presentation differences: understudy controls hidden, page-mini and help variants, staffing sample text, role-intro nouns) and R6 (server-generated content: transactional emails and hire-order PDFs render the org's vocabulary). Plus the admin preview toggle, the "what does workspace type change" help answer, the changelog entry, and the version bump. After this PR the feature is fully live for staffing orgs; production orgs still render byte-identically to today.

**Architecture:** PR 1 installed the mechanism (`org_kind` column, `set_org_kind` RPC, `src/lib/orgKind.ts` registry mirrored to the edge, `useOrgKind()`, `VocabularyBridge`, `OrgKindSelect`, the four pickers). PR 2 converted the client locale files, glossary, minis and help copy to `{{noun}}` variables, and made `termLabel`/`roleLabel` kind-aware. This PR adds the pieces that variables alone cannot express:

1. **R6 server (do first).** `resolveEmailCopy` and `resolveHireOrderCopy` gain a `kind` parameter and run `interpolateVocabulary` over the resolved copy record. The two copy maps (`emailCopy.ts`, `pdfCopy.ts`, both file-mode mirror sources under `src/`) get their domain nouns rewritten as `{{noun}}` variables. `kind` threads through `resolveTemplatePresentation` + `send-transactional-email`, and through the issue/preview render sites in `generate-hire-orders`. `preview-transactional-email` accepts an explicit `body.kind` for admin QA.
2. **R5 presentation.** A single gate, `useOrgKind() === 'staffing'`, hides understudy controls. `MiniDef` and `HelpItem` gain an optional `byKind` for the few places a structurally different variant is needed. Sample text and role-intro nouns follow the vocabulary.

**Tech Stack:** React 18, TypeScript, react-i18next 15 / i18next 23, @tanstack/react-query 5, Supabase (Deno edge functions, `@react-pdf`/react-email renderers), Vitest, Playwright. No migration and no schema change (the column, RPC and resolver all shipped in PR 1).

**Spec:** `docs/superpowers/specs/2026-09-14-org-kind-workspace-type-design.md` (R5, R6, plus the changelog and help answer from the Delivery section). PR 1 and PR 2 are merged (`#373`). This plan carries four deliberate deviations from the spec, all of which are written back into the spec in the final task. Read the "Open decisions and spec deviations" section before starting: two of them narrow scope and want a one-line owner confirmation at the Task 0 gate.

---

## Global Constraints

- Never hand-edit a file or block stamped GENERATED. The sources that matter here: `src/lib/orgKind.ts` (block, mirrored to `supabase/functions/_shared/orgKind.ts`), `src/lib/emailTemplates/emailCopy.ts` (whole file, mirrored to `supabase/functions/_shared/transactional-email-templates/_shell/emailCopy.ts`), `src/lib/hireOrders/pdf/pdfCopy.ts` and `src/lib/hireOrders/pdf/render.tsx` (whole files, mirrored under `supabase/functions/_shared/hire-order-pdf/`), `src/config/app.config.ts` (ROLE LABELS block, mirrored to `_shared/roles.ts`). After editing a source: `npm run sync:mirrors`, then `npm run sync:mirrors:check`.
- **Production orgs render byte-identically.** Every default resolver call (no `kind`, or `kind = 'production'`) must produce the exact string it produces today, because the production vocabulary words equal the hardcoded English/German nouns. This is the acceptance bar for R6 and is guarded by the byte-identity tests each task adds.
- Copy rules: no em or en dashes, no exclamation marks, no emoji. German is Du-form. `copyLint.conventions.test.ts`, `keyParity.test.ts`, `translationCompleteness.test.ts`, and the noun gate `vocabularyLint.test.ts` enforce. English and German land in the same commit. New capitalised `{{Token}}`s must be real `VocabKey`s (the lint checks this across `src/**`).
- `any` is banned. Cast Supabase rows once at the query boundary with an explicit row interface. Tests use `src/test/supabaseFake.ts`, `src/test/renderWithProviders.tsx`, `supabase/functions/_shared/testing.ts`. Never `vi.mock('@/integrations/supabase/client')`.
- UI rules: `docs/ui-conventions.md`. Reuse `src/components/ui` primitives, no raw values, 13px controls, uppercase only via `<Eyebrow>`.
- Commit messages: imperative, lowercase, at most 72 chars, ending with the Co-Authored-By Claude trailer this repo uses on the earlier org_kind PRs.
- Branch: `claude/pr-3-plan-k27wnp` (this session's designated branch). Do not push or open the PR until the final task says so.
- The `producer` role literal is never renamed or compared against a display label.

---

## Open decisions and spec deviations

The four surface maps done for this plan turned up four gaps between the spec's wording and the current tree. Each is resolved below with a recommendation; the two marked **CONFIRM** want a yes or no from the owner at the Task 0 gate before their task starts.

1. **R5.4 sample data is orphaned. CONFIRM (recommend: drop from PR 3).** The spec names a `SamplePreview` component and a "Get running preview". Neither exists. The only fixture is `SAMPLE_PREVIEW` in `src/lib/dashboard/firstRun.ts`, and nothing in `src/**` imports it (it and its sibling first-run exports are dead code). The Get running board is fully i18n-driven and PR 2 already converted its nouns. So there is no live render site for staffing sample text. Recommendation: do not build staffing fixtures for dead code. Task 10 is written as a small, optional "make the orphaned fixture kind-neutral through the vocabulary if the owner still wants it" and is skipped by default. If the owner has a first-run rewire coming, we do it in that project, not here.

2. **R5.2 minis: only the `bookings` mini exists. CONFIRM scope.** The spec's "first pass: Get running, Today, Dates minis" is inaccurate: there is no Get running mini and no Today (Dashboard) mini. All existing minis already interpolate `{{noun}}` vocabulary, so the noun swap already works for staffing today. The only thing variables cannot do is show a structurally different mini. The single mini with genuinely production-specific structure is `productions` (its illustration and one step name understudies and slots). Recommendation: add an optional `byKind` to `MiniDef` (Task 8) and use it only where a structural difference is real, starting with `productions`. Do not invent Get running / Today minis in this PR.

3. **R5.5 `roleDescription` has no render site.** `roleLabel` and `termLabel` are already kind-aware (PR 2). `ROLE_DESCRIPTIONS` / `roleDescription` in `app.config.ts` still hardcode production nouns, but the doc comment marks their consumers as "planned, not yet built", and grep confirms no `.tsx` renders `roleDescription`. Recommendation: make `roleDescription(role, kind)` kind-aware for completeness and correctness (cheap, keeps the mirror honest), but treat the real R5.5 work as the `org-invitation` email nouns, which fold into R6 (Task 1). No new render site is created here.

4. **R6 PDF token collision. No decision needed, but it drives Task 2.** In `pdfCopy.ts` the runtime data tokens `{{cast}}` (the billing cast reference) and `{{artist}}` (the person's name) collide with the vocabulary keys `cast` and `artist`. A naive `interpolateVocabulary` pass would replace them with "team" / "staff member" before `applyTokens` injects the real values. Resolution (Task 2): rename those runtime tokens in `pdfCopy.ts` and `render.tsx` to non-colliding names (`{{castRef}}`, `{{artistName}}`), exactly as PR 2 renamed the colliding runtime variables on the client side, then the domain-noun prose becomes `{{Cast}}` / `{{Artist}}` vocabulary tokens. `{{role}}` does not collide (`role` is not a vocab key) and is left alone.

---

## Vocabulary reference

The tables live in `src/lib/orgKind.ts` (`VOCABULARY`, four forms per noun plus `roleProducer` and `kind`). The nouns this PR substitutes on the server: `show(s)`/`Show(s)`, `showDate(s)`/`ShowDate(s)`, `artist(s)`/`Artist(s)`, `production(s)`/`Production(s)`, `cast(s)`/`Cast(s)`, `understudy`/`understudies`/`Understudy`/`Understudies`, `skill(s)`/`Skill(s)`, `hireOrder(s)`/`HireOrder(s)`, `roleProducer`. `interpolateVocabulary(text, vocab)` (same file) replaces `{{name}}` when `name` is a vocab key and leaves every other `{{...}}` verbatim. `resolveOrgKind(admin, orgId)` (edge, below the mirror block) reads `organizations.org_kind` and falls back to `production` on null org or read error.

---

## Task 0: Visual approval gate

The owner's standing rule: mock up user-facing changes and get explicit approval before implementing them. PR 1 gated its two pickers this way. This PR's user-facing changes are the understudy-hidden surfaces (R5.1) and the email preview toggle (Task 5). Confirm decisions 1 and 2 here too.

**Files:**
- Create (scratch, not committed): `<scratchpad>/org-kind-pr3-mockup.html`

- [ ] **Step 1: Build a static HTML mockup** with three panels, using the app look (Geist, 13px controls, muted helper text, rounded cards):
  - Panel A: the show-date cockpit Cast tab for a staffing org, showing only a "Team" group and no "Standbys" group, no "Book as standby" checkbox, and the cancel dialog with no auto-promote line. Beside it, the same tab for a production org (unchanged) so the difference is visible.
  - Panel B: the Settings, Email templates editor header showing the existing EN/DE toggle plus the new Workspace type toggle (Live production / Staffing agency), and a preview body where "Cirque Lumiere plans its productions and books the artists" becomes "... plans its clients and books the people".
  - Panel C: a one-line note listing the confirm items (decision 1: drop dead sample data; decision 2: minis scoped to `productions` only).

- [ ] **Step 2: Publish it as an Artifact** (title "Workspace type staffing view", favicon "🏷️") and send the owner: "PR 3 presentation for approval: staffing cockpit (understudy controls hidden) and the email preview toggle. Also two scope confirms in Panel C: drop the orphaned sample-data task, and scope minis to the productions mini only. Yes, or changes?"

- [ ] **Step 3: STOP.** Do not start Task 1 until the owner answers. Record any wording or scope changes and apply them to the affected tasks. If the owner rejects decision 1 or 2, expand Task 10 / Task 8 accordingly before continuing.

---

## Task 1: Email copy: `resolveEmailCopy(kind)` + vocabulary in `emailCopy.ts`

**Files:**
- Modify: `src/lib/emailTemplates/emailCopy.ts` (source of the file-mode mirror; rewrite domain nouns in `EMAIL_COPY_DEFAULTS` and `EMAIL_COPY_DE` as `{{noun}}` variables; add `kind` to `resolveEmailCopy`)
- Modify (regenerate, do not hand-edit): `supabase/functions/_shared/transactional-email-templates/_shell/emailCopy.ts`
- Create: `src/lib/emailTemplates/emailCopy.orgKind.test.ts`

**Interfaces:**
- Produces: `resolveEmailCopy(override?, locale = 'en', kind: OrgKind = 'production'): EmailCopy`. Under `kind = 'production'` every returned string is byte-identical to today.

- [ ] **Step 1: Write the failing byte-identity + substitution test.** Import `resolveEmailCopy`, `EMAIL_COPY_DEFAULTS`, `EMAIL_COPY_DE`. Assert (a) `resolveEmailCopy(undefined, 'en')` deep-equals the pre-change English record captured from `origin/main` (snapshot the noun-bearing keys the audit will touch: `org-invitation.productIntro`, `.roleIntroAdmin`, `.roleIntroProducer`, `.roleIntroArtist`, `.roleIntroArtistOffers`, and any offer/confirmation/hire-order keys that name a domain noun); (b) `resolveEmailCopy(undefined, 'en', 'staffing')['org-invitation.productIntro']` contains "clients" and "people" and not "productions"/"artists"; (c) an admin-authored override that contains no variable is returned verbatim; (d) an override that itself contains `{{Show}}` is substituted.

- [ ] **Step 2: Run to verify it fails.** `npx vitest run src/lib/emailTemplates/emailCopy.orgKind.test.ts` (fails: `resolveEmailCopy` has arity 2, no substitution).

- [ ] **Step 3: Rewrite the noun-bearing defaults as variables.** In `emailCopy.ts`, for every English key in `EMAIL_COPY_DEFAULTS` and its German twin in `EMAIL_COPY_DE` that names a domain noun, replace the literal noun with the matching `{{vocab}}` token (e.g. `"ShowFlow is where {{orgName}} plans its productions and books the artists for them."` becomes `"... plans its {{productions}} and books the {{artists}} for them."`; the German follows with `{{productions}}`/`{{artists}}` too). Leave runtime tokens (`{{orgName}}`, `{{role}}`, `{{ctaUrl}}`, dates, counts) untouched. Do not touch kind-neutral keys (heading, greeting, ctaLabel, expiry). Use the noun gate rules: capitalised sentence-start nouns take the capital form. This is a mechanical pass over `emailCopy.ts` only.

- [ ] **Step 4: Add the `kind` parameter and substitution.** Change the signature to `resolveEmailCopy(override?, locale = 'en', kind: OrgKind = 'production')`. Import `type OrgKind`, `VOCABULARY`, `interpolateVocabulary` from `../../lib/orgKind` on the `src/` side (the mirror copies the file verbatim, so use a path that the generator rewrites; follow the pattern the generator already uses for other mirrored files, and if the edge target cannot resolve the import, pass the resolved `Vocabulary` table in as the third argument instead of `kind` and have the caller import it. Verify against `sync:mirrors:check`). After the existing override-layering loop, before `return resolved`, map every value through `interpolateVocabulary(value, VOCABULARY[kind][locale])`. Because production/en vocab words equal the hardcoded nouns, `kind = 'production'` is a no-op on the rewritten defaults, preserving byte-identity.

  Note on the import constraint: `emailCopy.ts` is a whole-file mirror. If importing `VOCABULARY` into it breaks the edge build (the target lives under `supabase/functions/` and cannot import from `src/`), the fallback the spec anticipates is to make the resolver take an already-resolved `vocab: Vocabulary` object (the caller in `registry.ts` imports `VOCABULARY` from the edge `_shared/orgKind.ts` and passes `VOCABULARY[kind][locale]`). Decide by running `sync:mirrors:check` and `deno check` in Step 6; prefer the `kind`-param shape if it resolves, else the `vocab`-param shape. Keep the same shape in Task 2 for consistency.

- [ ] **Step 5: Regenerate the mirror.** `npm run sync:mirrors && npm run sync:mirrors:check`.

- [ ] **Step 6: Run tests + typecheck + edge check.** `npx vitest run src/lib/emailTemplates && npx tsc -p tsconfig.app.json --noEmit && deno check --node-modules-dir=none supabase/functions/_shared/transactional-email-templates/_shell/emailCopy.ts`. Expected: PASS, byte-identity holds.

- [ ] **Step 7: Commit.** `git add src/lib/emailTemplates supabase/functions/_shared/transactional-email-templates/_shell/emailCopy.ts` and commit `thread org_kind vocabulary into email copy resolver`.

---

## Task 2: PDF copy: `resolveHireOrderCopy(kind)` + token disambiguation

**Files:**
- Modify: `src/lib/hireOrders/pdf/pdfCopy.ts` (rename colliding runtime tokens; rewrite nouns as variables; add `kind`)
- Modify: `src/lib/hireOrders/pdf/render.tsx` (rename the runtime-token keys in the `applyTokens` value map to match)
- Modify (regenerate): `supabase/functions/_shared/hire-order-pdf/pdfCopy.ts`, `.../render.tsx`
- Create: `src/lib/hireOrders/pdf/pdfCopy.orgKind.test.ts`

**Interfaces:**
- Produces: `resolveHireOrderCopy(overrides?, locale = 'en', kind: OrgKind = 'production'): HireOrderCopy`. Byte-identical under `kind = 'production'` after the runtime-token rename is accounted for.

- [ ] **Step 1: Write the failing tests.** (a) byte-identity of `resolveHireOrderCopy(undefined, 'en')` against a snapshot of the post-rename English record (see Step 3, the rename changes the token names, so the snapshot is taken after Step 3 is defined but the assertion pins the rendered output through `applyTokens` to be unchanged: better, assert the fully rendered strings from a fixed value map are identical before and after); (b) `resolveHireOrderCopy(undefined, 'en', 'staffing').party_cast_reference` reads "Team reference:" not "Cast reference:"; (c) a value carrying `{{castRef}}` is left verbatim by the vocab pass (it is not a vocab key) and later filled by `applyTokens`.

- [ ] **Step 2: Run to verify it fails.** `npx vitest run src/lib/hireOrders/pdf/pdfCopy.orgKind.test.ts`.

- [ ] **Step 3: Disambiguate the colliding runtime tokens.** In `pdfCopy.ts`, rename the runtime data tokens that collide with vocab keys: `{{cast}}` becomes `{{castRef}}` and `{{artist}}` becomes `{{artistName}}` in `billing_role_and_cast`, `billing_cast_only`, `party_cast_reference`, `signature_for_artist` (both EN and DE). `{{role}}` stays. In `render.tsx`, rename the corresponding keys in the value object passed to `applyTokens` (grep the sites the map lists: cast at render.tsx around 415/417/468, artist at 598) so the real values still land. Do NOT rename `{{role}}`.

- [ ] **Step 4: Rewrite the domain-noun prose as vocabulary.** Now that the runtime tokens are distinct, replace the literal domain nouns in the copy defaults with `{{vocab}}` tokens: `"Cast reference: {{castRef}}"` becomes `"{{Cast}} reference: {{castRef}}"`; `"The Artist · {{artistName}}"` becomes `"The {{Artist}} · {{artistName}}"`; and every other `HIRE_ORDER_COPY_DEFAULTS` / `HIRE_ORDER_COPY_DE` value that names a domain noun (contract/hire order, artist, show, production, cast) takes the matching token. Middots and other punctuation are unchanged (they are not dashes).

- [ ] **Step 5: Add the `kind` parameter and substitution.** Same shape decided in Task 1 Step 4 (`kind` param preferred, `vocab` param fallback). After the override layering, map each value through `interpolateVocabulary(value, VOCABULARY[kind][locale])` before returning. Production is a no-op.

- [ ] **Step 6: Regenerate mirrors.** `npm run sync:mirrors && npm run sync:mirrors:check`.

- [ ] **Step 7: Run tests + typecheck + edge check + render test.** `npx vitest run src/lib/hireOrders && npx tsc -p tsconfig.app.json --noEmit && deno check --node-modules-dir=none supabase/functions/_shared/hire-order-pdf/render.tsx && deno test --allow-all --node-modules-dir=none supabase/functions/_shared/hire-order-pdf/`. Expected: PASS, the render test's output unchanged for production.

- [ ] **Step 8: Commit.** `git add src/lib/hireOrders/pdf supabase/functions/_shared/hire-order-pdf` and commit `thread org_kind vocabulary into hire-order pdf copy`.

---

## Task 3: Thread kind through `resolveTemplatePresentation` and `send-transactional-email`

**Files:**
- Modify: `supabase/functions/_shared/transactional-email-templates/registry.ts` (`TemplatePresentationOptions`, the `resolveEmailCopy` call at ~:196)
- Modify: `supabase/functions/send-transactional-email/index.ts` (resolve kind beside locale at ~:272, thread into the options at ~:273)
- Modify: `supabase/functions/send-transactional-email/index.di.test.ts` (append a staffing-render test)

**Interfaces:**
- Consumes: `resolveOrgKind` from `../_shared/orgKind.ts`.
- Produces: `TemplatePresentationOptions.kind?: OrgKind`; `resolveTemplatePresentation` passes it to `resolveEmailCopy`; `send-transactional-email` resolves it from `org_id` and sends staffing copy to staffing orgs.

- [ ] **Step 1: Write the failing DI test.** Seed `makeFakeDeps` with an `organizations` row `{ id: 'org1', org_kind: 'staffing' }` and a template that renders `org-invitation.productIntro`. Invoke `handle` with `body.org_id = 'org1'` and assert the rendered HTML (or the resolved copy captured via a spy on `deps.sendEmail`) contains "clients" and "people", not "productions"/"artists". Add a second test with `org_kind` absent (null org) asserting production words, proving the fallback.

- [ ] **Step 2: Run to verify it fails.** `deno test --allow-all --node-modules-dir=none supabase/functions/send-transactional-email/`.

- [ ] **Step 3: Implement.** In `registry.ts`, add `kind?: OrgKind` to `TemplatePresentationOptions` (import the type from `../orgKind.ts`), and change the `resolveEmailCopy(options.copyOverride, options.locale)` call to pass the kind (or the resolved `VOCABULARY[options.kind ?? 'production'][options.locale]` table, matching Task 1's shape). In `send-transactional-email/index.ts`, import `resolveOrgKind` from `../_shared/orgKind.ts`, and right after `const locale = await resolveOrgLocale(admin, orgId, localeOverride)` add `const kind = await resolveOrgKind(admin, orgId)`, then pass `kind` into the `resolveTemplatePresentation(...)` options object. Do not add an entitlement gate: workspace type is not a paid module.

- [ ] **Step 4: Run tests + edge check.** `deno test --allow-all --node-modules-dir=none supabase/functions/send-transactional-email/ supabase/functions/_shared/transactional-email-templates/ && deno check --node-modules-dir=none supabase/functions/send-transactional-email/index.ts`. Expected: PASS, and the existing presentation/locale tests still green (production default unchanged).

- [ ] **Step 5: Commit.** `git add supabase/functions/send-transactional-email supabase/functions/_shared/transactional-email-templates/registry.ts` and commit `resolve org_kind when sending transactional email`.

---

## Task 4: Thread kind through `generate-hire-orders` issue and preview

**Files:**
- Modify: `supabase/functions/generate-hire-orders/index.ts` (issue site ~:1890, preview site ~:2453; leave the two snapshot re-render sites ~:2786/:2811 unchanged, see below)
- Modify: `supabase/functions/generate-hire-orders/index.di.test.ts` (append issue + preview staffing tests)

**Interfaces:**
- Consumes: `resolveOrgKind`.
- Produces: issued PDFs render the org's vocabulary and freeze the substituted copy into `issue_snapshot`; preview uses the live kind; re-render from a snapshot reproduces the frozen words.

- [ ] **Step 1: Write the failing tests.** Issue: seed an `organizations` row `org_kind: 'staffing'`, run the `issue` action for a date with a confirmed booking, and assert the copy passed to `deps.renderHireOrderPdf` (spy) has `party_cast_reference` starting "Team reference:", and that the `issue_snapshot.copy` written to `hire_orders` carries the substituted (staffing) strings. Preview: run `preview` for a staffing org and assert the rendered copy is staffing. Add a production control asserting byte-identical copy.

- [ ] **Step 2: Run to verify it fails.** `deno test --allow-all --node-modules-dir=none supabase/functions/generate-hire-orders/`.

- [ ] **Step 3: Implement.** Import `resolveOrgKind`. At the issue site, after `const locale = await resolveOrgLocale(admin, org)`, add `const kind = await resolveOrgKind(admin, org)` and pass it into `resolveHireOrderCopy(copyOverride, locale, kind)`. Do the same at the preview site (`resolveHireOrderCopy({ ...storedCopy, ...(body.copy_override ?? {}) }, locale, kind)`), matching the comment that preview uses live locale/kind. **Leave the two snapshot re-render calls (`resolveHireOrderCopy(snapshot.copy)` at ~:2786 and `resolveHireOrderCopy(storedCopy)` at ~:2811) on the production default.** The snapshot copy was already vocabulary-substituted at issue time, so it contains no remaining `{{vocab}}` tokens; a default-production second pass finds nothing to replace and is a safe no-op. Add a comment at each re-render site stating this so a future reader does not "fix" it by threading kind (which would be wrong: copy freezes at issue).

- [ ] **Step 4: Confirm the snapshot no-op with a test.** Add a test that issues under staffing, then re-renders from the written snapshot (the sign/countersign path) and asserts the copy is still staffing (frozen), proving the re-render neither reverts to production nor double-substitutes.

- [ ] **Step 5: Run tests + edge check.** `deno test --allow-all --node-modules-dir=none supabase/functions/generate-hire-orders/ && deno check --node-modules-dir=none supabase/functions/generate-hire-orders/index.ts`.

- [ ] **Step 6: Commit.** `git add supabase/functions/generate-hire-orders` and commit `resolve org_kind at hire-order issue and preview`.

---

## Task 5: `preview-transactional-email` accepts `body.kind`

**Files:**
- Modify: `supabase/functions/preview-transactional-email/index.ts` (parse `body.kind` ~:49, thread into `resolveTemplatePresentation` ~:104)
- Modify: `supabase/functions/preview-transactional-email/index.di.test.ts`

**Interfaces:**
- Produces: request body gains optional `kind` (`'production' | 'staffing'`, default production via `coerceOrgKind`); admin QA sees either vocabulary without changing the org.

- [ ] **Step 1: Write the failing test.** POST with `body.kind = 'staffing'` and assert the previewed copy is staffing; POST with no kind and assert production. Unknown value coerces to production.

- [ ] **Step 2: Run to verify it fails.** `deno test --allow-all --node-modules-dir=none supabase/functions/preview-transactional-email/`.

- [ ] **Step 3: Implement.** Import `coerceOrgKind`. Beside `const locale = coerceLocale(body.locale)` add `const kind = coerceOrgKind(body.kind)`, and pass `kind` into the `resolveTemplatePresentation(name, previewData, { ..., locale })` options. Auth is unchanged (`requireRole ['admin','producer']`).

- [ ] **Step 4: Run + edge check + commit.** `deno test ...preview-transactional-email/ && deno check ...index.ts`; `git add supabase/functions/preview-transactional-email` and commit `accept explicit kind in email preview`.

---

## Task 6: Email Templates editor: Workspace type preview toggle

**Files:**
- Modify: the Email Templates editor page (`src/pages/EmailTemplateEditorPage.tsx`) and/or its preview panel under `src/components/settings/emailTemplates/`
- Modify: `src/data/emailTemplates.ts` (the preview data-access that calls `preview-transactional-email`) to forward `kind`
- Modify/create: the editor's test alongside it

**Interfaces:**
- Produces: a two-option toggle beside the existing EN/DE toggle, defaulting to the current org's kind (`useOrgKind()`), that re-requests the preview with `kind` so an admin can see staffing wording without switching the org.

- [ ] **Step 1: Write the failing test.** Render the editor preview with a mocked preview fetch; assert the Workspace type toggle exists, defaults to the org's kind, and that flipping it re-invokes the preview data-access with `kind: 'staffing'`.

- [ ] **Step 2: Run to verify it fails.** `npx vitest run src/pages/EmailTemplateEditorPage.test.tsx` (or the preview component's test).

- [ ] **Step 3: Implement.** Add local state `previewKind` initialised from `useOrgKind()`. Render an `OrgKindSelect` or a two-button segmented control (reuse the existing EN/DE toggle's primitive for visual parity) labelled with the `settings:organization.kind.label` key added in PR 1. Thread `previewKind` through the preview fetch (the `src/data/emailTemplates.ts` function passes it as `kind` in the `preview-transactional-email` body). Copy for the toggle is Platform/Settings English-and-German via the existing settings namespace; add no new hardcoded strings, reuse `ORG_KIND_LABELS` for the option titles.

- [ ] **Step 4: Run + lint + commit.** `npx vitest run src/pages/EmailTemplateEditorPage.test.tsx && npx eslint <changed files> --max-warnings 0`; `git add ...` and commit `add workspace type toggle to email template preview`.

---

## Task 7: Hide understudy controls for staffing (R5.1)

The full inventory (ten controls, none currently reading `useOrgKind`) is in the map below. The gate is a single expression, `useOrgKind() === 'staffing'`, surfaced as a tiny helper so the intent reads the same everywhere and the pure/lib layers can be tested without a hook.

**Files:**
- Create: `src/lib/orgKindPresentation.ts` (pure: `showsUnderstudies(kind: OrgKind): boolean` returning `kind !== 'staffing'`, plus a doc comment naming what is hidden and why the data is untouched) and `src/lib/orgKindPresentation.test.ts`
- Create: `src/hooks/useShowsUnderstudies.ts` (thin: `useShowsUnderstudies() => showsUnderstudies(useOrgKind())`) and its test
- Modify (add the gate, keep production rendering identical):
  1. `src/components/catalog/CastingBreakdownFields.tsx` (main/understudy toggle + understudy total)
  2. `src/components/bookings/setup/SlotsStep.tsx` ("u/s" slot input)
  3. `src/pages/ProductionsPage.tsx` + `src/features/editor/columnRegistries.ts` (the `understudy_slots` column and the combined slots cell)
  4. `src/lib/cockpitCast.ts` + `src/components/shows/date/CockpitCastList.tsx` (the "Understudies" cast group)
  5. `src/components/shows/ShowDateDetailSheet.tsx` (the "Understudies" section in `AssignedArtistsCard`)
  6. `src/components/shows/date/EligibilityBookList.tsx` ("Book as understudy" checkbox + confirm copy)
  7. `src/components/calendar/surface/NeedsYouLens.tsx` (the "(US)" pill) + `src/components/calendar/surface/CalendarSurface.tsx` / `src/lib/bookingCockpit.ts` (the "understudy parts open" peek)
  8. `src/components/settings/bookingFlow/FlowTimeline.tsx` (the "Understudy promotion" switch)
  9. `src/lib/bookings/actionCopy.ts` (the cancel-dialog auto-promote line, already gated on `understudyPromotionEnabled`; also gate on kind)
  10. decorative minis in `src/components/minis/illustrations/BookingsMini.tsx` / `ProductionsMini.tsx` (fold into Task 8, not here)
- Modify the co-located test of each surface.

**Interfaces:**
- Produces: `showsUnderstudies(kind)` and `useShowsUnderstudies()`. Every surface renders unchanged for production; for staffing the understudy control is not rendered. `is_understudy`, the auto-promote trigger, and stored understudy rows are untouched, so switching back to production shows the data again.

- [ ] **Step 1: Write the pure + hook tests first.** `showsUnderstudies('production') === true`, `showsUnderstudies('staffing') === false`. Hook test: staffing org gives `false`, no org gives `true`.

- [ ] **Step 2: Implement the helper and hook.** Keep them tiny and documented.

- [ ] **Step 3: For each of surfaces 1 to 9, write a failing render test then gate it.** Pattern per surface: render under a staffing org (`authOverrides: { currentOrg: { ...org, org_kind: 'staffing' } }`) and assert the understudy control is absent; render under production and assert it is present (regression guard). Then wrap the control in `showsUnderstudies` / `useShowsUnderstudies()`. For `cockpitCast.ts` (pure), pass kind in and stop building the "Understudies" group when hidden. For the booking-flow "Understudy promotion" switch, hide the timeline step for staffing but leave the stored `understudy_promotion` flag untouched (the promote trigger still runs if data exists; it simply has no standby rows to promote). Keep each surface a separate commit so a regression is easy to bisect.

- [ ] **Step 4: Confirm no data path changed.** Grep the diff for any change to `is_understudy` writes, the promote RPC, or the DB. There must be none. Add or keep a test asserting that a staffing org with an existing understudy row still stores and reads it (data preserved, just not shown).

- [ ] **Step 5: Run the affected suites + lint + typecheck.** `npx vitest run src/components/shows src/components/bookings src/components/catalog src/components/calendar src/components/settings/bookingFlow src/lib && npx eslint <changed> --max-warnings 0 && npx tsc -p tsconfig.app.json --noEmit`.

- [ ] **Step 6: Commit each surface** with an imperative message, e.g. `hide understudy cast group for staffing orgs`.

---

## Task 8: Page-mini `byKind` variant (R5.2)

Scoped per decision 2 to the `productions` mini (the only structurally production-specific one) plus the decorative understudy labels in the two illustration files.

**Files:**
- Modify: `src/lib/minis/types.ts` (add optional `byKind?: Partial<Record<OrgKind, MiniSteps>>` to `MiniDef`, or a per-variant override; pick the shape the test in Step 1 pins)
- Modify: `src/lib/minis/resolveMiniRole.ts` or the `PageMini` resolution path to pick the kind variant when present (the cleanest place is `PageMini.tsx`, which already knows the vocab/kind; `resolveMiniRole` stays role-only)
- Modify: `src/lib/minis/pages/productions.ts` (add a staffing variant only where the shared vocabulary tokens are not enough, e.g. the understudy/slots step)
- Modify: `src/components/minis/illustrations/ProductionsMini.tsx`, `BookingsMini.tsx` (the hardcoded "Understudy" / "understudy" decorative labels become a `{{Understudy}}` token or are hidden for staffing via the vocab/kind the mini already receives)
- Modify: `src/lib/minis/minis.test.ts` (extend to cover the `byKind` structure: same 4-step / bilingual / non-verbatim checks for any kind variant), and `src/components/minis/PageMini.test.tsx` (assert `productions` under staffing renders the staffing variant)

**Interfaces:**
- Produces: `MiniDef.byKind`; `PageMini` renders the `staffing` steps for a staffing org when present, else the shared steps (which already interpolate vocabulary). Production is unchanged.

- [ ] **Step 1: Write the failing tests.** Add a `byKind` to a fixture MiniDef in the mini test and assert the resolver returns the staffing steps for a staffing kind and the shared steps otherwise. In `PageMini.test.tsx`, assert `productions` under `VOCABULARY.staffing.en` renders the staffing wording (extend the existing staffing assertion pattern).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement the type + resolution + the one variant.** Keep the shared steps as the production/default path (so the byte-identity for production holds). Add the staffing variant to `productions` only. The illustration labels use the mini's existing vocab (they already receive it via `PageMiniView`) or hide the understudy field for staffing.

- [ ] **Step 4: Run mini + copy gates.** `npx vitest run src/lib/minis src/components/minis src/i18n/vocabularyLint.test.ts`. The noun gate must stay green (any literal noun in the illustration files fails it, so use tokens).

- [ ] **Step 5: Commit.** `add per-workspace-type page mini variant`.

---

## Task 9: Help center `byKind` + the "workspace type" answer (R5.3)

**Files:**
- Modify: `src/lib/help/types.ts` (add optional `aByKind?: Partial<Record<OrgKind, Record<Lang, string>>>` to `HelpItem`, an alternate answer; question stays shared since the nouns already interpolate)
- Modify: `src/components/help/HelpItemRow.tsx` (when `aByKind[kind]` exists, render it through `interpolateVocabulary` instead of `item.a`; `HelpPage` already knows `orgKind`)
- Modify: `src/lib/help/items.ts` (add the alternate staffing answer to the ~5 understudy/cast/show items identified: `A3.1`, `P3.4`, `P4.3`, `R5.2`, `A0.1`; add ONE new item for all roles, "What does workspace type change", EN + DE Du; bump the item-count assertion)
- Modify: `src/lib/help/items.test.ts` (the exact-count assertion, currently 86, becomes 86 + N; the dash gate covers the new copy; assert any `aByKind` copy is bilingual and dash-free)

**Interfaces:**
- Produces: help answers that read genuinely differently for staffing where the noun swap is not enough (understudy promotion, cast mental model), and a new cross-role answer explaining workspace type.

- [ ] **Step 1: Write the failing tests.** Assert the new item id(s) exist and are bilingual/dash-free; assert the count matches the new total; assert `HelpItemRow` renders `aByKind.staffing` for a staffing org on an item that has one, and the shared `item.a` otherwise.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.** Add `aByKind` to the type and the render path. Write the staffing alternates for the five items (concept-level rewordings, not just noun swaps: e.g. R5.2 "I was promoted from standby" explains the standby-to-team move for staffing). Add the new answer(s): decide with the owner whether it is one shared item or one per role; default to one shared admin-stage item plus surfacing it to producers/artists via role duplication only if the help model requires a role per item (the test's role-completeness rule will tell you). Keep the A3.13 to A3.17 get-running deep-link ids intact.

- [ ] **Step 4: Run help + copy gates.** `npx vitest run src/lib/help src/components/help src/i18n/vocabularyLint.test.ts`.

- [ ] **Step 5: Commit.** `add staffing help answers and workspace-type explainer`.

---

## Task 10: Sample data (R5.4). SKIPPED by default (decision 1)

Do this task only if the owner rejected decision 1 at Task 0. `SAMPLE_PREVIEW` in `src/lib/dashboard/firstRun.ts` is orphaned (no importer). If kept:

- [ ] Make `SAMPLE_PREVIEW` a function of `kind` (or two records keyed by kind), with staffing names (a client project, shifts, staff names) and vocabulary nouns, and wire it wherever the owner points to a live render site. If there is still no render site, do not add one in this PR. Otherwise skip and note "R5.4 deferred: no live sample-preview render site" in the final task's spec update.

---

## Task 11: Kind-aware `roleDescription` (R5.5 client remainder)

**Files:**
- Modify: `src/config/app.config.ts` (inside the ROLE LABELS mirror block: `ROLE_DESCRIPTIONS` nouns become vocabulary lookups and `roleDescription(role, kind = DEFAULT_ORG_KIND)` gains the param, mirroring `roleLabel`)
- Modify (regenerate): `supabase/functions/_shared/roles.ts`
- Modify: `src/config/roleLabel.test.ts` or a new `roleDescription.test.ts`

**Interfaces:**
- Produces: `roleDescription(role, kind)`; production default byte-identical. No new render site (the consumers remain "planned"); this keeps the description honest for when they are built and keeps the edge mirror correct.

- [ ] **Step 1: Write the failing test.** `roleDescription('producer', 'en')` unchanged; `roleDescription('producer', 'staffing')` uses "clients"/"shifts"/"people". (English-only, matching `roleLabel`.)

- [ ] **Step 2: Implement.** Build the descriptions from `VOCABULARY[kind].en` tokens (or keep the English literal for production and substitute for staffing). Regenerate the mirror.

- [ ] **Step 3: Run + sync check + commit.** `npx vitest run src/config && npm run sync:mirrors:check`; commit `make roleDescription workspace-type aware`.

---

## Task 12: Changelog and version bump

Per CLAUDE.md: MINOR bump for a new user-facing feature. Current version `1.17.3` becomes `1.18.0`. The entry is written for admins (no super-admin/platform wording).

**Files:**
- Modify: `package.json` (`version` to `1.18.0`)
- Modify: `src/config/app.config.ts` (`APP_META.VERSION` to `1.18.0`)
- Modify: `public/changelog.md` (newest-first block)
- Regenerate: `public/changelog.json` via `deno run --allow-read --allow-write scripts/changelog-to-json.ts` (never hand-edit the JSON)

- [ ] **Step 1: Add the changelog block** at the top of `public/changelog.md`, following the existing house format exactly (this file is the one place the em-dash heading and bullet form is the mandated convention per CLAUDE.md's versioning section; the no-dash copy rule applies to the i18n locale JSON, not `changelog.md`). Match the shape of the current top entry: an `## 1.18.0 <house-separator> <Mon D, 2026>` heading, a one-line italic theme (`*Say it in your own words*`), and a `### New` section with one bullet in the repo's `- **Title** <house-separator> description` form. Bullet content: Workspace type. Choose Live production or staffing agency in Settings, Organization; the app then uses the words that fit your work (clients and shifts, or productions and dates) across the screens, emails and PDFs; nothing about your data changes and you can switch any time. Copy it in the same punctuation style as the neighbouring entries so the file stays consistent, and do not name any super-admin or platform action.

- [ ] **Step 2: Bump both version places** to `1.18.0`.

- [ ] **Step 3: Regenerate the JSON** and verify it changed.

- [ ] **Step 4: Run the changelog/version tests** if any (`npx vitest run` over the config + any changelog test), lint, commit `bump to 1.18.0 and add workspace type changelog entry`.

---

## Task 13: E2E presentation smoke (extends PR 1's `e2e/org-kind.spec.ts`)

**Files:**
- Modify: `e2e/org-kind.spec.ts`

- [ ] **Step 1: Add a scenario** that, with an org set to staffing, opens a show-date cockpit and asserts no "Standbys" group and no "Book as standby" control render, then switches the org back to production and asserts they return. Keep it one focused scenario; the settings-switch/nav-words scenario from PR 1 already covers vocabulary.

- [ ] **Step 2: Run** `npx playwright test --config=e2e/playwright.config.ts org-kind` against the local stack (`npm run local:up`). Commit `add staffing presentation e2e smoke`.

---

## Task 14: Update the spec, run the full gate, push, open the PR

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-org-kind-workspace-type-design.md` (record the four deviations from "Open decisions" as resolved notes, same way PR 2 wrote its deviations back)
- Modify: `memory.md` (add a Recent changes row and correct the stale `1.15.0` to the current version; note PR 1 to PR 3 landed)

- [ ] **Step 1: Write the deviations into the spec** so the spec and the code agree: R5.2 minis scoped to `productions`; R5.4 sample data deferred (dead code); R5.5 `roleDescription` kind-aware but no render site; the PDF runtime-token rename in R6.

- [ ] **Step 2: Run the full local gate.** `npm run verify:fast` (lint, typecheck, build, unit+coverage, Deno) and, against the local stack, `npm run verify:full` (adds pgTAP + Playwright). Also `npm run sync:mirrors:check` and all three typecheck projects. Everything green.

- [ ] **Step 3: Update `memory.md`.** One Recent-changes row dated today summarising the three-PR org_kind feature completing with PR 3, and fix the stale current-version line.

- [ ] **Step 4: Commit docs**, then push `git push -u origin claude/pr-3-plan-k27wnp` (retry with backoff on network error).

- [ ] **Step 5: Open the PR** ready for review against `main`, titled `workspace type (org_kind), PR 3: presentation and server`. Body: what changed (R5 + R6), the byte-identity guarantee for production orgs, the four deviations, the new version `1.18.0`, and the test coverage table. Note "Help center impact: yes (Task 9)", "Page minis: yes (Task 8)", "System map: no automation change". Then subscribe to the PR's activity and keep it green.

---

## Testing summary

| Layer | What |
|---|---|
| Unit | `resolveEmailCopy`/`resolveHireOrderCopy` byte-identical for production, substituted for staffing; PDF token-rename render identity; `showsUnderstudies` + `useShowsUnderstudies`; each understudy surface hidden for staffing / shown for production; `MiniDef.byKind` resolution + `productions` staffing render; help `aByKind` render + count + dash gate; `roleDescription(role, kind)` |
| Data | email-template preview data-access forwards `kind` |
| Deno | `send-transactional-email` and `generate-hire-orders` (issue, preview, snapshot re-render no-op) render staffing vs production; `preview-transactional-email` honours `body.kind`; production defaults byte-identical |
| E2E | staffing cockpit hides standby controls, production shows them |

Coverage thresholds unchanged. Production orgs render byte-identically at every layer; that is the release gate.
