import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { toDateKey } from "@/lib/dates";

// This hook composes MANY existing hooks that each import the `supabase` singleton
// directly (useHireOrders, useMyHireOrders, useArtistEligibleDates,
// useMyBlockedDatesCount, useNavCounts, useFlowTimes, plus the reads this file owns
// itself), rather than taking a client as a parameter — so there is no clean seam to
// hand them a `createFakeSupabase()` fake without hand-rolling a
// `vi.mock('@/integrations/supabase/client')` chain, which this project avoids (see
// useBookingFlowProvenance.test.tsx for the same call on a smaller composed hook).
// Instead we mock only the two identity sources (`useAuth`, `useMyArtist`) and the
// entitlement gate (`useFeature`), and seed the EXACT query keys every real
// downstream read resolves to directly into the QueryClient, with
// `staleTime: Infinity` / `gcTime: Infinity` so a fresh mount never triggers a
// background refetch against the (unmocked) real client.
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: vi.fn() }));
vi.mock("@/hooks/useEntitlements", () => ({ useFeature: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { useMyArtist } from "@/hooks/useMyArtist";
import { useFeature } from "@/hooks/useEntitlements";
import { useFirstRunMetrics } from "./useFirstRunMetrics";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
}

const ORG_ID = "org-1";
const ARTIST_ID = "artist-1";

describe("useFirstRunMetrics", () => {
  it("admin/producer: assembles org metrics from seeded reads, zero-fills artist metrics", () => {
    const queryClient = makeQueryClient();
    const today = toDateKey(new Date());

    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: ORG_ID, name: "Test Org" },
      hasRole: (r: string) => r === "admin",
    } as never);
    // Admin has no linked artist row — every artist-scoped read this hook and its
    // downstream hooks (useArtistEligibleDates, useMyHireOrders, useNavCounts'
    // offers query) resolve internally has no id to key on.
    vi.mocked(useMyArtist).mockReturnValue({ data: undefined } as never);
    vi.mocked(useFeature).mockImplementation(() => true);

    // ---- Seed exactly the query keys the ADMIN-role read set fires. ----
    queryClient.setQueryData(["first-run", "upcoming-dates", today, ORG_ID], [
      { id: "d1", date: "2026-09-01", show_id: "show-1", city_id: "city-1", session_1: "19:00", session_2: null, session_3: null, show: { program: "Cabaret", sub_program: null, main_cast_slots: 4 } },
      { id: "d2", date: "2026-09-02", show_id: "show-1", city_id: "city-1", session_1: "19:00", session_2: null, session_3: null, show: { program: "Cabaret", sub_program: null, main_cast_slots: 4 } },
      { id: "d3", date: "2026-09-03", show_id: "show-2", city_id: null, session_1: null, session_2: null, session_3: null, show: { program: "Revue", sub_program: null, main_cast_slots: null } },
    ]);
    queryClient.setQueryData(["bookings", "confirmed-dashboard", ORG_ID], [
      { show_date_id: "d1", status: "confirmed", is_understudy: false },
      { show_date_id: "d1", status: "confirmed", is_understudy: false },
      { show_date_id: "d2", status: "confirmed", is_understudy: true },
      { show_date_id: "d3", status: "confirmed", is_understudy: false },
    ]);
    // d2 already has tier 1 opened — excludes it from readyToOffer even though it
    // otherwise qualifies (session set, slots set).
    queryClient.setQueryData(["offer-tiers", "opened-tier1", ORG_ID], ["d2"]);
    // Empty coverage inputs -> resolveCoverage reports no uncovered pairs, so
    // coveredShowCity is trivially true for every (show, city).
    queryClient.setQueryData(["eligibility", "ladder-coverage", ORG_ID, today], {
      futurePairs: [], showPriorities: [], cityPriorities: [], nonEmptyCastIds: [],
    });
    queryClient.setQueryData(["hire-orders", "list", ORG_ID, { status: ["draft"] }], [
      { id: "ho1", status: "draft" },
      { id: "ho2", status: "draft" },
    ]);
    // useNavCounts' pending/awaiting-count queries fire for an org role; their
    // values don't feed FirstRunMetrics, they just must not hit the real client.
    queryClient.setQueryData(["bookings", "nav-pending-confirmations", ORG_ID], 0);
    queryClient.setQueryData(["hire-orders", "awaiting-count", ORG_ID], 0);
    queryClient.setQueryData(["app-settings", "flow-times", ORG_ID], {
      windowHours: 72, offerDigestHour: 21, confirmationDigestHour: 22,
    });

    const { result } = renderHookWithProviders(() => useFirstRunMetrics("admin"), { queryClient });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.metrics.datesIn).toBe(3);
    expect(result.current.metrics.confirmed).toBe(4);
    expect(result.current.metrics.hireDrafts).toBe(2);
    // d1 qualifies (session + slots + covered + not opened); d2 is excluded because
    // tier 1 is already opened; d3 is excluded because it has no session. Not
    // exhaustively re-testing the coverage math here (that's readyToOffer.test.ts) —
    // just confirming the wiring produces a real, non-negative count.
    expect(result.current.metrics.readyToOffer).toBe(1);
    expect(result.current.metrics.bookableDates).toBeGreaterThanOrEqual(0);
    // Artist-only metrics stay zero for an org role, even though nothing in this
    // scenario seeded their query keys.
    expect(result.current.metrics.eligibleDates).toBe(0);
    expect(result.current.metrics.blockedDates).toBe(0);
    expect(result.current.metrics.arriving).toBe(0);
    expect(result.current.metrics.toSign).toBe(0);
    // Timing reads the org's own override, not the code fallback.
    expect(result.current.timing).toEqual({ digestHourBerlin: 21, responseWindowHours: 72 });
  });

  it("excludes a null-city date from readyToOffer even with a session and slots set (regression)", () => {
    // resolveCoverage routes a cityless future pair into `hasNullCity`, never into
    // `uncoveredPairs` — so "not in uncoveredPairs" alone reads as "covered" for a
    // null-city date. But open-offer-tier bails on exactly that case ("Show date has
    // no city, cannot resolve priority casts"): tier 1 can never actually open for it.
    // The date below is ready in every OTHER respect (session set, slots set, not yet
    // opened) so this only isolates the city guard, not the whole predicate.
    const queryClient = makeQueryClient();
    const today = toDateKey(new Date());

    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: ORG_ID, name: "Test Org" },
      hasRole: (r: string) => r === "admin",
    } as never);
    vi.mocked(useMyArtist).mockReturnValue({ data: undefined } as never);
    vi.mocked(useFeature).mockImplementation(() => true);

    queryClient.setQueryData(["first-run", "upcoming-dates", today, ORG_ID], [
      { id: "d1", date: "2026-09-01", show_id: "show-1", city_id: null, session_1: "19:00", session_2: null, session_3: null, show: { program: "Cabaret", sub_program: null, main_cast_slots: 4 } },
    ]);
    queryClient.setQueryData(["bookings", "confirmed-dashboard", ORG_ID], []);
    queryClient.setQueryData(["offer-tiers", "opened-tier1", ORG_ID], []);
    queryClient.setQueryData(["eligibility", "ladder-coverage", ORG_ID, today], {
      futurePairs: [{ showId: "show-1", cityId: null }], showPriorities: [], cityPriorities: [], nonEmptyCastIds: [],
    });
    queryClient.setQueryData(["hire-orders", "list", ORG_ID, { status: ["draft"] }], []);
    queryClient.setQueryData(["bookings", "nav-pending-confirmations", ORG_ID], 0);
    queryClient.setQueryData(["hire-orders", "awaiting-count", ORG_ID], 0);
    queryClient.setQueryData(["app-settings", "flow-times", ORG_ID], {
      windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20,
    });

    const { result } = renderHookWithProviders(() => useFirstRunMetrics("admin"), { queryClient });

    expect(result.current.metrics.datesIn).toBe(1);
    expect(result.current.metrics.readyToOffer).toBe(0);
  });

  it("artist: assembles personal metrics from seeded reads, zero-fills org metrics", () => {
    const queryClient = makeQueryClient();

    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: ORG_ID, name: "Test Org" },
      hasRole: () => false,
    } as never);
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: ARTIST_ID } } as never);
    vi.mocked(useFeature).mockImplementation(() => true);

    // ---- Seed exactly the query keys the ARTIST-role read set fires. ----
    queryClient.setQueryData(["artist-eligible-dates", ARTIST_ID, ORG_ID], [
      { id: "d1" }, { id: "d2" }, { id: "d3" },
    ]);
    queryClient.setQueryData(["blocked-dates", "count", ARTIST_ID], 5);
    queryClient.setQueryData(["bookings", "nav-open-offers", ARTIST_ID], 7);
    queryClient.setQueryData(["hire-orders", "mine", ARTIST_ID], [
      { id: "ho1", status: "issued" },
      { id: "ho2", status: "countersigned" },
      { id: "ho3", status: "issued" },
    ]);
    queryClient.setQueryData(["app-settings", "flow-times", ORG_ID], {
      windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20,
    });

    const { result } = renderHookWithProviders(() => useFirstRunMetrics("artist"), { queryClient });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.metrics.eligibleDates).toBe(3);
    expect(result.current.metrics.blockedDates).toBe(5);
    expect(result.current.metrics.arriving).toBe(7);
    // Only the 2 "issued" rows count toward toSign; the countersigned one doesn't.
    expect(result.current.metrics.toSign).toBe(2);
    // Org metrics stay zero for an artist, even though their queries are disabled
    // (never fired) rather than resolved-and-discarded.
    expect(result.current.metrics.datesIn).toBe(0);
    expect(result.current.metrics.readyToOffer).toBe(0);
    expect(result.current.metrics.bookableDates).toBe(0);
    expect(result.current.metrics.confirmed).toBe(0);
    expect(result.current.metrics.hireDrafts).toBe(0);
    // Timing is org-level, not role-gated: an artist still reads the org's real
    // response-window/digest-hour settings, not a code fallback.
    expect(result.current.timing).toEqual({ digestHourBerlin: 19, responseWindowHours: 48 });
  });
});
