import { useCan } from "@/hooks/useCapabilities";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import type { SetupRailMode } from "@/components/setup/setupRailMode";

export interface SetupRailVisibility {
  /** Which hire-order onboarding surface the page should show right now. */
  mode: SetupRailMode;
}

const HIDDEN: SetupRailVisibility = { mode: "hidden" };

/**
 * Which hire-order onboarding surface to render: the full "banner" wizard, the
 * "collapsed" progress bar it hides into, the permanent "button" once setup is
 * complete, or "hidden". Completion (`status.complete`) is derived live; the
 * collapsed-vs-expanded choice is the localStorage dismissal from useRailDismissed,
 * a shared store so a Hide/Resume updates every reader at once.
 *
 * `complete` is checked after the actionable gate so the permanent button only
 * reaches viewers who can act on setup: once complete, `canIssue` is true, so
 * `actionable` reduces to `canEditSettings`.
 */
export function useSetupRailVisible(orgId: string | null): SetupRailVisibility {
  const canEditSettings = useCan("edit_hire_order_settings");
  const { status, isLoading } = useHireOrderSetupStatus(orgId);
  const [dismissed] = useRailDismissed("hireOrderSetup", orgId);

  if (!orgId || isLoading) return HIDDEN;
  const actionable = canEditSettings || !status.canIssue;
  if (!actionable) return HIDDEN;
  if (status.complete) return { mode: "button" };
  return { mode: dismissed ? "collapsed" : "banner" };
}
