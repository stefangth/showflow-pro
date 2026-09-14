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
import { WorkspaceStep } from "@/components/getRunning/v3/steps/WorkspaceStep";
import { SourceStep } from "@/components/getRunning/v3/steps/SourceStep";
import { ConnectStep } from "@/components/getRunning/v3/steps/ConnectStep";
import { MapStep } from "@/components/getRunning/v3/steps/MapStep";
import { CitiesStep } from "@/components/getRunning/v3/steps/CitiesStep";
import { ProductionsStep } from "@/components/getRunning/v3/steps/ProductionsStep";
import { SkillsStep } from "@/components/getRunning/v3/steps/SkillsStep";
import { FeeStep } from "@/components/getRunning/v3/steps/FeeStep";
import { DocumentStep } from "@/components/getRunning/v3/steps/DocumentStep";
import { StepComingSoon } from "./StepComingSoon";
import type { GetRunningStep, GetRunningStepKey } from "@/lib/getRunning/steps";

/** The `bookable`-phase step keys whose readiness `useBookingSetupStatus` (coverage +
 *  active-artist count) answers, mirroring v1 `taskPanelRegistry.tsx`'s
 *  `BOOKING_DOMAIN_TASK_KEYS` gate: an org with hire_orders on but booking off never pays
 *  for a booking-readiness fetch when it opens `letterhead`/`terms`/`countersign`, and a
 *  placeholder step never pays for it either (its body is `StepComingSoon`, which reads
 *  none of it). */
const BOOKING_DOMAIN_STEP_KEYS: ReadonlySet<GetRunningStepKey> = new Set(["artists", "coverage", "cities"]);

/**
 * Mounts the existing step editor for a `GetRunningStep` inside the v3 `WizardShell`'s
 * middle scroll slot (Task 6). Reuses the same in-panel editors v1's `taskPanelRegistry`
 * wires up (see that file's header comment for the "in-panel editors" initiative this
 * built on) — nothing here re-implements a body, it only re-maps v3's 17-step model onto
 * them. `coverage` is v3's one genuinely new mapping: the merged step (v3 retires
 * v1's separate `ladder`/`eligibility` steps) renders BOTH `LadderPanelBody` (org-wide
 * per-city ranking) and `EligibilityPanelBody` (per-show override) stacked, sharing the
 * one `coverage` read and each firing its own `onDone` on its own gap-closing transition
 * (see each body's own `onDone` doc comment for why that condition is body-specific).
 *
 * The five "Get dates in" steps (`source`/`connect`/`map`/`cities`/`productions`) have
 * real bodies too (Wireflow v3 Phase 2, Tasks 6-9/11), each owning its own data via the
 * `orgId`/`onDone` props passed straight through. As of Phase 3 (Task 6) all steps then
 * modeled have a real in-panel editor: `skills` reuses the Settings `SkillsTab`, `fee` reuses
 * `OrderDefaultsCard`, and `document` reuses `NumberingCard`. The `step.placeholder`
 * early-return and `StepComingSoon` below are now dead for every currently-modeled step,
 * but stay in place as the generic safety net for any future step added with
 * `placeholder: true` before its body is built (see `src/lib/getRunning/steps.ts`).
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
  onGoToStep,
}: {
  step: GetRunningStep;
  orgId: string | null;
  onDone: () => void;
  /** Move the wizard to a named step. Only the `map` body uses it today, to send an
   *  Airtable org that has not connected yet back to the step that can unblock it. */
  onGoToStep?: (key: GetRunningStepKey) => void;
}): JSX.Element {
  const bookingOrgId = BOOKING_DOMAIN_STEP_KEYS.has(step.key) ? orgId : null;
  const {
    coverage,
    artistCount,
    status,
    isLoading: bookingLoading,
    isError: bookingError,
  } = useBookingSetupStatus(bookingOrgId);

  if (step.placeholder) {
    return <StepComingSoon step={step} />;
  }

  switch (step.key) {
    case "artists":
      return <PeoplePanelBody orgId={orgId} artistCount={artistCount} />;
    case "coverage":
      // v3 merges v1's separate `ladder` and `eligibility` steps into one. Both bodies
      // print the org's cast roster and both end in an unlocks callout, so stacked
      // verbatim the step showed the same casts twice and the same callout twice in one
      // scroll. The ranking half keeps the roster (it is what you rank), the
      // per-production half keeps the closing callout, and a rule separates the two.
      // Neither needs a heading from here: each half already labels itself ("Cities with
      // dates" / "Coverage by production").
      return (
        <div className="space-y-5">
          <LadderPanelBody coverage={coverage} orgId={orgId} onDone={onDone} showUnlocks={false} />
          <div className="border-t border-border" />
          <EligibilityPanelBody coverage={coverage} orgId={orgId} onDone={onDone} showCastList={false} />
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
    case "workspace":
      return <WorkspaceStep orgId={orgId} onDone={onDone} />;
    case "source":
      return <SourceStep orgId={orgId} onDone={onDone} />;
    case "connect":
      return <ConnectStep orgId={orgId} onDone={onDone} />;
    case "map":
      return <MapStep orgId={orgId} onDone={onDone} onGoToStep={onGoToStep} />;
    case "cities":
      // `null` whenever the booking-setup read is unresolved, in flight OR failed:
      // `computeBookingSetupStatus` reports `hasAnyDates: false` for a failed
      // `fetchShowDateCount` (`dateCount.data ?? null`), which would render "No dates yet" to
      // an org with hundreds. `statusError` splits the two so the step can show a skeleton
      // for one and an error for the other instead of a skeleton that never resolves.
      return (
        <CitiesStep
          orgId={orgId}
          onDone={onDone}
          hasAnyDates={bookingLoading || bookingError ? null : status.hasAnyDates}
          statusError={bookingError}
        />
      );
    case "productions":
      return <ProductionsStep orgId={orgId} onDone={onDone} />;
    // skills/fee/document are real steps now (placeholder:false in steps.ts), so they reach
    // this switch like any other real step rather than being intercepted by the
    // `if (step.placeholder)` guard above. They need explicit cases (not `default`) so the
    // exhaustiveness check below holds: every GetRunningStepKey must be handled, or the
    // `never` assignment fails to compile.
    case "skills":
      return <SkillsStep orgId={orgId} onDone={onDone} />;
    case "fee":
      return <FeeStep orgId={orgId} onDone={onDone} />;
    case "document":
      return <DocumentStep orgId={orgId} onDone={onDone} />;
    default: {
      const exhaustive: never = step.key;
      throw new Error(`No step body registered for ${exhaustive}`);
    }
  }
}
