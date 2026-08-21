import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchBookingCountsByDate } from "@/data/bookings";
import { fetchShowDatesList } from "@/data/showDates";
import { useDatesReadyForHireOrder } from "@/hooks/useHireOrders";
import { useBookingsWithArtist } from "@/hooks/useBookingsWithArtist";
import { toProducerEntries, type ProducerShowDateRow } from "@/lib/calendar/producerData";
import { buildNeedsYouQueue, needsYouCandidateDateIds } from "@/lib/calendar/needsYou";

/**
 * The org-wide "Needs you" total — the exact four-bucket derivation the Shows & Bookings
 * ("Dates") page surfaces (`buildNeedsYouQueue`: expires-today, at-risk, ready-to-issue,
 * cancelled-untold), packaged for the sidebar "Dates" badge so the badge and the page can
 * never diverge. It is deliberately UNFILTERED — a global "how many things need me across
 * the org" signal, not the page's search/status/program-narrowed view — so with the page's
 * default (no) filters the two are equal, and the badge stays honest while the user narrows
 * the page.
 *
 * The org-wide reads reuse the page's own query keys, so `['show-dates','list',org]`,
 * `['bookings','counts-by-date',org]` and `['hire-orders','ready',org]` dedupe with the
 * Dates page when it is also open. The `['bookings','with-artist',org,ids]` query does NOT
 * generally dedupe: its key encodes the id list, and the page's ids come from its filtered,
 * sorted view while these are the unfiltered org set — so a fetch/status change on either
 * side yields a different key. That is expected (the badge needs the unfiltered set); it is
 * just not a shared cache entry. Booking/show-date/hire-order mutations invalidate those
 * prefixes and refresh the badge.
 *
 * @param enabled     caller's gate (e.g. admin/producer with booking_flow); off → 0, no fetch.
 * @param hireOrdersOn gates the ready-to-issue bucket's data, matching the page.
 */
/** The badge derivation runs from the always-mounted sidebar on every admin/producer route,
 *  so it holds its reads longer than a page view would (5 min) to keep the per-navigation cost
 *  down. Freshness is unaffected on real changes: booking/show-date/hire-order mutations
 *  invalidate these prefixes regardless of staleTime. */
const BADGE_STALE_MS = 5 * 60_000;

export function useNeedsYouCount(args: {
  orgId: string | null;
  enabled: boolean;
  hireOrdersOn: boolean;
}): number {
  const { orgId, enabled, hireOrdersOn } = args;
  const on = !!orgId && enabled;

  const showDatesQ = useQuery({
    queryKey: ["show-dates", "list", orgId],
    enabled: on,
    staleTime: BADGE_STALE_MS,
    queryFn: () => fetchShowDatesList<ProducerShowDateRow>(supabase, orgId),
  });

  const countsQ = useQuery({
    queryKey: ["bookings", "counts-by-date", orgId],
    enabled: on,
    staleTime: BADGE_STALE_MS,
    queryFn: () => fetchBookingCountsByDate(supabase, orgId),
  });

  const readyQ = useDatesReadyForHireOrder(on && hireOrdersOn ? orgId : null, { staleTime: BADGE_STALE_MS });

  const entries = useMemo(
    () => (showDatesQ.data ? toProducerEntries(showDatesQ.data, countsQ.data, readyQ.data?.orderByDate) : []),
    [showDatesQ.data, countsQ.data, readyQ.data],
  );

  // Queue-relevant date ids, via the same shared predicate the Dates page uses
  // (`needsYouCandidateDateIds`), so the two cannot drift.
  const dateIds = useMemo(() => needsYouCandidateDateIds(entries), [entries]);

  const peopleQ = useBookingsWithArtist(on ? orgId : null, dateIds, { staleTime: BADGE_STALE_MS });

  return useMemo(() => {
    if (!on || !showDatesQ.data) return 0;
    return buildNeedsYouQueue({
      entries,
      people: peopleQ.data ?? [],
      readyIds: new Set(readyQ.data?.readyIds ?? []),
      now: new Date(),
    }).totalItems;
  }, [on, showDatesQ.data, entries, peopleQ.data, readyQ.data]);
}
