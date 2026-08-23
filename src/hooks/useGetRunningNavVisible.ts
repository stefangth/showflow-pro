import { useAuth } from "@/features/auth/AuthContext";
import { useGetRunning } from "@/hooks/useGetRunning";
import { useGetRunningV3 } from "@/hooks/useGetRunningV3";
import { useGetRunningV3Enabled } from "@/hooks/useGetRunningV3Enabled";
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
 * mid-fetch only to reappear. A nothing-on org (no module entitled) has no board to set
 * up, so the item is hidden outright rather than left pointing at an undismissable
 * "nothing to set up" card.
 *
 * When the org has the v3 runtime flag on (`useGetRunningV3Enabled`), retirement is driven
 * by the v3 board's own model (`useGetRunningV3`) instead of v1's — same fields
 * (`complete`/`bookingOn`/`hireOrdersOn`), same rules, just sourced from whichever board is
 * actually live for this org. Both models are read unconditionally (rules of hooks); only
 * the selected one is consulted below, so v1 behavior stays byte-identical when v3 is off.
 *
 * `useGetRunningV3Enabled().enabled` itself defaults to the build flag while its own query
 * is still loading, so it can briefly report the wrong side for an org whose override
 * disagrees with the build default. Picking a model off a possibly-wrong flag would select
 * the wrong board's `complete`/dismissed state for that window (a v3-enabled org could
 * flash `v1Model`'s retirement verdict). So while the flag itself is loading, this hook
 * treats the model as indeterminate and fails open (visible), the same as the "model still
 * loading" case above, until the flag settles.
 */
export function useGetRunningNavVisible(): boolean {
  const { currentOrg, hasRole } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const isNonArtist = hasRole("admin") || hasRole("producer");

  const { enabled: v3Enabled, isLoading: v3EnabledLoading } = useGetRunningV3Enabled();
  // v1 is left ungated (accepted cost): a v3-enabled org pays for this v1 fan-out too even
  // though v1Model is discarded below. Gating v1 the same `active` way would mean threading
  // the option through the v1 hook, which is slated for deletion in the v1 cutover, and
  // v3-enabled orgs are few during rollout, so it is not worth the churn on retiring code.
  const { model: v1Model } = useGetRunning();
  // Gated on v3Enabled: the CI-review-bot-flagged efficiency fix. This hook is mounted by
  // AppLayout on every admin/producer route, so an unconditional useGetRunningV3() call fired
  // its whole booking/hire/skills/dates-source fan-out (plus, for an Airtable org, the ~12-query
  // useAirtableConsole) on every navigation even when v3 is off for the org (the prod default).
  // `useGetRunningV3`'s own `active` option keeps its sub-hooks from fetching when inactive
  // while still calling them (rules of hooks), so v3Model is simply null when v3 is off here.
  const { model: v3Model } = useGetRunningV3({ active: v3Enabled });
  const [dismissed] = useRailDismissed("getRunning", orgId);

  const model = v3Enabled ? v3Model : v1Model;

  if (!isNonArtist) return true;
  if (v3EnabledLoading) return true;
  if (!model) return true;
  // Nothing to set up (no module entitled) → no board, so don't advertise the item.
  if (!model.bookingOn && !model.hireOrdersOn) return false;
  return !(model.complete && dismissed);
}
