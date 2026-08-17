import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useBookingSetupStatus, useProducerCount } from "@/hooks/useBookingSetup";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { composeGetRunning, type GetRunningInput, type GetRunningModel } from "@/lib/getRunning/tasks";

/**
 * Live-data integration hook for the `/get-running` board: gathers every read the pure
 * `composeGetRunning` composer (`@/lib/getRunning/tasks`) needs, maps them to a
 * `GetRunningInput`, and returns the resulting `GetRunningModel`.
 *
 * Gating mirrors `useDashboardFirstRun` (`src/components/dashboard/firstRun/useDashboardFirstRun.ts`):
 * a module's own setup-status read only fires when the viewer is a non-artist AND the org is
 * entitled to that module — an artist never pays for an org-setup read (this board is
 * admin/producer-only per its route's `requiredRoles`, but the gate is defensive, matching the
 * dashboard's own pattern rather than assuming the route always protects it), and an org that
 * hasn't licensed a module never pays for that module's reads either.
 *
 * `datesDone` is a Phase 1 approximation: it reads the booking setup status's own `shows` step
 * (`hasAnyShows`), not a real Airtable sync signal. A later phase refines this with the
 * Airtable console's connected+synced state (see `src/lib/getRunning/tasks.ts` header comment).
 */
export function useGetRunning(): { model: GetRunningModel | null; isLoading: boolean } {
  const { currentOrg, hasRole } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const isNonArtist = hasRole("admin") || hasRole("producer");
  const role: GetRunningInput["role"] = hasRole("admin") ? "admin" : "producer";

  const { features, isLoading: entitlementsLoading } = useEntitlements();
  const bookingOn = features.has("booking_flow");
  const hireOrdersOn = features.has("hire_orders");

  // Gate each module's readiness reads on BOTH role and the module's entitlement, same
  // plumbing as useDashboardFirstRun's bookingOrgId/hireOrgId.
  const bookingOrgId = isNonArtist && bookingOn ? orgId : null;
  const hireOrgId = isNonArtist && hireOrdersOn ? orgId : null;
  const booking = useBookingSetupStatus(bookingOrgId);
  const hire = useHireOrderSetupStatus(hireOrgId);
  // Both admin and producer viewers pay for this read: the "team" task's `done` reflects
  // whether the org has ANY producer at all, which is a fact a producer viewer needs too
  // (composeGetRunning still marks `team` adminOnly for actionability — a producer can see
  // it's done but can't invite another producer). Producers can read the org member count
  // under RLS; gating this to admins only left `producerCount` null for every producer
  // viewer, so `team.done` was permanently false and the board could never reach
  // `model.complete` for a producer.
  const producerCount = useProducerCount(orgId, isNonArtist && bookingOn);

  // A producer granted either edit_* capability can actually run the org setup, same as the
  // dashboard's own capability reads. Called unconditionally (rules of hooks).
  const canEditBooking = useCan("edit_booking_settings");
  const canEditHire = useCan("edit_hire_order_settings");
  const canAddArtists = useCan("add_artists");

  const isLoading = entitlementsLoading
    || (bookingOn && booking.isLoading)
    || (hireOrdersOn && hire.isLoading);

  if (isLoading) return { model: null, isLoading: true };

  const input: GetRunningInput = {
    role,
    bookingOn,
    hireOrdersOn,
    booking: bookingOn ? booking.status : null,
    hire: hireOrdersOn ? hire.status : null,
    // Phase 1 approximation (see header comment): the booking setup status's own `shows`
    // step, not a real Airtable sync signal.
    datesDone: bookingOn ? (booking.status.steps.find((s) => s.key === "shows")?.done ?? false) : false,
    producerCount,
    canEditBooking,
    canEditHire,
    canAddArtists,
    canInvite: role === "admin",
  };

  return { model: composeGetRunning(input), isLoading: false };
}
