# i18n Phase 2 — Settings Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the entire **Settings** surface (all 12 tabs, ~60 component files) from hardcoded English JSX strings to typed react-i18next `t('ns.key')` calls, with hand-authored English + German catalogs, following the established `dashboard`/`bookings`/`availability` Phase-2 pattern. English output stays byte-identical; German ships dark behind the `language_packages` entitlement.

**Architecture:** The Settings surface is too large for a single flat catalog worked by one writer, and the user asked to do the whole surface in one PR with parallel subagents. To parallelize cleanly with **zero shared-file writes during fan-out**, the work is split into **one i18next namespace per Settings sub-domain** (`settings`, `settingsDocs`, `settingsCastsCoverage`, `settingsSkills`, `settingsTrust`, `settingsAirtable`, `settingsBookingFlow`, `settingsHireOrders`, `settingsEmailTemplates`, `settingsRolesRights`, `settingsEditor`). Each namespace owns a **disjoint set of component files** and its own `en`/`de` JSON pair, so a subagent can own a whole cluster end-to-end (string swap + catalog authoring + self-verification) without touching any file another subagent touches. All namespace **registration** (the four shared infra files) is done once, up front, serially, and committed **before** fan-out — after that commit, subagents only write their own JSON pair + their own component files.

**Tech Stack:** React 18 + TypeScript, react-i18next (already bootstrapped in `src/i18n/`), Vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-14-i18n-and-help-page-design.md` — "Whole-app rollout strategy" §181-203 names `settings` as a Phase-2 namespace ("one namespace per domain, one PR at a time"). This plan implements the Settings domain; because that domain is really ~11 sub-domains, it uses one namespace per sub-domain (a documented, mechanical elaboration of the spec's single `settings` entry — see *Namespace naming note* below). Prior Phase-2 plans: `2026-08-14-i18n-phase2-bookings-availability.md`, `2026-08-14-i18n-phase2-dashboard-and-language-gating.md`.

## Global Constraints

Copied verbatim from the Phase-2 bookings/availability plan; every task inherits these.

- **English is canonical; German must match key-for-key.** `keyParity.test.ts` fails CI on any missing/extra German key (`fallbackLng: 'en'` would otherwise silently render English in prod). Add every new namespace to its `for (const ns of [...])` loop.
- **English catalog values MUST be byte-identical to the current hardcoded string** (same punctuation, same `…` ellipsis char, same `&`, same `·`, same `↑/↓`), so existing component tests that query by visible text (`getByText`/`findByText`) keep passing untouched. **Do not "improve" copy during migration.**
- **No em dashes or en dashes** (`—` / `–`) anywhere in EN or DE copy — `copyLint.test.ts` fails on them. (Existing code already uses `·`, `…`; keep those.)
- **German uses informal *Du*** address; `copyLint.test.ts` rejects mid-sentence formal `Sie/Ihr…`.
- **German value must differ from English** for translatable keys — `translationCompleteness.test.ts` fails on a paste-through. Legitimately-identical strings (proper nouns like "Airtable", symbol/interpolation-only) are allowlisted in that test's `IDENTICAL_OK` with a reason. Add allowlist entries as needed, keyed `"<ns>.<dotted.key>"`.
- **Reuse `TERMS` for domain terms** (`src/i18n/terms.ts`): Hold→Vormerkung, Soft-booked→Vorläufig gebucht, Cast→Besetzung, Understudy→Zweitbesetzung, Hire order→Engagementvertrag, Blocked date→Gesperrter Termin, Response window→Antwortfrist, Digest→Tagesübersicht, Coverage→Abdeckung. Do not re-translate a glossary term inline with a different word. Role labels: `producer` displays as **"Production Team"** (EN) — never translate to "Produzent"; mirror the app's `roleLabel()`.
- **i18next interpolation** is `{{var}}`; **pluralization** uses `_one` / `_other` sibling keys with a `count` variable. Never build a sentence by string concatenation.
- **`any` is banned** (CI `--max-warnings 0`). Not expected; these are string swaps.
- **Component-level strings only.** Do **NOT** migrate shared dynamic copy/sentence-builder modules under `src/lib/**` or `src/data/settingsAudit.ts` (e.g. audit change-log sentence builders, `auditKeys.ts` identifiers, `src/lib/trust/facts.ts` claim tables, `src/lib/help/**`, `src/lib/systemMap.ts` / `docs/system-map.md` content). These are cross-domain, data-traceable, or deferred; leave every value sourced from them exactly as-is. `auditKeys.ts` values are stable identifiers, not display copy — skip.
- **Do NOT migrate date/weekday formatting** (`date-fns format(...)`, `.toLocaleDateString(...)`, weekday-header arrays). Deferred to the `dates.ts` locale-aware work. Leave English.
- **Skip non-UI strings**: `className`, `data-*`, route paths, query keys, `app_settings` keys, enum literals, `aria` values that mirror visible text already migrated, test IDs, icon names, URLs.

### Namespace naming note

The spec lists a single `settings` namespace. This plan splits it into `settings` (core shell) + ten `settings<SubDomain>` namespaces purely to let subagents write disjoint files in parallel. They are lazy-registered exactly like any namespace and cost nothing at runtime. A future cleanup **may** consolidate them into one `settings` catalog once the copy is stable; that is out of scope here and noted in the Handoff.

---

## File Structure

**Created (JSON catalogs — 2 per namespace, 22 files):**
`src/i18n/locales/{en,de}/settings.json`, `…/settingsDocs.json`, `…/settingsCastsCoverage.json`, `…/settingsSkills.json`, `…/settingsTrust.json`, `…/settingsAirtable.json`, `…/settingsBookingFlow.json`, `…/settingsHireOrders.json`, `…/settingsEmailTemplates.json`, `…/settingsRolesRights.json`, `…/settingsEditor.json`.

**Modified (shared infra — Task 1 only, serial):**
- `src/i18n/index.ts` — import all 22 JSON files; add to `resources.{en,de}`; add all 11 names to the `ns` array.
- `src/i18n/react-i18next.d.ts` — import the 11 EN types; add them to the `resources` interface.
- `src/i18n/keyParity.test.ts` — add the 11 names to the namespace loop.
- `src/i18n/translationCompleteness.test.ts` — add the 11 names to the namespace loop (+ allowlist entries as discovered).

**Modified (components — Tasks 2-12, parallelizable, disjoint):** see each task.

### Cluster → namespace → owned files

| Task | Namespace | Owned component files |
|---|---|---|
| 2 | `settings` (core) | `src/pages/SettingsPage.tsx`, `src/components/settings/OrganizationTab.tsx`, `src/components/settings/permissions/PermissionsMatrix.tsx`, `src/components/settings/permissions/PermissionRow.tsx` |
| 3 | `settingsDocs` | `src/components/settings/DocumentationTab.tsx`, `MarkdownDoc.tsx`, `SystemMapCanvas.tsx`, `SystemMapReference.tsx` |
| 4 | `settingsCastsCoverage` | `src/components/settings/castsCoverage/CastsCoverageTab.tsx`, `CoveragePanel.tsx`, `OwnershipPanel.tsx`, `TierCell.tsx` |
| 5 | `settingsSkills` | `src/components/settings/skills/SkillsTab.tsx` |
| 6 | `settingsTrust` | `src/components/settings/trust/TrustDataTab.tsx`, `CapabilitiesCard.tsx`, `DocumentsCard.tsx`, `OrgDataCard.tsx`, `RetentionCard.tsx`, `VisibilityMatrix.tsx`, `YourDataCard.tsx` |
| 7 | `settingsAirtable` | `src/components/settings/AirtableSyncTab.tsx`, `airtable/ActivityTab.tsx`, `AttentionPanel.tsx`, `CatalogTab.tsx`, `ConsoleTabs.tsx`, `MappingTab.tsx`, `OverviewTab.tsx`, `ReadOnlyBanner.tsx`, `SetupWizard.tsx`, `StatusHeader.tsx` |
| 8 | `settingsBookingFlow` | `src/components/settings/bookingFlow/BookingFlowTab.tsx`, `FlowPresets.tsx`, `FlowRail.tsx`, `FlowTimeline.tsx` |
| 9 | `settingsHireOrders` | `src/components/settings/hireOrders/HireOrdersTab.tsx`, `CountersignCard.tsx`, `LetterheadCard.tsx`, `NumberingCard.tsx`, `OrderDefaultsCard.tsx`, `PdfTemplateCard.tsx`, `TermsVariantsCard.tsx`, `fields/CountersignFields.tsx`, `fields/LetterheadFields.tsx`, `fields/TermsLibraryPicker.tsx`, `template/TemplateDocumentPane.tsx`, `template/TemplateEditorPage.tsx`, `template/TemplateInspector.tsx`, `template/TemplateOutline.tsx` |
| 10 | `settingsEmailTemplates` | `src/components/settings/emailTemplates/EmailTemplatesTab.tsx`, `EmailPreviewPane.tsx`, `EmailTemplateInspector.tsx`, `src/pages/EmailTemplateEditorPage.tsx` |
| 11 | `settingsRolesRights` | `src/components/settings/rolesRights/RolesRightsTab.tsx`, `ChangeLogDialog.tsx`, `EditingPickerCard.tsx`, `RightGroupCard.tsx`, `RightRow.tsx`, `StagedChangesCard.tsx` |
| 12 | `settingsEditor` | `src/components/settings/templateEditor/CopyFieldControl.tsx`, `DocumentBaseControls.tsx`, `RoleStyleControls.tsx`, `TemplateEditorShell.tsx`, `TemplateOutline.tsx` |

Every `.tsx` under `src/components/settings/**` (plus the two settings-editor pages) appears in exactly one row. No file is shared between two tasks.

---

## Task 1: Register all 11 namespaces (shared infra scaffold — SERIAL, do first, commit before fan-out)

**Files:**
- Create: the 22 JSON files listed above, each seeded `{}`.
- Modify: `src/i18n/index.ts`, `src/i18n/react-i18next.d.ts`, `src/i18n/keyParity.test.ts`, `src/i18n/translationCompleteness.test.ts`

**Interfaces:**
- Produces: 11 registered, typed, parity-checked namespaces. Each subagent (Tasks 2-12) consumes exactly one via `useTranslation('<ns>')` and is the sole writer of its `en/<ns>.json` + `de/<ns>.json`.

An empty `{}` catalog parity-passes (both sides have zero keys) and type-augments to an empty object, so `tsc` is green while no component references a key yet. This lets fan-out proceed on a compiling baseline.

- [ ] **Step 1: Create the 22 seed catalogs.** Each file contains exactly `{}` (with trailing newline). Order the 11 namespaces consistently everywhere as: `settings, settingsDocs, settingsCastsCoverage, settingsSkills, settingsTrust, settingsAirtable, settingsBookingFlow, settingsHireOrders, settingsEmailTemplates, settingsRolesRights, settingsEditor`.

- [ ] **Step 2: Register in `src/i18n/index.ts`.** Add an `en`/`de` import pair per namespace (e.g. `import enSettings from './locales/en/settings.json';` … `import deSettingsEditor from './locales/de/settingsEditor.json';`), add each to `resources.en` / `resources.de`, and append all 11 names to the `ns: [...]` array. Keep the existing `common, help, dashboard, bookings, availability` entries first.

- [ ] **Step 3: Register in `src/i18n/react-i18next.d.ts`.** Add `import type enSettings from './locales/en/settings.json';` … for all 11, and add `settings: typeof enSettings;` … lines to the `resources` interface.

- [ ] **Step 4: Extend the two test loops.** In `keyParity.test.ts` and `translationCompleteness.test.ts`, add all 11 names to the `for (const ns of [...] as const)` arrays.

- [ ] **Step 5: Verify infra compiles and gates pass on empty catalogs.**

```bash
npx vitest run src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts src/i18n/translationCompleteness.test.ts src/i18n/index.test.ts
npx tsc -p tsconfig.app.json --noEmit
```
Expected: all green (empty namespaces are parity-equal and type-augment cleanly).

- [ ] **Step 6: Commit.**

```bash
git add src/i18n
git commit -m "i18n: register 11 settings-surface namespaces (empty catalogs)"
```

---

## Tasks 2-12: Per-cluster string migration (PARALLELIZABLE after Task 1)

**All of Tasks 2-12 share the identical procedure below.** They differ only in their namespace and owned file list (see the table). Because their files and their JSON pair are disjoint, they can run concurrently as separate subagents with no coordination. Each is independently testable and independently reviewable.

### Shared procedure (apply to your cluster's namespace `NS` and file list `FILES`)

- [ ] **Step A: Inventory the strings.** For each file in `FILES`, read it and list every user-facing string: JSX text nodes, and string literals passed to visible props (`title`, `label`, `description`, `placeholder`, `aria-label` when it is real prose, `alt`, toast messages `toast.success('…')`/`toast.error('…')`, `Button`/`Badge`/`CardTitle`/`CardDescription` children, empty-state text, tooltip content). **Exclude** everything under "Skip non-UI strings" and the deferred `src/lib/**` sources in Global Constraints. A string already produced by an imported lib helper (e.g. a `flowCopy`/`facts.ts`/`auditKeys` value) is **not** yours — leave the call site as-is.

- [ ] **Step B: Author the EN catalog (`src/i18n/locales/en/<NS>.json`).** Nest keys by component and role/section for readability, e.g. for `settingsTrust`:
```json
{
  "tab": { "title": "Trust & data", "description": "What we store, who can see it, and how long we keep it." },
  "orgData": { "heading": "Organization data" }
}
```
Each **value is byte-identical** to the current hardcoded string. Use `{{org}}`-style interpolation for any string that today concatenates a variable; use `_one`/`_other` for any string that today branches on a count. Keep `…`, `·`, `↑`, `↓`, `&` exactly as they appear.

- [ ] **Step C: Author the DE catalog (`src/i18n/locales/de/<NS>.json`).** Same keys as EN (parity). Translate to informal *Du*, no em/en dashes, reusing `TERMS` for domain terms and `roleLabel` conventions. For any value that is legitimately identical across languages (a proper noun like "Airtable", a symbol/number-only string), keep it identical **and** add an allowlist entry `"<NS>.<dotted.key>": "reason"` to `translationCompleteness.test.ts`'s `IDENTICAL_OK`.

- [ ] **Step D: Swap the components.** In each file, add `import { useTranslation } from 'react-i18next';`, add `const { t } = useTranslation('<NS>');` inside the component, and replace each inventoried literal with `t('<dotted.key>')` (or `t('<key>', { org, count })`). Do not change surrounding logic, class names, or structure.

- [ ] **Step E: Verify the cluster.** Run this cluster's own test files plus the four i18n gates and the app typecheck:
```bash
npx vitest run \
  src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts src/i18n/translationCompleteness.test.ts \
  <globs for the *.test.tsx co-located with your FILES>
npx tsc -p tsconfig.app.json --noEmit
```
Expected: PASS. Because EN is byte-identical, component tests that query visible text need **zero** edits. If a component test breaks, the EN value drifted from the original — fix the catalog, don't edit the test. (If a co-located test does not exist for a file, that is expected for some presentational leaves; the i18n gates + tsc still cover the catalog.)

- [ ] **Step F: Commit.**
```bash
git add src/i18n/locales/en/<NS>.json src/i18n/locales/de/<NS>.json src/i18n/translationCompleteness.test.ts <FILES>
git commit -m "i18n: localize <cluster> settings (<NS> ns)"
```

### Per-cluster notes

- **Task 2 `settings` (core shell):** `SettingsPage.tsx` holds the tab labels (`TabsTrigger` text), page title/description, the **Filters** tab (page/role/filter-key labels rendered inline), the **Notifications** master toggle copy, the **Booking** master-switch card copy, and Save/toast strings. `OrganizationTab.tsx` holds org name/branding form labels. `permissions/*` holds the super-admin capability-matrix column/row chrome. This cluster owns the strings a user sees on **every** Settings visit, so prioritize byte-identity of tab labels (many other tests deep-link by tab name).
- **Task 3 `settingsDocs`:** Migrate the tab's own chrome (headings, the doc picker labels, empty/error states) only. The **document bodies** are Markdown/system-map content sourced from `src/lib/**` / `docs/**` — leave them. `SystemMapCanvas`/`SystemMapReference` node labels that come from `src/lib/systemMap.ts` (or `src/data/systemMap.ts`) are **not** yours.
- **Task 7 `settingsAirtable`:** "Airtable" is a proper noun — expect several `IDENTICAL_OK` allowlist entries. Status words and field-mapping chrome are yours; base/table/field **names fetched from the API** are runtime data, not copy.
- **Task 8 `settingsBookingFlow`:** Migrate `BookingFlowTab`/`FlowPresets`/`FlowRail`/`FlowTimeline` component chrome. **Do not** migrate `auditKeys.ts` (identifiers) or any audit-sentence value from `src/data/settingsAudit.ts` / `src/lib/**` — leave those call sites.
- **Task 9 `settingsHireOrders`:** Largest cluster. The PDF-template WYSIWYG (`template/*`) chrome is yours, but the **PDF role registry** copy in `src/lib/hireOrders/pdf/pdfTheme.ts` is not. "Hire order" → *Engagementvertrag* (TERMS).
- **Task 10 `settingsEmailTemplates`:** The coverage-registry rows describe each transactional email (trigger/recipient/status) — that descriptive chrome is yours if it lives in the component; if it is sourced from `emailEditorMeta.ts` or the `_shared/transactional-email-templates` registry, leave it. `EmailTemplateEditorPage.tsx` editor chrome is yours.
- **Task 11 `settingsRolesRights`:** Right **labels/descriptions/group names** come from `CAPABILITY_DEFS` in `src/lib/capabilities.ts` — those are **not** yours (leave `right.label`/`right.description`/`group` as-is). Only the tab's own chrome (search placeholder, filter chips, staged-changes/apply/change-log dialog labels) is yours.
- **Task 12 `settingsEditor`:** Domain-neutral editor kit shared by the hire-order and email editors. Keep copy generic ("Outline", "Copy", "Reset to default", etc.).

---

## Task 13: Full-surface verification + PR (SERIAL, after all clusters merge in)

**Files:** none (verification + docs).

- [ ] **Step 1: Run the full fast gate.**
```bash
npm run verify:fast
```
Expected: lint (0 warnings), all three tsc projects, build, unit+coverage, Deno — all green. Coverage thresholds must still pass (string swaps shouldn't drop coverage; if a new `t()` branch dips a file, add a focused test rather than lowering the threshold).

- [ ] **Step 2: Sanity-check German renders.** Temporarily flip the app to German (or a targeted test) is **not** required, but confirm `keyParity` + `translationCompleteness` + `copyLint` pass across all 11 namespaces:
```bash
npx vitest run src/i18n/
```

- [ ] **Step 3: Changelog / version.** Follow the Phase-2 precedent (PR #282): **do not bump** — English output is unchanged and German is dark-by-default; this rides the in-flight 1.16.0 i18n work. Optionally add one line under the existing 1.16.0 block in `public/changelog.md` ("Improved — more of Settings is ready for German"), then regenerate JSON via `deno run --allow-read --allow-write scripts/changelog-to-json.ts`. If unsure, leave unbumped and note it in the PR as PR #282 did.

- [ ] **Step 4: Help-center impact.** N/A — pure string extraction, English output unchanged, no change to what a role asks or how the app answers. State this in the PR.

- [ ] **Step 5: Open the PR** against `main` with a body mirroring PR #282's structure (What & why, the deferred items, the namespace-split rationale, checklist).

---

## Self-Review (run before execution)

1. **Spec coverage:** Spec §190 names `settings` as a Phase-2 namespace → covered by Tasks 2-12 (the 11-way split is documented in *Namespace naming note*). Byte-identical EN (spec's zero-test-churn requirement) → Global Constraints + Step B. Parity/copy-lint/completeness CI → Task 1 Steps 4-5 + each Step E. Lazy per-namespace registration → Task 1.
2. **Placeholder scan:** No "TBD"/"handle edge cases". Per-string content is authored during execution under the byte-identity gate rather than pre-listed (there are thousands; enumerating them in the plan would be a transcription of the source files, and the byte-identity + test-green gates make the extraction mechanical and self-checking — the same approach the merged bookings/availability plan used).
3. **Type consistency:** Namespace names are spelled identically in the File Structure table, Task 1, and the cluster table. Each namespace is registered in index.ts + d.ts + both test loops (Task 1) before any component references it.

## Handoff / deferred (out of scope, documented for the next PR)

- **Consolidating the 11 `settings*` namespaces** into one `settings` catalog once copy is stable.
- **Shared dynamic-copy modules**: `src/lib/flowCopy`, `src/data/settingsAudit.ts` sentence builders, `src/lib/trust/facts.ts`, `src/lib/capabilities.ts` `CAPABILITY_DEFS` labels, `src/lib/hireOrders/pdf/pdfTheme.ts`, `src/lib/systemMap.ts` node labels, `src/lib/help/**`. These are cross-domain / data-traceable and get their own migration.
- **Markdown/system-map document bodies** (`docs/**` served via `MarkdownDoc`).
- **Date/weekday formatting** → deferred to `dates.ts` locale-aware work.
- **`i18next-parser` in CI**, server-side `preferred_language`, and Phase-3 transactional-email localization (per the spec).
