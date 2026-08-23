import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useBookingSetupStatus, useProducerCount } from "@/hooks/useBookingSetup";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useSkills } from "@/hooks/useSkills";
import { composeGetRunningV3, type GetRunningInputV3, type GetRunningModelV3 } from "@/lib/getRunning/steps";

/**
 * Live-data integration hook for the Wireflow v3 `/get-running` board: gathers every read
 * the pure `composeGetRunningV3` composer (`@/lib/getRunning/steps`) needs, maps them to a
 * `GetRunningInputV3`, and returns the resulting `GetRunningModelV3`.
 *
 * Mirrors `useGetRunning` (`src/hooks/useGetRunning.ts`, the v1 board's integration hook)
 * hook-for-hook and gate-for-gate — see that file's header comment for the rationale behind
 * the role/entitlement gating and the `datesDone` Phase-1 approximation. This hook is
 * intentionally independent of v1: it does not import from `@/lib/getRunning/tasks`, so v1
 * stays byte-stable while this board evolves.
 *
 * Three inputs have no real signal yet in Phase 1: `skillsDone` uses a cheap best-effort
 * read (the org's skill catalog is non-empty) rather than a new query; `feeDone` and
 * `documentDone` are hardcoded false until later phases wire their real signals.
 */
export function useGetRunningV3(): { model: GetRunningModelV3 | null; isLoading: boolean } {
  const { currentOrg, hasRole } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const isNonArtist = hasRole("admin") || hasRole("producer");
  const role: GetRunningInputV3["role"] = hasRole("admin") ? "admin" : "producer";

  const { features, isLoading: entitlementsLoading } = useEntitlements();
  const bookingOn = features.has("booking_flow");
  const hireOrdersOn = features.has("hire_orders");

  // Gate each module's readiness reads on BOTH role and the module's entitlement, same
  // plumbing as v1's useGetRunning / useDashboardFirstRun.
  const bookingOrgId = isNonArtist && bookingOn ? orgId : null;
  const hireOrgId = isNonArtist && hireOrdersOn ? orgId : null;
  const booking = useBookingSetupStatus(bookingOrgId);
  const hire = useHireOrderSetupStatus(hireOrgId);
  const producerCount = useProducerCount(orgId, isNonArtist && bookingOn);

  // Cheap best-effort signal for the `skills` step: the org's skill catalog is non-empty.
  // Only fired for a non-artist viewer in a booking-entitled org, same gating shape as the
  // other booking-module reads above.
  const skills = useSkills({ enabled: isNonArtist && bookingOn });

  // Called unconditionally (rules of hooks), same as v1.
  const canManageShows = useCan("manage_productions");
  const canEditScheduling = useCan("edit_scheduling");
  const canEditBooking = useCan("edit_booking_settings");
  const canEditHire = useCan("edit_hire_order_settings");
  const canAddArtists = useCan("add_artists");

  const isLoading = entitlementsLoading
    || (bookingOn && booking.isLoading)
    || (hireOrdersOn && hire.isLoading);

  if (isLoading) return { model: null, isLoading: true };

  const input: GetRunningInputV3 = {
    role,
    bookingOn,
    hireOrdersOn,
    booking: bookingOn ? booking.status : null,
    hire: hireOrdersOn ? hire.status : null,
    // Phase 1 approximation (see header comment): the booking setup status's own `shows`
    // step, not a real Airtable sync signal.
    datesDone: bookingOn ? (booking.status.steps.find((s) => s.key === "shows")?.done ?? false) : false,
    producerCount,
    // Phase 1 placeholder: non-empty skill catalog. Defaults to false while the read is
    // outstanding or the module is off, rather than blocking the whole board on it.
    skillsDone: bookingOn ? (skills.data?.length ?? 0) > 0 : false,
    feeDone: false,
    documentDone: false,
    canManageShows,
    canEditScheduling,
    canEditBooking,
    canEditHire,
    canAddArtists,
    canInvite: role === "admin",
  };

  return { model: composeGetRunningV3(input), isLoading: false };
}
