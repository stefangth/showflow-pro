import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: vi.fn() }));
vi.mock("@/hooks/useEntitlements", () => ({ useFeature: vi.fn() }));
// The org-wide needs-you derivation is a boundary here (pinned in useNeedsYouCount.test.ts);
// this file pins how useNavCounts gates and surfaces it as the "Dates" badge value.
vi.mock("@/hooks/useNeedsYouCount", () => ({ useNeedsYouCount: vi.fn() }));
vi.mock("@/data/bookings", () => ({
  fetchMyOpenOffersCount: vi.fn(),
}));
vi.mock("@/data/hireOrders", () => ({
  fetchAwaitingCountersignCount: vi.fn(),
}));

import { useAuth } from "@/features/auth/AuthContext";
import { useMyArtist } from "@/hooks/useMyArtist";
import { useFeature } from "@/hooks/useEntitlements";
import { useNeedsYouCount } from "@/hooks/useNeedsYouCount";
import { fetchMyOpenOffersCount } from "@/data/bookings";
import { fetchAwaitingCountersignCount } from "@/data/hireOrders";
import { useNavCounts } from "./useNavCounts";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useNavCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAwaitingCountersignCount).mockResolvedValue(0);
    vi.mocked(useFeature).mockReturnValue(true);
    vi.mocked(useNeedsYouCount).mockReturnValue(0);
  });

  it("surfaces the needs-you count for a producer with an org; no offers without an artist", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: (r: string) => r === "producer",
    } as never);
    vi.mocked(useMyArtist).mockReturnValue({ data: null } as never);
    vi.mocked(useNeedsYouCount).mockReturnValue(5);

    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.needsYou).toBe(5));
    // Enabled for an org-visible role with booking_flow on.
    expect(useNeedsYouCount).toHaveBeenLastCalledWith({ orgId: "org-1", enabled: true, hireOrdersOn: true });
    expect(fetchMyOpenOffersCount).not.toHaveBeenCalled();
    expect(result.current.openOffers).toBe(0);
  });

  it("fetches open offers for an artist; needs-you stays disabled", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: () => false,
    } as never);
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: "artist-1" } } as never);
    vi.mocked(fetchMyOpenOffersCount).mockResolvedValue(3);

    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.openOffers).toBe(3));
    expect(fetchMyOpenOffersCount).toHaveBeenCalledWith(expect.anything(), "artist-1");
    // Artist cannot see org bookings → the needs-you hook is gated off.
    expect(useNeedsYouCount).toHaveBeenLastCalledWith({ orgId: "org-1", enabled: false, hireOrdersOn: true });
    expect(result.current.needsYou).toBe(0);
  });

  it("fetches the awaiting-countersign count for a producer/admin with an org", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: (r: string) => r === "producer",
    } as never);
    vi.mocked(useMyArtist).mockReturnValue({ data: null } as never);
    vi.mocked(fetchAwaitingCountersignCount).mockResolvedValue(7);

    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.awaitingCountersign).toBe(7));
    expect(fetchAwaitingCountersignCount).toHaveBeenCalledWith(expect.anything(), "org-1");
  });

  it("does not fetch the awaiting-countersign count for a role without org visibility (e.g. artist)", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: () => false,
    } as never);
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: "artist-1" } } as never);
    vi.mocked(fetchMyOpenOffersCount).mockResolvedValue(0);

    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.openOffers).toBe(0));
    expect(fetchAwaitingCountersignCount).not.toHaveBeenCalled();
    expect(result.current.awaitingCountersign).toBe(0);
  });

  it("does not fetch the awaiting-countersign count for an org with the hire_orders feature off", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: (r: string) => r === "admin",
    } as never);
    vi.mocked(useMyArtist).mockReturnValue({ data: null } as never);
    vi.mocked(useFeature).mockReturnValue(false);

    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.needsYou).toBe(0));
    expect(fetchAwaitingCountersignCount).not.toHaveBeenCalled();
    expect(result.current.awaitingCountersign).toBe(0);
  });

  it("does not fetch the awaiting-countersign count without an org", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: null,
      hasRole: (r: string) => r === "admin",
    } as never);
    vi.mocked(useMyArtist).mockReturnValue({ data: null } as never);

    renderHook(() => useNavCounts(), { wrapper: wrapper() });
    expect(fetchAwaitingCountersignCount).not.toHaveBeenCalled();
  });
});

describe("useNavCounts booking_flow gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-1" }, hasRole: () => true } as never);
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: "artist-1" } } as never);
    vi.mocked(useNeedsYouCount).mockReturnValue(0);
  });

  it("keeps needs-you enabled but gates open offers off when booking_flow is off", async () => {
    vi.mocked(useFeature).mockImplementation((f) => f !== "booking_flow");
    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    // needs-you tracks the (ungated) Dates page, so it stays enabled on role alone
    // regardless of booking_flow — the badge and page must not disagree for a module-off org.
    expect(useNeedsYouCount).toHaveBeenLastCalledWith({ orgId: "org-1", enabled: true, hireOrdersOn: true });
    // open offers remain a booking_flow concept and stay gated off.
    expect(fetchMyOpenOffersCount).not.toHaveBeenCalled();
    expect(result.current.openOffers).toBe(0);
  });
});
