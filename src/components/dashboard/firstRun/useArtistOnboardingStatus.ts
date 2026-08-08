import { useMyArtist } from "@/hooks/useMyArtist";
import { useMyProfile } from "@/hooks/useMyProfile";
import { useMyBlockedDatesCount } from "@/hooks/useMyBlockedDatesCount";
import type { ModuleStatusLite, ModuleStepState } from "@/lib/dashboard/types";

/** Artist "personal readiness" status: block-dates readiness and notification
 *  reachability. Unlike the licensed modules (booking, hire orders), this isn't
 *  gated by an entitlement or composed via `MODULE_ONBOARDING` — every artist gets
 *  it, so it's assembled directly from the existing read hooks plus one lightweight
 *  blocked-dates count read.
 *
 *  Both steps read as done ONLY from real data (a blocked date exists / a phone
 *  number is set). Dismissing the welcome panel collapses it but never marks a step
 *  done, so the collapsed chip keeps an honest, resumable "N steps left" nudge until
 *  the artist actually acts. Account linkage is not a step: the dashboard only mounts
 *  for an already-linked artist (ArtistDashboard early-returns otherwise), so it could
 *  never be an open todo. */
export function useArtistOnboardingStatus(): {
  status: ModuleStatusLite;
  isLoading: boolean;
} {
  const { data: artist, isLoading: artistLoading } = useMyArtist();
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const { data: blockedCount, isLoading: blockedLoading } = useMyBlockedDatesCount(artist?.id ?? null);

  const blockDates = (blockedCount ?? 0) > 0;
  const notifications = !!profile?.phone;

  const steps: ModuleStepState[] = [
    { key: "blockDates", done: blockDates, block: null },
    { key: "notifications", done: notifications, block: null },
  ];
  return {
    status: { steps, complete: steps.every((s) => s.done) },
    isLoading: artistLoading || profileLoading || blockedLoading,
  };
}
