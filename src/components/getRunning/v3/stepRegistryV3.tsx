import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import { FlowStep } from "@/components/bookings/setup/FlowStep";
import { TimingStep } from "@/components/bookings/setup/TimingStep";
import { PeoplePanelBody } from "@/components/getRunning/panels/PeoplePanelBody";
import { LadderPanelBody } from "@/components/getRunning/panels/LadderPanelBody";
import { EligibilityPanelBody } from "@/components/getRunning/panels/EligibilityPanelBody";
import { TeamPanelBody } from "@/components/getRunning/panels/TeamPanelBody";
import { LetterheadStep } from "@/components/hireOrders/setup/LetterheadStep";
import { TermsStep } from "@/components/hireOrders/setup/TermsStep";
import { CountersignStep } from "@/components/hireOrders/setup/CountersignStep";
import { SourceStep } from "@/components/getRunning/v3/steps/SourceStep";
import { ConnectStep } from "@/components/getRunning/v3/steps/ConnectStep";
import { MapStep } from "@/components/getRunning/v3/steps/MapStep";
import { CitiesStep } from "@/components/getRunning/v3/steps/CitiesStep";
import { ProductionsStep } from "@/components/getRunning/v3/steps/ProductionsStep";
import { StepComingSoon } from "./StepComingSoon";
import type { GetRunningStep, GetRunningStepKey } from "@/lib/getRunning/steps";

/** The `bookable`-phase step keys whose readiness `useBookingSetupStatus` (coverage +
 *  active-artist count) answers, mirroring v1 `taskPanelRegistry.tsx`'s
 *  `BOOKING_DOMAIN_TASK_KEYS` gate: an org with hire_orders on but booking off never pays
 *  for a booking-readiness fetch when it opens `letterhead`/`terms`/`countersign`, and a
 *  placeholder step never pays for it either (its body is `StepComingSoon`, which reads
 *  none of it). */
const BOOKING_DOMAIN_STEP_KEYS: ReadonlySet<GetRunningStepKey> = new Set(["artists", "coverage"]);

/**
 * Mounts the existing step editor for a `GetRunningStep` inside the v3 `WizardShell`'s
 * middle scroll slot (Task 6). Reuses the same in-panel editors v1's `taskPanelRegistry`
 * wires up (see that file's header comment for the "in-panel editors" initiative this
 * built on) — nothing here re-implements a body, it only re-maps v3's 16-step model onto
 * them. `coverage` is v3's one genuinely new mapping: the merged step (v3 retires
 * v1's separate `ladder`/`eligibility` steps) renders BOTH `LadderPanelBody` (org-wide
 * per-city ranking) and `EligibilityPanelBody` (per-show override) stacked, sharing the
 * one `coverage` read and each firing its own `onDone` on its own gap-closing transition
 * (see each body's own `onDone` doc comment for why that condition is body-specific).
 *
 * The five "Get dates in" steps (`source`/`connect`/`map`/`cities`/`productions`) have
 * real bodies too (Wireflow v3 Phase 2, Tasks 6-9/11), each owning its own data via the
 * `orgId`/`onDone` props passed straight through. Every remaining `step.placeholder`
 * step (`skills`/`fee`/`document` — see `src/lib/getRunning/steps.ts`'s header comment
 * on Phase-1 being an honest approximation) has no real in-panel editor yet and renders
 * `StepComingSoon` instead, which deep-links out to the step's real home.
 *
 * Data hooks are called unconditionally at the top (same convention as
 * `TaskPanelEditor`/`BookingSetupRail`/`SetupRail`): only one editor renders per mount,
 * so there is no rules-of-hooks hazard, and the read shares a query key with the board's
 * own `useGetRunning` reads, so opening a step is a cache hit, not a new request.
 */
export function StepBodyV3({
  step,
  orgId,
  onDone,
}: {
  step: GetRunningStep;
  orgId: string | null;
  onDone: () => void;
}): JSX.Element {
  const bookingOrgId = BOOKING_DOMAIN_STEP_KEYS.has(step.key) ? orgId : null;
  const { coverage, artistCount } = useBookingSetupStatus(bookingOrgId);

  if (step.placeholder) {
    return <StepComingSoon step={step} />;
  }

  switch (step.key) {
    case "artists":
      return <PeoplePanelBody orgId={orgId} artistCount={artistCount} />;
    case "coverage":
      return (
        <div className="space-y-4">
          <LadderPanelBody coverage={coverage} orgId={orgId} onDone={onDone} />
          <EligibilityPanelBody coverage={coverage} orgId={orgId} onDone={onDone} />
        </div>
      );
    case "flow":
      return <FlowStep orgId={orgId} onDone={onDone} />;
    case "timing":
      return <TimingStep orgId={orgId} onDone={onDone} />;
    case "team":
      return <TeamPanelBody orgId={orgId} />;
    case "letterhead":
      return <LetterheadStep orgId={orgId} onDone={onDone} />;
    case "terms":
      return <TermsStep orgId={orgId} onDone={onDone} />;
    case "countersign":
      return <CountersignStep orgId={orgId} onDone={onDone} />;
    case "source":
      return <SourceStep orgId={orgId} onDone={onDone} />;
    case "connect":
      return <ConnectStep orgId={orgId} onDone={onDone} />;
    case "map":
      return <MapStep orgId={orgId} onDone={onDone} />;
    case "cities":
      return <CitiesStep orgId={orgId} onDone={onDone} />;
    case "productions":
      return <ProductionsStep orgId={orgId} onDone={onDone} />;
    // The remaining placeholder keys are handled above via `step.placeholder` before this
    // switch is reached, but they must still appear here (rather than in `default`) for
    // the exhaustiveness check below to hold: TypeScript narrows `step.key` across the
    // whole switch, not just the cases after the `if`.
    case "skills":
    case "fee":
    case "document":
      return <StepComingSoon step={step} />;
    default: {
      const exhaustive: never = step.key;
      throw new Error(`No step body registered for ${exhaustive}`);
    }
  }
}
