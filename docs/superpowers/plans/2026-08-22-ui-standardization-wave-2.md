# UI Standardization Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dormant ADR 0012 UI-conventions lint on and migrate all feature code onto the design tokens and primitives, then surface the visible deltas in the changelog.

**Architecture:** Wave 1 shipped the foundation (primitives, `TONES`, `docs/ui-conventions.md`, a dormant `eslint/ui-conventions.js`). Wave 2 is enforcement + adoption: add the missing `fontSize` scale, mechanically sweep ~1,090 raw-value violations across ~203 feature files onto tokens, tune two over-broad lint selectors, wire the lint on as `error`, adopt the 8 primitives at their catalogued call sites, and fold the Wave 1+2 visible deltas into the last changelog entry.

**Tech Stack:** React 18 + TypeScript, Tailwind CSS v3 (config-driven tokens), ESLint flat config (`no-restricted-syntax`), Vitest.

**Spec:** `docs/superpowers/plans/2026-08-22-ui-standardization-wave-2-handover.md` (the Wave 2 handover) and `docs/ui-conventions.md` (the enforced spec).

## Global Constraints

- **No raw values in feature code** (everything under `src/**` except `src/components/ui/**`, `**/*.test.*`, `src/i18n/**`). No hex, no `rgba()`, no `text-[Npx]`, no `rounded-[Npx]`, no `rounded-sm/md/lg`, no bracket alpha, no hand-rolled uppercase eyebrow. The primitives in `src/components/ui/**` are exempt and keep their bracket sizes.
- **Type scale is 48 / 32 / 22 / 17 / 14 / 13 / 12 / 11.** Half-steps (10.5/11.5/12.5/13.5) and off-scale sizes do not exist; round to the nearest step. 13 is the control size.
- **Radius scale:** `xs` 4 / `s` 6 / `m` 8 / `l` 10 / `xl` (14, CSS var only, no utility) / `xxl` 20 / `pill`. Radii nest inward (card 10 ⊃ button 8 ⊃ chip 4).
- **Accent text is `text-accent-text`, never `text-accent-700`.**
- **Status colour comes from `TONES`** (`src/components/ui/tones.ts`): `confirmed | waiting | risk | accent | neutral`. Amber = waiting on a human, red = risk.
- **Copy:** no em/en dashes, no exclamation marks, no emoji; German is Du-form. (Enforced by `src/i18n/copyLint.test.ts`.)
- **Behavior-preserving:** every edit is a class rename or a primitive swap that renders the same. Snapshot tests that assert old classes will churn; regenerate with `npx vitest run -u` and confirm the diff is only the expected renames.
- **Green gates for every task:** `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`, `npx vitest run` all pass. CI runs `--max-warnings 0`.
- **Subagents doing the sweep must NOT run git commands** (no add/commit/reset). They edit files only; the orchestrator commits.

---

## Reference A — `fontSize` token map (added in Task 1)

| utility | px | role |
|---|---|---|
| `text-eyebrow` | 11 | eyebrow / badge |
| `text-caption` | 12 | captions, count chips |
| `text-control` | 13 | buttons, inputs, table cells, nav rows |
| `text-body` | 14 | body copy |
| `text-title-sm` | 17 | card titles |
| `text-title` | 22 | section headers |
| `text-display-sm` | 32 | page H1 |
| `text-display` | 48 | hero |

Defined as **plain string values** (no line-height tuple) so replacing `text-[13px]` emits only `font-size`, preserving inherited line-height. These are additive (Tailwind `extend`); the built-in `text-xs`/`text-sm`/`text-base`/`text-lg`/`text-xl` etc. remain unchanged, and the code that already uses `text-xs`/`text-sm` is untouched.

## Reference B — bracket font-size → token mapping (the sweep)

**Exact on-scale (blind-safe):**
`text-[48px]`→`text-display` · `text-[32px]`→`text-display-sm` · `text-[22px]`→`text-title` · `text-[17px]`→`text-title-sm` · `text-[14px]`→`text-body` · `text-[13px]`→`text-control` · `text-[12px]`→`text-caption` · `text-[11px]`→`text-eyebrow`

**Off-scale → nearest step (default; per-file judgment may override, and 8–10px labels especially may instead route through a primitive or accept the bump — eyeball dense layouts):**
`[10px]`→`text-eyebrow` (11) · `[10.5px]`→`text-eyebrow` · `[9px]`/`[9.5px]`/`[8px]`→`text-eyebrow` (verify it does not overflow a dense chip) · `[11.5px]`→`text-caption` (12) · `[12.5px]`→`text-control` (13) · `[13.5px]`→`text-control` (13) · `[15px]`→`text-body` (14) · `[18px]`/`[19px]`→`text-title-sm` (17) · `[26px]`→`text-title` (22) · `[28px]`/`[34px]`/`[36px]`→`text-display-sm` (32)

## Reference C — radius mapping (the sweep)

- **Aliases (px-identical, blind-safe):** `rounded-sm`→`rounded-s`, `rounded-md`→`rounded-m`, `rounded-lg`→`rounded-l`. Same for directional variants: `rounded-{t,b,l,r,tl,tr,bl,br}-{sm,md,lg}` → `-{s,m,l}`.
- **Bracket radius:** `[4px]`→`rounded-xs` · `[6px]`→`rounded-s` · `[8px]`→`rounded-m` · `[10px]`→`rounded-l` · `[20px]`→`rounded-xxl` · `[2px]`/`[1px]`/`[3px]`→`rounded-xs` (round to 4) · `[7px]`→`rounded-s` (6) · `[14px]`→`rounded-[var(--radius-xl)]` (no utility exists at 14; the CSS-var bracket is NOT a lint violation — the rule only matches numeric `px`) · `[12px]`→`rounded-xl` (Tailwind built-in 12, exact) · `[16px]`→`rounded-2xl` (built-in 16).

## Reference D — other sweeps

- **`text-accent-700`** → `text-accent-text`. Rendered-color change (accent-700 is a fixed hex, accent-text flips with the role token across modes). Eyeball a few in dark mode.
- **Raw hex `#rrggbb`** → the nearest semantic token or `var(--*)`. Per-site judgment (see the specific hex against `src/index.css`).
- **Bracket alpha** (`bg-x/[0.04]`, accent-scale opacity `bg-accent-500/20`) → a solid stop, an `rgba()` literal, or a dedicated tint token. Accent numbered stops are hex, so `/NN` silently no-ops. (Only ~3 files; legitimate HSL-channel alpha like `bg-primary/80`, `bg-muted/80` is fine and the tuned lint will not flag it.)
- **`uppercase`** → `<Eyebrow>` where it is a hand-rolled eyebrow (`text-[11px] font-semibold uppercase tracking-[...]`). A genuinely-uppercase non-eyebrow use keeps `uppercase` with an `// eslint-disable-next-line no-restricted-syntax` + reason. **Note:** `<Eyebrow>` renders a block `<p className="m-0">`; do not drop it in where an inline `<span>` is required by the layout. This overlaps Task "Primitive adoption".

## Reference E — primitive signatures (for the adoption task)

```ts
// src/components/ui/tones.ts
type Tone = 'confirmed' | 'waiting' | 'risk' | 'accent' | 'neutral';

Eyebrow({ tone?: Tone /* 'neutral' */, section?: boolean, className?, children })   // renders <p class="m-0 font-semibold uppercase ...">
Metric({ size?: 'inline'|'body'|'lg' /* 'inline' */, className?, children })          // renders <span class="font-mono tabular-nums ...">
KpiTile({ label: string, value: string, note?: string|null, tone?: Tone, className? })
StatusPill({ tone: Tone, ... })            // src/components/ui/status-pill.tsx
StatusDot({ tone: Tone, shape?: 'dot'|'bar', className? })
CountChip({ active?: boolean, children })
PageHeader({ eyebrow?: string, eyebrowTone?: Tone, title: string, sub?: string, actions?: ReactNode })
EmptyState(WithAction | WithReason)        // must have action OR explicit reason prop
```

---

## Task 1: Foundation — loose ends, fontSize tokens, selector tuning

Everything here lands green **before** any sweep and **before** the lint is wired on. One commit.

**Files:**
- Modify: `src/components/admin/people/InviteBar.tsx:86-90` (loose end §0.1 — DONE in this session, verify present)
- Modify: `CLAUDE.md` (loose end §0.2)
- Modify: `tailwind.config.ts` (add `fontSize` extend, Reference A)
- Modify: `eslint/ui-conventions.js` (tune two selectors, §3)

**Interfaces:**
- Produces: the `text-eyebrow … text-display` utilities every sweep task consumes; the tuned lint that Task "Wire lint on" flips to `error`.

- [ ] **Step 1: InviteBar loose end** — confirm `src/components/admin/people/InviteBar.tsx` resend control is the link-styled `<button className="text-control font-medium text-accent-text hover:underline disabled:pointer-events-none disabled:opacity-50">` (not `<Button variant="secondary">`), and `Button` is still imported/used elsewhere in the file.

- [ ] **Step 2: CLAUDE.md loose end** — in the "No raw values" hard rule (~line 18), change "The lint fails." to state that `eslint/ui-conventions.js` is wired on in Wave 2 and to write token-clean now regardless.

- [ ] **Step 3: Add the `fontSize` map** to `tailwind.config.ts` under `theme.extend`, as plain strings:
```ts
fontSize: {
  eyebrow: "11px",
  caption: "12px",
  control: "13px",
  body: "14px",
  "title-sm": "17px",
  title: "22px",
  "display-sm": "32px",
  display: "48px",
},
```

- [ ] **Step 4: Tune the `uppercase` selector** in `eslint/ui-conventions.js` so it only fires on the Tailwind `uppercase` utility inside a className string, not any literal containing the substring `uppercase`. Anchor it to a className context, e.g. match `uppercase` only when preceded/followed by a class-token boundary (space, quote, or `-`), so comments and data values like `"text-transform"` docs do not trip it. Suggested: `Literal[value=/(^|[\\s'"\`])uppercase([\\s'"\`]|$)/]`.

- [ ] **Step 5: Narrow the alpha selector** in `eslint/ui-conventions.js` so it flags only (a) bracket alpha `-[0.NN]` and (b) accent-scale opacity `accent-\d00/\d+` (which no-ops), and does NOT flag valid HSL-channel utilities `bg-primary/80`, `bg-muted/80`, `active:bg-accent/80`. Suggested two selectors: `Literal[value=/\\b(bg|text|border)-[a-z-]+\\/\\[[0-9.]+\\]/]` and `Literal[value=/\\b(bg|text|border)-accent-[0-9]00\\/[0-9]+/]`.

- [ ] **Step 6: Verify green** — `npx tsc -p tsconfig.app.json --noEmit` && `npm run lint` && `npx vitest run`. (Lint still dormant here, so this only proves nothing regressed.) Sanity-check the new utilities compile: `grep -q "text-control" tailwind.config.ts`.

- [ ] **Step 7: Commit** — `feat(ui): add fontSize scale, tune ui-conventions selectors, wave1 loose ends`

---

## Tasks 2–10: The sweep (one task per directory cluster)

Each cluster task applies **References B, C, D** to every violating file in its directory set, using the decision rules (on-scale = mechanical; off-scale / uppercase / hex = judgment). Dispatch as parallel subagents (disjoint directories → no file conflicts). Each subagent: edits files only, then reports the files it changed; the orchestrator runs the gates and commits per cluster (or one squashed commit).

**Per-cluster gate (orchestrator runs after each):** `npx tsc -p tsconfig.app.json --noEmit` && `npx vitest run` (regenerate churned snapshots with `-u`, eyeball the diff is only class renames). Do **not** run the ui-conventions lint as a gate yet — it is still `warn`/dormant; the completion check is Task 11.

- [ ] **Task 2 — `settings/` (44 files):** `src/components/settings/**`
- [ ] **Task 3 — `calendar/` (21 files):** `src/components/calendar/**`
- [ ] **Task 4 — `hireOrders/` (17 files):** `src/components/hireOrders/**`
- [ ] **Task 5 — `shows/` + booking surfaces (27 files):** `src/components/shows/**`, `src/components/bookings/**`, `src/components/casts/**`, `src/components/catalog/**`, `src/components/availability/**`, `src/components/dashboard/**`
- [ ] **Task 6 — `getRunning/` + `today/` (20 files):** `src/components/getRunning/**`, `src/components/today/**`
- [ ] **Task 7 — `platform/` + `demo/` + `admin/` (19 files):** `src/components/platform/**`, `src/components/demo/**`, `src/components/admin/**`, `src/components/auth/**`
- [ ] **Task 8 — `minis/` + `brand/` (10 files):** `src/components/minis/**`, `src/components/brand/**`
- [ ] **Task 9 — `help/` + `layout/` + `filters/` + `artists/` (18 files):** those four dirs
- [ ] **Task 10 — `pages/` + `lib/` + `features/` + `main.tsx` (27 files):** `src/pages/**`, `src/lib/**`, `src/features/**`, `src/main.tsx`

Each task's step shape:
- [ ] Enumerate the cluster's violating files (`grep -rEl '<the six patterns>' <dir> | grep -v .test.`).
- [ ] For each file: apply References B/C/D. On-scale sizes and radius aliases are mechanical; off-scale sizes, hex, and `uppercase` use judgment per the reference notes.
- [ ] Report changed files (no git).
- [ ] (Orchestrator) `tsc` + `vitest run -u`; eyeball snapshot diff; commit `refactor(ui): token sweep — <cluster>`.

---

## Task 11: Wire the lint on as error, prove zero violations

**Files:** Modify `eslint.config.js`.

- [ ] **Step 1:** Uncomment `import { uiConventions } from './eslint/ui-conventions.js';` (the "Wave 2 (ADR 0012)" hook).
- [ ] **Step 2:** In `eslint/ui-conventions.js`, flip both `no-restricted-syntax` and `no-restricted-imports` from `'warn'` to `'error'`.
- [ ] **Step 3:** Add `uiConventions` to the exported `tseslint.config(...)` array in `eslint.config.js`.
- [ ] **Step 4: Run `npm run lint`.** Expected: PASS with 0 warnings/errors. If any ui-conventions violation remains, it names the file+rule — fix it (it belongs to a cluster that missed a case) and re-run until clean.
- [ ] **Step 5: Full green** — `npx tsc -p tsconfig.app.json --noEmit` && `npm run lint` && `npx vitest run`.
- [ ] **Step 6: Commit** — `feat(ui): enforce ui-conventions lint as error (ADR 0012 wave 2)`.

---

## Task 12: Primitive adoption

Behavior-preserving swaps at the catalogued sites. Under test; eyeball each surface.

**Files (from the handover §4):**
- Modify: `src/components/platform/systemHealth/primitives.tsx:20-25` — delete the duplicate state-based StatusPill/StatusDot pair; map `HealthState → Tone` at the call sites and use canonical `src/components/ui/status-pill.tsx` / `status-dot.tsx`.
- Modify: `src/components/calendar/surface/SeasonKpis.tsx` — migrate the hand-rolled tile shape onto `KpiTile`.
- Modify: `OrdersKpis` (hire-orders KPIs) — migrate onto `KpiTile`.
- Modify: ~25 files that hand-write `text-[11px] font-semibold uppercase tracking-[1.6px]` → `<Eyebrow>` (this closes the `uppercase` sweep; watch the block-`<p>` vs inline-`<span>` caveat in Reference D).
- Modify: money/time/count/id numbers in feature code → wrap in `<Metric>`.
- Modify: obvious `PageHeader` / `EmptyState` / `CountChip` call sites.

- [ ] **Step 1:** systemHealth duplicate consolidation — write/adjust the `HealthState→Tone` map, swap to canonical primitives, delete the local pair. Run the systemHealth tests.
- [ ] **Step 2:** `SeasonKpis` + `OrdersKpis` → `KpiTile`. Run their tests.
- [ ] **Step 3:** Eyebrow adoption sweep (the ~25 hand-rolled eyebrows). Run `vitest run -u`.
- [ ] **Step 4:** Metric / PageHeader / EmptyState / CountChip adoption at obvious sites.
- [ ] **Step 5: Green** — `tsc` + `npm run lint` (now error) + `vitest run`.
- [ ] **Step 6: Commit** — `refactor(ui): adopt primitives at catalogued sites (ADR 0012 wave 2)`.

---

## Task 13: Changelog — fold Wave 1+2 visible deltas into the last entry

Per the user's instruction, **combine with the last changelog entry** (`1.17.1 — August 21, 2026`) rather than cutting a new version. That entry is already the UI-polish entry ("buttons you can see"), so the Wave 1+2 visible deltas belong there.

**Files:** Modify `public/changelog.md`; regenerate `public/changelog.json`.

- [ ] **Step 1:** In `public/changelog.md`, extend the `## 1.17.1` block with the Wave 1+2 end-user-visible deltas only (no refactors/tests/CI/lint). Candidate bullets, plain language, no dashes-as-punctuation:
  - **Improved — Clearer buttons and cards** — consistent button styles and card depth across the app (already partly captured by the existing "buttons you can see" bullet; merge, do not duplicate).
  - **Fixed — Risk shows in red** — warnings that mean a date is at risk now read red instead of amber, so "waiting on someone" and "at risk" look different.
  - Keep the existing bullets; only add what is genuinely user-visible and not already stated. If nothing new is genuinely visible beyond the existing bullets, note that in the PR and make no change.
- [ ] **Step 2:** Regenerate JSON: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`. Never hand-edit `public/changelog.json`.
- [ ] **Step 3:** `npx vitest run` (copyLint covers changelog copy for dashes/exclamation). Commit — `docs(changelog): fold ui standardization deltas into 1.17.1`.

---

## Task 14: Visual confirmations (§5) — running app

Needs a booted local stack (`npm run local:up` then `npm run dev`, or the Browser pane preview). Confirm the Wave 1 visual decisions still read right after the sweep; fold any fix into the touching commit.

- [ ] Cockpit "settings" affordances (`CockpitHeader.tsx`, `CockpitRail.tsx`) not over-emphasized as accent links.
- [ ] Email-templates segmented toggle (`EmailTemplateEditorPage.tsx`) selected state still reads selected.
- [ ] Offers-tab stacked `elevation={2}` cards not too heavy.
- [ ] Cards that lost their default shadow don't read flat inside dialogs/popovers/sheets (add `elevation={2}` where needed).
- [ ] Red `risk` badges read as risk, not alarm, on the get-running board.
- [ ] Spot-check `text-accent-700`→`text-accent-text` sites in dark mode.

---

## Self-review notes

- **Spec coverage:** §0→Task 1 · §1→Task 1 · §2→Tasks 2–10 · §3→Tasks 1(selectors)+11(wire) · §4→Task 12 · §5→Task 14 · §7 changelog→Task 13. §6 (SegmentedControl, Table density, Sidebar, tint tokens, Design System rebind) is explicitly out of scope for this wave.
- **Type consistency:** Tone union and primitive signatures pinned in Reference E from the actual source.
- **Out of scope:** §6 new components and the German native-speaker QA (§7) are separate tracks.
