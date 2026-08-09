# Multi-surface Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the dashboard's guided setup rail on `/bookings` and `/hire-orders` (module-scoped, same look, shared completion state), and make every step's button open the inline setup Sheet at that step — on the module pages and the dashboard — instead of routing away.

**Architecture:** Reuse, don't fork. `DashboardSetupRail` gains a `layout` variant, an `onStepAction` callback (replaces the route-out `Link`), and optional progress props. The pure `composeOnboarding` is driven with a single-module `enabled` set to produce a module-scoped rail. A new `useModuleOnboardingRail(feature)` hook wires the existing status + visibility hooks into what a module page needs, and a shared `SetupChecklistSheet` hosts the existing inline rails opened at a chosen step.

**Tech Stack:** React 18 + TypeScript, react-router-dom v6, @tanstack/react-query v5, Tailwind + shadcn/ui, Vitest + @testing-library/react (jsdom), `src/test/renderWithProviders` + `src/test/supabaseFake`.

## Global Constraints

- Lint gate is zero-warning: `npm run lint` runs eslint `--max-warnings 0`. No `any` — use explicit row interfaces + a single `as unknown as` cast at a query boundary, or the typed test helpers.
- Type-check with `npx tsc -p tsconfig.app.json --noEmit` (src/ project).
- Semantic tokens only (`bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`); the `accent-50`–`900` scale is plain hex and does NOT support `/opacity` modifiers. `bg-accent-500` for filled progress/checks, `bg-muted` for empty.
- No em/en dashes in any user-facing copy — use period, comma, colon, or middot.
- Tests import the real module under test; never re-implement production logic in a test. Never `vi.mock('@/integrations/supabase/client')` with a hand-rolled chain — use `createFakeSupabase` from `src/test/supabaseFake`.
- Co-locate each test beside the file it tests. Test-first (write the failing test before the implementation).
- Commit after each task with an imperative, lowercase, ≤72-char subject.

---

### Task 1: `DashboardSetupRail` — layout variant, step-action callback, progress cluster

**Files:**
- Modify: `src/lib/dashboard/types.ts` (extend `DashboardSetupRailProps`)
- Modify: `src/components/dashboard/firstRun/DashboardSetupRail.tsx`
- Test: `src/components/dashboard/firstRun/DashboardSetupRail.test.tsx` (extend)

**Interfaces:**
- Consumes: `ComposedStep`, `SetupBlock`, `InheritedRule` (existing, `src/lib/dashboard/types.ts`).
- Produces: `DashboardSetupRail` now accepts `layout?: "rail" | "banner"` (default `"rail"`), `onStepAction?: (step: ComposedStep) => void`, and `progressLabel?: string; progressFilled?: number; progressTotal?: number; progressHint?: string`. When `onStepAction` is set, a not-done step renders a `<button>` calling it; otherwise the current `<Link to={step.ctaRoute}>` is kept. Progress cluster renders only in `banner` layout when `progressTotal` is truthy.

- [ ] **Step 1: Write the failing tests** (append to `DashboardSetupRail.test.tsx`)

```tsx
it("calls onStepAction instead of navigating when provided", async () => {
  const onStepAction = vi.fn();
  const user = userEvent.setup();
  render(<MemoryRouter><DashboardSetupRail eyebrow="Set up · 1 of 2" title="Get running" body="Body." complete={false} steps={steps} rules={[]} offFooters={[]} onClose={vi.fn()} onDismiss={vi.fn()} onStepAction={onStepAction} /></MemoryRouter>);
  const btn = screen.getByRole("button", { name: "Set slots" });
  await user.click(btn);
  expect(onStepAction).toHaveBeenCalledWith(expect.objectContaining({ key: "slots" }));
});

it("renders a Link (not a button) for a step when onStepAction is absent", () => {
  render(<MemoryRouter><DashboardSetupRail eyebrow="Set up" title="Get running" body="Body." complete={false} steps={steps} rules={[]} offFooters={[]} onClose={vi.fn()} onDismiss={vi.fn()} /></MemoryRouter>);
  const cta = screen.getByText("Set slots");
  expect(cta.closest("a")).toHaveAttribute("href", "/productions");
});

it("renders the banner progress cluster in banner layout", () => {
  render(<MemoryRouter><DashboardSetupRail layout="banner" eyebrow="Set up" title="Get bookings running" body="Body." complete={false} steps={steps} rules={[]} offFooters={[]} onClose={vi.fn()} onDismiss={vi.fn()} progressLabel="Set up · 1 of 5" progressFilled={1} progressTotal={5} /></MemoryRouter>);
  expect(screen.getByText("Set up · 1 of 5")).toBeInTheDocument();
});
```

Add the import at the top of the test file (below the existing imports):

```tsx
import userEvent from "@testing-library/user-event";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/dashboard/firstRun/DashboardSetupRail.test.tsx`
Expected: FAIL — `onStepAction` prop not accepted / no button role / progress label absent.

- [ ] **Step 3: Extend the props type**

In `src/lib/dashboard/types.ts`, replace the `DashboardSetupRailProps` interface with:

```ts
export interface DashboardSetupRailProps {
  eyebrow: string; title: string; body: string; complete: boolean;
  steps: ComposedStep[]; rules: InheritedRule[]; offFooters: string[];
  onClose: () => void; onDismiss: () => void;
  /** "rail" (default) = dashboard side column; "banner" = full-width module header. */
  layout?: "rail" | "banner";
  /** When set, a not-done step renders a button that calls this instead of a Link. */
  onStepAction?: (step: ComposedStep) => void;
  /** Banner layout only: the top-right segmented progress rail. */
  progressLabel?: string;
  progressFilled?: number;
  progressTotal?: number;
  progressHint?: string;
}
```

- [ ] **Step 4: Implement the component changes**

Replace the whole body of `src/components/dashboard/firstRun/DashboardSetupRail.tsx` with:

```tsx
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { useCan } from "@/hooks/useCapabilities";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ComposedStep, DashboardSetupRailProps, SetupBlock } from "@/lib/dashboard/types";

const BLOCK_CHIP: Record<Exclude<SetupBlock, null>, { tone: "risk" | "neutral"; label: string }> = {
  offers: { tone: "risk", label: "Blocks offers" },
  filling: { tone: "neutral", label: "Blocks filling" },
  issuing: { tone: "risk", label: "Blocks issuing" },
};

function StepRow({ step, index, onAction }: { step: ComposedStep; index: number; onAction?: (step: ComposedStep) => void }) {
  const allowed = useCan(step.ctaCapability ?? "");
  const canAct = !step.ctaCapability || allowed;
  const ctaClass = "mt-2 inline-block rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-accent-600";
  return (
    <div className="flex items-start gap-2.5 border-b border-border px-3.5 py-3">
      {step.done ? (
        <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent-500">
          <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
        </span>
      ) : (
        <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground/70">{index}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{step.title}</div>
        <div className="mt-0.5 text-xs leading-[17px] text-muted-foreground text-pretty">{step.done ? step.doneHint : step.todoHint}</div>
        {!step.done && canAct && (
          onAction
            ? <button type="button" onClick={() => onAction(step)} className={ctaClass}>{step.ctaLabel}</button>
            : <Link to={step.ctaRoute} className={ctaClass}>{step.ctaLabel}</Link>
        )}
      </div>
      {!step.done && step.block && (
        <span className={cn(badgeVariants({ variant: BLOCK_CHIP[step.block].tone }), "shrink-0 font-semibold")}>
          {BLOCK_CHIP[step.block].label}
        </span>
      )}
    </div>
  );
}

function ProgressCluster({ label, filled, total, hint }: { label?: string; filled?: number; total?: number; hint?: string }) {
  if (!total) return null;
  return (
    <div className="shrink-0 text-right">
      {label && <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</div>}
      <div className="mt-2 flex justify-end gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className={`h-[3px] w-[34px] rounded-full ${i < (filled ?? 0) ? "bg-accent-500" : "bg-muted"}`} />
        ))}
      </div>
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function DashboardSetupRail({
  eyebrow, title, body, complete, steps, rules, offFooters, onClose, onDismiss,
  layout = "rail", onStepAction, progressLabel, progressFilled, progressTotal, progressHint,
}: DashboardSetupRailProps) {
  const banner = layout === "banner";
  return (
    <div className={cn(
      "overflow-hidden rounded-lg border-[0.5px] border-border bg-card shadow-elev3",
      banner ? "w-full" : "w-full md:w-[340px] md:shrink-0 order-first md:order-none",
    )}>
      <div className="border-b border-border p-4">
        {banner ? (
          <div className="flex items-start justify-between gap-8">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{eyebrow}</div>
              <div className="mt-1.5 font-display text-base font-semibold text-foreground">{title}</div>
              <p className="mt-1 text-xs leading-[19px] text-muted-foreground text-pretty">{body}</p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <button onClick={onClose} className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted">Hide</button>
              <ProgressCluster label={progressLabel} filled={progressFilled} total={progressTotal} hint={progressHint} />
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{eyebrow}</div>
              <button onClick={onClose} className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted">Close</button>
            </div>
            <div className="mt-1.5 font-display text-base font-semibold text-foreground">{title}</div>
            <p className="mt-1 text-xs leading-[19px] text-muted-foreground text-pretty">{body}</p>
          </>
        )}
      </div>

      {complete ? (
        <div>
          {rules.map((r, i) => (
            <div key={i} className="flex items-start gap-2.5 border-b border-border px-3.5 py-3">
              <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent-500"><Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{r.title}</div>
                <div className="mt-0.5 text-xs leading-[17px] text-muted-foreground text-pretty">{r.hint}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>{steps.map((s, i) => <StepRow key={`${s.moduleKey}:${s.key}`} step={s} index={i + 1} onAction={onStepAction} />)}</div>
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

- [ ] **Step 5: Run the full file's tests to verify they pass**

Run: `npx vitest run src/components/dashboard/firstRun/DashboardSetupRail.test.tsx`
Expected: PASS (all existing + 3 new tests). The existing `renders todo hint + CTA` / `hides the CTA` tests still pass because `onStepAction` is absent there (Link path).

- [ ] **Step 6: Type-check**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/dashboard/types.ts src/components/dashboard/firstRun/DashboardSetupRail.tsx src/components/dashboard/firstRun/DashboardSetupRail.test.tsx
git commit -m "add layout, onStepAction and progress to DashboardSetupRail"
```

---

### Task 2: Module rail header copy (`railHeader`) on the onboarding registry

**Files:**
- Modify: `src/lib/dashboard/types.ts` (`ModuleOnboardingDef`)
- Modify: `src/lib/dashboard/moduleOnboarding.ts`
- Test: `src/lib/dashboard/moduleOnboarding.test.ts` (extend)

**Interfaces:**
- Produces: `ModuleOnboardingDef.railHeader: { title: string; body: string }`, populated for `booking_flow` and `hire_orders`. Consumed by `useModuleOnboardingRail` (Task 5).

- [ ] **Step 1: Write the failing test** (append to `moduleOnboarding.test.ts`)

```ts
it("every module has railHeader copy with no em/en dashes", () => {
  for (const def of [bookingOnboarding, hireOrderOnboarding]) {
    expect(def.railHeader.title.length).toBeGreaterThan(0);
    expect(def.railHeader.body.length).toBeGreaterThan(0);
    expect(`${def.railHeader.title}${def.railHeader.body}`).not.toMatch(/[—–]/);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/dashboard/moduleOnboarding.test.ts`
Expected: FAIL — `railHeader` is undefined.

- [ ] **Step 3: Add the field to the type**

In `src/lib/dashboard/types.ts`, inside `ModuleOnboardingDef<StepKey extends string>`, add after the `steps` field:

```ts
  /** Header copy for the module-scoped rail rendered on the module page. */
  railHeader: { title: string; body: string };
```

- [ ] **Step 4: Populate both module defs**

In `src/lib/dashboard/moduleOnboarding.ts`, add to `bookingOnboarding` (after `key: "booking_flow",`):

```ts
  railHeader: {
    title: "Get bookings running",
    body: "Dates keep syncing and you can edit them now. These are what the first offer needs.",
  },
```

And to `hireOrderOnboarding` (after `key: "hire_orders",`):

```ts
  railHeader: {
    title: "Get hire orders ready",
    body: "You can draft orders right now. These are only needed before the first one goes out.",
  },
```

- [ ] **Step 5: Run tests + type-check**

Run: `npx vitest run src/lib/dashboard/moduleOnboarding.test.ts && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS, no type errors. (`MODULE_ONBOARDING: Record<FeatureKey, ModuleOnboardingDef<string>>` now requires `railHeader`, which both defs provide.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard/types.ts src/lib/dashboard/moduleOnboarding.ts src/lib/dashboard/moduleOnboarding.test.ts
git commit -m "add per-module rail header copy to onboarding registry"
```

---

### Task 3: `initialStep` on the inline setup rails

**Files:**
- Modify: `src/components/bookings/setup/BookingSetupRail.tsx`
- Modify: `src/components/hireOrders/setup/SetupRail.tsx`
- Test: `src/components/bookings/setup/BookingSetupRail.test.tsx` (extend)
- Test: `src/components/hireOrders/setup/SetupRail.test.tsx` (extend)

**Interfaces:**
- Produces: `BookingSetupRail` accepts `initialStep?: BookingSetupStepKey`; hire `SetupRail` accepts `initialStep?: SetupStepKey`. Each seeds which accordion row is open on mount. Consumed by `SetupChecklistSheet` (Task 4).

- [ ] **Step 1: Write the failing tests**

Append to `src/components/bookings/setup/BookingSetupRail.test.tsx`:

```tsx
it("opens the step named by initialStep", async () => {
  renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" initialStep="timing" /></MemoryRouter>);
  const timingToggle = await screen.findByRole("button", { name: /Response window and digests/ });
  expect(timingToggle).toHaveAttribute("aria-expanded", "true");
  const flowToggle = screen.getByRole("button", { name: /Booking flow/ });
  expect(flowToggle).toHaveAttribute("aria-expanded", "false");
});
```

Append to `src/components/hireOrders/setup/SetupRail.test.tsx` (mirror the file's existing `beforeEach`/seed/mocks harness — it already seeds `app_settings` and mocks `useCan`):

```tsx
it("opens the step named by initialStep", async () => {
  renderWithProviders(<MemoryRouter><SetupRail orgId="org-1" initialStep="terms" /></MemoryRouter>);
  const termsToggle = await screen.findByRole("button", { name: /Terms template/ });
  expect(termsToggle).toHaveAttribute("aria-expanded", "true");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/bookings/setup/BookingSetupRail.test.tsx src/components/hireOrders/setup/SetupRail.test.tsx`
Expected: FAIL — `initialStep` prop not accepted; timing/terms rows are `aria-expanded="false"` (booking defaults open to `flow`, hire defaults to none).

- [ ] **Step 3: Add the prop to `BookingSetupRail`**

In `src/components/bookings/setup/BookingSetupRail.tsx`, change the signature and the `open` state:

```tsx
import type { BookingSetupStepKey } from "@/lib/bookings/setupStatus"; // already imported alongside STEP_TITLES/BlockKind

export function BookingSetupRail({ orgId, initialStep }: { orgId: string | null; initialStep?: BookingSetupStepKey }) {
```

and

```tsx
  const [open, setOpen] = useState<BookingSetupStepKey | null>(initialStep ?? "flow");
```

- [ ] **Step 4: Add the prop to hire `SetupRail`**

In `src/components/hireOrders/setup/SetupRail.tsx`, change the signature and the `open` state:

```tsx
export function SetupRail({ orgId, initialStep }: { orgId: string | null; initialStep?: SetupStepKey }) {
```

and

```tsx
  const [open, setOpen] = useState<SetupStepKey | null>(initialStep ?? null);
```

(`SetupStepKey` is already imported at the top of the file.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/bookings/setup/BookingSetupRail.test.tsx src/components/hireOrders/setup/SetupRail.test.tsx`
Expected: PASS (existing + new).

- [ ] **Step 6: Commit**

```bash
git add src/components/bookings/setup/BookingSetupRail.tsx src/components/hireOrders/setup/SetupRail.tsx src/components/bookings/setup/BookingSetupRail.test.tsx src/components/hireOrders/setup/SetupRail.test.tsx
git commit -m "let the inline setup rails open at a given step"
```

---

### Task 4: `SetupChecklistSheet` — shared Sheet host that opens a rail at a step

**Files:**
- Create: `src/components/setup/SetupChecklistSheet.tsx`
- Test: `src/components/setup/SetupChecklistSheet.test.tsx`

**Interfaces:**
- Consumes: `BookingSetupRail` + `SetupRail` (with `initialStep` from Task 3); `FeatureKey` from `@/lib/entitlements`.
- Produces: `SetupChecklistSheet({ feature, orgId, open, onOpenChange, initialStep })` where `feature: FeatureKey`, `orgId: string | null`, `open: boolean`, `onOpenChange: (o: boolean) => void`, `initialStep?: string`. Renders the correct inline rail inside a right-side `Sheet`, remounted by `key={initialStep ?? "none"}` so each open re-seeds the accordion. Consumed by all three pages (Tasks 6–8).

- [ ] **Step 1: Write the failing test**

Create `src/components/setup/SetupChecklistSheet.test.tsx`:

```tsx
import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SetupChecklistSheet } from "./SetupChecklistSheet";

vi.mock("@/components/bookings/setup/BookingSetupRail", () => ({
  BookingSetupRail: ({ initialStep }: { initialStep?: string }) => <div data-testid="booking-rail">step:{initialStep ?? "none"}</div>,
}));
vi.mock("@/components/hireOrders/setup/SetupRail", () => ({
  SetupRail: ({ initialStep }: { initialStep?: string }) => <div data-testid="hire-rail">step:{initialStep ?? "none"}</div>,
}));

it("renders the booking rail for booking_flow at the given step", () => {
  render(<MemoryRouter><SetupChecklistSheet feature="booking_flow" orgId="org-1" open onOpenChange={vi.fn()} initialStep="timing" /></MemoryRouter>);
  expect(screen.getByTestId("booking-rail")).toHaveTextContent("step:timing");
  expect(screen.queryByTestId("hire-rail")).not.toBeInTheDocument();
});

it("renders the hire rail for hire_orders", () => {
  render(<MemoryRouter><SetupChecklistSheet feature="hire_orders" orgId="org-1" open onOpenChange={vi.fn()} /></MemoryRouter>);
  expect(screen.getByTestId("hire-rail")).toHaveTextContent("step:none");
});

it("renders nothing inside when closed", () => {
  render(<MemoryRouter><SetupChecklistSheet feature="booking_flow" orgId="org-1" open={false} onOpenChange={vi.fn()} /></MemoryRouter>);
  expect(screen.queryByTestId("booking-rail")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/setup/SetupChecklistSheet.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SetupChecklistSheet`**

Create `src/components/setup/SetupChecklistSheet.tsx`:

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BookingSetupRail } from "@/components/bookings/setup/BookingSetupRail";
import { SetupRail } from "@/components/hireOrders/setup/SetupRail";
import type { FeatureKey } from "@/lib/entitlements";
import type { BookingSetupStepKey } from "@/lib/bookings/setupStatus";
import type { SetupStepKey } from "@/lib/hireOrders/setupStatus";

interface SetupChecklistSheetProps {
  feature: FeatureKey;
  orgId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the inline rail expanded at this step. */
  initialStep?: string;
}

/**
 * Shared host for the inline setup rails in a right-side Sheet, opened at a chosen step.
 * Remounted by `key={initialStep}` so each open re-seeds the accordion. This is the "do it
 * here" surface the dashboard-style rail's step buttons open on every page.
 */
export function SetupChecklistSheet({ feature, orgId, open, onOpenChange, initialStep }: SetupChecklistSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-base">Setup checklist</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          {open && (feature === "hire_orders"
            ? <SetupRail key={initialStep ?? "none"} orgId={orgId} initialStep={initialStep as SetupStepKey | undefined} />
            : <BookingSetupRail key={initialStep ?? "none"} orgId={orgId} initialStep={initialStep as BookingSetupStepKey | undefined} />)}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/setup/SetupChecklistSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/setup/SetupChecklistSheet.tsx src/components/setup/SetupChecklistSheet.test.tsx
git commit -m "add shared SetupChecklistSheet host opened at a step"
```

---

### Task 5: `useModuleOnboardingRail(feature)` hook

**Files:**
- Create: `src/components/setup/useModuleOnboardingRail.ts`
- Test: `src/components/setup/useModuleOnboardingRail.test.tsx`

**Interfaces:**
- Consumes: `useBookingSetupStatus` (`@/hooks/useBookingSetup`), `useHireOrderSetupStatus` (`@/hooks/useHireOrderSetup`), `useBookingSetupRailVisible` (`@/components/bookings/setup/useBookingSetupRailVisible`), `useSetupRailVisible` (`@/components/hireOrders/setup/useSetupRailVisible`), `useRailDismissed` (`@/components/setup/useRailDismissed`), `useNavCounts`, `useBookingFlow`, `useAuth`, `composeOnboarding` (`@/lib/dashboard/firstRun`), `MODULE_ONBOARDING` (`@/lib/dashboard/moduleOnboarding`), `BOOKING_FLOW_DEFAULTS` (`@/lib/bookingFlow`), and `railHeader` from Task 2.
- Produces: `useModuleOnboardingRail(feature: FeatureKey): ModuleOnboardingRail` where

```ts
interface ModuleOnboardingRail {
  show: boolean;
  reinvocable: boolean;
  steps: ComposedStep[];
  rules: InheritedRule[];
  offFooters: string[];
  eyebrow: string;
  title: string;
  body: string;
  progressFilled: number;
  progressTotal: number;
  progressLabel: string;
  dismiss: () => void;
}
```

Consumed by the module pages (Tasks 6–7).

- [ ] **Step 1: Write the failing test**

Create `src/components/setup/useModuleOnboardingRail.test.tsx`:

```tsx
import { it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => true }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1", name: "Test Org" }, hasRole: (r: string) => r === "admin" }),
}));
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: () => ({ data: null }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useBookingFlow", () => ({ useBookingFlow: () => ({ data: undefined }) }));

import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

import { useModuleOnboardingRail } from "./useModuleOnboardingRail";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  localStorage.clear();
  seed({
    app_settings: { data: [], error: null },
    shows: { data: [], error: null },
    show_dates: { data: [], error: null },
    show_cast_eligibility: { data: [], error: null },
    cast_city_priority: { data: [], error: null },
  });
});

it("composes the booking module with its header copy and progress totals", async () => {
  const { result } = renderHook(() => useModuleOnboardingRail("booking_flow"), { wrapper });
  await vi.waitFor(() => expect(result.current.progressTotal).toBe(5));
  expect(result.current.title).toBe("Get bookings running");
  expect(result.current.steps).toHaveLength(5);
  expect(result.current.progressLabel).toContain("of 5");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/setup/useModuleOnboardingRail.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `src/components/setup/useModuleOnboardingRail.ts`:

```ts
import { useAuth } from "@/features/auth/AuthContext";
import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useNavCounts } from "@/hooks/useNavCounts";
import { useBookingFlow } from "@/hooks/useBookingFlow";
import { useBookingSetupRailVisible } from "@/components/bookings/setup/useBookingSetupRailVisible";
import { useSetupRailVisible } from "@/components/hireOrders/setup/useSetupRailVisible";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import { composeOnboarding } from "@/lib/dashboard/firstRun";
import { MODULE_ONBOARDING } from "@/lib/dashboard/moduleOnboarding";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import type { FeatureKey } from "@/lib/entitlements";
import type { ComposedStep, InheritedRule, ModuleStatusLite, OnboardingCtx } from "@/lib/dashboard/types";

export interface ModuleOnboardingRail {
  show: boolean;
  reinvocable: boolean;
  steps: ComposedStep[];
  rules: InheritedRule[];
  offFooters: string[];
  eyebrow: string;
  title: string;
  body: string;
  progressFilled: number;
  progressTotal: number;
  progressLabel: string;
  dismiss: () => void;
}

const DISMISS_KEY: Record<FeatureKey, string> = {
  booking_flow: "bookingSetup",
  hire_orders: "hireOrderSetup",
};

/**
 * Module-scoped adapter over the dashboard's pure onboarding composition, for the rail
 * rendered on a module page (admin/producer). Completion comes from the same status hooks
 * the dashboard reads, so a step done on the dashboard reads done here. Visibility and
 * dismissal reuse the module's existing rail-visibility hook and its localStorage key.
 *
 * Both modules' status + visibility hooks are called unconditionally (rules of hooks) with
 * the non-selected one gated to a null org so its queries stay idle.
 */
export function useModuleOnboardingRail(feature: FeatureKey): ModuleOnboardingRail {
  const { currentOrg, hasRole } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const role = hasRole("admin") ? "admin" : "producer";

  const bookingOrg = feature === "booking_flow" ? orgId : null;
  const hireOrg = feature === "hire_orders" ? orgId : null;

  const bookingViz = useBookingSetupRailVisible(bookingOrg);
  const booking = useBookingSetupStatus(bookingOrg);
  const hireViz = useSetupRailVisible(hireOrg);
  const hire = useHireOrderSetupStatus(hireOrg);

  const counts = useNavCounts();
  const flow = useBookingFlow().data ?? BOOKING_FLOW_DEFAULTS;
  const [, dismiss] = useRailDismissed(DISMISS_KEY[feature], orgId);

  const ctx: OnboardingCtx = {
    orgName: currentOrg?.name ?? "your workspace",
    artistAcceptance: flow.artist_acceptance,
    counts,
  };

  const status: ModuleStatusLite = feature === "hire_orders"
    ? { steps: hire.status.steps.map((s) => ({ key: s.key, done: s.done, block: s.blocksIssue ? ("issuing" as const) : null })), complete: hire.status.complete }
    : { steps: booking.status.steps.map((s) => ({ key: s.key, done: s.done, block: s.block })), complete: booking.status.complete };

  const composed = composeOnboarding(
    { enabled: new Set<FeatureKey>([feature]), role, moduleStatuses: { [feature]: status }, ctx },
    MODULE_ONBOARDING,
  );
  const filled = composed.steps.filter((s) => s.done).length;
  const total = composed.steps.length;
  const railHeader = MODULE_ONBOARDING[feature].railHeader;
  const viz = feature === "hire_orders" ? hireViz : bookingViz;

  return {
    show: viz.visible,
    reinvocable: viz.reinvocable,
    steps: composed.steps,
    rules: composed.rules,
    offFooters: composed.offFooters,
    eyebrow: "Set up",
    title: railHeader.title,
    body: railHeader.body,
    progressFilled: filled,
    progressTotal: total,
    progressLabel: `Set up · ${filled} of ${total}`,
    dismiss,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/setup/useModuleOnboardingRail.test.tsx`
Expected: PASS. (`show` is false in the test because `useModuleGate`/visibility depends on `useCan` + status; the test asserts compose/copy/progress, which do not require `show`.)

- [ ] **Step 5: Type-check**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors. (Note the computed key `moduleStatuses: { [feature]: status }` yields `Partial<Record<FeatureKey, ModuleStatusLite>>` which matches `ComposeInput.moduleStatuses`.)

- [ ] **Step 6: Commit**

```bash
git add src/components/setup/useModuleOnboardingRail.ts src/components/setup/useModuleOnboardingRail.test.tsx
git commit -m "add module-scoped onboarding rail hook"
```

---

### Task 6: Wire the wizard into `/hire-orders`

**Files:**
- Modify: `src/pages/HireOrdersPage.tsx`
- Test: `src/pages/HireOrdersPage.test.tsx` (extend)

**Interfaces:**
- Consumes: `DashboardSetupRail` (Task 1), `useModuleOnboardingRail` (Task 5), `SetupChecklistSheet` (Task 4).
- Produces: the hire-orders page renders the banner rail above `OrdersKpis`, with step buttons that open the Sheet at that step. The old dashed "Get hire orders ready" callout is removed.

- [ ] **Step 1: Write the failing test** (append to `src/pages/HireOrdersPage.test.tsx`, following that file's existing render harness — reuse its `beforeEach`, seed, and provider setup)

```tsx
it("shows the setup rail above the KPIs and opens the Sheet at a clicked step", async () => {
  const user = userEvent.setup();
  // Render the page for an entitled org with empty settings (setup incomplete) using the
  // file's existing harness (renderWithProviders + seeded supabase + hire_orders entitled).
  renderHireOrdersPage(); // helper already defined in this test file's harness
  expect(await screen.findByText("Get hire orders ready")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Set letterhead" }));
  // The Sheet opens with the letterhead step expanded.
  expect(await screen.findByRole("button", { name: /Letterhead/ })).toHaveAttribute("aria-expanded", "true");
});

it("no longer renders the old dashed callout", async () => {
  renderHireOrdersPage();
  await screen.findByText("Get hire orders ready");
  expect(screen.queryByText("Open checklist")).not.toBeInTheDocument();
});
```

If `HireOrdersPage.test.tsx` has no shared render helper, add these to a fresh describe block that mirrors the harness in `BookingSetupRail.test.tsx` (mock `@/integrations/supabase/client` with `createFakeSupabase`, mock `useCan` → true, mock `useAuth` → `{ currentOrg: { id: "org-1" }, hasRole: () => true }`, wrap in `renderWithProviders` + `MemoryRouter`), seeding `app_settings`/`hire_orders` empty so setup is incomplete and the module is entitled. Import `userEvent` from `@testing-library/user-event`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pages/HireOrdersPage.test.tsx`
Expected: FAIL — "Get hire orders ready" not found (currently a dashed callout with different copy) / step buttons absent.

- [ ] **Step 3: Add imports**

In `src/pages/HireOrdersPage.tsx`, add:

```tsx
import { DashboardSetupRail } from "@/components/dashboard/firstRun/DashboardSetupRail";
import { useModuleOnboardingRail } from "@/components/setup/useModuleOnboardingRail";
import { SetupChecklistSheet } from "@/components/setup/SetupChecklistSheet";
import type { ComposedStep } from "@/lib/dashboard/types";
```

- [ ] **Step 4: Add rail state + handler; keep the existing visibility gate**

Inside `HireOrdersPage`, near the existing setup state (`setupSheetOpen`), add:

```tsx
  const rail = useModuleOnboardingRail("hire_orders");
  const [setupStep, setSetupStep] = useState<string | undefined>(undefined);
  const openSetupAt = (step: ComposedStep) => { setSetupStep(step.key); setSetupSheetOpen(true); };
```

Keep the existing `entitledForWrites`, `showSetupRail`, `showSetupReinvoke`, `undismissSetup`, `setupSheetOpen` declarations.

- [ ] **Step 5: Render the banner rail above `OrdersKpis`, remove the dashed callout**

Replace the dashed-callout block (the `{showSetupRail && ( <Card className="border-dashed"> ... </Card> )}` at lines ~202–216) — MOVE the rail to sit ABOVE `<OrdersKpis .../>` (line ~197). The region becomes:

```tsx
      {showSetupRail && (
        <DashboardSetupRail
          layout="banner"
          eyebrow={rail.eyebrow}
          title={rail.title}
          body={rail.body}
          complete={false}
          steps={rail.steps}
          rules={rail.rules}
          offFooters={rail.offFooters}
          progressLabel={rail.progressLabel}
          progressFilled={rail.progressFilled}
          progressTotal={rail.progressTotal}
          onStepAction={openSetupAt}
          onClose={rail.dismiss}
          onDismiss={rail.dismiss}
        />
      )}

      <OrdersKpis orders={allOrders} />
```

(Delete the old `<OrdersKpis>` line at ~197 and the entire dashed-callout `<Card>` block; the `hireOrderSetupStatus` read that fed the callout's "N of N" copy can be removed if now unused — verify with the type-check in Step 8.)

- [ ] **Step 6: Point the header re-invoke button at the rail; swap the Sheet for `SetupChecklistSheet`**

The header "Setup checklist" button (lines ~176–185) should just un-dismiss the rail (bring the banner back) — change its onClick to `onClick={() => { undismissSetup(); }}`.

Replace the existing `<Sheet> ... <SetupRail orgId=... /> ... </Sheet>` block (lines ~268–277) with:

```tsx
      <SetupChecklistSheet
        feature="hire_orders"
        orgId={entitledForWrites ? orgId : null}
        open={setupSheetOpen}
        onOpenChange={setSetupSheetOpen}
        initialStep={setupStep}
      />
```

Remove the now-unused `SetupRail`, `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle` imports if nothing else on the page uses them (the order slide-over uses its own components; verify via the type-check).

- [ ] **Step 7: Run the page tests to verify they pass**

Run: `npx vitest run src/pages/HireOrdersPage.test.tsx`
Expected: PASS.

- [ ] **Step 8: Lint + type-check the page**

Run: `npx tsc -p tsconfig.app.json --noEmit && npx eslint src/pages/HireOrdersPage.tsx --max-warnings 0`
Expected: no errors, no unused-import warnings.

- [ ] **Step 9: Commit**

```bash
git add src/pages/HireOrdersPage.tsx src/pages/HireOrdersPage.test.tsx
git commit -m "render setup wizard above KPIs on hire-orders page"
```

---

### Task 7: Wire the wizard into `/bookings`

**Files:**
- Modify: `src/pages/ShowsBookingsPage.tsx`
- Test: `src/pages/ShowsBookingsPage` test (extend the existing spec, e.g. `ShowsBookingsPage.peek.test.tsx` or a new `ShowsBookingsPage.setup.test.tsx` following that harness)

**Interfaces:**
- Consumes: `DashboardSetupRail` (Task 1), `useModuleOnboardingRail` (Task 5), `SetupChecklistSheet` (Task 4).
- Produces: `/bookings` renders the banner rail below the page header (above the filters/table); the dashed "Get bookings running" callout is removed; step buttons open the Sheet at that step.

- [ ] **Step 1: Write the failing test**

Create `src/pages/ShowsBookingsPage.setup.test.tsx` mirroring the harness used by the existing ShowsBookingsPage tests (mock `@/integrations/supabase/client` with `createFakeSupabase`; mock `useCan` → true; mock `useAuth` → `{ currentOrg: { id: "org-1" }, hasRole: () => true }`; wrap `renderWithProviders` + `MemoryRouter`; seed `app_settings`/`shows`/`show_dates`/`show_cast_eligibility`/`cast_city_priority` empty so setup is incomplete). Assertions:

```tsx
it("renders the booking setup rail and opens the Sheet at a clicked step", async () => {
  const user = userEvent.setup();
  renderWithProviders(<MemoryRouter><ShowsBookingsPage /></MemoryRouter>);
  expect(await screen.findByText("Get bookings running")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Choose flow" }));
  expect(await screen.findByRole("button", { name: /Booking flow/ })).toHaveAttribute("aria-expanded", "true");
});

it("no longer renders the old dashed callout button", async () => {
  renderWithProviders(<MemoryRouter><ShowsBookingsPage /></MemoryRouter>);
  await screen.findByText("Get bookings running");
  expect(screen.queryByText("Open checklist")).not.toBeInTheDocument();
});
```

(`ShowsBookingsPage` is the default export of `src/pages/ShowsBookingsPage.tsx`. `Choose flow` is the booking `flow` step's `ctaLabel` from `moduleOnboarding.ts`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pages/ShowsBookingsPage.setup.test.tsx`
Expected: FAIL — the rail title/step buttons are not rendered (only the dashed callout's "Open checklist" exists today).

- [ ] **Step 3: Add imports**

In `src/pages/ShowsBookingsPage.tsx`, add:

```tsx
import { DashboardSetupRail } from "@/components/dashboard/firstRun/DashboardSetupRail";
import { useModuleOnboardingRail } from "@/components/setup/useModuleOnboardingRail";
import { SetupChecklistSheet } from "@/components/setup/SetupChecklistSheet";
import type { ComposedStep } from "@/lib/dashboard/types";
```

- [ ] **Step 4: Add rail state + handler**

Near the existing `setupSheetOpen` state (~line 241), add:

```tsx
  const rail = useModuleOnboardingRail("booking_flow");
  const [setupStep, setSetupStep] = useState<string | undefined>(undefined);
  const openSetupAt = (step: ComposedStep) => { setSetupStep(step.key); setSetupSheetOpen(true); };
```

Keep `railVisible`, `showSetupReinvoke`, `undismissBookingSetup`, `bookingSetupStatus` (the last may become unused after Step 5 — remove it then if so).

- [ ] **Step 5: Replace the dashed callout with the banner rail**

Replace the `{railVisible && ( <Card className="border-dashed"> ... </Card> )}` block (lines ~444–458) with:

```tsx
      {railVisible && (
        <DashboardSetupRail
          layout="banner"
          eyebrow={rail.eyebrow}
          title={rail.title}
          body={rail.body}
          complete={false}
          steps={rail.steps}
          rules={rail.rules}
          offFooters={rail.offFooters}
          progressLabel={rail.progressLabel}
          progressFilled={rail.progressFilled}
          progressTotal={rail.progressTotal}
          onStepAction={openSetupAt}
          onClose={rail.dismiss}
          onDismiss={rail.dismiss}
        />
      )}
```

- [ ] **Step 6: Swap the Sheet for `SetupChecklistSheet`**

Replace the `<Sheet open={setupSheetOpen} ...> ... <BookingSetupRail orgId=... /> ... </Sheet>` block (lines ~734–743) with:

```tsx
      <SetupChecklistSheet
        feature="booking_flow"
        orgId={bookingOn ? orgId : null}
        open={setupSheetOpen}
        onOpenChange={setSetupSheetOpen}
        initialStep={setupStep}
      />
```

Change the header re-invoke button's onClick (line ~420) to `onClick={() => { undismissBookingSetup(); }}`. Remove now-unused imports (`BookingSetupRail`, and `Sheet*`/`Card`/`CardContent` if nothing else on the page uses them — verify via the type-check).

- [ ] **Step 7: Run the page test to verify it passes**

Run: `npx vitest run src/pages/ShowsBookingsPage.setup.test.tsx`
Expected: PASS.

- [ ] **Step 8: Run the sibling page tests, lint + type-check**

Run: `npx vitest run src/pages/ShowsBookingsPage.peek.test.tsx && npx tsc -p tsconfig.app.json --noEmit && npx eslint src/pages/ShowsBookingsPage.tsx --max-warnings 0`
Expected: PASS, no type/lint errors.

- [ ] **Step 9: Commit**

```bash
git add src/pages/ShowsBookingsPage.tsx src/pages/ShowsBookingsPage.setup.test.tsx
git commit -m "render setup wizard on shows and bookings page"
```

---

### Task 8: Dashboard step buttons open the inline Sheet in place

**Files:**
- Modify: `src/pages/DashboardPage.tsx` (`ProducerDashboard`)
- Test: `src/pages/DashboardPage.firstRun.test.tsx` (extend)

**Interfaces:**
- Consumes: `DashboardSetupRail`'s new `onStepAction` (Task 1), `SetupChecklistSheet` (Task 4), `ComposedStep.moduleKey`.
- Produces: on `/dashboard`, a booking/hire step button opens that module's `SetupChecklistSheet` at the step instead of navigating to Settings/Productions. `ArtistDashboard` is unchanged.

- [ ] **Step 1: Write the failing test** (append to `src/pages/DashboardPage.firstRun.test.tsx`, reusing its harness)

```tsx
it("opens the module setup Sheet in place when a rail step is clicked (no navigation)", async () => {
  const user = userEvent.setup();
  // Render ProducerDashboard for an incomplete-setup org via the file's existing harness,
  // with the rail open (fr.railOpen). Then:
  const stepBtn = await screen.findByRole("button", { name: "Choose flow" });
  await user.click(stepBtn);
  expect(await screen.findByRole("button", { name: /Booking flow/ })).toHaveAttribute("aria-expanded", "true");
});
```

If the file's harness does not already open the rail, follow the existing tests' pattern for driving `useDashboardFirstRun` into the open state (the file already exercises the welcome → rail flow); reuse it rather than re-implementing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pages/DashboardPage.firstRun.test.tsx`
Expected: FAIL — the step renders a `Link`, not a button; clicking does not open a Sheet.

- [ ] **Step 3: Add imports + Sheet state to `ProducerDashboard`**

In `src/pages/DashboardPage.tsx`, add imports:

```tsx
import { SetupChecklistSheet } from '@/components/setup/SetupChecklistSheet';
import type { ComposedStep } from '@/lib/dashboard/types';
import type { FeatureKey } from '@/lib/entitlements';
```

Inside `ProducerDashboard`, add:

```tsx
  const [setupSheet, setSetupSheet] = useState<{ feature: FeatureKey; step: string } | null>(null);
  const openSetupAt = (step: ComposedStep) => setSetupSheet({ feature: step.moduleKey, step: step.key });
```

- [ ] **Step 4: Pass `onStepAction` to the rail and render the Sheet**

On the existing `<DashboardSetupRail ... />` (lines ~385–396), add the prop `onStepAction={openSetupAt}`.

After the `<DashboardSetupRail />` block (before the closing `</div>` of the flex row), render:

```tsx
        <SetupChecklistSheet
          feature={setupSheet?.feature ?? 'booking_flow'}
          orgId={orgId}
          open={setupSheet !== null}
          onOpenChange={(o) => { if (!o) setSetupSheet(null); }}
          initialStep={setupSheet?.step}
        />
```

(`orgId` is already in scope in `ProducerDashboard`. The `feature` fallback of `'booking_flow'` is inert while `open` is false.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/pages/DashboardPage.firstRun.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the dashboard test suite, lint + type-check**

Run: `npx vitest run src/pages/DashboardPage.firstRun.test.tsx src/pages/DashboardPage.test.tsx src/pages/DashboardPage.moduleGate.test.tsx && npx tsc -p tsconfig.app.json --noEmit && npx eslint src/pages/DashboardPage.tsx --max-warnings 0`
Expected: PASS, no type/lint errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/DashboardPage.tsx src/pages/DashboardPage.firstRun.test.tsx
git commit -m "open inline setup Sheet from dashboard rail steps"
```

---

### Task 9: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole unit suite with coverage (what CI runs)**

Run: `npm run test:coverage`
Expected: PASS, coverage thresholds met.

- [ ] **Step 2: Lint + all three type-check projects**

Run: `npm run lint && npx tsc -p tsconfig.app.json --noEmit && npx tsc -p tsconfig.tools.json --noEmit`
Expected: no errors. (No edge-function or migration changes in this plan, so the Deno check is unaffected, but running `deno check` on touched edge functions is a no-op here.)

- [ ] **Step 3: Manual smoke (optional, local stack)**

Run `npm run local:up && npm run dev`, sign in as the seeded admin, and confirm: the setup rail appears above the KPIs on `/hire-orders` and above the table on `/bookings`, matches the dashboard rail's colors with the top-right progress rail; a step button opens the inline Sheet expanded at that step; the dashboard's step buttons open the Sheet in place (no navigation); Hide/Close removes the rail on that surface only.

- [ ] **Step 4: Commit any coverage/config fallout** (only if Step 1 required a test tweak)

```bash
git add -A
git commit -m "verify multi-surface onboarding wizard suite green"
```

---

## Self-Review

**Spec coverage:**
- Render dashboard-style rail on `/bookings` + `/hire-orders`, module-scoped → Tasks 5, 6, 7.
- Visually identical incl. top-right progress rail → Task 1 (banner layout + `ProgressCluster`), Task 6/7 pass progress props.
- Step button opens inline Sheet at that step, on module pages AND dashboard → Task 1 (`onStepAction`), Task 4 (`SetupChecklistSheet` + `initialStep`), Task 3 (`initialStep` on rails), Tasks 6/7/8 wiring.
- Keep inline Sheet as "do it here" → Task 4 reuses the existing rails unchanged (only `initialStep` added).
- Completion consistent across surfaces → all surfaces read the same status hooks (Task 5 reuses `useBookingSetupStatus`/`useHireOrderSetupStatus`); no divergence introduced.
- Artist path untouched → `onStepAction` is optional; `ArtistDashboard` is not modified (Task 8 touches only `ProducerDashboard`).
- Dismiss per-surface → Task 5 reuses the module dismiss keys (`bookingSetup`/`hireOrderSetup`); dashboard keeps `dashboardWelcome`.
- Module-specific header copy single-sourced → Task 2 (`railHeader`).

**Placeholder scan:** No TBD/TODO. Every code step has concrete code. Page-wiring tests reference the real in-file harness (which genuinely exists) and provide concrete assertions; where a shared render helper may be absent, Step 1 gives the exact harness to replicate (from `BookingSetupRail.test.tsx`).

**Type consistency:** `useModuleOnboardingRail` returns `ModuleOnboardingRail` (Task 5); the pages read `rail.eyebrow/title/body/steps/rules/offFooters/progressLabel/progressFilled/progressTotal/dismiss` — all present. `DashboardSetupRail` prop names (`layout`, `onStepAction`, `progressLabel`, `progressFilled`, `progressTotal`, `progressHint`) match between Task 1 definition and Tasks 6/7/8 usage. `SetupChecklistSheet` props (`feature`, `orgId`, `open`, `onOpenChange`, `initialStep`) match between Task 4 and Tasks 6/7/8. `ComposedStep.moduleKey` is a `FeatureKey` (existing type), matching Task 8's `setSetupSheet({ feature: step.moduleKey, ... })`.
