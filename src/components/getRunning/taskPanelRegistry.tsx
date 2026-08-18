import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import { ShowsStep } from "@/components/bookings/setup/ShowsStep";
import { FlowStep } from "@/components/bookings/setup/FlowStep";
import { SlotsStep } from "@/components/bookings/setup/SlotsStep";
import { LadderStep } from "@/components/bookings/setup/LadderStep";
import { EligibilityStep } from "@/components/bookings/setup/EligibilityStep";
import { TimingStep } from "@/components/bookings/setup/TimingStep";
import { TeamPanelBody } from "@/components/getRunning/panels/TeamPanelBody";
import { PeoplePanelBody } from "@/components/getRunning/panels/PeoplePanelBody";
import { LetterheadStep } from "@/components/hireOrders/setup/LetterheadStep";
import { TermsStep } from "@/components/hireOrders/setup/TermsStep";
import { CountersignStep } from "@/components/hireOrders/setup/CountersignStep";
import { BOOKING_DOMAIN_TASK_KEYS } from "@/lib/getRunning/taskPanelMeta";
import type { GetRunningTask } from "@/lib/getRunning/tasks";

/**
 * Mounts the existing step editor for a `GetRunningTask` inside the `TaskPanel` frame's
 * scroll slot. Most editors here already exist under `src/components/bookings/setup/*`
 * or `src/components/hireOrders/setup/*` and are reused as-is (wrap, don't modify) —
 * including `ShowsStep` for the `dates` task. `team` and `people` are exceptions: their
 * old steps (`TeamStep`, `PeopleStep`) only linked out to other pages, and the
 * "in-panel editors" initiative (`.superpowers/sdd/2026-08-18-get-running-in-panel-editors`)
 * replaced them with `TeamPanelBody` and `PeoplePanelBody`, genuine in-panel editors built
 * for this registry — later tasks in the same initiative do the same for
 * `letterhead`/`terms`/`countersign`/`slots`.
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
      return <ShowsStep />;
    case "slots":
      return <SlotsStep orgId={orgId} onDone={onDone} />;
    case "flow":
      return <FlowStep orgId={orgId} onDone={onDone} />;
    case "people":
      return <PeoplePanelBody orgId={orgId} artistCount={artistCount} onDone={onDone} />;
    case "ladder":
      return <LadderStep coverage={coverage} orgId={orgId} />;
    case "eligibility":
      return <EligibilityStep coverage={coverage} orgId={orgId} />;
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
