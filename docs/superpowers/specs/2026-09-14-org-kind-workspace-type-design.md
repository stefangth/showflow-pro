# Workspace type (`org_kind`): per-org vocabulary and presentation. Spec

**Date:** 2026-09-14
**Status:** Approved in brainstorming (owner, 2026-09-14). Awaiting spec review.
**Related:** `2026-08-14-i18n-and-help-page-design.md` (client i18n), `2026-08-15-i18n-server-side-per-org.md` (per-org language for emails and PDFs, whose resolution pattern this spec reuses), `2026-08-14-page-minis-design.md`.

---

## Problem

Every word in the app assumes the customer is a live-show production company: shows, show dates, artists, casts, understudies, hire orders. A staffing agency (expo staff, event crews) has the same workflow, people declare availability and a booker fills slots, but reads the screen as if it were built for someone else. Sales cannot demo to that customer without apologising for the words.

## Decision summary (locked with the owner)

| Question | Decision |
|---|---|
| Depth | **Vocabulary plus presentation.** Nouns change everywhere; a short list of controls and explanations change or hide. Booking behaviour and the data model do not change. |
| Kinds in v1 | **`production`** (today's default) and **`staffing`**. More kinds are pure copy work later. |
| Who sets it | Anywhere, anytime. Super-admin at provisioning and in the Platform console; org admin in Get running and in Settings, Organization. Never locked. |
| Name | Code `org_kind`. UI label "Workspace type" (DE "Arbeitsbereich-Typ"). Values `production`, `staffing`. |
| Mechanism | **Interpolated vocabulary.** One set of sentences with `{{noun}}` variables; one vocabulary table per kind and language. Presentation differences via a `useOrgKind()` hook. |

## Non-goals

- Behaviour or data-model changes per kind (no tier-less booking, no different contract fields). That is a separate project.
- A "generic" or third kind. Adding one is a table plus reviewed copy, not a design change.
- Per-user kind. The kind belongs to the organization, like `org_language`.
- Vocabulary in: the Airtable mapping UI, the System Map (`docs/system-map.md`, `src/data/systemMap.ts`), Trust Center facts and `trust.json`, the changelog, `docs/`. These stay in production language.
- Translating anything automatically. German for the staffing vocabulary is authored in the same PR as the English; the existing key-parity test enforces it.

## Staffing vocabulary (owner-approved draft; German pending owner review)

| Production (today) | Staffing EN | Staffing DE | Note |
|---|---|---|---|
| Production / Show | Client / Project | Kunde / Projekt | A recurring engagement for one client |
| Show date | Shift | Schicht | One slot at a venue |
| Artist | Staff member | Teammitglied | The bookable person |
| Artists (nav) | People | Personen | |
| Cast | Team | Team | The group booked for a shift |
| Understudy | Standby | Ersatz | Concept kept; controls hidden (see Presentation) |
| Production Team (role) | Booking team | Buchungsteam | `producer` role value unchanged |
| Skill | Qualification | Qualifikation | Language, badge, licence |
| Contract (hire order) | Work order | Arbeitsauftrag | |
| Availability, Venue, City, Offer, Waiting on you | unchanged | unchanged | |

## Requirements

### R1. Storage: a column on `organizations`

- Migration adds `organizations.org_kind text not null default 'production'` with `check (org_kind in ('production','staffing'))`. Existing orgs become `production` with no data change.
- Column, not an `app_settings` key, because it is a first-class fact of the org: listed in the Platform table, written by `provision-org` at creation, read by every edge function that renders copy. It sits beside `is_demo` and `status`.
- **Writes.** `provision-org` accepts an optional `org_kind` (default `production`). Org admins write it through a new `set_org_kind(p_org uuid, p_kind text)` RPC, `SECURITY DEFINER`, guarded by `has_org_role(auth.uid(), p_org, 'admin')`, super-admins pass. No admin UPDATE policy is opened on `organizations`. Super-admins in the Platform console use the same RPC. Grant to `authenticated` and `service_role` (see the service-role grant gotcha).
- No entitlement gate. Workspace type is not a paid module.
- Regenerate `types.ts` and the edge mirror after the migration (`npm run sync:mirrors`).

### R2. Registry and mirror

- `src/lib/orgKind.ts` exports: `OrgKind` type, `ORG_KINDS` list, `ORG_KIND_LABELS` (EN/DE UI labels), `DEFAULT_ORG_KIND = 'production'`, `isOrgKind()`, and `VOCABULARY: Record<OrgKind, Record<Lang, Vocabulary>>`.
- `Vocabulary` is a flat string map with a fixed key set. Every noun has four forms because i18next interpolation is plain substitution and sentences start with capitals: `show`, `shows`, `Show`, `Shows`, likewise `artist`, `production`, `showDate`, `cast`, `understudy`, `skill`, `hireOrder`, plus `roleProducer`. The exact key list is fixed by the audit in PR 2; the shape rule is what matters.
- A unit test asserts every `(kind, lang)` table has exactly the same key set, and that no value contains a dash or an exclamation mark (same rule as `copyLint`).
- The registry block is sentinel-delimited and mirrored into `supabase/functions/_shared/orgKind.ts` by `scripts/sync-mirrors.mjs` (add the entry to `scripts/mirrors.manifest.json`, `block` mode). Never hand-edit the target.

### R3. Client resolution

- `src/data/orgs.ts` selects `org_kind` with the org row, so `currentOrg.org_kind` is present wherever `currentOrg` is. `Organization` type gains the field.
- `useOrgKind(): OrgKind` in `src/hooks/useOrgKind.ts` returns `currentOrg?.org_kind ?? 'production'`. It falls back to `production` while auth loads, mirroring `useFeature`'s loading behaviour, so a staffing org may flash production words for one render on cold load. Accepted.
- `VocabularyBridge` (in `src/features/i18n/`, mounted next to the existing language reset in `AppLayout`) sets `i18n.options.interpolation.defaultVariables = VOCABULARY[kind][lang]` whenever kind or language changes, then triggers a react-i18next re-render. The trigger is `i18n.changeLanguage(currentLang)`, which react-i18next listens to. This is the one piece of i18next trickery in the design; it gets a unit test that mounts a component, flips the kind, and asserts the rendered noun changed.
- Public and no-org pages (login, accept-invite, sandbox, legal) have no org and render the production vocabulary.

### R4. Copy audit (locale files)

- Every user-facing sentence in `src/i18n/locales/{en,de}/*.json` that names a domain noun uses the vocabulary variable instead: `"Add your first {{show}}"`. Applies to nav labels in `common.json`, page titles, empty states, minis, onboarding, help.
- **German grammar rule.** Articles and case endings follow the noun, so a sentence that needs "die Show" or "des Artists" cannot take a bare variable. Resolution, in order of preference: reword article-free; otherwise add German-only per-kind sibling keys (`key_production` / `key_staffing`) and set the base key to `$t(ns:path.key_{{kind}})`, which i18next resolves through the `kind` vocabulary variable with no call-site changes (pinned by `kindVariants.test.ts`). Never add a fifth noun form for case. Expect a few dozen such strings.
- `TERMS` in `src/i18n/terms.ts` becomes kind-aware for `cast`, `understudy`, `hireOrder`: `termLabel(key, lang, kind = 'production')`. Other terms are unchanged.
- `ROLE_LABELS` stays as the production table; `roleLabel(role, kind = 'production')` returns `VOCABULARY[kind].en.roleProducer` for `producer`. The `_shared/roles.ts` mirror follows through the generator. The `producer` role value is never changed or compared against a label.
- **Noun scanner test** (`src/i18n/vocabularyLint.test.ts`): scans every English locale file for bare `show(s)`, `artist(s)`, `production(s)`, `cast`, `understudy`, `hire order(s)` outside a small explicit allowlist (proper nouns, "ShowFlow", strings the audit deliberately left). CI fails on a new bare noun. Same pattern as `copyLint.test.ts`.
- The translation-completeness allowlist gains the interpolation-only strings the audit creates.

### R5. Presentation differences (staffing only; everything else identical)

Gated by `useOrgKind() === 'staffing'`:

1. **Understudy controls hidden.** The understudy toggle, the auto-promote explanation, and the understudy column or badge are not rendered. The `is_understudy` column and the promote trigger are untouched; switching back to production shows the data again.
2. **Page minis.** `MiniDef` gains an optional `byKind?: Partial<Record<OrgKind, MiniDef>>`. `resolveMiniRole` picks the kind variant when present. First pass: Get running, Today, Dates minis. Other minis use the shared sentences with variables.
3. **Help center.** Help items gain the same optional `byKind`. First pass: the answers that explain shows, casts, and understudies (about five). Plus one new answer for all kinds: "What does workspace type change" (EN + DE, Du).
4. **Sample data.** The dashboard first-run `SamplePreview` and Get running preview fixtures use staffing names (a client project and shifts). Fixture text only.
5. **Role intro sentences** in `app.config.ts` and the `org-invitation` email use the vocabulary.

### R6. Server-generated content (emails, PDFs)

- `resolveOrgKind(admin, orgId): Promise<OrgKind>` in `supabase/functions/_shared/orgKind.ts`, beside the mirrored registry. Reads `organizations.org_kind`; `orgId == null` or any read error resolves to `production`.
- `resolveEmailCopy(override, locale = 'en', kind = 'production')` and `resolveHireOrderCopy(overrides, locale = 'en', kind = 'production')`: after selecting the locale base and layering the sparse override, apply a plain `{{noun}}` substitution from `VOCABULARY[kind][locale]`. Defaults keep every existing call byte-identical. Admin-authored per-org overrides are org data and are substituted too if they contain a variable, otherwise left as typed.
- `send-transactional-email` resolves kind at the same choke point where it resolves locale and threads it into `resolveTemplatePresentation`. `generate-hire-orders` resolves kind at the `issue` and `preview` render sites. Issued PDFs freeze copy into `issue_snapshot`, so kind bakes in at issue time.
- `preview-transactional-email` accepts an explicit `body.kind` for admin QA; the Email Templates editor gets a Workspace type preview toggle next to the EN/DE toggle.

### R7. Pickers (four surfaces, one component)

- `OrgKindSelect` in `src/components/settings/`: a `Select` over `ORG_KINDS` with `ORG_KIND_LABELS` and a one-line description per kind (EN/DE). Used by:
  1. `NewOrgDialog` (Platform): sent to `provision-org`.
  2. `EditOrgDialog` (Platform): calls `set_org_kind`.
  3. `OrganizationTab` (Settings, Organization): calls `set_org_kind`; `readOnly` follows the existing admin capability gate.
  4. Get running: an early step "Workspace type" in the v3 wizard, before the dates-source step, defaulting to the current value. Calls `set_org_kind`.
- On success: invalidate `['orgs']` so `currentOrg` refreshes and the bridge swaps vocabulary immediately; `toast.success`.
- **Visual approval.** Per the owner's standing rule, surfaces 3 and 4 are mocked up and approved before PR 1 implementation starts.

## Testing

| Layer | What |
|---|---|
| Unit | registry key parity + copy-lint on vocabulary values; `VocabularyBridge` re-render; `roleLabel(role, kind)`; `termLabel` by kind; noun scanner; `vocabularyDiff.test.ts` (production byte-identity report vs `origin/main`); `resolveMiniRole` with `byKind`; `OrgKindSelect` |
| Data | `fetchOrgs` selects `org_kind`; `setOrgKind` calls the RPC (supabaseFake) |
| pgTAP | CHECK constraint rejects unknown kinds; `set_org_kind` rejects non-admins and accepts admins and super-admins; `has_function_privilege` for `service_role` |
| Deno | `resolveOrgKind` (row, null org, read error); `resolveEmailCopy` and `resolveHireOrderCopy` byte-identical with defaults, substituted with `staffing`; `provision-org` accepts and rejects `org_kind` values |
| E2E | one Playwright smoke: switch an org to staffing in Settings, assert the nav reads People and Shifts, switch back |

Coverage thresholds unchanged.

## Delivery

Three PRs, each shippable, invisible to production orgs until PR 3:

1. **Mechanism.** R1, R2, R3, R7, the noun scanner (allowlisting everything, tightened in PR 2). Production vocabulary wired; every string reads as today.
2. **Copy audit.** R4 in full, EN and DE (locale files only). Mechanical; run by a subagent with the noun scanner as the acceptance gate, German reviewed by the owner.
3. **Presentation and server.** R5, R6, the preview toggle, help answer, changelog, plus the email and PDF copy maps converted to variables (moved here from PR 2: the edge copy maps are file-mode mirrors that cannot import the locale table, so they belong with the R6 server work).

Changelog: one `### New` entry, "Workspace type", written for admins, in the release that ships PR 3. Help center impact: yes (R5.3). Page minis: yes (R5.2). System map: no automation change, no update.

## Risks

- **i18next re-render trick** (R3). If `changeLanguage` to the same language does not re-render in the installed react-i18next version, fall back to a React `key` on the routed tree keyed by kind. The bridge test decides which.
- **German grammar** (R4). Some sentences will read stiffly when made article-free. The owner reviews the DE diff of PR 2 with that in mind.
- **Cold-load flash** (R3). One render of production words for a staffing org before `currentOrg` resolves. Accepted for v1.

## PR 3 resolutions (as shipped, 2026-09-15)

Where the implementation deviated from R5/R6 above, with the reason:

- **R5.1 standby kept, not hidden.** Owner decision (2026-09-14): standby is valid for both workspace types and reads the org vocabulary word (production "Understudy", staffing "Standby"), rather than being hidden for staffing. PR 2 had already tokenized most understudy labels; PR 3 tokenized the residual hardcoded ones: the cockpit cast-group titles, the calendar "Needs you" standby pill and the SlotsStep short label (both kind-varying in EN and DE), and the stored SlotsStep slot names. No `showsUnderstudies` gate or hook was built.
- **R5.2 minis.** No `byKind` on `MiniDef` was needed: the mini text already interpolates the vocabulary (PR 2). The decorative illustrations were made vocabulary-aware in PR 3 (owner decision 2026-09-15) via an `ArtEntry` union plus `resolveArt`, resolved on the English kind table so illustrations stay English previews. Get running / Today / Dates minis do not exist; the five real page minis with domain nouns were converted.
- **R5.3 help.** No `aByKind` on `HelpItem` was needed: `HelpItemRow` already interpolates the vocabulary. Only the new cross-role explainer shipped, as one admin item (`A3.18`, Settings then Organization).
- **R5.4 sample data.** Dropped. `SamplePreview` was never built and `SAMPLE_PREVIEW` was orphaned (unreachable, including by demo orgs), so the dead fixture and its types were deleted rather than given a staffing variant.
- **R5.5 role intro.** `roleDescription(role, kind)` is kind-aware (production byte-identical, derived from vocabulary token templates), wired at the accept-invite success card (joined org's kind) and the People pane (active org's kind). "show dates" stays literal there, matching `org-invitation.roleIntroProducer`.
- **R6 signatures.** `resolveEmailCopy`/`resolveHireOrderCopy` take a resolved `vocab: Record<string, string>` table, not a `kind`: the file-mode copy mirrors cannot import the registry at both relative depths, so the caller (outside the mirror) supplies `VOCABULARY[kind][locale]`. The PDF runtime data tokens `{{cast}}`/`{{artist}}` were renamed `{{castRef}}`/`{{artistName}}` to stop colliding with the `cast`/`artist` vocab keys. Some production email/PDF `hireOrder` literals were aligned to the registry word "contract"/"Engagementvertrag" (owner-approved byte-identity exception).
- **E2E.** The staffing vocabulary swap is covered by the existing Playwright smoke; a cockpit-standby scenario was deferred (it needs seeded cockpit data and a live local stack) with the cockpit wording unit-covered instead.
