import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { BOOKING_FLOW_DEFAULTS, applyPreset, type BookingFlow } from "@/lib/bookingFlow";
import type { FeedInput } from "@/lib/autopilot/today";

// The flow hooks are the only inputs whose IDENTITY the query key is built from,
// so they are stubbed through a mutable ref the tests flip between renders.
const flowRef: { value: BookingFlow } = { value: BOOKING_FLOW_DEFAULTS };
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowRef.value, isLoading: false }),
  useFlowTimes: () => ({
    data: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 },
    isLoading: false,
  }),
}));

// Reads are stubbed at the data-access boundary (the layer the CLAUDE.md testing
// rules put them behind), so this exercises the real hook, key and composition.
vi.mock("@/data/bookings", () => ({ fetchTierAttention: vi.fn(async () => []) }));
vi.mock("@/data/autopilot", () => ({
  fetchCancelledUntoldDates: vi.fn(async () => []),
  fetchBouncedAsks: vi.fn(async () => []),
  fetchAtRiskDateFacts: vi.fn(async () => []),
  fetchAutopilotFeed: vi.fn(async () => feedRef.value),
}));

import { useAutopilotToday } from "./useAutopilotToday";

const feedRef: { value: FeedInput[] } = { value: [] };

function bookRow(id: string, count: number): FeedInput {
  return {
    id,
    kind: "book",
    count,
    names: Array.from({ length: count }, (_, i) => `Artist ${i}`).join(", "),
    show: "Hamlet, Abend",
    date: "3 Sep",
    at: "Mon 07:02",
    actedAt: "2026-08-17T05:02:00Z",
    emailedAt: null,
    bookingIds: [id],
  };
}

const authOverrides = {
  currentOrg: { id: "org-1", name: "Acme", slug: "acme", status: "active", is_demo: false },
};

beforeEach(() => {
  flowRef.value = BOOKING_FLOW_DEFAULTS;
  feedRef.value = [];
});

describe("useAutopilotToday", () => {
  // Regression: this counted the "book" ROWS (one per date) while the header copy
  // says "N artists", so five acceptances across two dates read as "2 artists" —
  // and in Classic that number is an instruction ("waiting on you to book them").
  it("counts the artists who accepted overnight, not the dates they accepted on", async () => {
    feedRef.value = [bookRow("book:date-1", 3), bookRow("book:date-2", 2)];

    const { result } = renderHookWithProviders(() => useAutopilotToday(), { authOverrides });

    await waitFor(() => expect(result.current.model).toBeDefined());
    expect(result.current.model?.bookedOvernight).toBe(5);
  });

  // Regression: the model carries `producerConfirmation`, but the query key listed
  // only `offer_delivery`, so an org switching Autopilot -> Classic kept serving the
  // cached model and the board went on saying "Booked them, the place is theirs".
  it("rebuilds the model when the org's producer_confirmation changes", async () => {
    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "fasttrack"); // a yes books on its own
    const { result, rerender } = renderHookWithProviders(() => useAutopilotToday(), { authOverrides });

    await waitFor(() => expect(result.current.model).toBeDefined());
    expect(result.current.model?.producerConfirmation).toBe(false);

    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "classic"); // the producer books
    rerender();

    await waitFor(() => expect(result.current.model?.producerConfirmation).toBe(true));
  });
});
