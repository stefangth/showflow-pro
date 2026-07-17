import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: vi.fn() }));
vi.mock("@/data/bookings", () => ({
  fetchPendingConfirmationsCount: vi.fn(),
  fetchMyOpenOffersCount: vi.fn(),
}));
vi.mock("@/data/hireOrders", () => ({
  fetchAwaitingCountersignCount: vi.fn(),
}));

import { useAuth } from "@/features/auth/AuthContext";
import { useMyArtist } from "@/hooks/useMyArtist";
import { fetchPendingConfirmationsCount, fetchMyOpenOffersCount } from "@/data/bookings";
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
  });

  it("fetches pending confirmations for a producer with an org; no offers without an artist", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: (r: string) => r === "producer",
    } as never);
    vi.mocked(useMyArtist).mockReturnValue({ data: null } as never);
    vi.mocked(fetchPendingConfirmationsCount).mockResolvedValue(5);

    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.pendingConfirmations).toBe(5));
    expect(fetchPendingConfirmationsCount).toHaveBeenCalledWith(expect.anything(), "org-1");
    expect(fetchMyOpenOffersCount).not.toHaveBeenCalled();
    expect(result.current.openOffers).toBe(0);
  });

  it("fetches open offers for an artist; no org-confirmations query", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: () => false,
    } as never);
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: "artist-1" } } as never);
    vi.mocked(fetchMyOpenOffersCount).mockResolvedValue(3);

    const { result } = renderHook(() => useNavCounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.openOffers).toBe(3));
    expect(fetchMyOpenOffersCount).toHaveBeenCalledWith(expect.anything(), "artist-1");
    expect(fetchPendingConfirmationsCount).not.toHaveBeenCalled();
    expect(result.current.pendingConfirmations).toBe(0);
  });

  it("fetches the awaiting-countersign count for a producer/admin with an org", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: (r: string) => r === "producer",
    } as never);
    vi.mocked(useMyArtist).mockReturnValue({ data: null } as never);
    vi.mocked(fetchPendingConfirmationsCount).mockResolvedValue(0);
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
