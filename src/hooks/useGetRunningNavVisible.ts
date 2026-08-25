import { useAuth } from "@/features/auth/AuthContext";
import { useGetRunningV3 } from "@/hooks/useGetRunningV3";
import { useRailDismissed } from "@/components/setup/useRailDismissed";

/**
 * Whether the "Get running" sidebar item should still show, for `AppLayout`/`navItems`.
 *
 * An artist never has a board to retire (the route itself is admin/producer-only, and
 * `NAV_ITEMS`'s own `roles` gate already drops this item for an artist before this hook
 * is ever consulted), so that case returns `true` without reading anything further.
 *
 * For a non-artist, this composes the same `useGetRunningV3()` the board itself renders
 * from and the same `useRailDismissed("getRunning", orgId)` every other setup rail uses
 * for its own per-person "Hide" — deliberately NOT re-derived inline in `AppLayout`
 * (which mounts on every route) so that composition stays owned in one place.
 * `useGetRunningV3` already gates its own heavy reads on role + each module's entitlement
 * (see its own docstring), so this hook pays for nothing extra beyond what a non-artist
 * viewer at a booking_flow-or-hire_orders org was already going to pay for the moment
 * they open the Get running board themselves, even though it now mounts on every
 * admin/producer route to decide the sidebar item's visibility.
 *
 * Fails open (visible) while `model` is still loading, so the item never blinks away
 * mid-fetch only to reappear. A nothing-on org (no module entitled) has no board to set
 * up, so the item is hidden outright rather than left pointing at an undismissable
 * "nothing to set up" card.
 */
export function useGetRunningNavVisible(): boolean {
  const { currentOrg, hasRole } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const isNonArtist = hasRole("admin") || hasRole("producer");
  const { model } = useGetRunningV3();
  const [dismissed] = useRailDismissed("getRunning", orgId);

  if (!isNonArtist) return true;
  if (!model) return true; // fail open while loading
  // Nothing to set up (no module entitled) → no board, so don't advertise the item.
  if (!model.bookingOn && !model.hireOrdersOn) return false;
  return !(model.complete && dismissed);
}
