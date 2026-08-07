import { useCan } from "@/hooks/useCapabilities";
import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import { useRailDismissed } from "@/components/setup/useRailDismissed";

/**
 * Whether `BookingSetupRail` renders anything. Its own module rather than a second export
 * from the rail, because ShowsBookingsPage must know the answer before it picks its grid
 * template: a null child does not collapse a grid track. Mirrors
 * `hireOrders/setup/useSetupRailVisible`.
 */
export function useBookingSetupRailVisible(orgId: string | null): boolean {
  const canEdit = useCan("edit_booking_settings");
  const { status, isLoading } = useBookingSetupStatus(orgId);
  const [dismissed] = useRailDismissed("bookingSetup", orgId);

  if (!orgId) return false;
  if (isLoading || dismissed || status.complete) return false;
  // A non-editor (producer without edit_booking_settings) is only shown the waiting card
  // while offers are actually blocked, so an org that can already offer never shows a
  // producer a blocker no admin action would clear.
  return canEdit || !status.canOffer;
}
