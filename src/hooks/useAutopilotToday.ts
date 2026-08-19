import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { berlinDateKey, dfLocale } from "@/lib/dates";
import { computeTierAttention } from "@/lib/bookingCockpit";
import { BOOKING_FLOW_DEFAULTS, hh, type FlowTimes } from "@/lib/bookingFlow";
import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";
import { fetchTierAttention } from "@/data/bookings";
import { useBookingFlow, useFlowTimes } from "@/hooks/useBookingFlow";
import {
  fetchAtRiskDateFacts,
  fetchAutopilotFeed,
  fetchBouncedAsks,
  fetchCancelledUntoldDates,
} from "@/data/autopilot";
import { computeToday, type TodayModel } from "@/lib/autopilot/today";

const DEFAULT_FLOW_TIMES: FlowTimes = {
  windowHours: BOOKING_ENGINE_DEFAULTS.offer_response_window_hours,
  offerDigestHour: BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin,
  confirmationDigestHour: BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin,
};

/** The most recent weekday before `now` (skips Sat/Sun) — the feed's
 *  "since" lookback boundary. A cosmetic cutoff (what shows in the "Done for
 *  you since {{day}}" header and how far back `fetchAutopilotFeed` looks),
 *  not a billing/legal boundary, so plain local calendar-day arithmetic is
 *  fine here unlike the booking engine's own Berlin-anchored cutoffs. */
function previousBusinessDay(now: Date): Date {
  let d = subDays(now, 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d = subDays(d, 1);
  }
  return d;
}

export interface UseAutopilotTodayResult {
  model: TodayModel | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  /** "19:00" — the org's offer digest hour, formatted. */
  askTimeLabel: string;
  /** Weekday the feed's lookback window starts, e.g. "Friday". */
  feedSinceLabel: string;
  refetch: () => void;
}

/**
 * Composes the `src/data/autopilot.ts` reads (+ `fetchTierAttention` from
 * `src/data/bookings.ts`) into a single `TodayModel` via the pure
 * `computeToday` (`src/lib/autopilot/today.ts`). Read-only — no mutations,
 * see `TodayContainer` in `src/components/today/TodayPage.tsx` for those.
 *
 * `fillingOnTheirOwn` and `bookedOvernight` are not among `computeToday`'s
 * derived outputs (its `TodayInput` takes them as bare passthrough numbers),
 * and no Task 3 fetcher supplies them either. Rather than add a new
 * data-access query outside this task's authorized scope, both are
 * approximated from data already fetched here:
 *  - `fillingOnTheirOwn` = dates with an open offer tier, minus the ones
 *    flagged at-risk — i.e. tiers quietly filling on their own. Not a full
 *    season count (that needs a fetcher this task doesn't add).
 *  - `bookedOvernight` = count of "book"-kind feed rows (dates with an
 *    overnight acceptance), not a per-artist count — `FeedInput.text` bakes
 *    artist names into an opaque string, so an exact artist count isn't
 *    available without parsing it.
 * Both are flagged in the task report as approximations, not exact figures.
 */
export interface UseAutopilotTodayOptions {
  /**
   * Whether the query should run at all. Defaults to true. The `booking_flow`
   * module gate (see `TodayContainer` in `src/components/today/TodayPage.tsx`)
   * passes its resolved `allow` here so a org without the entitlement never
   * fires these booking-derived reads in the first place — mirroring
   * `ModuleGate`'s "don't mount children whose queries can't be acted on".
   */
  enabled?: boolean;
}

export function useAutopilotToday(options?: UseAutopilotTodayOptions): UseAutopilotTodayResult {
  const enabled = options?.enabled ?? true;
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const flowQ = useBookingFlow();
  const timesQ = useFlowTimes(orgId);
  const flow = flowQ.data ?? BOOKING_FLOW_DEFAULTS;
  const times = timesQ.data ?? DEFAULT_FLOW_TIMES;

  const modelQ = useQuery({
    queryKey: ["autopilot", "today", orgId, flow.offer_delivery, times.offerDigestHour, times.confirmationDigestHour],
    enabled: !!orgId && enabled,
    queryFn: async (): Promise<TodayModel> => {
      const now = new Date();
      const today = berlinDateKey(now);
      const since = previousBusinessDay(now).toISOString();

      const [tierAttentionRows, cancelledUntold, bounced, feed] = await Promise.all([
        fetchTierAttention(supabase, { orgId, today }),
        fetchCancelledUntoldDates(supabase, { orgId, today }),
        fetchBouncedAsks(supabase, { orgId, today }),
        fetchAutopilotFeed(supabase, { orgId, since }),
      ]);

      const atRiskShowDateIds = Array.from(
        new Set(computeTierAttention(tierAttentionRows, now).map((a) => a.showDateId)),
      );
      const atRiskFacts = await fetchAtRiskDateFacts(supabase, { orgId, showDateIds: atRiskShowDateIds });

      const model = computeToday(
        {
          tierAttention: tierAttentionRows,
          atRiskFacts,
          cancelledUntold,
          bounced,
          feed,
          flow,
          times,
          fillingOnTheirOwn: 0,
          bookedOvernight: 0,
        },
        now,
      );

      const distinctOpenTierDates = new Set(tierAttentionRows.map((r) => r.showDateId));
      const fillingOnTheirOwn = Math.max(0, distinctOpenTierDates.size - atRiskShowDateIds.length);
      const bookedOvernight = feed.filter((row) => row.kind === "book").length;

      return { ...model, fillingOnTheirOwn, bookedOvernight };
    },
  });

  return {
    model: modelQ.data,
    isLoading: modelQ.isLoading || flowQ.isLoading || timesQ.isLoading,
    isError: modelQ.isError,
    error: modelQ.error,
    askTimeLabel: hh(times.offerDigestHour),
    feedSinceLabel: format(previousBusinessDay(new Date()), "EEEE", { locale: dfLocale() }),
    refetch: () => void modelQ.refetch(),
  };
}
