# Email Templates Coverage, Editor, and Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every live transactional email an accurate Settings registry, one email-safe branded shell, editable org-wide styling, and per-template copy editing without regressing the hire-order PDF editor.

**Architecture:** Pure theme and copy registries live in `src/lib/emailTemplates/` and are mirrored into the Edge runtime. Every live React Email component renders through one edge-only `EmailShell`; sending and previewing share the same resolver. The frontend adds a coverage registry and an editor built from domain-neutral controls extracted from the hire-order editor.

**Tech Stack:** React 18, TypeScript 5, Vite 5, semantic Tailwind v3, shadcn/Radix, TanStack Query v5, Vitest/RTL, Supabase Edge Functions on Deno 2.1, React Email 0.0.22, Supabase migrations.

## Global Constraints

- Follow `CLAUDE.md`, `memory.md`, and `docs/adr/README.md`; tests import real production modules.
- Demonstrate a focused failing test before each production change.
- In-app UI uses semantic tokens only. Email hex values live only in `emailTheme.ts`.
- Email layout uses presentation tables, 600px maximum width, inline critical styles, solid `bgcolor` fallback, and no flexbox, grid, or `backdrop-filter`.
- Keep pinned imports `npm:react@18.3.1` and `npm:@react-email/components@0.0.22`.
- No em or en dashes in UI copy or email defaults. Changelog prose follows the same rule, while its parser-mandated heading and bullet delimiters remain em dashes.
- The browser never imports React Email; previews call `preview-transactional-email`.
- Never hand-edit mirror targets. Run `npm run sync:mirrors`.
- Create SQL with `supabase migration new email_template_capability`; never apply it to production.
- Preserve send service-role auth, fail-closed suppression/logging, preferences, attachments, and idempotency.
- Password reset stays external and non-editable. `cron-health-alert` stays internal and non-editable.

---

### Task 1: Pure Email Theme, Copy, and Metadata Registries

**Files:**
- Create: `src/lib/emailTemplates/emailTheme.ts`, `emailTheme.test.ts`, `emailCopy.ts`, `emailCopy.test.ts`, `emailTemplateMeta.ts`
- Modify: `scripts/mirrors.manifest.json`
- Generate: `supabase/functions/_shared/transactional-email-templates/_shell/emailTheme.ts`, `emailCopy.ts`

**Interfaces:**
- Produces `EmailFamily = "violet" | "ember" | "cyan" | "pine" | "steel"`.
- Produces `EmailRoleKey = "header" | "heading" | "subheading" | "body" | "dataLabel" | "dataValue" | "button" | "footer"`.
- Produces `EmailThemeOverride`, `resolveEmailTheme`, `compactEmailTheme`, `EmailTemplateKey`, `EmailCopyKey`, `EmailCopyOverride`, `resolveEmailCopy`, `compactEmailCopy`, `legacyEmailOverridesToCopy`, and `applyEmailTokens`.

- [ ] **Step 1: Write failing theme tests**

```ts
expect(EMAIL_FAMILY_ACCENTS.violet).toEqual({
  from: "#4738B0", to: "#1E175A", glow: "#6E5FD0",
  solid: "#322685", buttonBg: "#4738B0",
});
expect(resolveEmailTheme({ roles: { heading: { size: 31 } } }).roles.heading.size).toBe(31);
expect(compactEmailTheme({ base: {}, roles: { heading: {} } })).toEqual({});
```

Also assert all five spec colors, malformed JSON fallback, and valid palette references.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/lib/emailTemplates/emailTheme.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the theme model**

Create complete defaults for palette, system-fallback fonts, button radius, footer, and eight roles. Validate colors with `/^#[0-9a-fA-F]{6}$/`, positive finite sizes, allowed weights, and transforms. Resolve loose JSON without mutating defaults.

- [ ] **Step 4: Write failing copy tests**

```ts
expect(legacyEmailOverridesToCopy({
  "offer-immediate": { subject: "Custom", cta_label: "Answer" },
})).toEqual({
  "offer-immediate.subject": "Custom",
  "offer-immediate.ctaLabel": "Answer",
});
expect(applyEmailTokens("Hi {{name}}, {{missing}}", { name: "Mara" }))
  .toBe("Hi Mara, {{missing}}");
```

Assert blank fallback, compaction, metadata/default parity, and absence of Unicode dash characters.

- [ ] **Step 5: Verify RED**

Run: `npx vitest run src/lib/emailTemplates/emailCopy.test.ts`

Expected: FAIL because copy and metadata modules do not exist.

- [ ] **Step 6: Implement defaults and metadata**

Provide `subject`, `heading`, `intro`, `ctaLabel`, `footer`, and every current static label for all ten live templates. Dynamic plurals remain component logic but use singular/plural copy entries. Metadata defines label, multiline flag, and token hints for every copy key.

- [ ] **Step 7: Mirror, verify, and commit**

```bash
npm run sync:mirrors
npm run sync:mirrors:check
npx vitest run src/lib/emailTemplates scripts/sync-mirrors.test.mjs
git add src/lib/emailTemplates scripts/mirrors.manifest.json supabase/functions/_shared/transactional-email-templates/_shell
git commit -m "add email theme and copy registries"
```

---

### Task 2: Shared Email Shell and Booking Templates

**Files:**
- Create: `supabase/functions/_shared/transactional-email-templates/_shell/EmailShell.tsx`, `EmailShell.test.tsx`
- Modify: `offer-immediate.tsx`, `artist-offer-digest.tsx`, `offer-expiry-reminder.tsx`, `artist-confirmation-digest.tsx`, `app-links.test.ts`

**Interfaces:**
- Produces `EmailShell({ family, theme, previewText, heading, subheading, children, footer, cta, highlightRole })`.
- Produces optional template props `_emailCopy`, `_emailTheme`, `_emailFamily`, and `_highlightRole`; direct template renders still use defaults.

- [ ] **Step 1: Write the failing shell test**

```ts
assertStringIncludes(html, 'bgcolor="#322685"');
assertStringIncludes(html, "background-image");
assertStringIncludes(html, 'name="color-scheme"');
assertStringIncludes(html, 'role="presentation"');
assertEquals(html.includes("backdrop-filter"), false);
assertEquals(html.includes("display:flex"), false);
```

- [ ] **Step 2: Verify RED**

Run: `deno test --allow-all supabase/functions/_shared/transactional-email-templates/_shell/EmailShell.test.tsx`

Expected: FAIL because the shell does not exist.

- [ ] **Step 3: Implement the shell**

Use React Email primitives plus presentation tables. Put the solid family color on the hero cell's `bgcolor` and layer gradients via inline `backgroundImage`. Use a 600px light container, system fallback stack, progressive Geist font face, role styles, and preview-only highlight outlines.

- [ ] **Step 4: Write failing booking-template tests**

Render all four templates with default and custom presentation props. Assert shared hero markup, violet fallback, app links, overridden heading/CTA text, and preserved dynamic rows.

- [ ] **Step 5: Verify RED, convert, and verify GREEN**

```bash
deno test --allow-all supabase/functions/_shared/transactional-email-templates/
```

Remove duplicated page/container/button/footer styles, read static copy from `EmailCopy`, preserve preview data and subject semantics, and render through `EmailShell` with family violet. Rerun the command and expect PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/transactional-email-templates
git commit -m "add shared transactional email shell"
```

---

### Task 3: Remaining Templates and Orphan Removal

**Files:**
- Modify: `cast-escalation-requested.tsx`, `hire-order-issued.tsx`, `hire-order-countersigned.tsx`, `org-invitation.tsx`, `account-email-changed.tsx`, `cron-health-alert.tsx`, `registry.ts`, and focused tests
- Delete: `signup-decision.tsx`, `new-signup-admin-notification.tsx`

**Interfaces:**
- Produces exactly ten keys in `TEMPLATES` and a `family` on every entry.

- [ ] **Step 1: Write failing exact-registry and family tests**

```ts
assertEquals(Object.keys(TEMPLATES).sort(), [
  "account-email-changed", "artist-confirmation-digest", "artist-offer-digest",
  "cast-escalation-requested", "cron-health-alert", "hire-order-countersigned",
  "hire-order-issued", "offer-expiry-reminder", "offer-immediate", "org-invitation",
].sort());
```

Render and assert ember for escalation, pine for issued, steel for countersigned/account/cron, violet for invitation, and shared-shell markup.

- [ ] **Step 2: Verify RED**

Run: `deno test --allow-all supabase/functions/_shared/transactional-email-templates/`

Expected: FAIL with twelve keys and six bespoke layouts.

- [ ] **Step 3: Convert six templates and delete orphans**

Move static strings to Task 1 defaults, use `EmailShell`, preserve subjects and dynamic data, add registry family metadata, and delete both dead files/imports/entries.

- [ ] **Step 4: Verify and commit**

```bash
rg -n "signup-decision|new-signup-admin-notification" src supabase scripts
deno test --allow-all supabase/functions/_shared/transactional-email-templates/
deno check --node-modules-dir=none supabase/functions/_shared/transactional-email-templates/registry.ts
git add -A supabase/functions/_shared/transactional-email-templates src/lib/emailTemplates
git commit -m "redesign live transactional emails"
```

The search may report design and plan documents only; production references must be absent.

---

### Task 4: Shared Send and Preview Presentation Resolution

**Files:**
- Modify: `supabase/functions/send-transactional-email/index.ts`, `index.di.test.ts`
- Modify: `supabase/functions/preview-transactional-email/index.ts`, `index.di.test.ts`, `index.smoke.test.ts`
- Create: `src/data/emailTemplates.ts`, `emailTemplates.test.ts`

**Interfaces:**
- Produces `fetchEmailTemplateSettings(client, orgId): Promise<{ copy: EmailCopyOverride; theme: EmailThemeOverride }>`.
- Preview accepts `{ templateName, copyOverride?, themeOverride?, highlightRole? }`.
- Send reads `email_copy` and `email_theme`; it maps effective legacy overrides only when effective `email_copy` is absent.

- [ ] **Step 1: Write failing frontend data tests**

With `makeSupabaseFake`, assert new copy wins, legacy data backfills only when new copy is absent, a stored empty object does not resurrect legacy copy, and missing theme becomes `{}`.

- [ ] **Step 2: Verify RED and implement data access**

Run: `npx vitest run src/data/emailTemplates.test.ts`

Expected: FAIL because the module does not exist. Implement three `resolveOrgSetting` reads, using `null` as the new-copy fallback to distinguish absence from stored `{}`; rerun and expect PASS.

- [ ] **Step 3: Write failing Edge DI tests**

Prove send applies custom subject/copy/theme, falls back to mapped legacy fields only when needed, preview honors all three override inputs, preview returns ten templates, and preview/send subjects share one registry helper. Preserve existing service-role, suppression, preference, attachment, and logging assertions.

- [ ] **Step 4: Verify RED**

```bash
deno test --allow-all \
  supabase/functions/send-transactional-email/index.di.test.ts \
  supabase/functions/preview-transactional-email/index.di.test.ts
```

Expected: FAIL because both handlers still use legacy fields.

- [ ] **Step 5: Implement one registry resolver path**

Expose helpers that resolve subject and attach copy, theme, family, and highlight role to component data. Use them from both handlers. Preview remains an admin/producer read operation; send remains service-role-only. Do not move or weaken any send pipeline guard.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run src/data/emailTemplates.test.ts
deno test --allow-all supabase/functions/
deno check --node-modules-dir=none \
  supabase/functions/send-transactional-email/index.ts \
  supabase/functions/preview-transactional-email/index.ts
git add src/data/emailTemplates.ts src/data/emailTemplates.test.ts supabase/functions
git commit -m "unify email send and preview overrides"
```

---

### Task 5: Coverage Registry and Settings Surface

**Files:**
- Create: `src/lib/emailTemplates/coverage.ts`, `coverage.test.ts`
- Create: `src/components/settings/emailTemplates/EmailTemplatesTab.tsx`, `EmailTemplatesTab.test.tsx`
- Modify: `src/pages/SettingsPage.tsx`, `SettingsPage.test.tsx`
- Modify: `src/components/settings/bookingFlow/BookingFlowTab.tsx`, `BookingFlowTab.test.tsx`
- Delete: `src/components/settings/EmailTemplatesCard.tsx`
- Modify: `src/lib/notificationCategories.test.ts`

**Interfaces:**
- Produces ordered `EMAIL_TEMPLATE_COVERAGE` entries with displayName, group, family, trigger, recipient, status, and category.
- Produces `EmailTemplatesTab({ readOnly, isSuperAdmin })`.

- [ ] **Step 1: Write failing parity tests**

Assert ten live keys, editable metadata for nine customer templates, external password reset, internal cron health, and category values sourced from `EMAIL_TEMPLATE_CATEGORY`.

- [ ] **Step 2: Verify RED and implement metadata**

Run: `npx vitest run src/lib/emailTemplates/coverage.test.ts`

Expected: FAIL because coverage does not exist. Transcribe the approved inventory exactly; rerun and expect PASS.

- [ ] **Step 3: Write failing component and IA tests**

Assert all groups/rows, super-admin-only internal visibility, preview request and iframe, semantic-token classes, an Email templates Settings tab, and no template card in Booking Flow. Edit navigation is added with the editor route in Task 8.

- [ ] **Step 4: Verify RED**

```bash
npx vitest run \
  src/components/settings/emailTemplates/EmailTemplatesTab.test.tsx \
  src/components/settings/bookingFlow/BookingFlowTab.test.tsx \
  src/pages/SettingsPage.test.tsx
```

Expected: FAIL because the new tab is absent.

- [ ] **Step 5: Implement the grouped surface and IA move**

Use Card, Badge, Button, Dialog, and a sandboxed iframe. Preview effective saved copy/theme. Add Email templates under Automation for admins/producers, pass `readOnly={!useCan("edit_email_templates")}`, remove `email_template_overrides` from page draft keys, delete the old card, and leave the from-address input in Booking Flow.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run \
  src/lib/emailTemplates/coverage.test.ts \
  src/components/settings/emailTemplates/EmailTemplatesTab.test.tsx \
  src/components/settings/bookingFlow/BookingFlowTab.test.tsx \
  src/pages/SettingsPage.test.tsx \
  src/lib/notificationCategories.test.ts
git add -A src/components/settings src/lib/emailTemplates src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx src/lib/notificationCategories.test.ts
git commit -m "add email template coverage settings"
```

---

### Task 6: Extract the Domain-Neutral Template Editor Kit

**Files:**
- Create: `src/components/settings/templateEditor/types.ts`, `overrideMap.ts`, `overrideMap.test.ts`
- Create: `TemplateEditorShell.tsx`, `TemplateOutline.tsx`, `CopyFieldControl.tsx`, `RoleStyleControls.tsx`, `DocumentBaseControls.tsx` under that directory
- Modify: `src/components/settings/hireOrders/template/TemplateEditorPage.tsx`, `TemplateInspector.tsx`, `TemplateOutline.tsx`, and their tests

**Interfaces:**
- Produces generic `TemplateSection<RoleKey, CopyKey>`, `GenericRoleStyle`, `hasOwnKeys`, `numericInputValue`, `compactCopyMap`, and `compactThemeMap`.
- Produces a slot-based `TemplateEditorShell` and callback-driven generic outline.

- [ ] **Step 1: Write failing helper and outline tests**

Assert null/hollow objects are unmodified, empty numeric input returns null, default/blank copy compacts away, hollow roles are removed, generic string role keys select, and modified state comes from a callback.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run \
  src/components/settings/templateEditor/overrideMap.test.ts \
  src/components/settings/hireOrders/template/TemplateOutline.test.tsx
```

Expected: FAIL because the shared kit is absent.

- [ ] **Step 3: Extract helpers, shell, and outline**

Move behavior without changing PDF output. The PDF outline may remain a thin adapter but must delegate rendering to the generic outline.

- [ ] **Step 4: Write failing shared-control regression tests**

Cover copy reset deletion, bad-dash warning, whole-role deletion, one-field clearing with sibling preservation, base deletion, and read-only control disabling.

- [ ] **Step 5: Extract controls and refactor PDF wiring**

Parameterize fonts, color keys/labels, base fields, role defaults, copy metadata, and callbacks. Make the PDF inspector wiring-only. Use the shared shell and compaction helpers in the PDF page.

- [ ] **Step 6: Run the complete PDF editor guard suite**

```bash
npx vitest run \
  src/components/settings/templateEditor \
  src/components/settings/hireOrders/template/TemplateEditorPage.test.tsx \
  src/components/settings/hireOrders/template/TemplateInspector.test.tsx \
  src/components/settings/hireOrders/template/TemplateOutline.test.tsx \
  src/components/settings/hireOrders/template/TemplateDocumentPane.test.tsx
```

Expected: PASS with unchanged PDF behavior.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/templateEditor src/components/settings/hireOrders/template
git commit -m "extract shared template editor kit"
```

---

### Task 7: Capability and Migration

**Files:**
- Modify: `src/lib/capabilities.ts`, `capabilities.test.ts`, `capabilityDefaultsSql.test.ts`
- Generate: `supabase/functions/_shared/capabilities.ts`
- Create via CLI: `supabase/migrations/*_email_template_capability.sql`
- Create: `src/lib/appSettingCapabilitySql.test.ts`

**Interfaces:**
- Produces key `producer_can_edit_email_templates`, action `edit_email_templates`, group `Email`, risk `sensitive`, default false.
- Maps `email_copy` and `email_theme` to the new capability in SQL.

- [ ] **Step 1: Write failing capability and SQL tests**

Assert the producer default, registry group/risk, exact SQL default arm, and both app-setting mappings.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run \
  src/lib/capabilities.test.ts \
  src/lib/capabilityDefaultsSql.test.ts \
  src/lib/appSettingCapabilitySql.test.ts
```

Expected: FAIL because the capability and SQL are absent.

- [ ] **Step 3: Generate and fill the migration**

```bash
supabase --version
supabase migration new email_template_capability
```

Use the exact path printed by the CLI. Replace `capability_default` with every existing arm plus:

```sql
when 'producer_can_edit_email_templates' then false
```

Replace `app_setting_capability` with every existing arm plus:

```sql
when _key in ('email_copy','email_theme')
  then 'producer_can_edit_email_templates'
```

- [ ] **Step 4: Implement the registry and mirror**

Add the Email capability and sync the generated Edge registry block.

- [ ] **Step 5: Verify and commit**

```bash
npm run sync:mirrors
npm run sync:mirrors:check
npx vitest run src/lib/capabilities.test.ts src/lib/capabilityDefaultsSql.test.ts src/lib/appSettingCapabilitySql.test.ts
supabase migration list --local
git add src/lib supabase/functions/_shared/capabilities.ts supabase/migrations
git commit -m "gate email template editing"
```

---

### Task 8: Email Preview Pane, Inspector, and Editor Page

**Files:**
- Create: `src/components/settings/emailTemplates/EmailPreviewPane.tsx`, `EmailPreviewPane.test.tsx`
- Create: `src/components/settings/emailTemplates/EmailTemplateInspector.tsx`, `EmailTemplateInspector.test.tsx`
- Create: `src/pages/EmailTemplateEditorPage.tsx`, `EmailTemplateEditorPage.test.tsx`
- Modify: `src/components/settings/emailTemplates/EmailTemplatesTab.tsx`, `EmailTemplatesTab.test.tsx`
- Modify: `src/config/app.config.ts`, `app.config.test.ts`, `src/App.tsx`

**Interfaces:**
- Preview consumes templateKey, copyOverride, themeOverride, and highlightRole; after 250ms it invokes preview and renders `templates[0].html` in `iframe srcDoc`.
- Page loads and saves `email_copy` and `email_theme` with seeded refs and compact maps.
- Produces `ROUTES.EMAIL_TEMPLATE = "/settings/email-templates/:templateKey"` and lazy protected route wiring.

- [ ] **Step 1: Write failing preview concurrency tests**

Use fake timers and the Supabase fake boundary. Assert one debounced call, latest-run-wins, stale errors do not replace newer HTML, unmount cancels updates, the request includes all overrides, and iframe sandbox/title are present.

- [ ] **Step 2: Verify RED and implement preview**

Run: `npx vitest run src/components/settings/emailTemplates/EmailPreviewPane.test.tsx`

Expected: FAIL because the pane is absent. Implement the monotonic token pattern from `TemplateDocumentPane`, retaining the previous frame while updating; rerun and expect PASS.

- [ ] **Step 3: Write failing inspector and page tests**

Assert invalid template handling, legacy seed only when new copy is absent, copy/theme preview round trips, compact persistence, reset deletion rather than null values, read-only preview with disabled mutations, dirty-draft preservation across refetch, the exact route constant, and correct Edit links only for editable rows.

- [ ] **Step 4: Verify RED**

```bash
npx vitest run \
  src/components/settings/emailTemplates/EmailTemplateInspector.test.tsx \
  src/pages/EmailTemplateEditorPage.test.tsx
```

Expected: FAIL because inspector/page do not exist.

- [ ] **Step 5: Implement inspector and page**

Use `TemplateEditorShell`, generic outline, CopyFieldControl, RoleStyleControls, and DocumentBaseControls. Sections are Document, Header, Content, Action, Footer. Label style controls “Applies to all emails.” Save compact copy then compact theme via `upsertOrgSetting`, invalidate `["app-settings"]`, and toast results. Add the route constant, lazy-load the page, and register it in `ProtectedRoute requiredRoles={["admin", "producer"]}`.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run \
  src/components/settings/emailTemplates \
  src/pages/EmailTemplateEditorPage.test.tsx \
  src/components/settings/hireOrders/template
git add src/components/settings/emailTemplates src/pages/EmailTemplateEditorPage.tsx src/pages/EmailTemplateEditorPage.test.tsx src/config/app.config.ts src/config/app.config.test.ts src/App.tsx
git commit -m "add email template editor"
```

---

### Task 9: Release Metadata, Documentation, and Full Verification

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/config/app.config.ts`, `public/changelog.md`, `CLAUDE.md`
- Generate: `public/changelog.json`

**Interfaces:**
- Produces version 1.15.0 in package and app metadata.
- Produces customer-facing release notes for the registry, redesign, and editor.

- [ ] **Step 1: Write release notes and update architecture docs**

Add newest-first `## 1.15.0 — August 7, 2026` with New and Improved bullets. Do not mention internal cron templates, platform administration, migrations, refactors, or tests. Document the new email template, shared editor-kit, and pure registry directories in CLAUDE.md.

- [ ] **Step 2: Bump versions and regenerate**

```bash
npm version 1.15.0 --no-git-tag-version
deno run --allow-read --allow-write scripts/changelog-to-json.ts
npm run sync:mirrors
```

- [ ] **Step 3: Run structural checks**

```bash
rg -n "signup-decision|new-signup-admin-notification" src supabase scripts
rg -n "–|—" src/lib/emailTemplates src/components/settings/emailTemplates
npm run sync:mirrors:check
git diff --check
```

Expected: orphan names and forbidden dashes have no production-code hits; mirror/diff checks pass.

- [ ] **Step 4: Run the full matrix**

```bash
npm run test:coverage
npm run lint
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.tools.json --noEmit
deno test --allow-all supabase/functions/
deno check --node-modules-dir=none supabase/functions/*/index.ts
npm run build
```

Expected: every command exits 0. If local Supabase is available, also run `supabase test db`; otherwise record that database execution was unavailable and retain SQL-twin unit coverage.

- [ ] **Step 5: Review the final diff**

Check ten live templates, exact coverage inventory, external/internal gating, send/preview parity, legacy fallback, capability read-only floor, email-client safety, PDF editor regression suite, and release discipline.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/config/app.config.ts public/changelog.md public/changelog.json CLAUDE.md
git commit -m "release email template editor"
```
