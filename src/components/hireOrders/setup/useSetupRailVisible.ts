import { useCan } from "@/hooks/useCapabilities";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useRailDismissed } from "./useRailDismissed";

/**
 * Whether `SetupRail` will render anything at all.
 *
 * Its own module rather than a second export from SetupRail.tsx, because a `null` child
 * does not collapse a grid track: the orders page has to know the answer BEFORE it picks
 * its column template, or it reserves 340px of empty space forever once setup is done.
 * The rail reads the same hook, so the rule lives in one place and cannot drift, and
 * `useRailDismissed` is a shared store so both readers see a Hide click.
 */
export function useSetupRailVisible(orgId: string | null): boolean {
  const canEditSettings = useCan("edit_hire_order_settings");
  const { status, isLoading } = useHireOrderSetupStatus(orgId);
  const [dismissed] = useRailDismissed(orgId);

  if (isLoading || dismissed || status.complete) return false;
  // A producer is only told about setup while issuing is ACTUALLY blocked. Countersign
  // is deliberately not a blocker, so an org that can already issue must never show a
  // producer a "waiting on your admin" card that no admin action would ever clear.
  return canEditSettings || !status.canIssue;
}
