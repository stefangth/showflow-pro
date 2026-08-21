import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { ProducerShowDateRow } from "@/lib/calendar/producerData";

// Leaf data reads and the two sub-hooks are mocked; the real toProducerEntries +
// buildNeedsYouQueue run, so the test exercises the actual four-bucket derivation
// (its per-bucket rules are pinned in needsYou.test.ts) and this file pins the wiring.
vi.mock("@/data/showDates", () => ({ fetchShowDatesList: vi.fn() }));
vi.mock("@/data/bookings", () => ({ fetchBookingCountsByDate: vi.fn() }));
vi.mock("@/hooks/useHireOrders", () => ({ useDatesReadyForHireOrder: vi.fn() }));
vi.mock("@/hooks/useBookingsWithArtist", () => ({ useBookingsWithArtist: vi.fn() }));

import { fetchShowDatesList } from "@/data/showDates";
import { fetchBookingCountsByDate } from "@/data/bookings";
import { useDatesReadyForHireOrder } from "@/hooks/useHireOrders";
import { useBookingsWithArtist } from "@/hooks/useBookingsWithArtist";
import { useNeedsYouCount } from "./useNeedsYouCount";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

/** A cancelled date whose cast has not been told yet → the queue's `cancelled` bucket. */
const cancelledUntold: ProducerShowDateRow = {
  id: "d1",
  date: "2026-01-01",
  session_1: null,
  session_2: null,
  session_3: null,
  venue: null,
  status: "cancelled",
  notes: null,
  city_id: null,
  show_id: "s1",
  custom: null,
  cast_notified_at: null,
  show: { program: "X", sub_program: null, status: "active", main_cast_slots: 2, understudy_slots: 0 },
  city: null,
};

describe("useNeedsYouCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchBookingCountsByDate).mockResolvedValue(new Map());
    vi.mocked(useDatesReadyForHireOrder).mockReturnValue({ data: undefined } as never);
    vi.mocked(useBookingsWithArtist).mockReturnValue({ data: [] } as never);
  });

  it("returns the org-wide four-bucket needs-you total", async () => {
    vi.mocked(fetchShowDatesList).mockResolvedValue([cancelledUntold] as never);

    const { result } = renderHook(
      () => useNeedsYouCount({ orgId: "org-1", enabled: true, hireOrdersOn: false }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current).toBe(1));
    expect(fetchShowDatesList).toHaveBeenCalledWith(expect.anything(), "org-1");
  });

  it("returns 0 and issues no reads when disabled", () => {
    const { result } = renderHook(
      () => useNeedsYouCount({ orgId: "org-1", enabled: false, hireOrdersOn: true }),
      { wrapper: wrapper() },
    );

    expect(result.current).toBe(0);
    expect(fetchShowDatesList).not.toHaveBeenCalled();
    expect(fetchBookingCountsByDate).not.toHaveBeenCalled();
  });

  it("only fetches hire-order readiness when the hire_orders module is on", () => {
    renderHook(
      () => useNeedsYouCount({ orgId: "org-1", enabled: true, hireOrdersOn: false }),
      { wrapper: wrapper() },
    );
    // Off → the ready query is handed a null org and stays disabled.
    expect(useDatesReadyForHireOrder).toHaveBeenLastCalledWith(null, expect.objectContaining({ staleTime: expect.any(Number) }));

    vi.mocked(useDatesReadyForHireOrder).mockClear();
    renderHook(
      () => useNeedsYouCount({ orgId: "org-1", enabled: true, hireOrdersOn: true }),
      { wrapper: wrapper() },
    );
    expect(useDatesReadyForHireOrder).toHaveBeenLastCalledWith("org-1", expect.objectContaining({ staleTime: expect.any(Number) }));
  });
});
