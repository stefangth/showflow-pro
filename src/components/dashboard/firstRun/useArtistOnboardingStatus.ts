import { useMyArtist } from "@/hooks/useMyArtist";
import { useMyBlockedDatesCount } from "@/hooks/useMyBlockedDatesCount";
import { useAuth } from "@/features/auth/AuthContext";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import type { ModuleStatusLite, ModuleStepState } from "@/lib/dashboard/types";

/** Artist "personal readiness" status: a single optional step, blocking the dates you
 *  cannot play. Unlike the licensed modules (booking, hire orders), this isn't gated by
 *  an entitlement or composed via `MODULE_ONBOARDING` — every artist gets it.
 *
 *  "done" is satisfied by real data (the artist has blocked >= 1 date) OR by the artist
 *  having opened their Availability page: an open calendar (nothing to block) is a valid
 *  end state, so visiting the page counts the step as handled. That keeps the welcome
 *  panel completable for an available-for-everything artist without a skip-ack (which a
 *  casual "Later" would trip). Account linkage is a precondition, not a step; a
 *  phone/notifications step was dropped because delivery is email + in-app only, so a
 *  phone number changes nothing about offers. See AvailabilityPage, which sets the
 *  "artistVisitedAvailability" flag. */
export function useArtistOnboardingStatus(): {
  status: ModuleStatusLite;
  isLoading: boolean;
} {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const { data: artist, isLoading: artistLoading } = useMyArtist();
  const { data: blockedCount, isLoading: blockedLoading } = useMyBlockedDatesCount(artist?.id ?? null);
  const [visitedAvailability] = useRailDismissed("artistVisitedAvailability", orgId);

  const blockDates = (blockedCount ?? 0) > 0 || visitedAvailability;

  const steps: ModuleStepState[] = [
    { key: "blockDates", done: blockDates, block: null },
  ];
  return {
    status: { steps, complete: steps.every((s) => s.done) },
    isLoading: artistLoading || blockedLoading,
  };
}
