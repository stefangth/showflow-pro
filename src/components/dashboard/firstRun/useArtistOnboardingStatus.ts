import { useMyArtist } from "@/hooks/useMyArtist";
import { useMyProfile } from "@/hooks/useMyProfile";
import { useMyBlockedDatesCount } from "@/hooks/useMyBlockedDatesCount";
import { useAuth } from "@/features/auth/AuthContext";
import { useRailDismissed } from "@/components/setup/useRailDismissed";
import type { ModuleStatusLite, ModuleStepState } from "@/lib/dashboard/types";

/** Artist "personal readiness" status: block-dates readiness and notification
 *  reachability. Unlike the licensed modules (booking, hire orders), this isn't
 *  gated by an entitlement or composed via `MODULE_ONBOARDING` — every artist gets
 *  it, so it's assembled directly from the existing read hooks plus one lightweight
 *  blocked-dates count read. Account linkage is not a step: the dashboard only mounts
 *  for an already-linked artist (ArtistDashboard early-returns otherwise), so it could
 *  never be an open todo. */
export function useArtistOnboardingStatus(): {
  status: ModuleStatusLite;
  ackBlock: () => void;
  ackNotify: () => void;
  isLoading: boolean;
} {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const { data: artist, isLoading: artistLoading } = useMyArtist();
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const { data: blockedCount, isLoading: blockedLoading } = useMyBlockedDatesCount(artist?.id ?? null);
  const [blockAcked, ackBlock] = useRailDismissed("artistBlockAck", orgId);
  const [notifyAcked, ackNotify] = useRailDismissed("artistNotifyAck", orgId);

  // "done" is satisfied by either real data (the artist has already blocked
  // >= 1 date) or the ack, so a genuinely-open artist reaches complete without
  // separately dismissing the rail.
  const blockDates = (blockedCount ?? 0) > 0 || blockAcked;
  const notifications = !!profile?.phone || notifyAcked;

  const steps: ModuleStepState[] = [
    { key: "blockDates", done: blockDates, block: null },
    { key: "notifications", done: notifications, block: null },
  ];
  return {
    status: { steps, complete: steps.every((s) => s.done) },
    ackBlock,
    ackNotify,
    isLoading: artistLoading || profileLoading || blockedLoading,
  };
}
