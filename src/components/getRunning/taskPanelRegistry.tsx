import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import { FlowStep } from "@/components/bookings/setup/FlowStep";
import { SlotsStep } from "@/components/bookings/setup/SlotsStep";
import { TimingStep } from "@/components/bookings/setup/TimingStep";
import { TeamPanelBody } from "@/components/getRunning/panels/TeamPanelBody";
import { PeoplePanelBody } from "@/components/getRunning/panels/PeoplePanelBody";
import { DatesPanelBody } from "@/components/getRunning/panels/DatesPanelBody";
import { LadderPanelBody } from "@/components/getRunning/panels/LadderPanelBody";
import { EligibilityPanelBody } from "@/components/getRunning/panels/EligibilityPanelBody";
import { LetterheadStep } from "@/components/hireOrders/setup/LetterheadStep";
import { TermsStep } from "@/components/hireOrders/setup/TermsStep";
import { CountersignStep } from "@/components/hireOrders/setup/CountersignStep";
import { BOOKING_DOMAIN_TASK_KEYS } from "@/lib/getRunning/taskPanelMeta";
import type { GetRunningTask } from "@/lib/getRunning/tasks";

/**
 * Mounts the existing step editor for a `GetRunningTask` inside the `TaskPanel` frame's
 * scroll slot. Most editors here already exist under `src/components/bookings/setup/*`
 * or `src/components/hireOrders/setup/*` and are reused as-is (wrap, don't modify).
 * `dates`, `team`, `people`, `ladder` and `eligibility` are exceptions: their old steps
 * (`ShowsStep`, `TeamStep`, `PeopleStep`, `LadderStep`, `EligibilityStep`) only linked out
 * to other pages or (for `ladder`/`eligibility`) summarized coverage read-only, and the
 * "in-panel editors" initiative (`.superpowers/sdd/2026-08-18-get-running-in-panel-editors`)
 * replaced them with `DatesPanelBody`, `TeamPanelBody`, `PeoplePanelBody`, `LadderPanelBody`
 * and `EligibilityPanelBody`, genuine in-panel editors built for this registry — later
 * tasks in the same initiative do the same for `letterhead`/`terms`/`countersign`/`slots`.
 * `ShowsStep`, `LadderStep` and `EligibilityStep` themselves are left in place
 * (`src/components/bookings/setup/`), unused by this registry now, pending their own
 * removal in a later task.
 *
 * Data hooks are called unconditionally at the top (same convention as
 * `BookingSetupRail`/`SetupRail`, which always fetch coverage/artist-count regardless of
 * which row is expanded): only one editor renders per mount, so there is no rules-of-hooks
 * hazard, and every read here shares a query key with `useGetRunning`'s own reads, so
 * opening a panel is a cache hit, not a new request.
 */
export function TaskPanelEditor({
  task,
  orgId,
  onDone,
}: {
  task: GetRunningTask;
  orgId: string | null;
  onDone: () => void;
}): JSX.Element {
  const bookingOrgId = BOOKING_DOMAIN_TASK_KEYS.has(task.key) ? orgId : null;
  const { coverage, artistCount } = useBookingSetupStatus(bookingOrgId);

  switch (task.key) {
    case "dates":
      return <DatesPanelBody orgId={orgId} onDone={onDone} />;
    case "slots":
      return <SlotsStep orgId={orgId} onDone={onDone} />;
    case "flow":
      return <FlowStep orgId={orgId} onDone={onDone} />;
    case "people":
      return <PeoplePanelBody orgId={orgId} artistCount={artistCount} onDone={onDone} />;
    case "ladder":
      return <LadderPanelBody coverage={coverage} orgId={orgId} onDone={onDone} />;
    case "eligibility":
      return <EligibilityPanelBody coverage={coverage} orgId={orgId} onDone={onDone} />;
    case "timing":
      return <TimingStep orgId={orgId} onDone={onDone} />;
    case "team":
      return <TeamPanelBody orgId={orgId} onDone={onDone} />;
    case "letterhead":
      return <LetterheadStep orgId={orgId} onDone={onDone} />;
    case "terms":
      return <TermsStep orgId={orgId} onDone={onDone} />;
    case "countersign":
      return <CountersignStep orgId={orgId} onDone={onDone} />;
    default: {
      const exhaustive: never = task.key;
      throw new Error(`No task panel editor registered for ${exhaustive}`);
    }
  }
}
