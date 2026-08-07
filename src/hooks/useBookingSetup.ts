import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchShowsWithSlots, fetchOwnedSettingKeys } from "@/data/settings";
import { fetchLadderCoverageInputs } from "@/data/eligibility";
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
  const coverage = useQuery({
    queryKey: ["eligibility", "ladder-coverage", orgId],
    enabled: !!orgId,
    queryFn: () => fetchLadderCoverageInputs(supabase, { orgId: orgId!, today: toDateKey(new Date()) }),
  });

  const isLoading = !!orgId && (owned.isLoading || shows.isLoading || coverage.isLoading);
  const isError = owned.isError || shows.isError || coverage.isError;
  const ownedSet = owned.data;
  const status = computeBookingSetupStatus({
    flowChosen: ownedSet ? ownedSet.has("booking_flow") : false,
    shows: shows.data,
    timingChosen: ownedSet ? TIMING_KEYS.every((k) => ownedSet.has(k)) : false,
    coverage: coverage.data,
  });
  return { status, coverage: coverage.data, isLoading, isError };
}
