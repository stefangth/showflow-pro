import { useAuth } from "@/features/auth/AuthContext";
import { useGetRunning } from "@/hooks/useGetRunning";
import { useRailDismissed } from "@/components/setup/useRailDismissed";

/**
 * Whether the "Get running" sidebar item should still show, for `AppLayout`/`navItems`.
 *
 * An artist never has a board to retire (the route itself is admin/producer-only, and
 * `NAV_ITEMS`'s own `roles` gate already drops this item for an artist before this hook
 * is ever consulted), so that case returns `true` without reading anything further.
 *
 * For a non-artist, this composes the same `useGetRunning()` the board itself renders
 * from and the same `useRailDismissed("getRunning", orgId)` every other setup rail uses
 * for its own per-person "Hide" — deliberately NOT re-derived inline in `AppLayout`
 * (which mounts on every route) so that ~40-line composition stays owned in one place.
 * `useGetRunning` already gates its own heavy reads on role + each module's entitlement
 * (see its own docstring), so this hook pays for nothing extra beyond what a non-artist
 * viewer at a booking_flow-or-hire_orders org was already going to pay for the moment
 * they open the Dashboard or the Get running board themselves — this just lets the
 * sidebar read the same answer.
 *
 * Fails open (visible) while `model` is still loading, so the item never blinks away
 * mid-fetch only to reappear.
 */
export function useGetRunningNavVisible(): boolean {
  const { currentOrg, hasRole } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const isNonArtist = hasRole("admin") || hasRole("producer");

  const { model } = useGetRunning();
  const [dismissed] = useRailDismissed("getRunning", orgId);

  if (!isNonArtist) return true;
  if (!model) return true;
  return !(model.complete && dismissed);
}
