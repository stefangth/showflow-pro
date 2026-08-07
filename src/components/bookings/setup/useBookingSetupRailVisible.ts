import { useCan } from "@/hooks/useCapabilities";
import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import { useRailDismissed } from "@/components/setup/useRailDismissed";

export interface BookingSetupRailVisibility {
  /** Whether `BookingSetupRail` will render anything at all right now. */
  visible: boolean;
  /**
   * Whether the header's "Setup checklist" re-invoke button should show: `visible`'s own
   * eligibility minus the dismissed check, since re-invoking IS clearing that dismissal.
   * Computed from the same inputs as `visible` so the two can't drift the way an
   * independently-gated header button once did (Plan B fix wave). Mirrors
   * `hireOrders/setup/useSetupRailVisible`.
   */
  reinvocable: boolean;
}

const HIDDEN: BookingSetupRailVisibility = { visible: false, reinvocable: false };

/**
 * Whether `BookingSetupRail` renders anything, and whether the header re-invoke button
 * should show. Its own module rather than a second export from the rail, because
 * ShowsBookingsPage must know the answer before it picks its grid template: a null child
 * does not collapse a grid track. Mirrors `hireOrders/setup/useSetupRailVisible`.
 */
export function useBookingSetupRailVisible(orgId: string | null): BookingSetupRailVisibility {
  const canEdit = useCan("edit_booking_settings");
  const { status, isLoading } = useBookingSetupStatus(orgId);
  const [dismissed] = useRailDismissed("bookingSetup", orgId);

  if (!orgId || isLoading || status.complete) return HIDDEN;

  // A non-editor (producer without edit_booking_settings) is only shown the waiting card
  // while offers are actually blocked, so an org that can already offer never shows a
  // producer a blocker no admin action would clear.
  const actionable = canEdit || !status.canOffer;
  return { visible: actionable && !dismissed, reinvocable: actionable && dismissed };
}
