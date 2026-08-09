import { useCan } from "@/hooks/useCapabilities";
import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import type { SetupRailMode } from "@/components/setup/setupRailMode";

export interface BookingSetupRailVisibility {
  /** Which booking onboarding surface the page should show right now. */
  mode: SetupRailMode;
}

const HIDDEN: BookingSetupRailVisibility = { mode: "hidden" };

/**
 * Which booking onboarding surface to render. Mirrors
 * `hireOrders/setup/useSetupRailVisible`: "banner" wizard, "collapsed" bar,
 * permanent "button" once complete, or "hidden". `complete` is checked after the
 * actionable gate so the button only reaches viewers who can act on setup.
 */
export function useBookingSetupRailVisible(orgId: string | null): BookingSetupRailVisibility {
  const canEdit = useCan("edit_booking_settings");
  const { status, isLoading } = useBookingSetupStatus(orgId);
  const [dismissed] = useRailDismissed("bookingSetup", orgId);

  if (!orgId || isLoading) return HIDDEN;
  const actionable = canEdit || !status.canOffer;
  if (!actionable) return HIDDEN;
  if (status.complete) return { mode: "button" };
  return { mode: dismissed ? "collapsed" : "banner" };
}
