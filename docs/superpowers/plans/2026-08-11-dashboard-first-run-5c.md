# Dashboard First Run 5c Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is designed to run in **three waves**: Wave A (contracts, sequential) → Wave B (six independent tasks, **run concurrently**) → Wave C (integration, sequential barrier). Wave B tasks touch **disjoint new files** and can be dispatched in parallel in the same worktree.

**Goal:** Replace the dashboard first-run surface (welcome banner + `DashboardSetupRail` + rich `SamplePreview`) with the config-driven **stage chain** from Claude Design variant 5c: a header card + progress cluster, an off-footer strip, a horizontal "How a date will move" chain with setup steps docked into the stage they unblock, a reassurance card, and a sample/live queue — all composed from the org's real entitlements, flow, capabilities, data, and setup readiness.

**Architecture:** A pure composer (`composeStageChain`) turns `{role, entitlements, flow, capabilities, setup readiness, live metrics}` into a `StageChainResult` (header copy + stages with docked steps + hot/plain/dim state + side/queue copy). Presentational components render that result. `useDashboardFirstRun` becomes the integration hook that feeds real hooks into the composer and fixes the `show` gate so a no-module org gets an explicit floor state instead of nothing. `DashboardPage`/`ArtistDashboard` render one new `DashboardFirstRun` surface. The existing editable wizard (`SetupChecklistSheet` → `BookingSetupRail`) is unchanged and becomes the target a stage CTA opens.

**Tech Stack:** React 18 + TS, Vite, Tailwind v3 + shadcn, `@tanstack/react-query` v5, Vitest + jsdom + @testing-library/react. Data-access via `src/data/**` fns taking the client; tests use `src/test/supabaseFake.ts` + `renderWithProviders.tsx` + `fixtures.ts`.

## Global Constraints

- **Copy: no em-dashes / en-dashes.** The 5c source copy (Appendix A) contains em-dashes; when porting, replace every `—`/`–` with a period, comma, or colon. Middot `·` and arrows are allowed. (House rule.)
- **Semantic tokens only.** Use `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary-foreground`, accent-scale utilities (`bg-accent-100`, `text-accent-700`, `bg-accent-500`). Tokens with no named utility use arbitrary values matching the house idiom: `text-[var(--text-faint)]`, `bg-[var(--surface-3)]`, `text-[var(--amber-600)]`, `bg-[var(--amber-100)]`, `shadow-elev2`, `rounded-[14px]` (14px hero radius has no utility). Accent numbered stops do **not** support `/opacity` — never write `bg-accent-500/20`.
- **Week starts Monday** (not relevant to any grid here, but keep in mind if a calendar appears).
- **Admin marker is per step, from the real registry `ctaCapability`** — NOT the design's coarse `capBlocked`. `shows` has no capability (both roles); `people` gates on `add_artists` (default ON for producers); `flow`/`slots`/`ladder`/`eligibility`/`timing` gate on `edit_booking_settings`; hire `letterhead`/`terms`/`countersign` gate on `edit_hire_order_settings`. Admins always pass (`useCan` short-circuits). A step is `admin`-marked when the viewer lacks its `ctaCapability`.
- **Step titles + todo hints come from the existing registries**, not re-typed: `STEP_TITLES` (`src/lib/bookings/setupStatus.ts`), `bookingOnboarding.steps[key].todoHint` / `hireOrderOnboarding.steps` / `ARTIST_ONBOARDING.steps` / `TEAM_STEP_META` (`src/lib/dashboard/moduleOnboarding.ts`). Only stage-level copy (names, tags, lines, badges, metric labels, head/side/queue copy) is new (Appendix A).
- **Times in copy are live, not "09:00 / 48h".** Read the org's `offer_digest_hour_berlin` and `offer_response_window_hours` (settings) and format them; 5c's `09:00`/`48 hours` are demo placeholders.
- **TDD per task.** Pure logic → Vitest with fixtures (import the real module; never re-implement). Components → `renderWithProviders`. Data-access → `supabaseFake`. Never `vi.mock` the client. `any` is banned (CI `--max-warnings 0`).
- **Type-check split:** after any `src/` change run `npx tsc -p tsconfig.app.json --noEmit`. Run `npm run lint` and `npx vitest run` before each commit.
- **Branch:** `claude/dashboard-first-run-design-780363`. Commit per task (`git add <files> && git commit -m "…"`), imperative lowercase ≤72 chars.

---

## File Structure

| File | Responsibility | Wave |
|---|---|---|
| `src/lib/dashboard/stageChain.types.ts` (create) | All shared types + the `StageChainInput`/`StageChainResult` contract. Nothing else imports 5c code without importing this. | A |
| `src/lib/dashboard/stageChain.ts` (create) | Pure `composeStageChain(input): StageChainResult` — the port of `over10` reading real done-ness/hints/metrics. + `stageChain.test.ts`. | B1 |
| `src/components/dashboard/firstRun/StageCard.tsx` (create) | One stage card in hot/plain/dim variant. | B2 |
| `src/components/dashboard/firstRun/DashboardChain.tsx` (create) | The horizontal chain: arrows + `StageCard`s. | B2 |
| `src/components/dashboard/firstRun/FirstRunHeaderCard.tsx` (create) | Header card: eyebrow/headline/body/ghost/hint + progress cluster (ticks) + module on/off list. | B3 |
| `src/components/dashboard/firstRun/OffFooters.tsx` (create) | The off-footer strip (unlicensed modules). | B4 |
| `src/components/dashboard/firstRun/FirstRunSideCard.tsx` (create) | "Nothing here blocks the rest of the app" card + side links. | B4 |
| `src/components/dashboard/firstRun/FirstRunQueue.tsx` (create) | Sample/live queue list. | B5 |
| `src/hooks/useFirstRunMetrics.ts` (create) | Assembles `FirstRunMetrics` + `FirstRunProvenance` + digest/window settings from existing hooks + the new ready-to-offer aggregate. | B6a |
| `src/data/bookings.ts` (modify) + `src/lib/bookings/readyToOffer.ts` (create) | New org-wide opened-tier read + pure `countReadyToOffer` derivation. | B6b |
| `src/data/settingsAudit.ts` / `src/hooks/useBookingFlowProvenance.ts` (create) | Role-split provenance resolver. | B6c |
| `src/components/dashboard/firstRun/DashboardFirstRun.tsx` (create) | Assembles header + off-footers + chain + side + queue from a `StageChainResult`; owns CTA→(route/openSetup) wiring + dismiss/collapse. | C1 |
| `src/components/dashboard/firstRun/useDashboardFirstRun.ts` (modify) | Feed real hooks into `composeStageChain`; fix `show` gate for the floor case; return the assembled state + handlers. | C2 |
| `src/pages/DashboardPage.tsx` + `src/components/dashboard/ArtistDashboard.tsx` (modify) | Render `DashboardFirstRun`; retire welcome/rail/rich SamplePreview on first run. | C3 |

**Reused unchanged:** `SetupChecklistSheet`, `BookingSetupRail`, `DashboardWelcomeCollapsed` (the collapsed chip), the step registries, `useRailDismissed`, `useBookingFlow`, `useCan`, `useBookingSetupStatus`, `useArtistOnboardingStatus`.

---

## Wave A — Contracts (sequential, do first)

### Task A1: Shared types and the composer contract

**Files:**
- Create: `src/lib/dashboard/stageChain.types.ts`
- Test: none (types only; consumed by A1's TS check)

**Interfaces:**
- Produces: every type below. Wave B and C import from here.

- [ ] **Step 1: Write the types**

```ts
// src/lib/dashboard/stageChain.types.ts
import type { FeatureKey } from "@/lib/entitlements";

export type FirstRunRole = "admin" | "producer" | "artist";
export type StageVariant = "hot" | "plain" | "dim";

/** A setup step docked into the stage it unblocks. Sourced from the existing
 *  registries (title/hint) + setupStatus (done/block) + capability (admin). */
export interface DockedStep {
  key: string;          // BookingSetupStepKey | SetupStepKey | "team" | "blockDates"
  label: string;
  done: boolean;
  hard: boolean;        // hard gate → amber "Blocks …" chip
  hardLabel: string;    // "Blocks offers" | "Blocks booking" | "Blocks issuing" | ""
  soft: boolean;        // soft gate → neutral "Slows filling" chip
  admin: boolean;       // capability-blocked for this viewer
  hint: string;         // "" when done
}

/** What a stage's single CTA does. The composer stays pure and emits intent;
 *  DashboardFirstRun maps it to navigate() or openSetup(). */
export type StageAction =
  | { kind: "route"; to: string }
  | { kind: "openSetup"; feature: FeatureKey; step: string };

export interface Stage {
  key: string;              // "dates" | "offers" | "confirm" | "hire" | "eligibility" | "availability" | "offer"
  n: string;                // "01".."04"
  variant: StageVariant;
  name: string;
  tag: string;
  line: string;
  running: boolean;         // plain card that is done → shows "Running"
  badge: string;            // "Waits" | "Not on" | ""  (dim cards)
  needs: string;            // dim mono "needs …" line ("" if none)
  metric: string | null;    // rendered number or null
  metricLabel: string;
  steps: DockedStep[];
  ctaLabel: string;         // primary (hot) or chip (plain/dim) label; "" if none
  ctaIsPrimary: boolean;    // true → hot primary button; false → outline chip
  action: StageAction | null;
}

export interface FirstRunMetrics {
  datesIn: number;
  readyToOffer: number;
  bookableDates: number;
  confirmed: number;
  hireDrafts: number;
  eligibleDates: number;   // artist
  blockedDates: number;    // artist
  arriving: number;        // artist pending offers
  toSign: number;          // artist issued hire orders awaiting signature
}

export interface FirstRunProvenance {
  byYou: boolean;              // admin viewing their own rules
  actorName: string | null;    // who set booking_flow (admin: audit actor; producer: admin name(s))
  changedAt: string | null;    // ISO; admin-only; null for producer or no-override
}

export interface FirstRunTiming {
  digestHourBerlin: number;    // offer_digest_hour_berlin
  responseWindowHours: number; // offer_response_window_hours
}

export interface SideLink { title: string; where: string; }
export interface QueueRow { dot: "accent" | "faint"; title: string; hint: string; when: string; cta: string; }

export interface StageChainInput {
  role: FirstRunRole;
  orgName: string;
  bookingEntitled: boolean;    // enabledFeatures.has("booking_flow")
  hireEntitled: boolean;       // enabledFeatures.has("hire_orders")
  offers: boolean;             // flow.artist_acceptance
  imported: boolean;           // hasAnyShows / hasData
  canEditBooking: boolean;     // useCan("edit_booking_settings") (admin always true)
  canEditHire: boolean;        // useCan("edit_hire_order_settings")
  /** per-step done + block from the existing setupStatus, keyed by step key */
  bookingSteps: Record<string, { done: boolean }>;
  hireSteps: Record<string, { done: boolean }>;
  artistBlockDatesDone: boolean;
  metrics: FirstRunMetrics;
  provenance: FirstRunProvenance;
  timing: FirstRunTiming;
}

export interface StageChainResult {
  eyebrow: string;
  headline: string;
  body: string;
  ghost: string;
  hint: string;
  progressLabel: string;
  progressHint: string;
  hasSteps: boolean;
  ticks: boolean[];           // true = filled
  modules: { label: string; on: boolean }[];
  offFooters: string[];
  hasChain: boolean;
  chainTitle: string;
  rulesBy: string;            // provenance line
  stages: Stage[];
  sideTitle: string;
  sideBody: string;
  side: SideLink[];
  queueTitle: string;
  queueHint: string;
  sample: boolean;
  queueOpacity: number;
  nothingOn: boolean;
}
```

- [ ] **Step 2: Type-check** — `npx tsc -p tsconfig.app.json --noEmit` → PASS.
- [ ] **Step 3: Commit** — `git add src/lib/dashboard/stageChain.types.ts && git commit -m "add stage-chain type contract for dashboard first run"`

---

## Wave B — Parallel fan-out (dispatch B1–B6 concurrently)

All six consume A1 and touch disjoint new files. No shared state → safe to run at once in the same worktree.

### Task B1: The pure composer `composeStageChain`

**Files:**
- Create: `src/lib/dashboard/stageChain.ts`, `src/lib/dashboard/stageChain.test.ts`

**Interfaces:**
- Consumes: A1 types; `STEP_TITLES` (`@/lib/bookings/setupStatus`); `bookingOnboarding`, `hireOrderOnboarding`, `ARTIST_ONBOARDING`, `TEAM_STEP_META` (`@/lib/dashboard/moduleOnboarding`).
- Produces: `export function composeStageChain(input: StageChainInput): StageChainResult`.

**Port source:** Appendix A is the canonical `over10` logic (copy + structure). Port it faithfully with these seams:
1. Replace demo `mk(T.flow, true)` etc. with real done-ness from `input.bookingSteps[key].done` / `input.hireSteps` / `input.artistBlockDatesDone`.
2. Read step `label` from `STEP_TITLES[key]` / `TEAM_STEP_META.title` / `ARTIST_ONBOARDING.steps.blockDates.title`, and `hint` from the registry `todoHint` (only when `!done`).
3. Compute `admin` per step from the real `ctaCapability` vs the viewer's caps (see mapping below), **not** the design's `capBlocked`.
4. Replace hardcoded metrics (`"34"`, `"4"`, `"12"`, `"2"`, `"3"`, `"1"`) with `input.metrics.*` (see stage→metric map below). A metric renders `null` (hidden) when its number is 0 **and** the stage is not a "done" card that should still show 0 — follow Appendix A which shows `"0"` on the active first stage.
5. Replace `"09:00"` / `"48 hours"` in copy with `fmtHour(input.timing.digestHourBerlin)` / `${input.timing.responseWindowHours} hours`.
6. Replace `rulesBy` demo string with the provenance line from `input.provenance` (see rule below).
7. Strip all em-dashes.

**Per-step admin mapping** (`ctaCapability` → cap):
```ts
const stepCap: Record<string, "booking" | "hire" | null> = {
  shows: null, people: null /* add_artists, default on; treat as not-admin-blocked here */,
  flow: "booking", slots: "booking", ladder: "booking", eligibility: "booking", timing: "booking",
  letterhead: "hire", terms: "hire", countersign: "hire", team: null, blockDates: null,
};
const isAdminBlocked = (key: string) =>
  (stepCap[key] === "booking" && !input.canEditBooking) ||
  (stepCap[key] === "hire" && !input.canEditHire);
```
(Note: `people` gates on `add_artists` which defaults ON; if a future need arises, thread a `canAddArtists` input. For now `people` is never admin-blocked, matching the default.)

**Step→stage docking** (non-artist, booking entitled):
- `dates`: [shows, slots] · `offers`: [flow, people, ladder, eligibility, timing] · `confirm`: admin ? [team] : [] · `hire`: [letterhead, terms, countersign] (when hire entitled)
- Artist: `availability`: [blockDates]; other artist stages have no steps.

**Stage→metric map:**
- `dates.metric = imported ? String(datesIn) : "0"`
- `offers.metric = offers ? String(readyToOffer) : String(bookableDates)` (direct)
- `confirm.metric` (direct "Confirmed on the spot") `= String(confirmed)`
- `hire.metric = String(hireDrafts)`
- artist `eligibility = String(eligibleDates)`, `availability = String(blockedDates)`, `offer = String(arriving)`, `hire = String(toSign)`

**Provenance line rule:**
```ts
function rulesByLine(p: FirstRunProvenance): string {
  if (p.byYou) return "Rules set by you · Settings · Booking flow";
  if (p.actorName && p.changedAt) return `Rules set by ${p.actorName} · ${fmtDate(p.changedAt)}`;
  if (p.actorName) return `Rules set by ${p.actorName}`;
  return "Rules set in Settings · Booking flow";
}
```

**Transforms to port verbatim (from Appendix A):** the arrow/default normalization, the `stuck` demotion (a not-done stage whose outstanding steps are ALL `admin` and that is not `keepAction` → becomes dashed `dim` with `badge:"Waits"`, `needs:"Waits on <admin>"`, no CTA), and the `hot = card && (act || primary)` → `variant` assignment. `keepAction:true` on the hire stage exempts it from the demotion.

- [ ] **Step 1: Write failing tests** (`stageChain.test.ts`) — cover the matrix:

```ts
import { describe, it, expect } from "vitest";
import { composeStageChain } from "./stageChain";
import type { StageChainInput } from "./stageChain.types";

const base: StageChainInput = {
  role: "admin", orgName: "Halle Kollektiv",
  bookingEntitled: true, hireEntitled: false, offers: true, imported: false,
  canEditBooking: true, canEditHire: true,
  bookingSteps: { shows:{done:false}, slots:{done:false}, flow:{done:true}, people:{done:true},
                  ladder:{done:false}, eligibility:{done:false}, timing:{done:true} },
  hireSteps: { letterhead:{done:false}, terms:{done:false}, countersign:{done:false} },
  artistBlockDatesDone: false,
  metrics: { datesIn:0, readyToOffer:0, bookableDates:0, confirmed:0, hireDrafts:0,
             eligibleDates:0, blockedDates:0, arriving:0, toSign:0 },
  provenance: { byYou:true, actorName:null, changedAt:null },
  timing: { digestHourBerlin: 19, responseWindowHours: 48 },
};

it("admin, bf on, ho off, offers, no dates → 8 steps, 3 filled, stage 01 is hot", () => {
  const r = composeStageChain(base);
  expect(r.progressLabel).toBe("Set up · 3 of 8");
  expect(r.stages[0].variant).toBe("hot");
  expect(r.stages[0].name).toBe("Dates");
  expect(r.offFooters).toContain("Hire orders is off for this org. Ask your account manager to switch it on.");
});

it("no modules → floor state, hasChain false, headline names the floor", () => {
  const r = composeStageChain({ ...base, bookingEntitled:false, hireEntitled:false });
  expect(r.nothingOn).toBe(true);
  expect(r.hasChain).toBe(false);
  expect(r.headline).toBe("No modules are switched on for Halle Kollektiv");
});

it("no em-dashes anywhere in the composed copy", () => {
  const r = composeStageChain({ ...base, imported:true, metrics:{ ...base.metrics, datesIn:34, readyToOffer:4 } });
  const blob = JSON.stringify(r);
  expect(blob).not.toMatch(/[—–]/);
});

it("producer without edit caps → offers stage steps are admin-marked and the stage demotes to a waiting card", () => {
  const r = composeStageChain({ ...base, role:"producer", canEditBooking:false, canEditHire:false, imported:true,
    metrics:{ ...base.metrics, datesIn:34, readyToOffer:4 } });
  const offersStage = r.stages.find(s => s.key === "offers")!;
  expect(offersStage.variant).not.toBe("hot"); // no CTA the producer cannot honour
});

it("direct flow → offers stage is 'Book directly', confirm is 'Confirmed on the spot' with confirmed metric", () => {
  const r = composeStageChain({ ...base, offers:false, imported:true, metrics:{ ...base.metrics, bookableDates:12, confirmed:12 } });
  expect(r.stages.find(s=>s.key==="offers")!.name).toBe("Book directly");
  expect(r.stages.find(s=>s.key==="confirm")!.name).toBe("Confirmed on the spot");
});

it("artist → exactly one step (blockDates), no invented phone step", () => {
  const r = composeStageChain({ ...base, role:"artist" });
  const stepKeys = r.stages.flatMap(s => s.steps.map(st => st.key));
  expect(stepKeys).toEqual(["blockDates"]);
});

it("bf off + ho on → hire stage is the hot manual-order card, booking off-footer present", () => {
  const r = composeStageChain({ ...base, bookingEntitled:false, hireEntitled:true });
  const hire = r.stages.find(s=>s.key==="hire")!;
  expect(hire.ctaLabel).toBe("New order");
  expect(r.offFooters).toContain("Booking flow is off for this org. Ask your account manager to switch it on.");
});

it("copy uses the org's configured digest hour, not 09:00", () => {
  const r = composeStageChain({ ...base, role:"artist", imported:true, offers:true,
    timing:{ digestHourBerlin: 7, responseWindowHours: 24 }, metrics:{ ...base.metrics, arriving:2, blockedDates:3 } });
  expect(JSON.stringify(r)).toContain("07:00");
  expect(JSON.stringify(r)).not.toContain("48 hours");
});
```

- [ ] **Step 2: Run** — `npx vitest run src/lib/dashboard/stageChain.test.ts` → FAIL (no module).
- [ ] **Step 3: Implement** `composeStageChain` porting Appendix A with the seams above.
- [ ] **Step 4: Run** → PASS. Then `npm run lint` on the file.
- [ ] **Step 5: Commit** — `git commit -m "add composeStageChain pure composer for dashboard first run"`

### Task B2: `StageCard` + `DashboardChain`

**Files:**
- Create: `src/components/dashboard/firstRun/StageCard.tsx`, `DashboardChain.tsx`, `StageCard.test.tsx`

**Interfaces:**
- Consumes: `Stage`, `StageAction` from A1.
- Produces: `StageCard({ stage, onAction }: { stage: Stage; onAction: (a: StageAction) => void })`; `DashboardChain({ stages, onAction }: { stages: Stage[]; onAction: (a: StageAction) => void })`.

Render the three variants exactly per the reproduction (`scratchpad/dashboard-first-run-5c.html`, function `stageCard`), translated to Tailwind tokens:
- **hot:** `bg-accent-700` card, white (`text-primary-foreground`/`var(--surface)`) text, mono `n`, "Start here" badge (`bg-card text-accent-700`), name/tag/line, optional metric (mono 22px white), docked steps (`stepsBlock` with `hot` styling using `color-mix` muted-on-violet), spacer, primary button (`bg-card text-accent-700`).
- **plain:** `bg-card border-border`, "Running" check when `stage.running`, metric in `text-foreground`, steps in normal styling, outline chip.
- **dim:** dashed `border-[var(--line-strong)]` transparent card, `badge` pill, muted name, `needs` mono line, steps, outline chip.
- Step chips: hard → `text-[var(--amber-600)] bg-[var(--amber-100)]` (or the hot inverse); soft/admin → `text-[var(--text-faint)] bg-[var(--surface-3)]` (or hot inverse). Done step → check (`stroke-var(--accent-500)` on plain/dim, `var(--surface)` on hot); todo → hollow circle.
- Buttons call `onAction(stage.action)` when `stage.action` is set.
- `DashboardChain` lays stages in a flex row; render a right-arrow between stages (`stage.n !== "01"`), with `overflow-x:auto` wrapper.

- [ ] **Step 1: Failing test** — render a hot stage with a primary + a docked hard step; assert the "Start here" badge, the primary label, the step label, and the "Blocks offers" chip text; click primary and assert `onAction` called with the stage's action. Render a dim stage; assert the badge + `needs` text + no primary.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** both components.
- [ ] **Step 4: Run** → PASS; `npx tsc -p tsconfig.app.json --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "add StageCard and DashboardChain for dashboard first run"`

### Task B3: `FirstRunHeaderCard`

**Files:** Create `src/components/dashboard/firstRun/FirstRunHeaderCard.tsx` + `.test.tsx`.

**Interfaces:**
- Consumes: from `StageChainResult`: `eyebrow, headline, body, ghost, hint, progressLabel, progressHint, hasSteps, ticks, modules`.
- Produces: `FirstRunHeaderCard(props: { eyebrow; headline; body; ghost; hint; progressLabel; progressHint; hasSteps; ticks: boolean[]; modules: {label;on}[]; onGhost?: () => void })`.

Left column: eyebrow (`text-accent-600` uppercase), `text-[32px] font-semibold` headline, muted body, ghost outline button + faint hint. Right 264px `bg-muted` card: `progressLabel`, ticks row (`hasSteps` only; filled `bg-accent-500`, empty `bg-[var(--surface-3)]`), `progressHint`, divider, module list (dot `bg-accent-500`/`bg-[var(--text-faint)]`, label, `On`/`Off` in `text-accent-600`/faint).

- [ ] **Step 1: Failing test** — assert headline/eyebrow render, tick count = `ticks.length` with the right number filled, and each module row shows On/Off matching `on`.
- [ ] **Step 2–4:** FAIL → implement → PASS + tsc.
- [ ] **Step 5: Commit** — `git commit -m "add FirstRunHeaderCard with progress cluster and module list"`

### Task B4: `OffFooters` + `FirstRunSideCard`

**Files:** Create `OffFooters.tsx`, `FirstRunSideCard.tsx` + a shared `.test.tsx`.

**Interfaces:**
- `OffFooters({ footers: string[] })` — renders nothing when empty; else a `bg-muted border` stack of muted lines.
- `FirstRunSideCard({ title, body, links }: { title: string; body: string; links: SideLink[] })` — left title(eyebrow)+body, right 300px list of arrow-icon + title + `where`.

- [ ] **Step 1: Failing test** — `OffFooters` with two strings renders both; with `[]` renders null. `FirstRunSideCard` renders title/body and each link's title + where.
- [ ] **Step 2–4:** FAIL → implement → PASS + tsc.
- [ ] **Step 5: Commit** — `git commit -m "add OffFooters and FirstRunSideCard for dashboard first run"`

### Task B5: `FirstRunQueue`

**Files:** Create `FirstRunQueue.tsx` + `.test.tsx`.

**Interfaces:**
- `FirstRunQueue({ title, hint, sample, opacity, rows }: { title: string; hint: string; sample: boolean; opacity: number; rows: QueueRow[] })` — header (eyebrow + optional "Sample" pill + faint hint), then a `bg-card border rounded-l` list at `opacity`, each row: dot (`accent`/`faint`), title + hint, mono `when`, optional outline `cta` button.

- [ ] **Step 1: Failing test** — renders title, "Sample" pill only when `sample`, each row's title/when, and the cta button only when `cta` non-empty.
- [ ] **Step 2–4:** FAIL → implement → PASS + tsc.
- [ ] **Step 5: Commit** — `git commit -m "add FirstRunQueue for dashboard first run"`

### Task B6a: `useFirstRunMetrics` (metrics assembler)

**Files:** Create `src/hooks/useFirstRunMetrics.ts` + `.test.tsx`.

**Interfaces:**
- Consumes: `FirstRunMetrics`, `FirstRunTiming` from A1; existing hooks (below); `countReadyToOffer` (B6b); `useBookingFlowProvenance` (B6c).
- Produces: `useFirstRunMetrics(role): { metrics: FirstRunMetrics; timing: FirstRunTiming; isLoading: boolean }`.

Wire verbatim from the data pass:
- `datesIn` = `useQuery(['dashboard-upcoming-dates', todayStr, orgId], () => fetchUpcomingShowDates(...)).length`
- `bookableDates` = `unfilledMainCastDates(upcomingDates, confirmedMainByDate).length` (`src/lib/bookingCockpit.ts:142`)
- `confirmed` = `fetchConfirmedBookingsLite(...).length` (key `['bookings','confirmed-dashboard',orgId]`)
- `hireDrafts` = `useHireOrders(orgId, { status:['draft'] }).data?.length ?? 0` (gate on `hire` entitlement)
- `eligibleDates` = `useArtistEligibleDates().data?.length ?? 0`
- `blockedDates` = `useMyBlockedDatesCount(artistId).data ?? 0`
- `arriving` = `useNavCounts().openOffers`
- `toSign` = `useMyHireOrders().data?.filter(o => o.status === 'issued').length ?? 0`
- `readyToOffer` = `countReadyToOffer(...)` (B6b)
- `timing.digestHourBerlin` / `responseWindowHours` = existing settings reads (`offer_digest_hour_berlin`, `offer_response_window_hours` via `resolveOrgSetting`/existing hook; check `src/data/settings.ts`).

Only fetch what the role needs (artist metrics gated to artist; org metrics gated to admin/producer), mirroring `useDashboardFirstRun`'s existing gating.

- [ ] **Step 1: Failing hook test** — with `renderWithProviders` + `supabaseFake` seeded (a few upcoming dates, N confirmed, a draft order), assert `metrics.datesIn`/`confirmed`/`hireDrafts` match the seeded counts. (Test each role's gating: artist metrics 0 for admin path, etc.)
- [ ] **Step 2–4:** FAIL → implement → PASS + tsc.
- [ ] **Step 5: Commit** — `git commit -m "add useFirstRunMetrics assembling live first-run counts"`

### Task B6b: "Ready to offer" aggregate

**Files:** Create `src/lib/bookings/readyToOffer.ts` + `.test.ts`; modify `src/data/bookings.ts` (add `fetchOpenedTier1DateIds(client, orgId): Promise<string[]>` — an org-wide read of `show_date_offer_tiers` for tier 1, distinct `show_date_id`).

**Interfaces:**
- Produces: `fetchOpenedTier1DateIds(client, orgId)`; pure `countReadyToOffer(input: ReadyToOfferInput): number` where a date counts iff: it has a session set, `main_cast_slots` set (slots done), a tier-1 cast covers `(show, city)` (reuse `resolveCoverage` inputs from `src/data/eligibility.ts` / `src/lib/bookings/setupStatus.ts`), and its id is NOT in the opened-tier set.

Derive the predicate from the existing building blocks named in the data pass: `fetchUpcomingShowDates` rows (need `session_1..3`, `city_id`, `main_cast_slots`), `fetchLadderCoverageInputs`, `shouldAutoOpenTier1`-style logic. Keep the count derivation PURE and unit-test it with fixtures; the fetch is a thin `src/data/bookings.ts` addition tested with `supabaseFake`.

- [ ] **Step 1: Failing test** for `countReadyToOffer` — fixtures: 4 dates ready, 30 missing slots, 2 already opened → expect `4`. Edge: no coverage → 0; date with no session → excluded.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the pure derivation + the `fetchOpenedTier1DateIds` read.
- [ ] **Step 4:** PASS + `supabaseFake` test for the fetch + tsc.
- [ ] **Step 5: Commit** — `git commit -m "add ready-to-offer aggregate for dashboard first run"`

### Task B6c: `useBookingFlowProvenance` (role-split)

**Files:** Create `src/hooks/useBookingFlowProvenance.ts` + `.test.tsx`. (No data-access change if `fetchSettingsAudit` + `useOrgAdminNames` suffice; else add a thin helper.)

**Interfaces:**
- Produces: `useBookingFlowProvenance(role): FirstRunProvenance`.

Logic:
- **admin:** `useSettingsAudit(['booking_flow'])` → newest row for `key==='booking_flow'` → `{ byYou:true, actorName: row.actorName, changedAt: row.created_at }`; if no row → `{ byYou:true, actorName:null, changedAt:null }`.
- **producer/artist:** `useOrgAdminNames(orgId)` → `{ byYou:false, actorName: names[0] ?? null, changedAt:null }` (audit table is admin-only RLS; names only).

- [ ] **Step 1: Failing test** — admin with a seeded audit row → actorName+changedAt set, byYou true; admin with no row → nulls, byYou true; producer → byYou false, actorName from admin names, changedAt null.
- [ ] **Step 2–4:** FAIL → implement → PASS + tsc.
- [ ] **Step 5: Commit** — `git commit -m "add role-split booking-flow provenance hook"`

---

## Wave C — Integration (sequential barrier)

### Task C1: `DashboardFirstRun` assembly + CTA wiring + dismiss

**Files:** Create `src/components/dashboard/firstRun/DashboardFirstRun.tsx` + `.test.tsx`.

**Interfaces:**
- Consumes: all Wave B components + `StageChainResult`.
- Produces: `DashboardFirstRun({ result, onOpenSetup, dismissed, onDismiss, onUndismiss }: { result: StageChainResult; onOpenSetup: (feature: FeatureKey, step: string) => void; dismissed: boolean; onDismiss: () => void; onUndismiss: () => void })`.

- Render order: `FirstRunHeaderCard` → `OffFooters` → (when `hasChain`) chain header (`chainTitle` + `rulesBy`) + `DashboardChain` → `FirstRunSideCard` → `FirstRunQueue`.
- `onAction` mapping: `{kind:"route"}` → `useNavigate()` to `to`; `{kind:"openSetup"}` → `onOpenSetup(feature, step)`.
- Dismiss: when `dismissed`, render `DashboardWelcomeCollapsed` (reuse) with `collapsedCopy`-style label/hint and `onOpen={onUndismiss}` instead of the full surface. Add a small "Hide" affordance on the header card calling `onDismiss` (the design omits it; note 06 requires dismissal persists + reopens from a chip).

- [ ] **Step 1: Failing test** — given a `StageChainResult` fixture (admin, chain present), assert header + off-footer + chain title + a stage card render; a stage `openSetup` action click calls `onOpenSetup(feature, step)`; when `dismissed` the collapsed chip renders and its open button calls `onUndismiss`.
- [ ] **Step 2–4:** FAIL → implement → PASS + tsc.
- [ ] **Step 5: Commit** — `git commit -m "assemble DashboardFirstRun surface with CTA and dismiss wiring"`

### Task C2: Rewire `useDashboardFirstRun`

**Files:** Modify `src/components/dashboard/firstRun/useDashboardFirstRun.ts` (+ update `useDashboardFirstRun.test.tsx`).

- Build `StageChainInput` from: entitlements (`enabledFeatures`), `useBookingFlow` (`active`, `artist_acceptance`), `useCan('edit_booking_settings'|'edit_hire_order_settings')`, the existing `useBookingSetupStatus`/`useArtistOnboardingStatus` step done-ness, `useFirstRunMetrics`, `useBookingFlowProvenance`.
- Call `composeStageChain(input)` → `result`.
- **Fix the `show` gate:** replace `show = composed.steps.length > 0` with `show = !loading && (result.hasChain || result.nothingOn)` so the **no-modules floor state renders** (currently it vanishes). Keep loading guards.
- Return `{ show, result, dismissed, dismiss, undismiss, openSetupAt }` (drop `railOpen`/`openRail` and the old welcome/sample fields no longer used).
- `imported` = same `hasData`/`datesSettled` signal DashboardPage already computes (dates length > 0), threaded in.

- [ ] **Step 1: Update tests** — assert `show` true for a no-module org (floor), and `result.headline` is the floor headline; assert a normal admin org yields `result.stages.length === 4`.
- [ ] **Step 2:** Run → FAIL (old shape).
- [ ] **Step 3: Implement** the rewire.
- [ ] **Step 4:** Run → PASS + tsc + lint.
- [ ] **Step 5: Commit** — `git commit -m "rewire useDashboardFirstRun to stage-chain and fix no-modules floor gate"`

### Task C3: Wire pages, retire the old surface

**Files:** Modify `src/pages/DashboardPage.tsx`, `src/components/dashboard/ArtistDashboard.tsx`.

- Replace the welcome region + right-column `DashboardSetupRail` + rich `SamplePreview` with a single top `DashboardFirstRun` block driven by `useDashboardFirstRun`.
- Keep `SetupChecklistSheet` mounted; `onOpenSetup` opens it at `{feature, step}` (reuse existing `openSetupAt`/`setupSel`).
- Below the first-run surface: the normal KPI dashboard body shows once `!result.sample` (real data) or the surface is dismissed. The 5c queue stands in for the empty body while sampling — so during first-run the KPI cards/booking sections are hidden behind the queue; once data lands (`!sample`), render the existing `ProducerBookingSection` + KPI cards as today (no longer wrapped in the old `SamplePreview`).
- Artist: same, with the artist stages; no `SamplePreview` (already the case).
- Remove now-unused imports (`DashboardWelcome`, `DashboardSetupRail`, `SamplePreview` if fully unused). Do not delete the component files in this task (a follow-up can, once nothing imports them) — but if a component is now referenced nowhere, delete it and its test in the same commit to keep the tree clean.

- [ ] **Step 1: Update DashboardPage/ArtistDashboard tests** (the existing `ArtistDashboard.firstRun.test.tsx` etc.) to expect the new surface (chain present, floor state for no modules). Run → FAIL.
- [ ] **Step 2: Implement** the wiring.
- [ ] **Step 3:** Run the full dashboard test set → PASS. `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`.
- [ ] **Step 4: Commit** — `git commit -m "render DashboardFirstRun on dashboard, retire welcome+rail+sample"`

### Task C4: Browser verification + suite

- [ ] **Step 1:** `npm run local:up` then `npm run dev` (LOCAL stack per CLAUDE.md — never prod). Open the dashboard.
- [ ] **Step 2:** Verify against the reproduction artifact for: admin/offers/no-dates (stage 01 hot), admin/imported, producer without edit caps (offers stage demotes), direct flow, artist, bf-off+ho-on (manual hire hot), and **no modules** (floor state renders, not blank). Screenshot each; compare to `https://claude.ai/code/artifact/5d9fdad5-72f2-4608-b7e7-8fc46bbd0705`.
- [ ] **Step 3:** Check console/network clean; verify a stage CTA opens `SetupChecklistSheet` at the right step and a route CTA navigates.
- [ ] **Step 4:** `npm run verify:fast` (lint, typecheck, build, unit+coverage, Deno). Fix any coverage gaps.
- [ ] **Step 5: Commit** any fixes — `git commit -m "verify dashboard first run 5c across configurations"`

---

## Self-Review

- **Spec coverage:** header card ✓(B3), progress+modules ✓(B3), off-footers ✓(B4), stage chain + hot/plain/dim ✓(B1/B2), docked steps from real registry ✓(B1), stuck-demotion + keepAction ✓(B1), side card ✓(B4), sample/live queue ✓(B5), no-modules floor ✓(B1+C2), direct-book + bf-off+ho-on branches ✓(B1), live metrics ✓(B6a/b), provenance ✓(B6c), retire old surface ✓(C3). Config axes (entitlements/flow/dates/caps) all threaded via `StageChainInput` ✓(A1/C2).
- **Placeholder scan:** metrics all have named sources; the one build (ready-to-offer) is a full task; provenance role-split specified. No TBDs.
- **Type consistency:** `StageAction`, `Stage`, `FirstRunMetrics`, `FirstRunProvenance` defined once in A1 and consumed by name throughout. `composeStageChain(StageChainInput): StageChainResult` stable across B1/C2. `onOpenSetup(feature, step)` stable across C1/C3.
- **Parallelization:** A1 blocks all; B1–B6 independent (disjoint files) and dispatchable together; C1–C4 sequential (shared files + browser). Confirmed no two Wave-B tasks write the same file.

---

## Appendix A — canonical `over10` composition (source of copy + structure for B1)

Port from the design's `over10()`, captured verbatim in the owner-approved reproduction committed alongside this plan: **`docs/superpowers/plans/assets/2026-08-11-dashboard-first-run-5c.reproduction.html`** (functions `over10` = composition + all copy, `stageCard`/`stepRow`/`stepsBlock` = markup + token styling, `render` = layout). That file is the source of truth for every exact string and every inline style. **Strip em-dashes**, and swap demo done-ness/metrics/times/provenance for the real inputs per B1's seams. Key copy anchors (non-artist): stage names Dates / Offers|Book directly / Confirm|Confirmed on the spot / Hire order; tags "Shows and bookings", "Booking flow", "Booking flow · direct", "Hire orders", "… · off"; the "Start here" hot badge; dim badges "Waits"/"Not on"; head/side/queue copy per role×imported×flow. The six implementer notes (composed into behavior, not shown): booking-flow-is-a-step; unlicensed-module-contributes-no-steps; artist-has-one-step; chip-wording-follows-flow; admin-marker-per-step; dismissal-persists-and-floor-must-not-vanish.
