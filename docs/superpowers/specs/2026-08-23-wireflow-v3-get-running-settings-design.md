# Wireflow v3 — Get running + Settings redesign

Design source: Claude Design project `02c15575-91a6-4acd-92fc-e006a5cf1b88`, file
`Wireflow v3.dc.html` (+ `BoardPhases`, `SourceImport`, `Coverage`, `OfferFlow`,
`Run2Steps`, `Run3Steps`, `W2 Artists`, `W3 Letterhead`, `Contracts`, `PartsEditor`).
Design system: `_ds/showflow-design-system-019dff72-…/colors_and_type.css` (light,
violet accent, Geist) — the app already ships the equivalent tokens, so no new
design tokens are introduced.

Status: DESIGN (awaiting owner review). Branch: `claude/wireflow-v3-design-f3338b`.
Relates to `2026-08-17-setup-settings-design/` (the v1 board that this replaces) and
the memory note `setup-settings-getrunning-initiative`.

---

## 1. Goal

Replace the just-shipped side-panel Get running board with Wireflow v3: **one board
that foreshadows three phase-wizards**. Each phase expands inline out of its own
board card into a three-column wizard (step rail / step body / "How this works"
guide + sticky footer); the other phases stay in view as one-line rows. Mirror the
same board inside `/settings` directly below "How this org works", where it becomes
the permanent home once the nav item retires. Everything stays role-, module- and
entitlement-aware. No observability is lost.

## 2. Locked decisions (owner, 2026-08-23 via AskUserQuestion)

1. **Scope**: architectural spec + **phased plan**, each phase its own PR.
2. **New capabilities**: **build them now** — a Google-Sheet→dates importer and a
   per-cast fee (extended per decision 5 below).
3. **Settings sunsetting**: **mirror + flag, minimal removal** — mirror the board
   under "How this org works"; keep every existing tab; deliver a documented
   deprecation map; remove nothing until the owner approves each removal.
4. **Ladder + eligibility**: **merge** into one "Casts and the ladder" step (the
   city×tier Coverage matrix), keeping both underlying writes.
5. **Per-cast fee granularity**: **fee per (cast × production)**.
6. **Rollout**: **behind a feature flag** (`getrunning_v3`), flipped on once all
   phases land; the v1 board stays intact until then.

Supersedes-design rule (owner): copy that is true to functionality, role and
configuration **always** wins over the design's copy. The design's layout/interaction
is authoritative; its wording is a draft.

## 3. Current state (what exists today)

- **Board**: `src/pages/GetRunningPage.tsx` — 3 phases (`get_dates`, `bookable`,
  `paperwork`), **11 tasks**, a **440px side panel** (`TaskPanel` +
  `taskPanelRegistry`). Pure model in `src/lib/getRunning/tasks.ts`
  (`composeGetRunning`), deep-linking in `taskFeature.ts`.
- **Editors already built** (reused as step bodies): `SlotsStep`, `FlowStep`,
  `TimingStep`, `LetterheadStep`, `TermsStep`, `CountersignStep`, and the panel
  bodies `DatesPanelBody`, `PeoplePanelBody`, `LadderPanelBody`,
  `EligibilityPanelBody`, `TeamPanelBody`, plus `panels/airtable/AirtableConnect`.
- **Settings**: `src/pages/SettingsPage.tsx` — 14 tabs in 6 groups; "How this org
  works" (`HowThisOrgWorks`) is the first tab and the admin/producer default.
  Tab whitelist + gating in `src/lib/settingsTabs.ts`.
- **Airtable observability** (must persist): `AirtableSyncTab` +
  `useAirtableConsole` — sync history, last/next run, imported/new/updated/held
  counts, held-record causes, errors, "Sync now". Shared with the board via the
  same query keys.
- **Nav**: `src/components/layout/navItems.ts` — "Get running" is first in
  `workspace`; "Help"/"Settings" in `system`.
- **Verified gaps**: Google Sheet is an **artists/contracts** import source only
  (`fetch-remote-sheet` + `bulkImportArtists`); there is **no** Sheet→`show_dates`
  path. Fee/currency exist only org-level (`OrderDefaultsCard`); no per-cast fee.

## 4. Target model

### 4.1 Phases and 16 steps

| # | Phase (`phase` key) | Step (`step` key) | Body source |
|---|---|---|---|
| 1 | `get_dates` "Get dates in" | `source` | NEW: source picker (Airtable / Google Sheet / by hand) |
| 2 | | `connect` | Airtable connect (reuse `AirtableConnect`) / Sheet link (NEW) |
| 3 | | `map` | reuse Airtable/Sheet mapping; **slots fold** confirm rides here |
| 4 | | `cities` | reuse catalog/city-link (`CatalogTab` logic) — cannot be skipped |
| 5 | | `productions` | NEW list + **PartsEditor** sheet (casting breakdown + required skills) |
| 6 | `bookable` "Make it bookable" | `artists` | reuse `PeoplePanelBody` (roster + paste import) |
| 7 | | `skills` | NEW step over existing `SkillsTab` logic (part↔artist skills) |
| 8 | | `coverage` | reuse Coverage matrix — **merges ladder + eligibility** |
| 9 | | `flow` | reuse `FlowStep` (presets + 4-line timeline) |
| 10 | | `timing` | reuse `TimingStep` |
| 11 | | `team` | reuse `TeamPanelBody` (invite Production Team) |
| 12 | `paperwork` "Contracts" | `letterhead` | reuse `LetterheadStep` (compact variant) |
| 13 | | `fee` | NEW: org fee defaults + per-(cast×production) fees |
| 14 | | `terms` | reuse `TermsStep` |
| 15 | | `document` | NEW step over hire-order numbering/layout (`NumberingCard`) |
| 16 | | `countersign` | reuse `CountersignStep` (never blocks) |

Renames vs v1 model: `dates`→split into `source`/`connect`/`map`/`cities`;
`slots`→folded into `map` + surfaced in `productions`; `people`→`artists`;
`ladder`+`eligibility`→`coverage`; add `skills`, `fee`, `document`.

### 4.2 Module / role gating (unchanged rules, re-applied per phase)

- No `booking_flow` entitlement → phases 1 + 2 absent (progress denominator shrinks).
- No `hire_orders` entitlement → phase 3 (Contracts) absent. Design is explicit:
  "an org without the Contracts module sees two phases and 11 steps".
- Contracts is **admin-only**; producers see it read-only as "waits on {admin}".
- Producers act on phases 1–2 per their capabilities (`canManageShows`,
  `canEditScheduling`, `canEditBooking`, `canAddArtists`, `canInvite`), exactly as
  `withActionability` does today. A step the viewer cannot act on renders read-only
  with "who to ask", per the design's "Rules" note.
- Progress is `N of {visibleSteps} done`; every counter reads from enabled modules.

### 4.3 Gating between phases (from the design)

- **Make it bookable waits on Get dates in**: phase 2 does not open until at least
  one production can be cast (a production with dates + parts). Card reads "Waits on
  Get dates in".
- **Contracts is independent but not "ready"**: it opens/completes any time (admin),
  but issuing needs one booked date, so the board only ever calls it *finished*,
  never *ready*.
- Board-level hard block for `source`…`productions` mirrors today's `hardBlock`
  (offers vs booking wording), kept board-side, not pushed into
  `computeBookingSetupStatus`.

## 5. Component architecture

### 5.1 `WizardShell` (the new core primitive)

`src/components/getRunning/wizard/WizardShell.tsx` — one frame for all three phases:

- **Header** (accent-50 band): phase number pill, phase name (17px), blocking chip
  (red "Blocks your first ask" / neutral "Admin" / "Waits on X"), an optional context
  chip (e.g. the picked source), `step N / M`, "Collapse" + close.
- **Body grid** `216px / minmax(0,1fr) / 268px`:
  - **Left step rail** — vertical stepper (done ✓ / current filled / pending),
    per-step title + hint line, connecting rule.
  - **Middle step body** — heading + subheading + the step's body component.
  - **Right guide** ("How this works") — title, body, 3 bullet points, a
    step-article link + Help center link. Content per step from a `STEP_GUIDE` map
    (i18n).
- **Sticky footer** — `step N / M`, a saved/consequence note, "Finish later" +
  primary action. The primary is portalled by the step body via the existing
  `TaskPanelFooterContext` pattern (renamed `WizardFooterContext`).

The shell is presentation-only; step bodies own their data/mutations.

### 5.2 Board (`GetRunningBoardV3`)

`src/components/getRunning/v3/GetRunningBoardV3.tsx`, rendered by
`GetRunningPage` when the flag is on and mirrored in Settings:

- Header: eyebrow "Get running", "One thing at a time", `N of M done` + progress bar.
- **Hero** "Where you left off" (accent-600 card): the single next action in display
  type + "Open step X" / "See all steps" + est. minutes.
- **"What is still shut"** card: "Your first ask" / "Your first contract" gates with
  "N steps away" amber chips + "Nothing else / Open".
- **"All N steps"** card: one **icon rail per phase**, each icon a step (filled /
  amber-on-blocking / pending), `title` on hover; per-phase `k / n` + summary line.
- **Phase rows** (1 per phase): number, name, status line, Continue / "Waits on X" /
  Start. Selecting a phase mounts `WizardShell` inline in place of that row; the
  other phases collapse to one-line rows above/below (see `Coverage`/`OfferFlow`
  screens for the collapsed sibling rows).
- **Footer**: role + module explanation + module on/off chips (Booking engine,
  Contracts).
- States: `NothingToSetUp` (no modules) and `RetiredBoard` (all done) are reused
  from v1, restyled to v3.

### 5.3 Step registry & model

- `src/lib/getRunning/steps.ts` (reshaped from `tasks.ts`): `GetRunningStepKey`
  (16), `GetRunningPhaseKey` (3), `composeGetRunningV3(input)` producing
  `{ phases: PhaseModel[], doneCount, totalCount, canFirstOffer, complete,
  nextStep, gates }`. Reuses `computeBookingSetupStatus` + `HireOrderSetupStatus`;
  maps their step outputs onto the 16 keys. `coverage.done` = ladder coverage-only
  done AND eligibility done (both writes behind one step).
- `src/lib/getRunning/stepFeature.ts` (extends `taskFeature.ts`): per-step
  `{ route, tab?, crumbKey, shortKey }` for breadcrumbs and deep-linking.
- Keep v1 `tasks.ts`/`taskFeature.ts` untouched while the flag is off; v3 lives
  alongside until cutover, then v1 is deleted.

## 6. New backend capabilities

### 6.1 Google Sheet → show dates importer

- New edge function `import-sheet-dates` (mirrors `airtable-poll`'s upsert into
  `show_dates`; DI + `_shared` helpers; `requireOrgRole(['producer','admin'])` +
  `requireFeature(booking_flow)`). Reads the published CSV via the existing
  SSRF-guarded `fetch-remote-sheet`; parses/maps client-side then a set-based RPC
  `import_sheet_dates(p_org, p_rows)` performs the upsert with the same city-hold
  and dedupe semantics as Airtable.
- The `source`/`connect`/`map`/`cities` wizard steps parameterize on
  `source ∈ {airtable, sheet, manual}`; Airtable reuses `useAirtableConsole`, Sheet
  uses the new path, manual jumps to `productions` (via `ShowFormDialog`).
- **Observability**: Sheet imports write the same sync-log shape so `AirtableSyncTab`
  (to be generalized to a "Sources"/sync console; see §8) shows Sheet runs too. A
  Sheet source keeps re-reading on the org's poll schedule, same as Airtable.
- Config: add `[functions.import-sheet-dates]` in `supabase/config.toml`.

### 6.2 Per-(cast × production) fee

- Migration: new table `cast_production_fees` (`org_id`, `cast_id`, `show_id`,
  `fee` numeric null, `currency`, `fee_basis`, timestamps; unique
  `(cast_id, show_id)`; RLS via `is_org_member`/`has_org_role` + `org_isolation`).
  Org defaults stay in `OrderDefaultsCard` (currency, `default_fee_basis`, VAT,
  travel, payment terms) — a new (cast×production) fee inherits them.
- The `fee` step (Run3Steps·fee): org "what every cast starts from" defaults
  (currency, counted per-date/engagement, net+VAT toggle, travel toggle, payment
  terms) + a per-(cast×production) fee list that appears once casts exist; amber
  gate "no casts yet → Open Casts and the ladder" (deep-link to `coverage`).
- Contract generation (`generate-hire-orders resolveFields`) reads the
  (cast×production) fee when present, else the org default. Data access in
  `src/data/*` + hook; pgTAP for RLS + resolution precedence.

## 7. Copy & i18n

- New `getRunningV3` namespace (or extend `getRunning`), EN + DE (Du, no dashes),
  keyParity + copyLint CI gates. Guide content (`STEP_GUIDE`) authored through
  `t()`; step-article + Help links point at real Help center items (update
  `src/lib/help/items.ts` in the same PR or state "no help impact").
- Copy remap (design → app), examples:

  | design | app copy |
  |---|---|
  | "Set parts on N productions" / "PartsEditor" | Casting breakdown / part (Position) |
  | "show" (the work) | production |
  | "slots" | parts / people-per-part |
  | phase names | Get dates in / Make it bookable / Contracts (keep) |
  | "hire order" | Contract / Engagementvertrag |

  Reuse `src/i18n/terms.ts` `TERMS`; add new domain terms there, don't inline.
- Numbers via `<Metric>`, uppercase via `<Eyebrow>`, tokens only, 13px controls —
  per `docs/ui-conventions.md`.

## 8. Settings mirror, retirement, deep-linking, deprecation

- **Mirror**: a new Settings section renders `GetRunningBoardV3` (same component,
  `context="settings"`) **directly below** the "How this org works" tab, admin +
  producer. Reached at `/settings?tab=get-running` (add to `SETTINGS_TAB_PARAMS`,
  order it right after `how-it-works`).
- **Retirement**: when `complete`, the nav item retires (reuse `useRailDismissed`);
  the Settings mirror is the permanent home. A phase can be re-opened there for a
  new season / a second source (design end-note).
- **Deep-linking into wizard steps** (extend `stepFeature.ts` + add
  `?step=<key>` handling to the board): `/dates` → `get_dates` (source/productions),
  `/productions` → `productions` (PartsEditor), `/artists` → `artists`,
  `/contracts` → Contracts phase, plus existing Settings-tab targets. Each page
  gains a lightweight "finish setup" affordance linking to its step (role/module
  gated, hidden once that step is done).
- **Airtable → Sources**: generalize `AirtableSyncTab` to host both Airtable and
  Sheet observability (keep the tab; consider relabel "Sources"/"Sync" — flag,
  don't rename without approval). `useAirtableConsole` stays the data layer; add a
  Sheet branch. **No observability removed.**
- **Deprecation map** (`docs/…/wireflow-v3-settings-deprecation.md`): every tab the
  wizard now duplicates, with keep/redirect/retire recommendation. Initial read:
  - Redundant editing surfaces (recommend later redirect-into-board): Booking engine
    (flow+timing), Casts & coverage (coverage), Skills (skills), Contracts settings
    (letterhead/fee/terms/document/countersign).
  - Keep untouched: Airtable/Sources, People, Roles & rights, Activity, Trust & data,
    Documentation, Organization, Notifications, Email templates.
  - **No tab is removed in this initiative without a separate owner approval.**

## 9. Testing

TDD per layer:
- Pure: `composeGetRunningV3`, step gating, progress denominator by module,
  `stepFeature` deep-link resolution, fee resolution precedence.
- Component (RTL): `WizardShell`, board (hero/gates/rails/phase rows), each new step
  body, PartsEditor sheet, Settings mirror, deep-link `?step=`.
- Edge (Deno DI): `import-sheet-dates`.
- DB (pgTAP): `cast_production_fees` RLS + `import_sheet_dates` RPC.
- Live dev-stack visual verification against each design screen before each PR.

## 10. Phasing plan

Each phase is its own branch/PR, all behind `getrunning_v3` (off) until Phase 5.

- **Phase 1 — Frame + board + model.** `WizardShell`, `GetRunningBoardV3`,
  `steps.ts`/`stepFeature.ts`, flag plumbing. Wire the **reuse-only** steps
  (artists, flow, timing, coverage-merge, letterhead, terms, countersign) into the
  frame. Parity with the design for existing content.
- **Phase 2 — Get dates in wizard.** source/connect/map(+slots fold)/cities/
  productions + PartsEditor, Airtable + by-hand real (no Sheet yet: source shows it
  disabled/"coming in Phase 4").
- **Phase 3 — Remaining bookable + Contracts steps.** skills, fee (org defaults +
  UI shell), document. Contracts phase faithful.
- **Phase 4 — New backend.** `import-sheet-dates` + Sheet source path;
  `cast_production_fees` + per-(cast×production) fee wired into the fee step and
  contract generation.
- **Phase 5 — Settings mirror + deep-linking + retirement + deprecation map;
  flip the flag on; delete v1 board code.**

## 11. Risks & open items

- **Large re-frame of a live surface** — mitigated by the feature flag and phased
  PRs; v1 stays until Phase 5.
- **`coverage` merge** — must preserve both `cast_city_priority` and
  `show_cast_eligibility` semantics behind one step; a city with no tier-1 stays the
  one hard rule (design).
- **Sheet importer parity** — must reproduce Airtable's city-hold, dedupe and
  slots-guard rules to avoid divergent behavior; reuse the same RPC shape.
- **Fee precedence** — (cast×production) → org default; contract generation and the
  offer mail must agree on which fee is quoted.
- **i18n volume** — every new string EN+DE up front.

## 12. Out of scope

- Removing any Settings tab (separate approvals per the deprecation map).
- Full 3-channel nudge (deferred earlier).
- Artist-facing surfaces (Availability/Profile) — unchanged.
- Documentation/System map and Platform console (super-admin only).
