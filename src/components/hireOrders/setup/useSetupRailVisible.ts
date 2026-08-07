import { useCan } from "@/hooks/useCapabilities";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useRailDismissed } from "@/components/setup/useRailDismissed";

export interface SetupRailVisibility {
  /** Whether `SetupRail` will render anything at all right now. */
  visible: boolean;
  /**
   * Whether the header's "Setup checklist" re-invoke button should show. This is
   * `visible`'s own eligibility (org present, not loading, not complete, and either
   * an editor or something actually blocking) minus the dismissed check -- re-invoking
   * IS clearing that dismissal, so a rail that would still show nothing once undismissed
   * (e.g. a producer once nothing blocks issuing) must never offer the button either.
   * Computed from the exact same inputs as `visible` so the two can't drift the way an
   * independently-gated header button once did (Plan B fix wave).
   */
  reinvocable: boolean;
}

const HIDDEN: SetupRailVisibility = { visible: false, reinvocable: false };

/**
 * Whether `SetupRail` will render anything at all, and whether the header re-invoke
 * button should show.
 *
 * Its own module rather than a second export from SetupRail.tsx, because a `null` child
 * does not collapse a grid track: the orders page has to know the answer BEFORE it picks
 * its column template, or it reserves 340px of empty space forever once setup is done.
 * The rail reads the same hook, so the rule lives in one place and cannot drift, and
 * `useRailDismissed` is a shared store so both readers see a Hide click.
 */
export function useSetupRailVisible(orgId: string | null): SetupRailVisibility {
  const canEditSettings = useCan("edit_hire_order_settings");
  const { status, isLoading } = useHireOrderSetupStatus(orgId);
  const [dismissed] = useRailDismissed("hireOrderSetup", orgId);

  // No org (or a caller passing null to gate on the `hire_orders` entitlement) means
  // nothing to set up and nothing to read. Without this the all-false status of an
  // idle query would read as "cannot issue" and show the rail.
  if (!orgId || isLoading || status.complete) return HIDDEN;

  // A producer is only told about setup while issuing is ACTUALLY blocked. Countersign
  // is deliberately not a blocker, so an org that can already issue must never show a
  // producer a "waiting on your admin" card that no admin action would ever clear.
  const actionable = canEditSettings || !status.canIssue;
  return { visible: actionable && !dismissed, reinvocable: actionable && dismissed };
}
