import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useMyArtist } from "@/hooks/useMyArtist";
import { useFeature } from "@/hooks/useEntitlements";
import { useHireOrders, useMyHireOrders } from "@/hooks/useHireOrders";
import { useArtistEligibleDates } from "@/hooks/useArtistEligibleDates";
import { useMyBlockedDatesCount } from "@/hooks/useMyBlockedDatesCount";
import { useNavCounts } from "@/hooks/useNavCounts";
import { useFlowTimes } from "@/hooks/useBookingFlow";
import { fetchUpcomingShowDates } from "@/data/showDates";
import { fetchConfirmedBookingsLite, fetchOpenedTier1DateIds } from "@/data/bookings";
import { fetchLadderCoverageInputs } from "@/data/eligibility";
import { resolveCoverage } from "@/lib/bookings/setupStatus";
import { unfilledMainCastDates } from "@/lib/bookingCockpit";
import { countReadyToOffer, type ReadyDateInput } from "@/lib/bookings/readyToOffer";
import { toDateKey } from "@/lib/dates";
import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";
import type { FirstRunMetrics, FirstRunRole, FirstRunTiming } from "@/lib/dashboard/stageChain.types";

/** Row shape for the one org-wide upcoming-dates read this hook needs: enough to
 *  count dates (datesIn), derive the ready-to-offer inputs (session/slots/city),
 *  AND derive the direct-book "bookable now" count (unfilledMainCastDates), all from
 *  a single query instead of three. */
interface FirstRunDateRow {
  id: string;
  date: string;
  show_id: string;
  city_id: string | null;
  session_1: string | null;
  session_2: string | null;
  session_3: string | null;
  show: { program: string | null; sub_program: string | null; main_cast_slots: number | null } | null;
}

const UPCOMING_DATE_COLS =
  "id, date, show_id, city_id, session_1, session_2, session_3, show:shows(program, sub_program, main_cast_slots)";

// Widened to `number` (not the `as const` literal-0 shape) so `orgMetrics`/`artistMetrics`
// below can be reassigned to a real computed count, not just re-assigned the literal 0.
const ZERO_ORG_METRICS: Pick<FirstRunMetrics, "datesIn" | "readyToOffer" | "bookableDates" | "confirmed" | "hireDrafts"> =
  { datesIn: 0, readyToOffer: 0, bookableDates: 0, confirmed: 0, hireDrafts: 0 };
const ZERO_ARTIST_METRICS: Pick<FirstRunMetrics, "eligibleDates" | "blockedDates" | "arriving" | "toSign"> =
  { eligibleDates: 0, blockedDates: 0, arriving: 0, toSign: 0 };

/**
 * Assembles the live `FirstRunMetrics` + `FirstRunTiming` the stage-chain composer
 * (`composeStageChain`, src/lib/dashboard/stageChain.ts) consumes, from existing
 * domain hooks plus the `readyToOffer` aggregate (src/lib/bookings/readyToOffer.ts).
 *
 * Every hook below is called unconditionally (rules of hooks); only each QUERY's
 * `enabled` (for the reads this file owns directly, and for the two existing hooks
 * that accept an id parameter — `useHireOrders`, `useMyBlockedDatesCount`) and the
 * final metrics object (for the hooks that have no injectable `enabled`, e.g.
 * `useArtistEligibleDates`, `useNavCounts`, `useMyHireOrders` — each already gates
 * itself on an artist/org id it reads internally) are gated by `role`. This mirrors
 * how `useDashboardFirstRun` gates its own reads.
 */
export function useFirstRunMetrics(role: FirstRunRole): {
  metrics: FirstRunMetrics;
  timing: FirstRunTiming;
  isLoading: boolean;
} {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const { data: artist } = useMyArtist();
  const artistId = artist?.id ?? null;

  const isOrgRole = role === "admin" || role === "producer";
  const isArtist = role === "artist";

  const today = toDateKey(new Date());

  // ---- Org-scoped reads (admin/producer only). Reuses the exact query keys
  // DashboardPage/useBookingSetupStatus already use for the shared reads, so the
  // cache is shared rather than duplicated when both are mounted. ----
  const upcomingQ = useQuery({
    queryKey: ["dashboard-upcoming-dates", today, orgId],
    enabled: isOrgRole && !!orgId,
    queryFn: () => fetchUpcomingShowDates<FirstRunDateRow>(supabase, orgId, today, UPCOMING_DATE_COLS),
  });

  const confirmedQ = useQuery({
    queryKey: ["bookings", "confirmed-dashboard", orgId],
    enabled: isOrgRole && !!orgId,
    queryFn: () => fetchConfirmedBookingsLite(supabase, orgId),
  });

  const openedTier1Q = useQuery({
    queryKey: ["offer-tiers", "opened-tier1", orgId],
    enabled: isOrgRole && !!orgId,
    queryFn: () => fetchOpenedTier1DateIds(supabase, orgId!),
  });

  const coverageQ = useQuery({
    queryKey: ["eligibility", "ladder-coverage", orgId, today],
    enabled: isOrgRole && !!orgId,
    queryFn: () => fetchLadderCoverageInputs(supabase, { orgId: orgId!, today }),
  });

  const hireEntitled = useFeature("hire_orders");
  // hireDrafts is an org-wide (admin/producer) count; gate the id itself (not just a
  // post-hoc zero-fill) so an org without the hire_orders entitlement never pays for
  // the read at all — same "null id disables the query" pattern useDashboardFirstRun
  // uses for its own hireOrgId.
  const hireOrgId = isOrgRole && hireEntitled ? orgId : null;
  const draftHireOrders = useHireOrders(hireOrgId, { status: ["draft"] });

  // ---- Artist-scoped reads. Each is already internally gated on the artist id it
  // reads itself (useMyArtist), except useMyBlockedDatesCount, which takes the id as
  // a param — gated here so a non-artist role never fires it. ----
  const eligibleDatesQ = useArtistEligibleDates();
  const blockedDatesQ = useMyBlockedDatesCount(isArtist ? artistId : null);
  const navCounts = useNavCounts();
  const myHireOrdersQ = useMyHireOrders();

  // ---- Timing: org-level for every role (artists receive the digest + carry the
  // response window too), org override -> platform default -> BOOKING_ENGINE_DEFAULTS. ----
  const timingQ = useFlowTimes(orgId);
  const timing: FirstRunTiming = {
    digestHourBerlin: timingQ.data?.offerDigestHour ?? BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin,
    responseWindowHours: timingQ.data?.windowHours ?? BOOKING_ENGINE_DEFAULTS.offer_response_window_hours,
  };

  let orgMetrics: typeof ZERO_ORG_METRICS = ZERO_ORG_METRICS;
  if (isOrgRole) {
    const dates = upcomingQ.data ?? [];
    const confirmedRows = confirmedQ.data ?? [];

    const confirmedMainByDate = new Map<string, number>();
    for (const b of confirmedRows) {
      if (!b.is_understudy) confirmedMainByDate.set(b.show_date_id, (confirmedMainByDate.get(b.show_date_id) ?? 0) + 1);
    }

    // The `resolveCoverage`/`fetchLadderCoverageInputs` pair useBookingSetup.ts already
    // uses for the setup rail's ladder step — same predicate, so an org's "ready to
    // offer" count and its setup-rail coverage gap can never disagree.
    //
    // A null city is never "covered": `resolveCoverage` routes cityless future pairs
    // into `hasNullCity` rather than `uncoveredPairs` (there's no (show, city) pair to
    // rank a ladder for), so treating "not in uncoveredPairs" as covered would silently
    // count a cityless date as ready. It can never actually open tier 1 —
    // open-offer-tier bails on exactly this case ("Show date has no city, cannot
    // resolve priority casts") — so the metric would overclaim without this guard.
    const coverage = coverageQ.data ? resolveCoverage(coverageQ.data) : null;
    const coveredShowCity = (showId: string, cityId: string | null): boolean => {
      if (cityId === null) return false;
      return !coverage || !coverage.uncoveredPairs.some((p) => p.showId === showId && p.cityId === cityId);
    };

    const readyInputs: ReadyDateInput[] = dates.map((d) => ({
      id: d.id,
      showId: d.show_id,
      cityId: d.city_id,
      hasSession: !!(d.session_1 || d.session_2 || d.session_3),
      // Intentionally stricter than computeBookingSetupStatus's own "slots done" check
      // (setupStatus.ts: `main_cast_slots != null`, understudy_slots included). "Ready
      // to offer" additionally requires `> 0`: a date with 0 main cast slots satisfies
      // the setup-status step (a number is configured) but can never actually open a
      // tier-1 offer, since there is nothing to fill. Do not loosen this to `!= null`
      // to "match" the setup step — the setup step is deliberately more permissive.
      slotsSet: d.show?.main_cast_slots != null && d.show.main_cast_slots > 0,
    }));

    // The direct-book analog of readyToOffer: dates whose main cast isn't fully
    // confirmed yet. Same helper (and the same upcoming-dates + confirmed-bookings
    // reads) DashboardPage's direct-mode section already uses for `directItems`.
    const bookable = unfilledMainCastDates(
      dates.map((d) => ({
        id: d.id,
        date: d.date,
        program: d.show?.program ?? null,
        subProgram: d.show?.sub_program ?? null,
        mainSlots: d.show?.main_cast_slots ?? null,
      })),
      confirmedMainByDate,
    );

    orgMetrics = {
      datesIn: dates.length,
      readyToOffer: countReadyToOffer(readyInputs, coveredShowCity, new Set(openedTier1Q.data ?? [])),
      bookableDates: bookable.length,
      confirmed: confirmedRows.length,
      hireDrafts: draftHireOrders.data?.length ?? 0,
    };
  }

  let artistMetrics: typeof ZERO_ARTIST_METRICS = ZERO_ARTIST_METRICS;
  if (isArtist) {
    artistMetrics = {
      eligibleDates: eligibleDatesQ.data?.length ?? 0,
      blockedDates: blockedDatesQ.data ?? 0,
      arriving: navCounts.openOffers,
      toSign: myHireOrdersQ.data?.filter((o) => o.status === "issued").length ?? 0,
    };
  }

  const metrics: FirstRunMetrics = { ...orgMetrics, ...artistMetrics };

  const isLoading = isOrgRole
    ? upcomingQ.isLoading || confirmedQ.isLoading || openedTier1Q.isLoading || coverageQ.isLoading || draftHireOrders.isLoading
    : isArtist
      ? eligibleDatesQ.isLoading || blockedDatesQ.isLoading || myHireOrdersQ.isLoading
      : false;

  return { metrics, timing, isLoading };
}
