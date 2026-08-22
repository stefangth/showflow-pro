# Wireflow v3 — Phase 1: Frame + Board + Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a flag-gated Wireflow v3 Get running board — the inline-expanding phase-wizard shell, the 16-step model, and the board — reusing every existing step editor, with the genuinely-new steps stubbed, so nothing user-visible changes until later phases flip the flag.

**Architecture:** Add v3 files *alongside* the live v1 board (deleted only at the Phase 5 cutover). A new pure model (`steps.ts`) maps the existing `BookingSetupStatus`/`HireOrderSetupStatus` onto 16 steps in 3 phases. A new `useGetRunningV3` hook assembles it. `GetRunningBoardV3` renders the board (hero, gates, three icon rails, phase rows) and expands a phase inline into a single reusable `WizardShell` (step rail / body / "How this works" guide + sticky footer). Existing step bodies (`FlowStep`, `TimingStep`, `Ladder`/`Eligibility`/`People`/`Team` panel bodies, `LetterheadStep`/`TermsStep`/`CountersignStep`) mount unchanged via their `{ orgId, onDone }` signatures; new steps (`source`/`connect`/`map`/`cities`/`productions`/`skills`/`fee`/`document`) render a `StepComingSoon` stub. A build-time env flag `VITE_GETRUNNING_V3` selects v3 vs v1 in `GetRunningPage`; the dev-only `/dev/get-running` harness always renders v3 for verification.

**Tech Stack:** React 18 + TS, Vite, Tailwind v3 + shadcn primitives, react-i18next, @tanstack/react-query v5, Vitest + @testing-library/react (jsdom). Design system tokens already in `src/index.css`.

**Spec:** `docs/superpowers/specs/2026-08-23-wireflow-v3-get-running-settings-design.md`

**Design screens (source of truth for pixel markup; read the named file before building each component):** Claude Design project `02c15575-91a6-4acd-92fc-e006a5cf1b88` — `BoardPhases.dc.html` (board), `SourceImport.dc.html` / `Coverage.dc.html` / `OfferFlow.dc.html` / `Run3Steps.dc.html` (the WizardShell frame + collapsed sibling phase rows). The frame markup is identical across those four; copy it from `Coverage.dc.html` (a reuse-step example).

## Global Constraints

- **UI conventions (`docs/ui-conventions.md`, CI-gated):** use `src/components/ui` primitives first; **no raw values** (no hex, `rgba()`, `text-[13px]`, `rounded-[10px]`, `bg-foreground/[0.04]`) outside `src/components/ui` — `eslint/ui-conventions.js` runs at `--max-warnings 0`. Use the `fontSize` scale (`text-control` = 13px controls, `text-body` = 14, eyebrow = 11), radius scale (`rounded-s|m|l|xl`), semantic colour tokens, `TONES` for status, tint tokens (`bg-hover-tint`/`bg-well-tint`/`bg-accent-tint`). Uppercase → `<Eyebrow>`; numbers → `<Metric>` (Geist Mono, tabular); status → `StatusPill`/`StatusDot`.
- **Copy:** no em/en dashes, no exclamation marks, no emoji, German is Du-form. `src/i18n/copyLint.test.ts` + `keyParity.test.ts` gate it. Every new user-facing string goes through `t()` with **both** EN and DE added in the same commit. Terminology (post-#334, supersedes the design): production (not show), Casting breakdown / part (not "parts"/"places"/"slots"), Contract (not hire order), Dates. Reuse `src/i18n/terms.ts` `TERMS`.
- **`any` is banned** (lint error). Supabase rows: explicit interface + single `as unknown as` cast at the query boundary; test stubs via `src/test/castHelpers.ts`.
- **Type-check split:** `npx tsc -p tsconfig.app.json --noEmit` after TS changes.
- **Tests import the real module.** Never re-implement production logic in a test. Data-access via `src/test/supabaseFake.ts`; hooks/components via `src/test/renderWithProviders.tsx` + `src/test/fixtures.ts`. Never `vi.mock('@/integrations/supabase/client')`.
- **Fast gate:** `npm run verify:fast` (lint, typecheck, build, unit+coverage, deno) is the inner loop; each task ends green on the tests it adds + `npx tsc -p tsconfig.app.json --noEmit` + `npm run lint`.
- **Commits:** imperative, lowercase, ≤72 chars. End every commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. This branch (`claude/wireflow-v3-design-f3338b`) is not main; commit freely, do not push or open a PR unless the owner asks.
- **Additive only:** do not modify `src/lib/getRunning/tasks.ts`, `taskFeature.ts`, `taskPanelMeta.ts`, `GetRunningPage`'s v1 branch, `TaskPanel`, or `taskPanelRegistry`. v1 stays byte-stable; v3 lives in new files until Phase 5.

---

## File map

- Create `src/config/flags.ts` — build-time flag reads (`GETRUNNING_V3`).
- Create `src/lib/getRunning/steps.ts` — v3 step/phase/model types + `composeGetRunningV3`.
- Create `src/lib/getRunning/steps.test.ts`.
- Create `src/lib/getRunning/stepFeature.ts` — per-step deep-link map.
- Create `src/lib/getRunning/stepFeature.test.ts`.
- Create `src/hooks/useGetRunningV3.ts` — assembles input → `composeGetRunningV3`.
- Create `src/hooks/useGetRunningV3.test.tsx`.
- Create `src/components/getRunning/v3/WizardFooterContext.ts` — footer portal slot.
- Create `src/components/getRunning/v3/WizardShell.tsx` + `.test.tsx`.
- Create `src/components/getRunning/v3/StepComingSoon.tsx` — stub body for new steps.
- Create `src/components/getRunning/v3/stepRegistryV3.tsx` + `.test.tsx` — step key → body.
- Create `src/components/getRunning/v3/board/HeroCard.tsx`, `StillShutCard.tsx`, `PhaseIconRail.tsx`, `PhaseRow.tsx` (+ one `board.test.tsx`).
- Create `src/components/getRunning/v3/GetRunningBoardV3.tsx` + `.test.tsx`.
- Create `src/i18n/locales/en/getRunningV3.json` + `src/i18n/locales/de/getRunningV3.json`.
- Modify `src/i18n/index.ts` — register the `getRunningV3` namespace.
- Modify `src/pages/GetRunningPage.tsx` — branch to v3 board behind the flag.
- Modify `src/pages/DevGetRunningHarness.tsx` — render `GetRunningBoardV3` for verification.
- Modify `.env.development` (committed local stack config) — add `VITE_GETRUNNING_V3=true` so the dev stack shows v3.

---

## Task 1: Build-time feature flag

**Files:**
- Create: `src/config/flags.ts`
- Test: `src/config/flags.test.ts`
- Modify: `.env.development` (append one line)

**Interfaces:**
- Produces: `export const GETRUNNING_V3: boolean` — `true` when `import.meta.env.VITE_GETRUNNING_V3 === 'true'`, else `false`. Default off in prod; set in host env to flip on at Phase 5.

- [ ] **Step 1: Write the failing test**

```ts
// src/config/flags.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";

describe("GETRUNNING_V3 flag", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("is false when the env var is unset", async () => {
    vi.stubEnv("VITE_GETRUNNING_V3", "");
    const { GETRUNNING_V3 } = await import("./flags");
    expect(GETRUNNING_V3).toBe(false);
  });

  it("is true only for the exact string 'true'", async () => {
    vi.stubEnv("VITE_GETRUNNING_V3", "true");
    const { GETRUNNING_V3 } = await import("./flags");
    expect(GETRUNNING_V3).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/flags.test.ts`
Expected: FAIL — cannot resolve `./flags`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/config/flags.ts
/**
 * Build-time internal flags. Read from `import.meta.env.VITE_*`, so they are
 * statically resolved at build and can be flipped per environment without a DB
 * migration. Mirrors the VITE_DEV_AUTOLOGIN precedent (see AuthContext).
 *
 * GETRUNNING_V3 gates the Wireflow v3 Get running board. Default OFF; the v1
 * board renders until every v3 phase lands and the host sets this to "true".
 */
export const GETRUNNING_V3: boolean =
  import.meta.env.VITE_GETRUNNING_V3 === "true";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/config/flags.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Enable it for the local dev stack**

Append to `.env.development` (the committed LOCAL-stack config; safe because it targets `127.0.0.1`, never prod):
```
VITE_GETRUNNING_V3=true
```

- [ ] **Step 6: Commit**

```bash
git add src/config/flags.ts src/config/flags.test.ts .env.development
git commit -m "feat: add getrunning_v3 build-time flag"
```

---

## Task 2: v3 step model + `composeGetRunningV3`

**Files:**
- Create: `src/lib/getRunning/steps.ts`
- Test: `src/lib/getRunning/steps.test.ts`

**Interfaces:**
- Consumes: `BookingSetupStatus` (`src/lib/bookings/setupStatus.ts`), `HireOrderSetupStatus` (`src/lib/hireOrders/setupStatus.ts`). Read their step arrays with `.steps.find(s => s.key === ...)?.done` and `.block`, exactly as v1 `tasks.ts` does — reuse, don't re-derive.
- Produces: `GetRunningStepKey`, `GetRunningPhaseKey`, `StepBlock`, `GetRunningStep`, `GetRunningPhaseV3`, `GetRunningModelV3`, `GetRunningInputV3`, `composeGetRunningV3(input): GetRunningModelV3`, `MINUTES_PER_STEP` (= 3), `getRunningV3State(model): "blocking" | "ready" | "complete"`.

**Phase-1 signal mapping (honest approximations; later phases replace the get_dates split and the new-step signals):**

| step | phase | Phase-1 `done` source | `placeholder` |
|---|---|---|---|
| source, connect, map, cities | get_dates | `input.datesDone` (all four share the "dates are in" signal for now) | true |
| productions | get_dates | booking `slots` step `.done` (casting breakdown set) | true |
| artists | bookable | booking `people` step `.done` | false |
| skills | bookable | `input.skillsDone` (default false) | true |
| coverage | bookable | booking `ladder` coverage-done AND `eligibility` `.done` | false |
| flow | bookable | booking `flow` step `.done` | false |
| timing | bookable | booking `timing` step `.done` | false |
| team | bookable | `input.producerCount != null && input.producerCount > 0` | false |
| letterhead | paperwork | hire `letterhead` step `.done` | false |
| fee | paperwork | `input.feeDone` (default false) | true |
| terms | paperwork | hire `terms` step `.done` | false |
| document | paperwork | `input.documentDone` (default false) | true |
| countersign | paperwork | hire `countersign` step `.done` | false |

`block` per step: reuse the matching booking/hire step's `block` where a mapping exists (as v1's `makeBookingTask`/`makeHireTask` do); `null` otherwise. Board-level hard block for the four "dates are in" steps mirrors v1 `hardBlock` (booking `people` step block, default `"booking"`). `adminOnly`: `team` always true; paperwork steps true; else false. `actionableByViewer`: admin → true; producer → `!adminOnly` AND (booking-domain steps require the matching capability, mirroring v1 `withActionability`). `placeholder` steps still render on the board; their body is `StepComingSoon` (Task 7).

Phase gating: `get_dates` + `bookable` only when `input.bookingOn`; `paperwork` only when `input.hireOrdersOn`. `bookable.waitsOn = "get_dates"` when the `productions` step is not done (design: "waits on Get dates in" until one production can be cast). `paperwork.waitsOn = null` (independent). Progress `totalCount` = count of steps across included phases.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/getRunning/steps.test.ts
import { describe, it, expect } from "vitest";
import { composeGetRunningV3, type GetRunningInputV3 } from "./steps";
import type { BookingSetupStatus } from "@/lib/bookings/setupStatus";
import type { HireOrderSetupStatus } from "@/lib/hireOrders/setupStatus";

// Minimal booking status builder: every step done unless overridden.
function booking(overrides: Partial<Record<string, boolean>> = {}): BookingSetupStatus {
  const keys = ["shows", "slots", "flow", "people", "ladder", "eligibility", "timing"];
  return {
    // Match the real BookingSetupStatus shape; steps carry key/done/block.
    steps: keys.map((key) => ({ key, done: overrides[key] ?? true, block: null })),
    // Fields consumed by the coverage merge + advisory:
    uncoveredPairs: [],
    datesWithoutCity: 0,
  } as unknown as BookingSetupStatus;
}
function hire(overrides: Partial<Record<string, boolean>> = {}): HireOrderSetupStatus {
  const keys = ["letterhead", "terms", "countersign"];
  return {
    steps: keys.map((key) => ({ key, done: overrides[key] ?? true, blocksIssue: false })),
  } as unknown as HireOrderSetupStatus;
}
const base: GetRunningInputV3 = {
  role: "admin",
  bookingOn: true,
  hireOrdersOn: true,
  booking: booking(),
  hire: hire(),
  datesDone: true,
  producerCount: 1,
  skillsDone: true,
  feeDone: false,
  documentDone: false,
  canManageShows: true,
  canEditScheduling: true,
  canEditBooking: true,
  canEditHire: true,
  canAddArtists: true,
  canInvite: true,
};

it("produces 16 steps across 3 phases when both modules are on", () => {
  const m = composeGetRunningV3(base);
  expect(m.phases.map((p) => p.key)).toEqual(["get_dates", "bookable", "paperwork"]);
  expect(m.totalCount).toBe(16);
  expect(m.phases.flatMap((p) => p.steps)).toHaveLength(16);
});

it("drops the paperwork phase and shrinks the denominator when hire_orders is off", () => {
  const m = composeGetRunningV3({ ...base, hireOrdersOn: false, hire: null });
  expect(m.phases.map((p) => p.key)).toEqual(["get_dates", "bookable"]);
  expect(m.totalCount).toBe(11);
});

it("shows only the paperwork phase when booking_flow is off", () => {
  const m = composeGetRunningV3({ ...base, bookingOn: false, booking: null });
  expect(m.phases.map((p) => p.key)).toEqual(["paperwork"]);
});

it("maps the four dates-in steps to datesDone and productions to the slots step", () => {
  const m = composeGetRunningV3({ ...base, datesDone: false, booking: booking({ slots: false }) });
  const getDates = m.phases.find((p) => p.key === "get_dates")!;
  const doneByKey = Object.fromEntries(getDates.steps.map((s) => [s.key, s.done]));
  expect(doneByKey).toMatchObject({ source: false, connect: false, map: false, cities: false, productions: false });
});

it("bookable waits on get_dates until productions (slots) is done", () => {
  const m = composeGetRunningV3({ ...base, booking: booking({ slots: false }) });
  expect(m.phases.find((p) => p.key === "bookable")!.waitsOn).toBe("get_dates");
});

it("merges ladder+eligibility into one coverage step", () => {
  const m = composeGetRunningV3({ ...base, booking: booking({ eligibility: false }) });
  const coverage = m.phases.find((p) => p.key === "bookable")!.steps.find((s) => s.key === "coverage")!;
  expect(coverage.done).toBe(false);
  expect(m.phases.flatMap((p) => p.steps).some((s) => s.key === "eligibility")).toBe(false);
});

it("marks new steps as placeholders and reuse steps as real", () => {
  const m = composeGetRunningV3(base);
  const byKey = Object.fromEntries(m.phases.flatMap((p) => p.steps).map((s) => [s.key, s.placeholder]));
  expect(byKey).toMatchObject({ source: true, skills: true, fee: true, document: true, artists: false, flow: false, coverage: false });
});

it("a producer cannot act on team (adminOnly)", () => {
  const m = composeGetRunningV3({ ...base, role: "producer" });
  const team = m.phases.find((p) => p.key === "bookable")!.steps.find((s) => s.key === "team")!;
  expect(team.adminOnly).toBe(true);
  expect(team.actionableByViewer).toBe(false);
});

it("is complete only when every included non-placeholder-blocking step is done", () => {
  // With placeholders (source/skills/fee/document) not done, board is not complete.
  expect(composeGetRunningV3(base).complete).toBe(false);
  // All real+placeholder signals satisfied → complete.
  const all = composeGetRunningV3({ ...base, skillsDone: true, feeDone: true, documentDone: true });
  expect(all.complete).toBe(true);
});
```

> Note for the implementer: read the real `BookingSetupStatus`/`HireOrderSetupStatus` shapes in `src/lib/bookings/setupStatus.ts` and `src/lib/hireOrders/setupStatus.ts` before finalizing the builders above; adjust the `as unknown as` stubs to match the actual step field names (`key`, `done`, `block`/`blocksIssue`). Do not weaken the assertions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/getRunning/steps.test.ts`
Expected: FAIL — `composeGetRunningV3` not found.

- [ ] **Step 3: Implement `steps.ts`**

Implement the types and `composeGetRunningV3` per the mapping table above. Model the composer on v1 `src/lib/getRunning/tasks.ts` (`makeBookingTask`/`makeHireTask`/`withActionability`) — read it and mirror its capability + block logic; do not import from it (v1 stays independent). Compute `datesWithoutCity` by reading `booking.datesWithoutCity` (as v1 does). `complete` = every included step `done`. `canFirstOffer` = every `block === "offers" || "booking"` step done. `nextStep` = first not-done step in phase order. `MINUTES_PER_STEP = 3`.

```ts
// src/lib/getRunning/steps.ts  (shape — fill in bodies per the mapping table)
import type { BookingSetupStatus } from "@/lib/bookings/setupStatus";
import type { HireOrderSetupStatus } from "@/lib/hireOrders/setupStatus";

export type GetRunningPhaseKey = "get_dates" | "bookable" | "paperwork";
export type GetRunningStepKey =
  | "source" | "connect" | "map" | "cities" | "productions"
  | "artists" | "skills" | "coverage" | "flow" | "timing" | "team"
  | "letterhead" | "fee" | "terms" | "document" | "countersign";
export type StepBlock = "offers" | "booking" | "issuing" | "filling" | null;

export interface GetRunningStep {
  key: GetRunningStepKey;
  phase: GetRunningPhaseKey;
  done: boolean;
  block: StepBlock;
  adminOnly: boolean;
  actionableByViewer: boolean;
  placeholder: boolean;
}
export interface GetRunningPhaseV3 {
  key: GetRunningPhaseKey;
  steps: GetRunningStep[];
  done: boolean;
  doneCount: number;
  totalCount: number;
  block: StepBlock;
  waitsOn: GetRunningPhaseKey | null;
}
export interface GetRunningModelV3 {
  phases: GetRunningPhaseV3[];
  doneCount: number;
  totalCount: number;
  canFirstOffer: boolean;
  complete: boolean;
  bookingOn: boolean;
  hireOrdersOn: boolean;
  datesWithoutCity: number;
  nextStep: { phase: GetRunningPhaseKey; key: GetRunningStepKey } | null;
}
export interface GetRunningInputV3 {
  role: "admin" | "producer";
  bookingOn: boolean;
  hireOrdersOn: boolean;
  booking: BookingSetupStatus | null;
  hire: HireOrderSetupStatus | null;
  datesDone: boolean;
  producerCount: number | null;
  skillsDone: boolean;
  feeDone: boolean;
  documentDone: boolean;
  canManageShows: boolean;
  canEditScheduling: boolean;
  canEditBooking: boolean;
  canEditHire: boolean;
  canAddArtists: boolean;
  canInvite: boolean;
}
export const MINUTES_PER_STEP = 3;
export type GetRunningV3State = "blocking" | "ready" | "complete";
export function getRunningV3State(m: GetRunningModelV3): GetRunningV3State {
  return m.complete ? "complete" : m.canFirstOffer ? "ready" : "blocking";
}
export function composeGetRunningV3(input: GetRunningInputV3): GetRunningModelV3 {
  // ...build phases per the mapping table; see tasks.ts for the block/capability idiom.
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/getRunning/steps.test.ts && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS (all `it` blocks); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/getRunning/steps.ts src/lib/getRunning/steps.test.ts
git commit -m "feat: add wireflow v3 step model composer"
```

---

## Task 3: Per-step deep-link map (`stepFeature.ts`)

**Files:**
- Create: `src/lib/getRunning/stepFeature.ts`
- Test: `src/lib/getRunning/stepFeature.test.ts`

**Interfaces:**
- Consumes: `GetRunningStepKey` (Task 2); `ROUTES` (`src/config/app.config.ts`); `SettingsTabParam` (`src/lib/settingsTabs.ts`).
- Produces: `StepFeature { route: string; tab?: SettingsTabParam; crumbKey: string; shortKey: string }`, `STEP_FEATURE: Record<GetRunningStepKey, StepFeature>`, `stepFeatureLink(key): string`. Deep-link targets: `source`/`connect`/`map`/`cities` → `ROUTES.BOOKINGS` (`/dates`); `productions` → `ROUTES.PRODUCTIONS`; `artists` → `ROUTES.ARTISTS`; `skills` → `?tab=skills`; `coverage` → `?tab=casts-coverage`; `flow`/`timing` → `?tab=booking`; `team` → `?tab=people`; `letterhead`/`fee`/`terms`/`document`/`countersign` → `?tab=hire-orders`. `stepFeatureLink` appends `?tab=` when `tab` is set (mirror v1 `taskFeatureLink`).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/getRunning/stepFeature.test.ts
import { describe, it, expect } from "vitest";
import { STEP_FEATURE, stepFeatureLink } from "./stepFeature";
import { ROUTES } from "@/config/app.config";

it("covers all 16 step keys", () => {
  expect(Object.keys(STEP_FEATURE)).toHaveLength(16);
});
it("routes coverage to the casts-coverage settings tab", () => {
  expect(stepFeatureLink("coverage")).toBe(`${ROUTES.SETTINGS}?tab=casts-coverage`);
});
it("routes productions to the productions page (no tab)", () => {
  expect(stepFeatureLink("productions")).toBe(ROUTES.PRODUCTIONS);
});
it("routes contracts steps to the hire-orders tab", () => {
  for (const k of ["letterhead", "fee", "terms", "document", "countersign"] as const) {
    expect(stepFeatureLink(k)).toBe(`${ROUTES.SETTINGS}?tab=hire-orders`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/getRunning/stepFeature.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `stepFeature.ts`** (model on v1 `taskFeature.ts`, verbatim idiom; add the `source`/`connect`/`map`/`cities`/`skills`/`fee`/`document` rows).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/getRunning/stepFeature.test.ts && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/getRunning/stepFeature.ts src/lib/getRunning/stepFeature.test.ts
git commit -m "feat: add wireflow v3 per-step deep-link map"
```

---

## Task 4: `useGetRunningV3` hook

**Files:**
- Create: `src/hooks/useGetRunningV3.ts`
- Test: `src/hooks/useGetRunningV3.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `useEntitlements`, `useBookingSetupStatus`, `useHireOrderSetupStatus`, `useProducerCount`, `useCan` — exactly the hooks v1 `src/hooks/useGetRunning.ts` uses (read it and mirror it). Plus a skills-count query for `skillsDone` (reuse `useSkills` if it exposes a count; else default `skillsDone` from a cheap count and leave `feeDone`/`documentDone` false in Phase 1).
- Produces: `useGetRunningV3(): { model: GetRunningModelV3 | null; isLoading: boolean }`.

Build `GetRunningInputV3` from the same sources as v1 `useGetRunning` (see digest §5): `bookingOn`/`hireOrdersOn` from `useEntitlements`; `booking`/`coverage`/`artistCount` from `useBookingSetupStatus`; `hire` from `useHireOrderSetupStatus`; `producerCount` from `useProducerCount`; capabilities from the five `useCan(...)`. `datesDone` = booking `shows` step done (Phase-1 approximation, same as v1). `skillsDone` = skills exist (best-effort; default false if no cheap signal). `feeDone`/`documentDone` = false (Phase 1). Return `{ model: null, isLoading: true }` while loading, mirroring v1.

- [ ] **Step 1: Write the failing test**

```tsx
// src/hooks/useGetRunningV3.test.tsx
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { withProviders } from "@/test/renderWithProviders"; // use the real wrapper export
import { useGetRunningV3 } from "./useGetRunningV3";

it("returns a 16-step model for an admin with both modules on", async () => {
  // Seed the supabaseFake / query client via renderWithProviders fixtures so
  // entitlements = booking_flow + hire_orders and setup statuses resolve.
  const { result } = renderHook(() => useGetRunningV3(), { wrapper: withProviders(/* seeded fixtures */) });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.model?.totalCount).toBe(16);
});
```

> Implementer: match the exact provider/fixture API in `src/test/renderWithProviders.tsx` + `src/test/fixtures.ts` (read them; v1 `useGetRunning` has no hook test today, so model the seeding on an existing hook test such as `src/hooks/*.test.tsx`). Assert only on the composed model, never on internal query state.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useGetRunningV3.test.tsx`
Expected: FAIL — hook not found.

- [ ] **Step 3: Implement `useGetRunningV3.ts`** by copying the structure of `src/hooks/useGetRunning.ts` and swapping `composeGetRunning` → `composeGetRunningV3`, adding the `skillsDone`/`feeDone`/`documentDone` inputs.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useGetRunningV3.test.tsx && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGetRunningV3.ts src/hooks/useGetRunningV3.test.tsx
git commit -m "feat: add useGetRunningV3 hook"
```

---

## Task 5: i18n namespace `getRunningV3`

**Files:**
- Create: `src/i18n/locales/en/getRunningV3.json`, `src/i18n/locales/de/getRunningV3.json`
- Modify: `src/i18n/index.ts` (import + register the namespace; add to the `ns` array)
- Test: covered by existing `src/i18n/keyParity.test.ts` + `copyLint.test.ts` (run them).

**Interfaces:**
- Produces: the `getRunningV3` namespace with keys used by Tasks 6–9: `header.{eyebrow,title}`, `progress.done` (`"{{done}} of {{total}} done"`), `hero.{eyebrowTemplate,openStep,seeAll,minutes}`, `stillShut.{title,firstAsk,firstContract,nothingElse,open,stepsAway}`, `rails.{title,hint,clickHint}`, `phases.{get_dates,bookable,paperwork}.{name,summary}`, `phaseRow.{continue,start,waitsOn,doneOf}`, `wizard.{collapse,stepOf,finishLater,howThisWorks,helpCenter}`, `steps.<16 keys>.{title,hint}`, `guide.<16 keys>.{title,body,points,article}`, `comingSoon.{title,body}`, `footerRole.{admin,producer}`.

- [ ] **Step 1: Write EN + DE JSON** (Du-form, no dashes, terminology per Global Constraints; every EN key present in DE). Source the copy from the design screens (`BoardPhases`, `SourceImport`, `Coverage`, `OfferFlow`, `Run3Steps`, `PartsEditor`) but remap terminology (production/Casting breakdown/Contract). Keep the guide `points` as string arrays.

- [ ] **Step 2: Register the namespace**

In `src/i18n/index.ts`: add `import enGetRunningV3 from './locales/en/getRunningV3.json';` (+ DE twin), add `getRunningV3: enGetRunningV3` to the EN `resources` and the DE twin, and add `'getRunningV3'` to the `ns:` array.

- [ ] **Step 3: Run the i18n gates**

Run: `npx vitest run src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts`
Expected: PASS (EN/DE parity holds; no dashes; Du-form).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/getRunningV3.json src/i18n/locales/de/getRunningV3.json src/i18n/index.ts
git commit -m "feat: add getRunningV3 i18n namespace"
```

---

## Task 6: `WizardShell` + footer portal

**Files:**
- Create: `src/components/getRunning/v3/WizardFooterContext.ts`
- Create: `src/components/getRunning/v3/WizardShell.tsx`
- Test: `src/components/getRunning/v3/WizardShell.test.tsx`

**Interfaces:**
- Consumes: `GetRunningStep` (Task 2), `STEP_FEATURE`/`stepFeatureLink` (Task 3), `useTranslation("getRunningV3")`, ui primitives (`Eyebrow`, `Metric`, `Button`, `StatusPill`).
- Produces: `WizardFooterContext` (a `React.Context<HTMLDivElement | null>`, mirroring `TaskPanelFooterContext`); `WizardShell` with props:
```ts
export interface WizardShellProps {
  phaseKey: GetRunningPhaseKey;
  steps: GetRunningStep[];        // the phase's steps, for the left rail
  activeKey: GetRunningStepKey;   // which step body shows
  onSelectStep: (key: GetRunningStepKey) => void;
  onCollapse: () => void;         // header "Collapse"/close and footer "Finish later"
  children: React.ReactNode;      // the step body (from stepRegistryV3)
}
```
Layout follows the frame in `Coverage.dc.html`: accent-50 header band (phase number pill, phase name, block chip via `StatusPill`, `step N / M`, Collapse) · body grid `[216px_minmax(0,1fr)_268px]` (left step rail with per-step dot+title+hint; middle = `children`; right = "How this works" guide from `guide.<activeKey>`); sticky footer (`step N / M`, note, "Finish later", + a `<div ref>` footer-portal mount wrapped in `<WizardFooterContext.Provider value={slotEl}>`). Use tokens only.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/getRunning/v3/WizardShell.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WizardShell } from "./WizardShell";
import type { GetRunningStep } from "@/lib/getRunning/steps";

const steps: GetRunningStep[] = [
  { key: "artists", phase: "bookable", done: true, block: null, adminOnly: false, actionableByViewer: true, placeholder: false },
  { key: "coverage", phase: "bookable", done: false, block: "offers", adminOnly: false, actionableByViewer: true, placeholder: false },
];
function renderShell(active = "coverage" as const, onSelectStep = vi.fn(), onCollapse = vi.fn()) {
  render(
    <MemoryRouter>
      <WizardShell phaseKey="bookable" steps={steps} activeKey={active} onSelectStep={onSelectStep} onCollapse={onCollapse}>
        <div>BODY</div>
      </WizardShell>
    </MemoryRouter>
  );
  return { onSelectStep, onCollapse };
}

it("renders the active step body and the step counter", () => {
  renderShell();
  expect(screen.getByText("BODY")).toBeInTheDocument();
  expect(screen.getByText(/2 \/ 2|step 2 \/ 2/i)).toBeInTheDocument();
});
it("renders every step in the left rail and lets you pick one", async () => {
  const { onSelectStep } = renderShell();
  await userEvent.click(screen.getByRole("button", { name: /artists/i }));
  expect(onSelectStep).toHaveBeenCalledWith("artists");
});
it("collapses from the header and the footer", async () => {
  const { onCollapse } = renderShell();
  await userEvent.click(screen.getByRole("button", { name: /collapse|close/i }));
  await userEvent.click(screen.getByRole("button", { name: /finish later/i }));
  expect(onCollapse).toHaveBeenCalledTimes(2);
});
it("shows the how-this-works guide for the active step", () => {
  renderShell();
  // guide.coverage.title from getRunningV3 — assert the section landmark, not exact copy.
  expect(screen.getByText(/how this works/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/getRunning/v3/WizardShell.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `WizardFooterContext.ts` then `WizardShell.tsx`** per the layout above; copy the footer-portal pattern from `TaskPanel.tsx` (`setFooterSlotEl` + `<...Context.Provider value={footerSlotEl}>` + `<div ref={setFooterSlotEl} />`). Pixel markup follows `Coverage.dc.html`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/getRunning/v3/WizardShell.test.tsx && npx tsc -p tsconfig.app.json --noEmit && npm run lint`
Expected: PASS; typecheck + lint (ui-conventions) clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/getRunning/v3/WizardFooterContext.ts src/components/getRunning/v3/WizardShell.tsx src/components/getRunning/v3/WizardShell.test.tsx
git commit -m "feat: add v3 WizardShell frame"
```

---

## Task 7: Step body registry + `StepComingSoon`

**Files:**
- Create: `src/components/getRunning/v3/StepComingSoon.tsx`
- Create: `src/components/getRunning/v3/stepRegistryV3.tsx`
- Test: `src/components/getRunning/v3/stepRegistryV3.test.tsx`

**Interfaces:**
- Consumes: existing bodies with their real signatures (digest §2) — `FlowStep`/`TimingStep` (`{orgId,onDone}`), `LetterheadStep`/`TermsStep`/`CountersignStep` (`{orgId,onDone}`), `PeoplePanelBody` (`{orgId,artistCount}`), `LadderPanelBody`/`EligibilityPanelBody` (`{orgId,coverage,onDone}`), `TeamPanelBody` (`{orgId}`); `useBookingSetupStatus` for `coverage`/`artistCount` (gate the fetch on booking-domain steps, as v1 `taskPanelRegistry` does).
- Produces: `StepBodyV3({ step, orgId, onDone }): JSX.Element` where `step: GetRunningStep`. Mapping: `artists`→`PeoplePanelBody`; `coverage`→render **both** `LadderPanelBody` and `EligibilityPanelBody` stacked (the merged step, decision #4) sharing `coverage`; `flow`→`FlowStep`; `timing`→`TimingStep`; `team`→`TeamPanelBody`; `letterhead`/`terms`/`countersign`→ their steps; every `placeholder` step (`source`/`connect`/`map`/`cities`/`productions`/`skills`/`fee`/`document`)→`StepComingSoon` with a deep-link to `stepFeatureLink(step.key)` for the real surface.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/getRunning/v3/stepRegistryV3.test.tsx
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { StepBodyV3 } from "./stepRegistryV3";
import type { GetRunningStep } from "@/lib/getRunning/steps";

const mk = (key: GetRunningStep["key"], placeholder: boolean): GetRunningStep =>
  ({ key, phase: "bookable", done: false, block: null, adminOnly: false, actionableByViewer: true, placeholder });

it("renders StepComingSoon for a placeholder step with a deep-link", () => {
  renderWithProviders(<StepBodyV3 step={mk("skills", true)} orgId="org-1" onDone={vi.fn()} />);
  expect(screen.getByText(/coming/i)).toBeInTheDocument();
  expect(screen.getByRole("link")).toBeInTheDocument();
});
it("renders the real team body for the team step", () => {
  renderWithProviders(<StepBodyV3 step={mk("team", false)} orgId="org-1" onDone={vi.fn()} />);
  // TeamPanelBody renders an invite control — assert a stable element it owns.
  expect(screen.getByRole("heading", { level: 2, name: /team|producer/i })).toBeInTheDocument();
});
```

> Implementer: pick assertions that match what `TeamPanelBody`/`StepComingSoon` actually render (read them). Keep role+name queries out of `findBy`/`waitFor` retry loops (see memory `rtl-role-name-queries-in-retry-loops`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/getRunning/v3/stepRegistryV3.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `StepComingSoon.tsx`** (title + body from `comingSoon.*` + a `<Link to={stepFeatureLink(step.key)}>` to the real surface) and **`stepRegistryV3.tsx`** (the switch above; mirror `taskPanelRegistry.tsx`'s `useBookingSetupStatus` gating).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/getRunning/v3/stepRegistryV3.test.tsx && npx tsc -p tsconfig.app.json --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/getRunning/v3/StepComingSoon.tsx src/components/getRunning/v3/stepRegistryV3.tsx src/components/getRunning/v3/stepRegistryV3.test.tsx
git commit -m "feat: add v3 step body registry with coming-soon stubs"
```

---

## Task 8: Board sub-components (Hero, StillShut, IconRail, PhaseRow)

**Files:**
- Create: `src/components/getRunning/v3/board/HeroCard.tsx`, `StillShutCard.tsx`, `PhaseIconRail.tsx`, `PhaseRow.tsx`
- Test: `src/components/getRunning/v3/board/board.test.tsx`

**Interfaces:**
- Consumes: `GetRunningModelV3`, `GetRunningPhaseV3`, `GetRunningStep` (Task 2); `useTranslation("getRunningV3")`; ui primitives (`Eyebrow`, `Metric`, `StatusPill`, `Button`).
- Produces:
  - `HeroCard({ model, onOpenNext }: { model: GetRunningModelV3; onOpenNext: (phase: GetRunningPhaseKey, step: GetRunningStepKey) => void })` — accent hero: "Where you left off", the `nextStep` title in display type, "Open step" + "See all", est. minutes (`MINUTES_PER_STEP × remaining`).
  - `StillShutCard({ model })` — the "first ask" / "first contract" / "nothing else" gates with amber "N steps away" chips.
  - `PhaseIconRail({ phase, onOpenStep })` — one rail: an icon per step (filled/amber-on-block/pending), `title` attr = step title, click → `onOpenStep`. Icons per step key: pick from `lucide-react` matching the design (`Search, Zap, Filter, MapPin, Ticket, User, Music, Users, Route, Clock, Plus, Settings, DollarSign, MoreHorizontal, Calendar, Check`).
  - `PhaseRow({ phase, index, model, onOpen })` — numbered row: name, status line, Continue/Start/"Waits on X".

- [ ] **Step 1: Write the failing tests** (render each with a fabricated `GetRunningModelV3`; assert: hero shows the next step title + calls `onOpenNext`; StillShut shows both gates; IconRail renders N icons with `title`s and fires `onOpenStep`; PhaseRow shows "Waits on Get dates in" when `phase.waitsOn === "get_dates"`). Build the model with `composeGetRunningV3` from a seeded input (import the real composer — do not hand-roll a model).

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run src/components/getRunning/v3/board/board.test.tsx` → FAIL.

- [ ] **Step 3: Implement the four components** per `BoardPhases.dc.html` (tokens only; numbers via `<Metric>`; uppercase via `<Eyebrow>`; blocking icon uses amber tokens + `StatusPill`).

- [ ] **Step 4: Run tests to verify they pass** — `npx vitest run src/components/getRunning/v3/board/board.test.tsx && npx tsc -p tsconfig.app.json --noEmit && npm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/getRunning/v3/board/
git commit -m "feat: add v3 board sub-components"
```

---

## Task 9: `GetRunningBoardV3` + wire the page and dev harness

**Files:**
- Create: `src/components/getRunning/v3/GetRunningBoardV3.tsx`
- Test: `src/components/getRunning/v3/GetRunningBoardV3.test.tsx`
- Modify: `src/pages/GetRunningPage.tsx`
- Modify: `src/pages/DevGetRunningHarness.tsx`

**Interfaces:**
- Consumes: `useGetRunningV3` (Task 4), `HeroCard`/`StillShutCard`/`PhaseIconRail`/`PhaseRow` (Task 8), `WizardShell` (Task 6), `StepBodyV3` (Task 7), `useAuth`, `useOrgAdminNames`, `RetiredBoard`/`NothingToSetUp` (reuse from v1). 
- Produces: `GetRunningBoardV3({ context }: { context: "page" | "settings" })` — renders header + progress, `HeroCard`, `StillShutCard`, the "All N steps" card (three `PhaseIconRail`s), and the phase rows; selecting a phase replaces its row with `<WizardShell>` wrapping `<StepBodyV3>` inline (other phases collapse to `PhaseRow`s), matching `Coverage.dc.html`. Local state `selectedPhase`/`selectedStep`; auto-open the first blocking step once (mirror v1 `autoOpenedRef`). `handleStepDone` advances to the next not-done step in the phase, else collapses.

- [ ] **Step 1: Write the failing tests**

```tsx
// GetRunningBoardV3.test.tsx — render with providers + seeded fixtures (both modules on, admin)
it("shows the board with three phase rows and expands a phase inline on click", async () => { /* click phase 2 → WizardShell appears, its step body renders */ });
it("shows a placeholder body for a new step (skills) inside the wizard", async () => { /* expand bookable, select skills → 'coming' text */ });
it("renders RetiredBoard when the model is complete", async () => { /* seed complete model */ });
```
Fill in with real queries/assertions modeled on the existing `GetRunningPage`/`PhaseCard` tests.

- [ ] **Step 2: Run tests to verify they fail** — FAIL (module not found).

- [ ] **Step 3: Implement `GetRunningBoardV3.tsx`** per `BoardPhases.dc.html` + the inline-expansion behavior from `Coverage.dc.html`.

- [ ] **Step 4: Wire the page (flag-gated)**

In `src/pages/GetRunningPage.tsx`, at the top of the non-artist render branch:
```tsx
import { GETRUNNING_V3 } from "@/config/flags";
import { GetRunningBoardV3 } from "@/components/getRunning/v3/GetRunningBoardV3";
// ...inside the component, after the artist bounce + loading guards:
if (GETRUNNING_V3) return <GetRunningBoardV3 context="page" />;
// ...existing v1 render below, unchanged.
```

- [ ] **Step 5: Wire the dev harness (always v3)**

In `src/pages/DevGetRunningHarness.tsx` render `<GetRunningBoardV3 context="page" />` so `/dev/get-running` shows v3 regardless of the flag (dev-only route already registered in `App.tsx`).

- [ ] **Step 6: Run tests + full fast gate**

Run: `npx vitest run src/components/getRunning/v3/ src/pages/GetRunningPage.test.tsx && npm run verify:fast`
Expected: PASS; v1 `GetRunningPage.test.tsx` still green (flag off in test env, so v1 renders).

- [ ] **Step 7: Commit**

```bash
git add src/components/getRunning/v3/GetRunningBoardV3.tsx src/components/getRunning/v3/GetRunningBoardV3.test.tsx src/pages/GetRunningPage.tsx src/pages/DevGetRunningHarness.tsx
git commit -m "feat: wire v3 board behind flag and dev harness"
```

---

## Task 10: Live dev-stack visual verification

**Files:** none (verification only).

- [ ] **Step 1: Boot the local stack + dev server**

Run: `npm run local:up` then `npm run dev` (Vite on 8080; `.env.development` now sets `VITE_GETRUNNING_V3=true`, so `/get-running` renders v3). Confirm the banner reads `▶ Supabase: LOCAL`.

- [ ] **Step 2: Verify against the design** using the Browser pane (`preview_start` name `dev`, navigate to `/get-running` and `/dev/get-running`): board header + progress, hero "Where you left off", "What is still shut" gates, the three icon rails (filled/amber/pending + hover titles), phase rows (Continue/Waits on/Start), inline phase expansion into `WizardShell` (step rail + a reuse body e.g. Coverage + guide + footer), and a placeholder step (skills) showing `StepComingSoon`. Compare side by side with `BoardPhases.dc.html` and `Coverage.dc.html`. Check `read_console_messages` for errors and `resize_window` for dark mode.

- [ ] **Step 3: Capture a screenshot** for the owner and note any fidelity gaps as follow-ups (do not fix pixel drift outside this plan's scope without noting it).

- [ ] **Step 4: Commit** any small fidelity fixes found:

```bash
git add -A && git commit -m "fix: v3 board fidelity against design"
```

---

## Self-review (completed while writing)

- **Spec coverage:** WizardShell (§5.1) → T6; board (§5.2) → T8/T9; step model + module/role gating + merged coverage (§4/§5.3) → T2; deep-linking scaffold (§8) → T3; flag (§2.6) → T1; i18n/copy remap (§7) → T5; reuse of existing editors (§4.1) → T7; observability untouched (§3) — Phase 1 touches no Airtable code. New backend (§6), Settings mirror (§8), Sheet/fee steps → **Phases 2–5, out of scope here** (their steps render `StepComingSoon`).
- **Placeholder scan:** the only "placeholders" are the intentional `StepComingSoon` bodies (a shipped stub behind the flag), documented in the mapping table — not plan gaps. Component pixel markup is delegated to named design files, with structure + props + tests specified.
- **Type consistency:** `GetRunningStepKey`/`GetRunningModelV3`/`GetRunningStep` names are used identically across T2→T4/T6/T7/T8/T9; `StepBodyV3`, `WizardShellProps`, `useGetRunningV3` signatures match their consumers; reuse-body props match the digest exactly (`PeoplePanelBody` takes `artistCount`, `team` takes only `orgId`, ladder/eligibility take `coverage`).
