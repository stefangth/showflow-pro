# Dashboard First Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a module-composed first-run layer to the dashboard — a role-scoped welcome panel, an on-demand setup rail, and a greyed sample-until-live preview — that assembles itself from whatever modules the org has licensed.

**Architecture:** A pure `src/lib/dashboard/` layer (types + composition + a `FeatureKey`-keyed onboarding registry) is consumed by one integration hook (`useDashboardFirstRun`) and four presentational components under `src/components/dashboard/firstRun/`. Readiness comes only from each module's existing status hook (`useBookingSetupStatus`, `useHireOrderSetupStatus`, plus a query-free artist status); the dashboard edits nothing and deep-links to the real setup surfaces. Anti-drift is structural: step coverage is a compile-time exhaustive `Record`, and a parity test guards the registry against `FEATURE_KEYS`.

**Tech Stack:** React 18 + TypeScript, `@tanstack/react-query` v5, Tailwind + shadcn/ui, Vitest + jsdom + `@testing-library/react`, Supabase Realtime.

## Global Constraints

Every task's requirements implicitly include these (verbatim from the spec and `CLAUDE.md`):

- **Semantic tokens only.** No hardcoded colors (`bg-white`, `#…`). Use `bg-accent-500`/`bg-primary`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-card`, `bg-muted`. Accent numbered stops (`accent-50`–`900`) do **not** support `/opacity` modifiers.
- **No em-dashes or en-dashes in any user-facing copy.** Use periods, commas, colons, or the middot `·`. Arrows are fine.
- **Routes only via `ROUTES`** (`src/config/app.config.ts`). Never a literal route string.
- **`any` is banned** (lint error, CI `--max-warnings 0`). Use explicit interfaces.
- **Tests import the real module.** Frontend tests use `src/test/renderWithProviders.tsx`, `src/test/fixtures.ts`, and `src/test/supabaseFake.ts`. Never `vi.mock('@/integrations/supabase/client')`.
- **Query-key domains:** reads keep the existing prefixes (`['entitlements', orgId]`, `['bookings', …]`, `['app-settings', …]`). Do not invent new domains here.
- **Type-check is three projects:** `npx tsc -p tsconfig.app.json --noEmit` covers `src/`. Run it after each task that adds/edits `src/`.
- **Lint gate:** `npm run lint` must pass with zero warnings.
- **Changelog** is user-facing only; never mention super-admin/platform-admin surfaces.

## Parallelization map

```
Task 1 (types)  ─┬─► Task 2  (firstRun compose)        ─┐
                 ├─► Task 3  (moduleOnboarding registry) ─┤
                 ├─► Task 4  (Welcome + Collapsed)        │
                 ├─► Task 5  (SetupRail)                  ├─► Task 9 (useDashboardFirstRun)
                 ├─► Task 6  (SamplePreview)              │        │
                 └─► Task 8  (useArtistOnboardingStatus) ─┘        │
Task 7 (realtimeInvalidations) ── independent, any time           │
                                                                  ▼
                                        Task 10 (wire DashboardPage) ║ Task 11 (wire ArtistDashboard)
                                                                  ▼
                                                        Task 12 (verify + changelog)
```

- **Wave A (max parallelism, after Task 1):** Tasks 2, 3, 4, 5, 6, 8 run concurrently. Task 7 has no dependency and can run in any wave.
- **Wave B:** Task 9 (needs 2, 3, 8).
- **Wave C:** Tasks 10 and 11 run concurrently (different files; both need 4, 5, 6, 9).
- **Wave D:** Task 12.

Task 1 is the single serialization point: it fixes every shared interface so Wave A tasks never collide. Do it first, commit, then fan out.

---

### Task 1: Shared types (`src/lib/dashboard/types.ts`)

The contract every other task binds to. Types only — verified by the type-checker.

**Files:**
- Create: `src/lib/dashboard/types.ts`

**Interfaces:**
- Produces: every type below. Later tasks import from `@/lib/dashboard/types`.

- [ ] **Step 1: Write the types file**

```ts
// src/lib/dashboard/types.ts
import type { ReactNode } from "react";
import type { FeatureKey } from "@/lib/entitlements";

/** The two capability actions this feature's step CTAs gate on. Kept as a local
 *  union (useCan takes a bare string; capabilities.ts exports no action type). */
export type StepCapability = "edit_booking_settings" | "edit_hire_order_settings";

export type DashboardRole = "admin" | "producer" | "artist";

/** Mirrors lib/bookings/setupStatus BlockKind. */
export type SetupBlock = "offers" | "filling" | null;

export interface OnboardingStepMeta {
  title: string;
  todoHint: string;
  doneHint: string;
  ctaLabel: string;
  ctaRoute: string; // a ROUTES.* value
  /** When set and the viewer lacks it, the step renders read-only (no CTA). */
  ctaCapability?: StepCapability;
}

/** The normalized, module-agnostic status shape the composition consumes.
 *  Every module's status hook is adapted to this ({ steps, complete }). */
export interface ModuleStepState { key: string; done: boolean; block: SetupBlock; }
export interface ModuleStatusLite { steps: ModuleStepState[]; complete: boolean; }
export type ModuleStatuses = Partial<Record<FeatureKey, ModuleStatusLite>>;

export interface ComposedStep extends OnboardingStepMeta {
  key: string;
  moduleKey: FeatureKey;
  done: boolean;
  block: SetupBlock;
}

export interface InheritedRule { title: string; hint: string; }

export interface OnboardingCtx {
  orgName: string;
  /** Resolved booking flow: true = offers with acceptance, false = direct booking. */
  artistAcceptance: boolean;
  counts: { pendingConfirmations: number; openOffers: number; awaitingCountersign: number };
}

export interface ModuleOnboardingDef<StepKey extends string> {
  key: FeatureKey;
  /** Exhaustive per engine step key — a missing/renamed key is a compile error. */
  steps: Record<StepKey, OnboardingStepMeta>;
  rules: (role: DashboardRole, ctx: OnboardingCtx) => InheritedRule[];
  /** Shown when the module is NOT licensed (the upsell nudge). */
  offFooter: string;
}

export interface WelcomeCopy {
  eyebrow: string;
  headline: string;
  body: string;
  primaryLabel: string;
  secondaryLabel: string;
  progressLabel: string;
  progressFilled: number;
  progressTotal: number;
  progressHint: string;
}

export interface SampleStat { title: string; value: string; label: string; }
export interface SampleQueueRow {
  title: string; hint: string; when: string; cta: string;
  tone: "accent" | "warning" | "faint";
}
export interface SampleWeekRow { date: string; ref: string; status: string; }
export interface SamplePreviewData { stats: SampleStat[]; queue: SampleQueueRow[]; week: SampleWeekRow[]; }

export interface ComposeInput {
  enabled: Set<FeatureKey>;
  role: DashboardRole;
  moduleStatuses: ModuleStatuses;
  ctx: OnboardingCtx;
}
export interface ComposeResult {
  steps: ComposedStep[];
  complete: boolean;
  rules: InheritedRule[];
  offFooters: string[];
}

export interface DashboardFirstRunState {
  show: boolean;
  complete: boolean;
  dismissed: boolean;
  steps: ComposedStep[];
  rules: InheritedRule[];
  offFooters: string[];
  welcome: WelcomeCopy;
  sample: SamplePreviewData;
  sectionTitle: string;
  sectionHint: string;
  railEyebrow: string;
  railTitle: string;
  railBody: string;
  collapsedLabel: string;
  collapsedHint: string;
  collapsedCta: string;
  railOpen: boolean;
  openRail: () => void;
  closeRail: () => void;
  dismiss: () => void;
  undismiss: () => void;
}

// Component prop contracts (Wave A components bind to these).
export interface DashboardWelcomeProps { welcome: WelcomeCopy; onPrimary: () => void; onSecondary: () => void; }
export interface DashboardWelcomeCollapsedProps { label: string; hint: string; ctaLabel: string; onOpen: () => void; }
export interface DashboardSetupRailProps {
  eyebrow: string; title: string; body: string; complete: boolean;
  steps: ComposedStep[]; rules: InheritedRule[]; offFooters: string[];
  onClose: () => void; onDismiss: () => void;
}
export interface SamplePreviewProps {
  complete: boolean; sample: SamplePreviewData;
  sectionTitle: string; sectionHint: string; children: ReactNode;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS (no references to undefined symbols; `FeatureKey` resolves).

- [ ] **Step 3: Commit**

```bash
git add src/lib/dashboard/types.ts
git commit -m "add dashboard first-run shared types"
```

---

### Task 2: Composition + copy + sample fixture (`src/lib/dashboard/firstRun.ts`)

Pure logic. **Depends on Task 1.** Parallel with 3, 4, 5, 6, 7, 8.

**Files:**
- Create: `src/lib/dashboard/firstRun.ts`
- Test: `src/lib/dashboard/firstRun.test.ts`

**Interfaces:**
- Consumes: all types from `@/lib/dashboard/types`; `MODULE_ONBOARDING` is imported lazily *only* inside `composeOnboarding` — to avoid a cycle, `composeOnboarding` takes the registry as a parameter (see signature).
- Produces:
  - `composeOnboarding(input: ComposeInput, registry: Record<FeatureKey, ModuleOnboardingDef<string>>): ComposeResult`
  - `welcomeCopy(role: DashboardRole, complete: boolean, ctx: OnboardingCtx, progress: { filled: number; total: number }): WelcomeCopy`
  - `railHeaderCopy(role: DashboardRole, complete: boolean, ctx: OnboardingCtx): { eyebrow: string; title: string; body: string }`
  - `collapsedCopy(role: DashboardRole, complete: boolean, remaining: number): { label: string; hint: string; cta: string }`
  - `SAMPLE_PREVIEW: Record<DashboardRole, SamplePreviewData>`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/dashboard/firstRun.test.ts
import { describe, it, expect } from "vitest";
import { composeOnboarding, welcomeCopy } from "./firstRun";
import type { ComposeInput, ModuleOnboardingDef, ModuleStatusLite } from "./types";

const bookingDef: ModuleOnboardingDef<"flow" | "slots"> = {
  key: "booking_flow",
  steps: {
    flow: { title: "Booking flow", todoHint: "t", doneHint: "d", ctaLabel: "Choose", ctaRoute: "/settings", ctaCapability: "edit_booking_settings" },
    slots: { title: "Slots per show", todoHint: "t", doneHint: "d", ctaLabel: "Set", ctaRoute: "/productions", ctaCapability: "edit_booking_settings" },
  },
  rules: () => [{ title: "Rule", hint: "h" }],
  offFooter: "Booking flow is off.",
};
const hireDef: ModuleOnboardingDef<"letterhead"> = {
  key: "hire_orders",
  steps: { letterhead: { title: "Letterhead", todoHint: "t", doneHint: "d", ctaLabel: "Set", ctaRoute: "/settings/hire-orders" } },
  rules: () => [],
  offFooter: "Hire orders is off. Ask your account manager to switch it on.",
};
const registry = { booking_flow: bookingDef, hire_orders: hireDef } as never;

const ctx = { orgName: "Halle Kollektiv", artistAcceptance: true, counts: { pendingConfirmations: 4, openOffers: 2, awaitingCountersign: 1 } };
const bookingStatus: ModuleStatusLite = {
  steps: [{ key: "flow", done: true, block: null }, { key: "slots", done: false, block: "filling" }],
  complete: false,
};

it("composes only enabled modules and carries done/block from status", () => {
  const input: ComposeInput = { enabled: new Set(["booking_flow"]), role: "admin", moduleStatuses: { booking_flow: bookingStatus }, ctx };
  const r = composeOnboarding(input, registry);
  expect(r.steps.map((s) => s.key)).toEqual(["flow", "slots"]);
  expect(r.steps[1]).toMatchObject({ done: false, block: "filling", moduleKey: "booking_flow", title: "Slots per show" });
  expect(r.complete).toBe(false);
});

it("complete is the AND over enabled modules' status.complete", () => {
  const input: ComposeInput = {
    enabled: new Set(["booking_flow", "hire_orders"]),
    role: "admin",
    moduleStatuses: {
      booking_flow: { steps: [{ key: "flow", done: true, block: null }], complete: true },
      hire_orders: { steps: [{ key: "letterhead", done: false, block: null }], complete: false },
    },
    ctx,
  };
  expect(composeOnboarding(input, registry).complete).toBe(false);
});

it("offFooters come from disabled licensable modules", () => {
  const input: ComposeInput = { enabled: new Set(["booking_flow"]), role: "admin", moduleStatuses: { booking_flow: bookingStatus }, ctx };
  expect(composeOnboarding(input, registry).offFooters).toEqual(["Hire orders is off. Ask your account manager to switch it on."]);
});

it("welcomeCopy interpolates org name and progress", () => {
  const w = welcomeCopy("admin", false, ctx, { filled: 1, total: 4 });
  expect(w.headline).toContain("Halle Kollektiv");
  expect(w.progressTotal).toBe(4);
  expect(w.progressFilled).toBe(1);
  expect(w.body).not.toMatch(/[—–]/); // no em/en dashes
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/dashboard/firstRun.test.ts`
Expected: FAIL ("composeOnboarding is not a function").

- [ ] **Step 3: Implement `firstRun.ts`**

```ts
// src/lib/dashboard/firstRun.ts
import { FEATURE_KEYS, type FeatureKey } from "@/lib/entitlements";
import type {
  ComposeInput, ComposeResult, ComposedStep, DashboardRole,
  ModuleOnboardingDef, OnboardingCtx, SamplePreviewData, WelcomeCopy,
} from "./types";

export function composeOnboarding(
  input: ComposeInput,
  registry: Record<FeatureKey, ModuleOnboardingDef<string>>,
): ComposeResult {
  const { enabled, role, moduleStatuses, ctx } = input;
  const steps: ComposedStep[] = [];
  const rules: ComposeResult["rules"] = [];
  let complete = true;

  for (const key of FEATURE_KEYS) {
    const def = registry[key];
    if (!enabled.has(key)) continue;
    const status = moduleStatuses[key];
    if (!status) { complete = false; continue; } // unread status => not complete
    for (const s of status.steps) {
      const meta = def.steps[s.key];
      if (!meta) continue; // defensive; parity test guarantees coverage
      steps.push({ ...meta, key: s.key, moduleKey: key, done: s.done, block: s.block });
    }
    if (!status.complete) complete = false;
    rules.push(...def.rules(role, ctx));
  }

  const offFooters = FEATURE_KEYS.filter((k) => !enabled.has(k)).map((k) => registry[k].offFooter);
  return { steps, complete, rules, offFooters };
}

// ---- Copy (ported from the prototype's renderVals; org name + counts interpolated).
export function welcomeCopy(
  role: DashboardRole, complete: boolean, ctx: OnboardingCtx,
  progress: { filled: number; total: number },
): WelcomeCopy {
  const org = ctx.orgName;
  const base = { eyebrow: "Welcome", progressFilled: progress.filled, progressTotal: progress.total };
  if (role === "admin") {
    return complete
      ? { ...base, headline: "This workspace is already set up", body: "Nothing to configure. Walk the decisions behind it, because every number on this page follows them.", primaryLabel: "How this org works", secondaryLabel: "Dismiss", progressLabel: `Set up · ${progress.total} of ${progress.total}`, progressHint: "The rules you inherited" }
      : { ...base, headline: `You are the first admin at ${org}`, body: "The database is empty. A few steps put real dates on this page, and the sample below becomes yours.", primaryLabel: "Start setup", secondaryLabel: "Later", progressLabel: `Set up · ${progress.filled} of ${progress.total}`, progressHint: "About 15 minutes" };
  }
  if (role === "producer") {
    return complete
      ? { ...base, headline: `You have joined ${org}`, body: `${ctx.counts.pendingConfirmations} artists are waiting on a confirm from you.`, primaryLabel: "How this org works", secondaryLabel: "Dismiss", progressLabel: `Set up · ${progress.total} of ${progress.total}`, progressHint: "The rules you inherited" }
      : { ...base, headline: `${org} is still being set up`, body: "Dates, offers and confirmations appear here the moment the first import lands.", primaryLabel: "See what is outstanding", secondaryLabel: "Later", progressLabel: `Org setup · ${progress.filled} of ${progress.total}`, progressHint: "Only an admin can do these" };
  }
  // artist
  return complete
    ? { ...base, headline: "Your first offers are on their way", body: "Your account is set up. A few rules decide when an offer reaches you and how long you have to answer.", primaryLabel: "How offers work here", secondaryLabel: "Dismiss", progressLabel: `Set up · ${progress.total} of ${progress.total}`, progressHint: "The rules you inherited" }
    : { ...base, headline: `${org} added you to the roster`, body: "Offers arrive by email and land on this page. Block the dates you cannot play first, so you only get asked about dates that work.", primaryLabel: "Start setup", secondaryLabel: "Later", progressLabel: `Set up · ${progress.filled} of ${progress.total}`, progressHint: "About 2 minutes" };
}

export function railHeaderCopy(role: DashboardRole, complete: boolean, ctx: OnboardingCtx) {
  if (complete) {
    return {
      eyebrow: role === "artist" ? "How offers work here" : "How this org works",
      title: "The rules you inherited",
      body: role === "producer"
        ? "You cannot change these, but every number on this page follows them."
        : "You can change them in Settings, but every number on this page follows them today.",
    };
  }
  if (role === "admin") return { eyebrow: "Set up", title: "Get the workspace running", body: "Some of these block the first offer. Nothing here stops you using the rest of the app." };
  if (role === "producer") return { eyebrow: "Org setup", title: "What is still outstanding", body: "Only an admin can do these. This is here so you know why the page is empty, not so you can fix it." };
  return { eyebrow: "Set up", title: "Before your first offer", body: "None of this blocks anything. It just makes the offers you get worth answering." };
}

export function collapsedCopy(role: DashboardRole, complete: boolean, remaining: number) {
  if (complete) return { label: role === "admin" ? "Set up · done" : "Set up · done", hint: role === "artist" ? "How offers reach you" : "Booking flow, dates, cast slots, your team", cta: "How this org works" };
  return {
    label: role === "producer" ? "Org setup in progress" : "Set up in progress",
    hint: `${remaining} step${remaining === 1 ? "" : "s"} left`,
    cta: role === "producer" ? "See what is outstanding" : "Resume",
  };
}

export const SAMPLE_PREVIEW: Record<DashboardRole, SamplePreviewData> = {
  admin: {
    stats: [
      { title: "Live dates", value: "34", label: "upcoming" },
      { title: "Waiting on a confirm", value: "6", label: "bookings" },
      { title: "Roster", value: "41", label: "artists" },
    ],
    queue: [
      { title: "6 artists accepted and are waiting on a confirm", hint: "Kammerkonzert 12 Aug, Nachtstück 14 Aug", when: "now", cta: "Confirm", tone: "accent" },
      { title: "2 offers expire at 17:00", hint: "Tier 1 · Nachtstück 14 Aug", when: "17:00", cta: "Open date", tone: "warning" },
      { title: "Airtable sync brought in 4 new dates", hint: "None of them have cast slots set", when: "09:04", cta: "Review", tone: "faint" },
    ],
    week: [
      { date: "10 Aug", ref: "Kammerkonzert · Halle B", status: "Cast complete" },
      { date: "12 Aug", ref: "Kammerkonzert · Halle B", status: "Tier 2 open · 1 of 3" },
      { date: "14 Aug", ref: "Nachtstück · Studio", status: "2 offers expire 17:00" },
    ],
  },
  producer: {
    stats: [
      { title: "Waiting on you", value: "4", label: "confirmations" },
      { title: "Expiring today", value: "2", label: "offers" },
      { title: "Unfilled tiers", value: "3", label: "dates" },
    ],
    queue: [
      { title: "4 artists accepted and are waiting on a confirm", hint: "Kammerkonzert 12 Aug, Nachtstück 14 Aug", when: "now", cta: "Confirm", tone: "accent" },
      { title: "2 offers expire at 17:00", hint: "Tier 1 · Nachtstück 14 Aug", when: "17:00", cta: "Open date", tone: "warning" },
      { title: "1 hire order awaits your countersign", hint: "Nora Lindqvist", when: "today", cta: "Sign", tone: "faint" },
    ],
    week: [
      { date: "10 Aug", ref: "Kammerkonzert · Halle B", status: "Cast complete" },
      { date: "12 Aug", ref: "Kammerkonzert · Halle B", status: "Tier 2 open · 1 of 3" },
      { date: "14 Aug", ref: "Nachtstück · Studio", status: "2 offers expire 17:00" },
    ],
  },
  artist: {
    stats: [
      { title: "Open offers", value: "2", label: "to answer" },
      { title: "Confirmed", value: "5", label: "dates" },
      { title: "Blocked", value: "3", label: "dates" },
    ],
    queue: [
      { title: "Offer for Nachtstück · Studio", hint: "Tier 1 · main cast · expires 17:00 today", when: "17:00", cta: "Answer", tone: "warning" },
      { title: "Offer for Kammerkonzert · Halle B", hint: "Tier 2 · understudy · expires Sun 09 Aug", when: "09 Aug", cta: "Answer", tone: "accent" },
      { title: "Hire order is ready to sign", hint: "Kammerkonzert 12 Aug · 480 EUR", when: "today", cta: "Sign", tone: "faint" },
    ],
    week: [
      { date: "10 Aug", ref: "Kammerkonzert · Halle B", status: "Confirmed · main" },
      { date: "12 Aug", ref: "Kammerkonzert · Halle B", status: "Confirmed · main" },
      { date: "14 Aug", ref: "Nachtstück · Studio", status: "Offer pending" },
    ],
  },
};
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/dashboard/firstRun.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/firstRun.ts src/lib/dashboard/firstRun.test.ts
git commit -m "add dashboard first-run composition and copy"
```

---

### Task 3: Module onboarding registry (`src/lib/dashboard/moduleOnboarding.ts`)

The `FeatureKey`-keyed registry + drift guards. **Depends on Task 1.** Parallel with 2, 4, 5, 6, 7, 8.

**Files:**
- Create: `src/lib/dashboard/moduleOnboarding.ts`
- Test: `src/lib/dashboard/moduleOnboarding.test.ts`

**Interfaces:**
- Consumes: `ModuleOnboardingDef`, `OnboardingStepMeta` from `@/lib/dashboard/types`; `type BookingSetupStepKey`, `STEP_TITLES`, `computeBookingSetupStatus` from `@/lib/bookings/setupStatus`; `type SetupStepKey`, `computeSetupStatus` from `@/lib/hireOrders/setupStatus`; `ROUTES` from `@/config/app.config`; `FEATURE_KEYS` from `@/lib/entitlements`.
- Produces: `MODULE_ONBOARDING: Record<FeatureKey, ModuleOnboardingDef<string>>` and the individually-typed `bookingOnboarding: ModuleOnboardingDef<BookingSetupStepKey>`, `hireOrderOnboarding: ModuleOnboardingDef<SetupStepKey>`.

- [ ] **Step 1: Write failing drift/parity tests**

```ts
// src/lib/dashboard/moduleOnboarding.test.ts
import { describe, it, expect } from "vitest";
import { MODULE_ONBOARDING, bookingOnboarding, hireOrderOnboarding } from "./moduleOnboarding";
import { FEATURE_KEYS } from "@/lib/entitlements";
import { computeBookingSetupStatus } from "@/lib/bookings/setupStatus";
import { computeSetupStatus } from "@/lib/hireOrders/setupStatus";

it("has one contribution per FeatureKey (no orphans, no gaps)", () => {
  expect(Object.keys(MODULE_ONBOARDING).sort()).toEqual([...FEATURE_KEYS].sort());
});

it("booking step keys cover exactly the engine's step keys", () => {
  const engineKeys = computeBookingSetupStatus({ flowChosen: false, shows: [], timingChosen: false, coverage: null })
    .steps.map((s) => s.key).sort();
  expect(Object.keys(bookingOnboarding.steps).sort()).toEqual(engineKeys);
});

it("hire-order step keys cover exactly the engine's step keys", () => {
  // SetupStatusInput = { letterhead, terms, countersignChosen } — an all-empty input
  // is enough to enumerate the step keys.
  const engineKeys = computeSetupStatus({ letterhead: null, terms: null, countersignChosen: false })
    .steps.map((s) => s.key).sort();
  expect(Object.keys(hireOrderOnboarding.steps).sort()).toEqual(engineKeys);
});

it("every CTA route is a real ROUTES value and no copy uses em/en dashes", () => {
  const all = [bookingOnboarding, hireOrderOnboarding].flatMap((d) => Object.values(d.steps));
  for (const s of all) {
    expect(s.ctaRoute.startsWith("/")).toBe(true);
    expect(`${s.title}${s.todoHint}${s.doneHint}${s.ctaLabel}`).not.toMatch(/[—–]/);
  }
});
```

> The `SetupStatusInput` shape is `{ letterhead: { legal_name?: string | null } | null | undefined; terms: HireOrderTermsSetting | null | undefined; countersignChosen: boolean }`. The all-empty input above is a valid instance and only needs to enumerate the step keys.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/dashboard/moduleOnboarding.test.ts`
Expected: FAIL ("MODULE_ONBOARDING is not defined").

- [ ] **Step 3: Implement the registry**

```ts
// src/lib/dashboard/moduleOnboarding.ts
import { ROUTES } from "@/config/app.config";
import type { FeatureKey } from "@/lib/entitlements";
import { STEP_TITLES, type BookingSetupStepKey } from "@/lib/bookings/setupStatus";
import type { SetupStepKey } from "@/lib/hireOrders/setupStatus";
import type { ModuleOnboardingDef } from "./types";

export const bookingOnboarding: ModuleOnboardingDef<BookingSetupStepKey> = {
  key: "booking_flow",
  steps: {
    flow: { title: STEP_TITLES.flow, todoHint: "Offers, or straight to booked. Everything downstream reads this.", doneHint: "Chosen. Change it any time in Settings.", ctaLabel: "Choose flow", ctaRoute: ROUTES.SETTINGS, ctaCapability: "edit_booking_settings" },
    slots: { title: STEP_TITLES.slots, todoHint: "A show with no slot count never reads as full.", doneHint: "Set on every show.", ctaLabel: "Set slots", ctaRoute: ROUTES.PRODUCTIONS, ctaCapability: "edit_booking_settings" },
    ladder: { title: STEP_TITLES.ladder, todoHint: "The order offers go out in, per city.", doneHint: "Every scheduled city has a tier 1 cast.", ctaLabel: "Open bookings", ctaRoute: ROUTES.BOOKINGS, ctaCapability: "edit_booking_settings" },
    eligibility: { title: STEP_TITLES.eligibility, todoHint: "Which casts can be offered which show in which city.", doneHint: "Every scheduled show and city has a cast.", ctaLabel: "Open bookings", ctaRoute: ROUTES.BOOKINGS, ctaCapability: "edit_booking_settings" },
    timing: { title: STEP_TITLES.timing, todoHint: "How long artists get, and when mail goes out.", doneHint: "Window and digest hours set.", ctaLabel: "Set timing", ctaRoute: ROUTES.SETTINGS, ctaCapability: "edit_booking_settings" },
  },
  rules: (role, ctx) => ([
    { title: ctx.artistAcceptance ? "Offers with tiers" : "Direct booking", hint: ctx.artistAcceptance ? "Tier 1 goes out first. Tier 2 opens later if unfilled." : "Producers book straight from the eligibility list." },
    { title: "Daily offer digest", hint: "Offers batch overnight rather than mailing instantly." },
    { title: "Response window", hint: "After it passes the offer expires and the tier reopens." },
    { title: role === "producer" ? "Confirm is on you" : "Confirm is manual", hint: "An accepted offer waits for a producer. That is the queue on this page." },
  ]),
  offFooter: "Booking flow is off for this org. Ask your account manager to switch it on.",
};

export const hireOrderOnboarding: ModuleOnboardingDef<SetupStepKey> = {
  key: "hire_orders",
  steps: {
    letterhead: { title: "Letterhead", todoHint: "Your name, address and logo on every hire order.", doneHint: "Set. Every order uses it.", ctaLabel: "Set letterhead", ctaRoute: ROUTES.SETTINGS, ctaCapability: "edit_hire_order_settings" },
    terms: { title: "Terms", todoHint: "The clauses printed on the engagement sheet.", doneHint: "A terms variant is chosen.", ctaLabel: "Choose terms", ctaRoute: ROUTES.SETTINGS, ctaCapability: "edit_hire_order_settings" },
    countersign: { title: "Countersignature", todoHint: "Who signs on behalf of the org.", doneHint: "Countersign policy set.", ctaLabel: "Set countersign", ctaRoute: ROUTES.SETTINGS, ctaCapability: "edit_hire_order_settings" },
  },
  rules: () => ([
    { title: "Auto-drafted on fill", hint: "When a date fills, a draft hire order is created from its confirmed bookings." },
    { title: "Issuing is manual", hint: "A producer reviews the draft and issues the PDF to the artist." },
  ]),
  offFooter: "Hire orders is off for this org. Ask your account manager to switch it on.",
};

export const MODULE_ONBOARDING: Record<FeatureKey, ModuleOnboardingDef<string>> = {
  booking_flow: bookingOnboarding,
  hire_orders: hireOrderOnboarding,
};
```

> The `STEP_TITLES` reuse binds booking titles to the engine (rename lands once). If `src/lib/hireOrders/setupStatus.ts` exports a title map, import and reuse it here too instead of the inline titles; otherwise the inline titles are fine (the drift guard covers keys, not copy).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/dashboard/moduleOnboarding.test.ts`
Expected: PASS. If the booking key list changed (engine added a step) the exhaustive `Record<BookingSetupStepKey, …>` will already have failed `tsc` — fix by adding the step meta.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc -p tsconfig.app.json --noEmit
git add src/lib/dashboard/moduleOnboarding.ts src/lib/dashboard/moduleOnboarding.test.ts
git commit -m "add module onboarding registry with drift guards"
```

---

### Task 4: Welcome panel + collapsed chip (`DashboardWelcome`, `DashboardWelcomeCollapsed`)

Presentational, pure props. **Depends on Task 1.** Parallel with 2, 3, 5, 6, 7, 8.

**Files:**
- Create: `src/components/dashboard/firstRun/DashboardWelcome.tsx`
- Create: `src/components/dashboard/firstRun/DashboardWelcomeCollapsed.tsx`
- Test: `src/components/dashboard/firstRun/DashboardWelcome.test.tsx`

**Interfaces:**
- Consumes: `DashboardWelcomeProps`, `DashboardWelcomeCollapsedProps` from `@/lib/dashboard/types`.
- Produces: default-less named exports `DashboardWelcome`, `DashboardWelcomeCollapsed`.

Visual reference: the accent hero + collapsed row in `Dashboard First Run v2.dc.html` (the `showPanel` / `showCollapsed` blocks). Hero = `bg-accent-500` with white text; progress dots = filled `bg-white/90` vs faint `bg-white/25`.

- [ ] **Step 1: Write failing test**

```tsx
// src/components/dashboard/firstRun/DashboardWelcome.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardWelcome } from "./DashboardWelcome";
import { DashboardWelcomeCollapsed } from "./DashboardWelcomeCollapsed";

const welcome = {
  eyebrow: "Welcome", headline: "You are the first admin at Halle Kollektiv",
  body: "The database is empty.", primaryLabel: "Start setup", secondaryLabel: "Later",
  progressLabel: "Set up · 1 of 4", progressFilled: 1, progressTotal: 4, progressHint: "About 15 minutes",
};

it("renders copy and fires primary/secondary", () => {
  const onPrimary = vi.fn(), onSecondary = vi.fn();
  render(<DashboardWelcome welcome={welcome} onPrimary={onPrimary} onSecondary={onSecondary} />);
  expect(screen.getByText(/first admin at Halle Kollektiv/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Later" }));
  expect(onPrimary).toHaveBeenCalledOnce();
  expect(onSecondary).toHaveBeenCalledOnce();
});

it("collapsed chip reopens the rail", () => {
  const onOpen = vi.fn();
  render(<DashboardWelcomeCollapsed label="Set up in progress" hint="2 steps left" ctaLabel="Resume" onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  expect(onOpen).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/dashboard/firstRun/DashboardWelcome.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement both components**

```tsx
// src/components/dashboard/firstRun/DashboardWelcome.tsx
import type { DashboardWelcomeProps } from "@/lib/dashboard/types";

export function DashboardWelcome({ welcome, onPrimary, onSecondary }: DashboardWelcomeProps) {
  return (
    <div className="flex items-start justify-between gap-8 rounded-xl bg-accent-500 px-6 py-6 text-white">
      <div className="max-w-xl">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">{welcome.eyebrow}</div>
        <h2 className="mt-2 font-display text-[28px] font-semibold leading-tight tracking-tight text-white text-pretty">{welcome.headline}</h2>
        <p className="mt-2 text-sm leading-[21px] text-white/80 text-pretty">{welcome.body}</p>
        <div className="mt-4 flex gap-2.5">
          <button onClick={onPrimary} className="rounded-lg bg-white px-4 py-2 text-[13px] font-semibold text-accent-700 hover:bg-white/90">{welcome.primaryLabel}</button>
          <button onClick={onSecondary} className="rounded-lg border-[0.5px] border-white/40 px-4 py-2 text-[13px] font-medium text-white hover:bg-white/10">{welcome.secondaryLabel}</button>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">{welcome.progressLabel}</div>
        <div className="mt-2 flex justify-end gap-1">
          {Array.from({ length: welcome.progressTotal }).map((_, i) => (
            <div key={i} className={`h-[3px] w-[34px] rounded-full ${i < welcome.progressFilled ? "bg-white/90" : "bg-white/25"}`} />
          ))}
        </div>
        <div className="mt-2.5 text-xs text-white/60">{welcome.progressHint}</div>
      </div>
    </div>
  );
}
```

```tsx
// src/components/dashboard/firstRun/DashboardWelcomeCollapsed.tsx
import { Check } from "lucide-react";
import type { DashboardWelcomeCollapsedProps } from "@/lib/dashboard/types";

export function DashboardWelcomeCollapsed({ label, hint, ctaLabel, onOpen }: DashboardWelcomeCollapsedProps) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border-[0.5px] border-border bg-card px-3.5 py-2.5">
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accent-100">
        <Check className="h-3 w-3 text-accent-700" strokeWidth={3} />
      </span>
      <span className="text-[13px] font-medium text-foreground">{label}</span>
      <span className="text-[13px] text-muted-foreground/70">{hint}</span>
      <span className="flex-1" />
      <button onClick={onOpen} className="rounded-lg border-[0.5px] border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">{ctaLabel}</button>
    </div>
  );
}
```

- [ ] **Step 4: Run test + lint**

Run: `npx vitest run src/components/dashboard/firstRun/DashboardWelcome.test.tsx && npm run lint`
Expected: PASS, zero warnings.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/firstRun/DashboardWelcome.tsx src/components/dashboard/firstRun/DashboardWelcomeCollapsed.tsx src/components/dashboard/firstRun/DashboardWelcome.test.tsx
git commit -m "add dashboard welcome panel and collapsed chip"
```

---

### Task 5: Setup rail (`DashboardSetupRail`)

Presentational, pure props. **Depends on Task 1.** Parallel with 2, 3, 4, 6, 7, 8.

**Files:**
- Create: `src/components/dashboard/firstRun/DashboardSetupRail.tsx`
- Test: `src/components/dashboard/firstRun/DashboardSetupRail.test.tsx`

**Interfaces:**
- Consumes: `DashboardSetupRailProps`, `ComposedStep`, `InheritedRule` from `@/lib/dashboard/types`; `useCan` from `@/hooks/useCapabilities`; `Link` from `react-router-dom`.
- Produces: named export `DashboardSetupRail`.

Notes: build a lightweight inline step row (the design's rail rows carry a CTA button, not the expander that `SetupStepRow` provides, so `SetupStepRow` is not reused here). A step shows its CTA `Link` only when `ctaCapability` is undefined or `useCan(ctaCapability)` is true. The "Blocks offers" chip appears when `block === "offers"` (amber via the repo `warning` tokens); `block === "filling"` shows a neutral "Blocks filling" chip.

- [ ] **Step 1: Write failing test**

```tsx
// src/components/dashboard/firstRun/DashboardSetupRail.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DashboardSetupRail } from "./DashboardSetupRail";
import type { ComposedStep } from "@/lib/dashboard/types";

// useCan is a thin hook; stub it per test via the capabilities provider is heavier than needed,
// so this test renders with a real MemoryRouter and relies on useCan's default (no override) —
// see renderWithProviders if capability context is required. Here we assert structure only.
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => true }));

const steps: ComposedStep[] = [
  { key: "flow", moduleKey: "booking_flow", title: "Booking flow", todoHint: "Pick a flow.", doneHint: "Chosen.", ctaLabel: "Choose flow", ctaRoute: "/settings", ctaCapability: "edit_booking_settings", done: true, block: null },
  { key: "slots", moduleKey: "booking_flow", title: "Slots per show", todoHint: "Set slots.", doneHint: "Set.", ctaLabel: "Set slots", ctaRoute: "/productions", ctaCapability: "edit_booking_settings", done: false, block: "filling" },
];

it("renders todo hint + CTA for an incomplete step", () => {
  render(<MemoryRouter><DashboardSetupRail eyebrow="Set up · 1 of 2" title="Get running" body="Body." complete={false} steps={steps} rules={[]} offFooters={["Hire orders is off."]} onClose={vi.fn()} onDismiss={vi.fn()} /></MemoryRouter>);
  expect(screen.getByText("Set slots")).toBeInTheDocument();
  expect(screen.getByText("Hire orders is off.")).toBeInTheDocument();
});

it("renders rules read-only when complete", () => {
  render(<MemoryRouter><DashboardSetupRail eyebrow="How this org works" title="Rules" body="Body." complete steps={[]} rules={[{ title: "Offers with tiers", hint: "Tier 1 first." }]} offFooters={[]} onClose={vi.fn()} onDismiss={vi.fn()} /></MemoryRouter>);
  expect(screen.getByText("Offers with tiers")).toBeInTheDocument();
  expect(screen.queryByText("Set slots")).not.toBeInTheDocument();
});
```

> The `vi.mock` of `useCapabilities` here is a **UI-hook stub for a presentational component**, not the banned `vi.mock` of the Supabase client. It is acceptable per the repo's component-test patterns; if the team prefers, render through `renderWithProviders` with a capability fixture instead.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/dashboard/firstRun/DashboardSetupRail.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the rail**

```tsx
// src/components/dashboard/firstRun/DashboardSetupRail.tsx
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { useCan } from "@/hooks/useCapabilities";
import type { ComposedStep, DashboardSetupRailProps } from "@/lib/dashboard/types";

function StepRow({ step, index }: { step: ComposedStep; index: number }) {
  // Hooks may not be conditional: always read the capability, ignore when the step has none.
  const allowed = useCan(step.ctaCapability ?? "");
  const canAct = !step.ctaCapability || allowed;
  return (
    <div className="flex items-start gap-2.5 border-b border-border px-3.5 py-3">
      {step.done ? (
        <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent-500">
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        </span>
      ) : (
        <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground/70">{index}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{step.title}</div>
        <div className="mt-0.5 text-xs leading-[17px] text-muted-foreground text-pretty">{step.done ? step.doneHint : step.todoHint}</div>
        {!step.done && canAct && (
          <Link to={step.ctaRoute} className="mt-2 inline-block rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-600">{step.ctaLabel}</Link>
        )}
      </div>
      {step.block === "offers" && (
        <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-warning">Blocks offers</span>
      )}
      {step.block === "filling" && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">Blocks filling</span>
      )}
    </div>
  );
}

export function DashboardSetupRail({ eyebrow, title, body, complete, steps, rules, offFooters, onClose, onDismiss }: DashboardSetupRailProps) {
  return (
    <div className="w-[340px] shrink-0 overflow-hidden rounded-lg border-[0.5px] border-border bg-card shadow-elev3">
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{eyebrow}</div>
          <button onClick={onClose} className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted">Close</button>
        </div>
        <div className="mt-1.5 font-display text-base font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-xs leading-[19px] text-muted-foreground text-pretty">{body}</p>
      </div>

      {complete ? (
        <div>
          {rules.map((r, i) => (
            <div key={i} className="flex items-start gap-2.5 border-b border-border px-3.5 py-3">
              <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent-500"><Check className="h-3 w-3 text-white" strokeWidth={3} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{r.title}</div>
                <div className="mt-0.5 text-xs leading-[17px] text-muted-foreground text-pretty">{r.hint}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>{steps.map((s, i) => <StepRow key={`${s.moduleKey}:${s.key}`} step={s} index={i + 1} />)}</div>
      )}

      <div className="flex items-center gap-2 px-3.5 py-3">
        <div className="flex-1 text-xs leading-[18px] text-muted-foreground/70 text-pretty">{offFooters.join(" ")}</div>
        {complete && (
          <button onClick={onDismiss} className="shrink-0 rounded-lg border-[0.5px] border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">Got it</button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test + lint**

Run: `npx vitest run src/components/dashboard/firstRun/DashboardSetupRail.test.tsx && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/firstRun/DashboardSetupRail.tsx src/components/dashboard/firstRun/DashboardSetupRail.test.tsx
git commit -m "add dashboard setup rail"
```

---

### Task 6: Sample-until-live wrapper (`SamplePreview`)

Presentational, pure props. **Depends on Task 1.** Parallel with 2, 3, 4, 5, 7, 8.

**Files:**
- Create: `src/components/dashboard/firstRun/SamplePreview.tsx`
- Test: `src/components/dashboard/firstRun/SamplePreview.test.tsx`

**Interfaces:**
- Consumes: `SamplePreviewProps` from `@/lib/dashboard/types`.
- Produces: named export `SamplePreview`.

Behavior: `complete` → render `children` (the live dashboard body) under a "Today · Live" section header. `!complete` → render the greyed sample fixture (stats row + Today queue + Next 7 days) with a `Sample` chip and the `sectionTitle`/`sectionHint`. Sample rows never link.

- [ ] **Step 1: Write failing test**

```tsx
// src/components/dashboard/firstRun/SamplePreview.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SamplePreview } from "./SamplePreview";
import { SAMPLE_PREVIEW } from "@/lib/dashboard/firstRun";

it("shows the Sample fixture when not complete", () => {
  render(<SamplePreview complete={false} sample={SAMPLE_PREVIEW.admin} sectionTitle="What this page becomes" sectionHint="Sample rows."><div>LIVE</div></SamplePreview>);
  expect(screen.getByText("Sample")).toBeInTheDocument();
  expect(screen.getByText("Live dates")).toBeInTheDocument();
  expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
});

it("renders live children when complete", () => {
  render(<SamplePreview complete sample={SAMPLE_PREVIEW.admin} sectionTitle="Today" sectionHint="Live."><div>LIVE</div></SamplePreview>);
  expect(screen.getByText("LIVE")).toBeInTheDocument();
  expect(screen.queryByText("Sample")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/dashboard/firstRun/SamplePreview.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `SamplePreview`**

```tsx
// src/components/dashboard/firstRun/SamplePreview.tsx
import type { SamplePreviewProps, SampleQueueRow } from "@/lib/dashboard/types";

const DOT: Record<SampleQueueRow["tone"], string> = {
  accent: "bg-accent-500", warning: "bg-warning", faint: "bg-muted-foreground/40",
};

export function SamplePreview({ complete, sample, sectionTitle, sectionHint, children }: SamplePreviewProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="font-display text-[17px] font-semibold tracking-tight text-foreground">{sectionTitle}</div>
        {!complete && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">Sample</span>}
        <span className="flex-1" />
        <div className="text-xs text-muted-foreground/70">{sectionHint}</div>
      </div>

      {complete ? (
        children
      ) : (
        <div className="flex flex-col gap-4 opacity-[.55]" aria-hidden>
          <div className="flex gap-3">
            {sample.stats.map((s) => (
              <div key={s.title} className="flex-1 rounded-lg border-[0.5px] border-border bg-card p-3.5">
                <div className="text-xs font-medium text-muted-foreground">{s.title}</div>
                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <div className="font-mono text-[28px] font-semibold tracking-tight text-foreground">{s.value}</div>
                  <div className="text-xs text-muted-foreground/70">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border-[0.5px] border-border bg-card">
            <div className="border-b border-border px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Today</div>
            {sample.queue.map((q) => (
              <div key={q.title} className="flex items-center gap-3 border-b border-border px-4 py-3">
                <div className={`h-1.5 w-1.5 rounded-sm ${DOT[q.tone]}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{q.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{q.hint}</div>
                </div>
                <div className="font-mono text-xs text-muted-foreground">{q.when}</div>
                <span className="rounded-lg border-[0.5px] border-border px-3 py-1.5 text-xs font-medium text-foreground">{q.cta}</span>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border-[0.5px] border-border bg-card">
            <div className="border-b border-border px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Next 7 days</div>
            {sample.week.map((w) => (
              <div key={w.date} className="grid grid-cols-[112px_1fr_190px] items-center gap-3 border-b border-border px-4 py-2.5">
                <div className="font-mono text-xs text-foreground">{w.date}</div>
                <div className="text-[13px] text-foreground">{w.ref}</div>
                <div className="text-right text-xs text-muted-foreground">{w.status}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test + lint**

Run: `npx vitest run src/components/dashboard/firstRun/SamplePreview.test.tsx && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/firstRun/SamplePreview.tsx src/components/dashboard/firstRun/SamplePreview.test.tsx
git commit -m "add dashboard sample-until-live preview"
```

---

### Task 7: Runtime entitlement propagation (`realtimeInvalidations.ts`)

Independent — depends on nothing. Run in any wave.

**Files:**
- Modify: `src/features/auth/realtimeInvalidations.ts`
- Test: `src/features/auth/realtimeInvalidations.test.ts` (add a case; create the file only if it does not exist)

- [ ] **Step 1: Verify whether `org_entitlements` is in the Realtime publication**

Using the Supabase MCP (`mcp__6fbecca6-...__execute_sql`), run:

```sql
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'org_entitlements';
```

- If it returns a row → no migration needed; skip Step 4.
- If empty → a migration is needed (Step 4).

- [ ] **Step 2: Write the failing test**

Add to `src/features/auth/realtimeInvalidations.test.ts` (mirror the existing assertion style if the file exists; otherwise create it):

```ts
import { describe, it, expect } from "vitest";
import { REALTIME_INVALIDATIONS } from "./realtimeInvalidations";

it("invalidates the entitlements query when org_entitlements changes", () => {
  const row = REALTIME_INVALIDATIONS.find((r) => r.table === "org_entitlements");
  expect(row).toBeDefined();
  expect(row!.keys).toContainEqual(["entitlements"]);
});
```

- [ ] **Step 3: Add the mapping**

In `src/features/auth/realtimeInvalidations.ts`, add to the array:

```ts
  { table: 'org_entitlements',            keys: [['entitlements']] },
```

Run: `npx vitest run src/features/auth/realtimeInvalidations.test.ts`
Expected: PASS.

- [ ] **Step 4 (only if Step 1 was empty): Add the table to the publication**

Create a migration via the migration tooling (do **not** hand-edit `supabase/migrations/`). SQL body:

```sql
alter publication supabase_realtime add table public.org_entitlements;
```

Follow the repo migration rules in `CLAUDE.md` (the merge applies it; do not hand-apply). Name the file with the tool's recorded version.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/realtimeInvalidations.ts src/features/auth/realtimeInvalidations.test.ts
# plus the migration file if created
git commit -m "invalidate entitlements query on org_entitlements realtime change"
```

---

### Task 8: Artist personal readiness (`useArtistOnboardingStatus`)

Query-free artist status adapted to `ModuleStatusLite`. **Depends on Task 1.** Parallel with 2, 3, 4, 5, 6, 7.

**Files:**
- Create: `src/components/dashboard/firstRun/useArtistOnboardingStatus.ts`
- Test: `src/components/dashboard/firstRun/useArtistOnboardingStatus.test.ts`

**Interfaces:**
- Consumes: `ModuleStatusLite` from `@/lib/dashboard/types`; `useMyArtist` (`@/hooks/useMyArtist`), `useMyProfile` (`@/hooks/useMyProfile`), `useRailDismissed` (`@/components/setup/useRailDismissed`), `useAuth` (`@/features/auth/AuthContext`).
- Produces: `useArtistOnboardingStatus(): { status: ModuleStatusLite; ackBlock: () => void; ackNotify: () => void }`.

Readiness (no new query): `accountLinked` = artist row present; `blockDates` = ack via `useRailDismissed("artistBlockAck", orgId)`; `notifications` = `profile.phone` present OR ack via `useRailDismissed("artistNotifyAck", orgId)`. `complete` = all three done. Steps keyed `"accountLinked" | "blockDates" | "notifications"` (these are the artist's booking_flow slice keys — the booking registry does not use them, so the artist path composes its status directly rather than through `MODULE_ONBOARDING`; see Task 9).

- [ ] **Step 1: Write the failing test**

```ts
// src/components/dashboard/firstRun/useArtistOnboardingStatus.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders"; // for the wrapper only if needed

// Stub the three read hooks so the pure readiness mapping is what we assert.
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: () => ({ data: { id: "a1", name: "Nora" } }) }));
vi.mock("@/hooks/useMyProfile", () => ({ useMyProfile: () => ({ data: { phone: null } }) }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "o1" } }) }));
vi.mock("@/components/setup/useRailDismissed", () => ({ useRailDismissed: () => [false, vi.fn(), vi.fn()] }));

import { useArtistOnboardingStatus } from "./useArtistOnboardingStatus";

it("account linked but block/notify not acked and no phone => incomplete", () => {
  const { result } = renderHook(() => useArtistOnboardingStatus());
  const s = result.current.status;
  expect(s.steps.find((x) => x.key === "accountLinked")!.done).toBe(true);
  expect(s.steps.find((x) => x.key === "notifications")!.done).toBe(false);
  expect(s.complete).toBe(false);
});
```

> These `vi.mock`s stub UI/read hooks (not the Supabase client) so the pure mapping is under test. A second test flipping the phone to a value and the acks to `true` should assert `complete === true` — write it the same way with different mock return values (use `vi.doMock`/`vi.resetModules` or separate test files if per-test mock values are needed).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/dashboard/firstRun/useArtistOnboardingStatus.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hook**

```ts
// src/components/dashboard/firstRun/useArtistOnboardingStatus.ts
import { useMyArtist } from "@/hooks/useMyArtist";
import { useMyProfile } from "@/hooks/useMyProfile";
import { useAuth } from "@/features/auth/AuthContext";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import type { ModuleStatusLite } from "@/lib/dashboard/types";

export function useArtistOnboardingStatus(): { status: ModuleStatusLite; ackBlock: () => void; ackNotify: () => void } {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const { data: artist } = useMyArtist();
  const { data: profile } = useMyProfile();
  const [blockAcked, ackBlock] = useRailDismissed("artistBlockAck", orgId);
  const [notifyAcked, ackNotify] = useRailDismissed("artistNotifyAck", orgId);

  const accountLinked = !!artist;
  const blockDates = blockAcked;
  const notifications = !!profile?.phone || notifyAcked;

  const steps = [
    { key: "accountLinked", done: accountLinked, block: null as const },
    { key: "blockDates", done: blockDates, block: null as const },
    { key: "notifications", done: notifications, block: null as const },
  ];
  return { status: { steps, complete: steps.every((s) => s.done) }, ackBlock, ackNotify };
}
```

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run src/components/dashboard/firstRun/useArtistOnboardingStatus.test.ts && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/firstRun/useArtistOnboardingStatus.ts src/components/dashboard/firstRun/useArtistOnboardingStatus.test.ts
git commit -m "add artist onboarding readiness status"
```

---

### Task 9: Integration hook (`useDashboardFirstRun`)

Composes entitlements + module status hooks into `DashboardFirstRunState`. **Depends on Tasks 2, 3, 8** (and Task 1). Wave B.

**Files:**
- Create: `src/components/dashboard/firstRun/useDashboardFirstRun.ts`
- Test: `src/components/dashboard/firstRun/useDashboardFirstRun.test.tsx`

**Interfaces:**
- Consumes: `useEntitlements` (`@/hooks/useEntitlements`), `useBookingSetupStatus` (`@/hooks/useBookingSetup`), `useHireOrderSetupStatus` (`@/hooks/useHireOrderSetup`), `useArtistOnboardingStatus` (Task 8), `useNavCounts` (`@/hooks/useNavCounts`), `useBookingFlow` (`@/hooks/useBookingFlow`), `useAuth`, `useRailDismissed`; `composeOnboarding`, `welcomeCopy`, `railHeaderCopy`, `collapsedCopy`, `SAMPLE_PREVIEW` (Task 2); `MODULE_ONBOARDING` (Task 3); `BOOKING_FLOW_DEFAULTS` (`@/lib/bookingFlow`).
- Produces: `useDashboardFirstRun(role: DashboardRole): DashboardFirstRunState`.

Key rules (from spec B.1 / C):
- Call **all** status hooks unconditionally. For `role === "artist"`, the `booking_flow` slice's status is `useArtistOnboardingStatus().status`; for admin/producer it is the normalized `useBookingSetupStatus`.
- `show === false` while `entitlements.isLoading` (no-flicker) or when the composed step list is empty (no licensable onboarding).
- `railOpen` is local `useState(false)`; `openRail`/`closeRail` set it. `dismiss`/`undismiss` come from `useRailDismissed("dashboardWelcome", orgId)` (also close the rail on dismiss).
- Progress = `{ filled: steps.filter(done).length, total: steps.length }`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/dashboard/firstRun/useDashboardFirstRun.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ features: new Set(["booking_flow"]), isLoading: false }) }));
vi.mock("@/hooks/useBookingSetup", () => ({ useBookingSetupStatus: () => ({ status: { steps: [{ key: "flow", done: false, block: null }, { key: "slots", done: false, block: "filling" }, { key: "ladder", done: false, block: "offers" }, { key: "eligibility", done: false, block: null }, { key: "timing", done: false, block: null }], complete: false }, coverage: null, isLoading: false }) }));
vi.mock("@/hooks/useHireOrderSetup", () => ({ useHireOrderSetupStatus: () => ({ status: { steps: [], complete: true }, isLoading: false }) }));
vi.mock("@/hooks/useNavCounts", () => ({ useNavCounts: () => ({ pendingConfirmations: 4, openOffers: 2, awaitingCountersign: 1 }) }));
vi.mock("@/hooks/useBookingFlow", () => ({ useBookingFlow: () => ({ data: { artist_acceptance: true } }) }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "o1", name: "Halle Kollektiv" } }) }));
vi.mock("@/components/setup/useRailDismissed", () => ({ useRailDismissed: () => [false, vi.fn(), vi.fn()] }));
vi.mock("./useArtistOnboardingStatus", () => ({ useArtistOnboardingStatus: () => ({ status: { steps: [], complete: true }, ackBlock: vi.fn(), ackNotify: vi.fn() }) }));

import { useDashboardFirstRun } from "./useDashboardFirstRun";

it("composes an incomplete admin first-run with only the enabled module", () => {
  const { result } = renderHook(() => useDashboardFirstRun("admin"));
  const s = result.current;
  expect(s.show).toBe(true);
  expect(s.complete).toBe(false);
  expect(s.steps.map((x) => x.key)).toEqual(["flow", "slots", "ladder", "eligibility", "timing"]); // hire_orders not enabled
  expect(s.welcome.headline).toContain("Halle Kollektiv");
  expect(s.offFooters).toContain("Hire orders is off for this org. Ask your account manager to switch it on.");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/dashboard/firstRun/useDashboardFirstRun.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the hook**

```ts
// src/components/dashboard/firstRun/useDashboardFirstRun.ts
import { useState } from "react";
import { useAuth } from "@/features/auth/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useNavCounts } from "@/hooks/useNavCounts";
import { useBookingFlow } from "@/hooks/useBookingFlow";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import { composeOnboarding, welcomeCopy, railHeaderCopy, collapsedCopy, SAMPLE_PREVIEW } from "@/lib/dashboard/firstRun";
import { MODULE_ONBOARDING } from "@/lib/dashboard/moduleOnboarding";
import type { DashboardFirstRunState, DashboardRole, ModuleStatuses } from "@/lib/dashboard/types";
import { useArtistOnboardingStatus } from "./useArtistOnboardingStatus";

const HIDDEN_BASE = {
  steps: [], rules: [], offFooters: [], railOpen: false,
};

export function useDashboardFirstRun(role: DashboardRole): DashboardFirstRunState {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const orgName = currentOrg?.name ?? "your workspace";

  const { features, isLoading } = useEntitlements();
  const booking = useBookingSetupStatus(orgId);       // admin/producer slice
  const artist = useArtistOnboardingStatus();          // artist slice
  const hire = useHireOrderSetupStatus(orgId);
  const counts = useNavCounts();
  const flow = useBookingFlow().data ?? BOOKING_FLOW_DEFAULTS;

  const [railOpen, setRailOpen] = useState(false);
  const [dismissed, dismiss, undismiss] = useRailDismissed("dashboardWelcome", orgId);

  const ctx = { orgName, artistAcceptance: flow.artist_acceptance, counts };

  const moduleStatuses: ModuleStatuses = {
    booking_flow: role === "artist" ? artist.status : booking.status,
    hire_orders: hire.status,
  };

  const composed = composeOnboarding({ enabled: features, role, moduleStatuses, ctx }, MODULE_ONBOARDING);
  const filled = composed.steps.filter((s) => s.done).length;
  const total = composed.steps.length;
  const remaining = total - filled;

  const welcome = welcomeCopy(role, composed.complete, ctx, { filled, total });
  const railHead = railHeaderCopy(role, composed.complete, ctx);
  const collapsed = collapsedCopy(role, composed.complete, remaining);

  const show = !isLoading && total > 0;

  return {
    show,
    complete: composed.complete,
    dismissed,
    steps: composed.steps,
    rules: composed.rules,
    offFooters: composed.offFooters,
    welcome,
    sample: SAMPLE_PREVIEW[role],
    sectionTitle: composed.complete ? "Today" : "What this page becomes",
    sectionHint: composed.complete ? "Live. Everything below is yours to act on." : "Sample rows. Yours replace them once the org has dates.",
    railEyebrow: railHead.eyebrow, railTitle: railHead.title, railBody: railHead.body,
    collapsedLabel: collapsed.label, collapsedHint: collapsed.hint, collapsedCta: collapsed.cta,
    railOpen,
    openRail: () => setRailOpen(true),
    closeRail: () => setRailOpen(false),
    dismiss: () => { setRailOpen(false); dismiss(); },
    undismiss,
  };
}
```

> `HIDDEN_BASE` is unused above; remove it (kept only to flag that `show:false` callers should still receive a valid state object — the returned object already is valid when `show` is false). Confirm `useBookingSetupStatus` returns `{ status, coverage, isLoading }` and `useHireOrderSetupStatus` returns `{ status, isLoading }` with `status.steps` shaped `{ key, done, block? }`; the booking `status.steps` uses `block: BlockKind` and hire-order uses `blocksIssue: boolean`. **Adapter needed:** map the hire-order steps to `{ key, done, block: null }` (their block semantics differ; the dashboard rail only needs offers/filling from booking). Do this mapping inside the hook when building `moduleStatuses.hire_orders`.

- [ ] **Step 4: Run test + type-check + lint**

Run: `npx vitest run src/components/dashboard/firstRun/useDashboardFirstRun.test.tsx && npx tsc -p tsconfig.app.json --noEmit && npm run lint`
Expected: PASS. Remove the unused `HIDDEN_BASE`.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/firstRun/useDashboardFirstRun.ts src/components/dashboard/firstRun/useDashboardFirstRun.test.tsx
git commit -m "add dashboard first-run integration hook"
```

---

### Task 10: Wire the producer/admin dashboard (`DashboardPage.tsx`)

**Depends on Tasks 4, 5, 6, 9.** Parallel with Task 11 (different file).

**Files:**
- Modify: `src/pages/DashboardPage.tsx` (the `ProducerDashboard` component's returned JSX)
- Test: `src/pages/DashboardPage.firstRun.test.tsx` (new)

**Interfaces:**
- Consumes: `useDashboardFirstRun`, `DashboardWelcome`, `DashboardWelcomeCollapsed`, `DashboardSetupRail`, `SamplePreview`, `useAuth` (for role).

- [ ] **Step 1: Write the failing test**

```tsx
// src/pages/DashboardPage.firstRun.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

// Reuse the auth/data harness the existing DashboardPage.test.tsx already sets up:
// copy its vi.mock block for "@/integrations/supabase/client" (the supabaseFake),
// "@/hooks/useBookingFlow" (useBookingFlow + useReferenceField), "@/hooks/useCapabilities"
// (useCan), and the null stubs for TierAttentionCard / DirectBookingCard. Add the two below.
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/components/dashboard/firstRun/useDashboardFirstRun", () => ({
  useDashboardFirstRun: () => ({
    show: true, complete: false, dismissed: false,
    steps: [], rules: [], offFooters: [], sample: { stats: [], queue: [], week: [] },
    welcome: { eyebrow: "Welcome", headline: "You are the first admin at Halle Kollektiv", body: "b", primaryLabel: "Start setup", secondaryLabel: "Later", progressLabel: "Set up · 0 of 4", progressFilled: 0, progressTotal: 4, progressHint: "About 15 minutes" },
    sectionTitle: "What this page becomes", sectionHint: "Sample rows.",
    railEyebrow: "Set up", railTitle: "Get running", railBody: "b",
    collapsedLabel: "Set up in progress", collapsedHint: "4 steps left", collapsedCta: "Resume",
    railOpen: false, openRail: vi.fn(), closeRail: vi.fn(), dismiss: vi.fn(), undismiss: vi.fn(),
  }),
}));

import { useAuth } from "@/features/auth/AuthContext";
import DashboardPage from "./DashboardPage";

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({
    hasRole: (r: string) => r === "admin",
    currentOrg: { id: "o1", name: "Halle Kollektiv" },
  } as never);
});

it("renders the welcome panel above the producer dashboard", async () => {
  renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
  expect(await screen.findByText(/first admin at Halle Kollektiv/)).toBeInTheDocument();
});
```

> `renderWithProviders` supplies only `QueryClientProvider` + `TooltipProvider` (no auth/router) — so `useAuth` is mocked with `vi.mocked(...).mockReturnValue(...)` and the tree is wrapped in `<MemoryRouter>` for the `Link`s, exactly as the existing `DashboardPage.test.tsx` does. Copy that file's supabase/hook mock block wholesale so the `ProducerDashboard` data reads resolve; this test only *adds* the first-run-hook mock and asserts the welcome text.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pages/DashboardPage.firstRun.test.tsx`
Expected: FAIL (welcome text not found — not yet wired).

- [ ] **Step 3: Wire `ProducerDashboard`**

In `src/pages/DashboardPage.tsx`: import the four components + the hook + `useAuth`. Derive `role` (`hasRole('admin') ? 'admin' : 'producer'`). At the top of the returned tree (inside the outer `<div className="space-y-6">`, before the existing heading/body), add:

```tsx
const fr = useDashboardFirstRun(role);
// ...
return (
  <div className="space-y-6">
    {fr.show && (fr.dismissed
      ? <DashboardWelcomeCollapsed label={fr.collapsedLabel} hint={fr.collapsedHint} ctaLabel={fr.collapsedCta} onOpen={fr.openRail} />
      : <DashboardWelcome welcome={fr.welcome} onPrimary={fr.openRail} onSecondary={fr.dismiss} />)}

    <div className="flex items-start gap-6">
      <div className="min-w-0 flex-1 space-y-6">
        {/* existing heading + ProducerBookingSection + cards, now wrapped: */}
        <SamplePreview complete={!fr.show || fr.complete} sample={fr.sample} sectionTitle={fr.sectionTitle} sectionHint={fr.sectionHint}>
          {/* the existing dashboard body JSX moves here unchanged */}
        </SamplePreview>
      </div>
      {fr.show && fr.railOpen && (
        <DashboardSetupRail eyebrow={fr.railEyebrow} title={fr.railTitle} body={fr.railBody} complete={fr.complete}
          steps={fr.steps} rules={fr.rules} offFooters={fr.offFooters} onClose={fr.closeRail} onDismiss={fr.dismiss} />
      )}
    </div>
  </div>
);
```

`complete={!fr.show || fr.complete}` ensures that when the first-run layer is hidden (e.g. no modules, or still loading) the body renders **live**, never greyed.

- [ ] **Step 4: Run the new test + existing dashboard tests + type-check + lint**

Run: `npx vitest run src/pages/DashboardPage.firstRun.test.tsx src/pages/DashboardPage.test.tsx src/pages/DashboardPage.moduleGate.test.tsx && npx tsc -p tsconfig.app.json --noEmit && npm run lint`
Expected: PASS (existing tests still green — the wrap must not disturb gated sections).

- [ ] **Step 5: Commit**

```bash
git add src/pages/DashboardPage.tsx src/pages/DashboardPage.firstRun.test.tsx
git commit -m "wire first-run welcome, rail and sample into producer dashboard"
```

---

### Task 11: Wire the artist dashboard (`ArtistDashboard.tsx`)

**Depends on Tasks 4, 5, 6, 9.** Parallel with Task 10 (different file).

**Files:**
- Modify: `src/components/dashboard/ArtistDashboard.tsx`
- Test: `src/components/dashboard/ArtistDashboard.firstRun.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/dashboard/ArtistDashboard.firstRun.test.tsx
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

// Reuse the harness from the existing ArtistDashboard.hireOrders.test.tsx /
// ArtistDashboard.flowCopy.test.tsx: copy their vi.mock block for the supabase client
// (supabaseFake), "@/features/auth/AuthContext" (useAuth), "@/hooks/useMyArtist",
// "@/hooks/useBookingFlow", "@/hooks/useEntitlements" (useFeature), "@/hooks/useHireOrders".
// Add the first-run-hook mock below and wrap in <MemoryRouter>.
vi.mock("@/components/dashboard/firstRun/useDashboardFirstRun", () => ({
  useDashboardFirstRun: () => ({
    show: true, complete: false, dismissed: false, steps: [], rules: [], offFooters: [],
    sample: { stats: [], queue: [], week: [] },
    welcome: { eyebrow: "Welcome", headline: "Halle Kollektiv added you to the roster", body: "b", primaryLabel: "Start setup", secondaryLabel: "Later", progressLabel: "Set up · 0 of 3", progressFilled: 0, progressTotal: 3, progressHint: "About 2 minutes" },
    sectionTitle: "What this page becomes", sectionHint: "Sample rows.",
    railEyebrow: "Set up", railTitle: "Before your first offer", railBody: "b",
    collapsedLabel: "Set up in progress", collapsedHint: "2 steps left", collapsedCta: "Resume",
    railOpen: false, openRail: vi.fn(), closeRail: vi.fn(), dismiss: vi.fn(), undismiss: vi.fn(),
  }),
}));

import { ArtistDashboard } from "./ArtistDashboard";

it("renders the artist welcome panel", async () => {
  renderWithProviders(<MemoryRouter><ArtistDashboard /></MemoryRouter>);
  expect(await screen.findByText(/added you to the roster/)).toBeInTheDocument();
});
```

> As in Task 10, mock `useAuth` (with a `currentOrg` carrying `name`) and the data hooks by copying the existing ArtistDashboard test harness; `renderWithProviders` provides no auth/router, so wrap in `<MemoryRouter>`. `useMyArtist` must return an artist so the `if (!artist)` early guard does not short-circuit before the first-run layer.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/dashboard/ArtistDashboard.firstRun.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Wire `ArtistDashboard`**

Same shape as Task 10, `role="artist"`. Wrap the existing body (the offer meter cards + hire orders + My Casts) in `SamplePreview` with `complete={!fr.show || fr.complete}`, and add the welcome/collapsed at the top and the rail beside the body when `fr.railOpen`. Keep the existing `if (!artist) return …` early guard **above** the first-run layer (a user with no artist profile has nothing to onboard).

- [ ] **Step 4: Run the new test + existing artist tests + type-check + lint**

Run: `npx vitest run src/components/dashboard/ArtistDashboard.firstRun.test.tsx src/components/dashboard/ArtistDashboard.hireOrders.test.tsx src/components/dashboard/ArtistDashboard.flowCopy.test.tsx && npx tsc -p tsconfig.app.json --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/ArtistDashboard.tsx src/components/dashboard/ArtistDashboard.firstRun.test.tsx
git commit -m "wire first-run welcome, rail and sample into artist dashboard"
```

---

### Task 12: Full verification, changelog, browser smoke

**Depends on all prior tasks.** Wave D.

**Files:**
- Modify: `public/changelog.md`, `public/changelog.json` (regenerated), `package.json`, `src/config/app.config.ts`

- [ ] **Step 1: Run the whole suite + all three type-check projects + lint + mirror check**

```bash
npx vitest run
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.tools.json --noEmit
npm run lint
npm run sync:mirrors:check
```

Expected: all PASS. (Entitlements/capabilities registries were not edited, so `sync:mirrors:check` should be clean; run it to be sure.)

- [ ] **Step 2: Browser smoke (real dashboard)**

Start the dev server via the preview tool (`preview_start { name: "<dev>" }` from `.claude/launch.json`, or add one), sign in with a dev account, and verify on `/dashboard`:
- welcome hero renders; "Start setup" opens the rail; a step CTA deep-links (e.g. to Productions); "Later" collapses to the chip; the chip reopens the rail.
- the body under the panel is greyed with a `Sample` chip while setup is incomplete.
- toggle `hire_orders` for the org (platform console or `org_entitlements`) and confirm the dashboard recomposes live (nav Hire orders unlocks; offFooter changes) without reload.
- check dark theme via `resize_window { colorScheme: "dark" }`: hero stays legible (white on `accent-500`).

Capture a screenshot for the user.

- [ ] **Step 3: Changelog + version bump**

Read the current `version` in `package.json` and `APP_META.VERSION` in `src/config/app.config.ts`. Bump the **MINOR** (new user-facing feature) and set both to the same value. Add a newest-first block to `public/changelog.md`:

```markdown
## <new version> — Aug 7, 2026

*A guided first run on your dashboard*

### New
- **Dashboard first run** — A welcome panel greets you on the dashboard and opens a setup checklist on demand. It shows exactly the steps your workspace needs, adapts to the modules your organization has enabled, and collapses to a single line you can reopen any time.
- **The rules you inherited** — Once setup is done, the same panel becomes a read-only summary of how your organization works, so a new teammate can see the decisions behind every number on the page.
```

Regenerate the JSON (never hand-edit it):

```bash
deno run --allow-read --allow-write scripts/changelog-to-json.ts
```

- [ ] **Step 4: Commit**

```bash
git add public/changelog.md public/changelog.json package.json src/config/app.config.ts
git commit -m "release: dashboard first run"
```

---

## Self-review

**Spec coverage:**
- Welcome panel / rail / collapsed / sample-live → Tasks 4, 5, 6 + wiring 10, 11. ✅
- Module-onboarding registry + composition → Tasks 2, 3. ✅
- Single setup-complete switch (panel + preview) → Task 9 (`complete` drives both). ✅
- Anti-drift (compiler coverage + parity test + shared titles/ROUTES) → Tasks 1, 3. ✅
- Runtime on/off (`org_entitlements` realtime + no-flicker) → Tasks 7, 9. ✅
- Producer read-only CTA gating → Task 5 (`useCan(ctaCapability)`). ✅
- Artist query-free readiness → Task 8. ✅
- Token mapping → applied in Tasks 4, 5, 6 (`bg-accent-500`, `warning`, semantic tokens). ✅
- Testing across pure/component/hook/wiring → every task is TDD; Task 12 runs the full gate. ✅

**Placeholder scan:** No "TBD"/"implement later". Signatures verified against the codebase: `renderWithProviders` provides no auth/router (Tasks 10/11 mock `useAuth` + wrap in `MemoryRouter`, matching the existing dashboard tests); hire-order `SetupStatusInput` is `{ letterhead, terms, countersignChosen }` (Task 3 fixed); `useBookingSetupStatus` → `{ status, coverage, isLoading }`, `useHireOrderSetupStatus` → `{ status, isLoading }`; `Organization` carries `name`. The one intentional runtime step is Task 7's publication check (query first, migrate only if absent).

**Type consistency:** `ModuleStatusLite`/`ComposedStep`/`DashboardFirstRunState` defined in Task 1 are used verbatim in Tasks 2, 5, 9. `composeOnboarding(input, registry)` signature matches between Task 2 (definition) and Task 9 (call). `useArtistOnboardingStatus` return shape matches its Task 8 definition and Task 9 usage. Hire-order status → `{key,done,block:null}` adapter is called out in Task 9's note.

## Execution handoff

Offered after the plan is saved (see chat).
