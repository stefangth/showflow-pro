import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchShowsWithSlots, fetchOwnedSettingKeys, fetchBookingFlow } from "@/data/settings";
import { fetchLadderCoverageInputs } from "@/data/eligibility";
import { fetchArtistCount } from "@/data/artists";
import { fetchProducerCount } from "@/data/members";
import { activeShows } from "@/lib/settings";
import { toDateKey } from "@/lib/dates";
import {
  computeBookingSetupStatus,
  type BookingSetupStatus,
  type LadderCoverageInputs,
} from "@/lib/bookings/setupStatus";

const TIMING_KEYS = [
  "offer_response_window_hours",
  "offer_digest_hour_berlin",
  "confirmation_digest_hour_berlin",
] as const;
const OWNED_KEYS = ["booking_flow", ...TIMING_KEYS] as const;

/** Org-level booking-setup readiness for the rail: three org-scoped reads composed
 *  through the pure `computeBookingSetupStatus`. Every read failing/loading reports its
 *  step outstanding rather than done. */
export function useBookingSetupStatus(orgId: string | null): {
  status: BookingSetupStatus;
  coverage: LadderCoverageInputs | undefined;
  /** ACTIVE roster size for the people panel (fetchArtistCount filters status = 'active',
   *  matching the offer engine); null while unread (loading or failed). */
  artistCount: number | null;
  isLoading: boolean;
  isError: boolean;
} {
  const owned = useQuery({
    queryKey: ["app-settings", "owned-keys", orgId],
    enabled: !!orgId,
    queryFn: () => fetchOwnedSettingKeys(supabase, orgId, OWNED_KEYS),
  });
  const shows = useQuery({
    queryKey: ["shows", "with-slots", orgId],
    enabled: !!orgId,
    queryFn: () => fetchShowsWithSlots(supabase, orgId),
  });
  // Fold the date cutoff into the key so a tab left open past midnight refetches instead of
  // serving coverage computed against yesterday's "today".
  const today = toDateKey(new Date());
  const coverage = useQuery({
    queryKey: ["eligibility", "ladder-coverage", orgId, today],
    enabled: !!orgId,
    queryFn: () => fetchLadderCoverageInputs(supabase, { orgId: orgId!, today }),
  });
  const flow = useQuery({
    queryKey: ["app-settings", "booking-flow", orgId],
    enabled: !!orgId,
    queryFn: () => fetchBookingFlow(supabase, orgId),
  });
  const artists = useQuery({
    queryKey: ["artists", "count", orgId],
    enabled: !!orgId,
    queryFn: () => fetchArtistCount(supabase, orgId!),
  });
  const isLoading = !!orgId
    && (owned.isLoading || shows.isLoading || coverage.isLoading || flow.isLoading || artists.isLoading);
  const isError = owned.isError || shows.isError || coverage.isError || flow.isError || artists.isError;
  const ownedSet = owned.data;
  const status = computeBookingSetupStatus({
    // The org must own its own booking_flow row AND have that flow currently active
    // (inheriting the classic default, or an inactive flow, is not a choice).
    flowChosen: ownedSet ? ownedSet.has("booking_flow") && flow.data?.active === true : false,
    // Any show of any status (active/archived/draft) marks the org as "not blank"; the raw
    // shows.data is unfiltered, unlike the activeShows() slice passed as `shows` below.
    hasAnyShows: Array.isArray(shows.data) && shows.data.length > 0,
    // Only active shows are counted (the spec: "every active show") — an archived or draft
    // show with unset slots must never keep this step outstanding. `activeShows` preserves
    // undefined while shows.data hasn't loaded yet, preserving the fail-safe.
    shows: activeShows(shows.data),
    timingChosen: ownedSet ? TIMING_KEYS.every((k) => ownedSet.has(k)) : false,
    coverage: coverage.data,
    // `?? null` covers both loading and a failed read, and the engine treats null as an
    // empty roster, so an unread count reports the step outstanding rather than done.
    artistCount: artists.data ?? null,
    // The SAME flow read as `flowChosen` above, used for a different question: not whether
    // the org chose a flow, but which one it runs. A direct-book org never opens a tier, so
    // its blockers must not be worded as offers, and the cast ladder is not one of its
    // blockers at all (nothing it runs reads a ranking). `null` until the read lands
    // (fetchBookingFlow always resolves to a normalized flow, so undefined means "not read
    // yet"), and every consumer gates on the `isLoading` returned below before reading
    // `canOffer`.
    artistAcceptance: flow.data ? flow.data.artist_acceptance : null,
  });
  return {
    status,
    coverage: coverage.data,
    artistCount: artists.data ?? null,
    isLoading,
    isError,
  };
}

/** Producer-role member count, backing the "Add your production team" task. Its own hook
 *  (not folded into useBookingSetupStatus) so only surfaces that need it pay for the read.
 *  `enabled` is the caller's gate: the Get running board reads it for admins AND producers
 *  (so a producer's `team` task reflects reality), not just admin surfaces. Null while unread. */
export function useProducerCount(orgId: string | null, enabled: boolean): number | null {
  const q = useQuery({
    queryKey: ["members", "producer-count", orgId],
    enabled: !!orgId && enabled,
    queryFn: () => fetchProducerCount(supabase, orgId!),
  });
  return q.data ?? null;
}
