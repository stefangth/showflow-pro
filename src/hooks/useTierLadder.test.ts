import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/data/tierLadder", () => ({
  fetchTierCastMap: vi.fn(),
  fetchTierLadderCounts: vi.fn(),
}));

import { fetchTierCastMap, fetchTierLadderCounts } from "@/data/tierLadder";
import { useTierCastMap, useTierLadderCounts } from "./useTierLadder";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useTierLadderCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is disabled (does not fetch) when orgId is absent, even with showId and showDateId set", () => {
    // fetchCastMemberCounts/fetchBlockedArtistIds both silently fail open (empty
    // {}/Set) for a falsy orgId inside fetchTierLadderCounts, which would zero out
    // castTotal and stop excluding blocked artists from matchCount — a
    // confidently-wrong result rather than a disabled query. Must stay idle.
    const { result } = renderHook(
      () => useTierLadderCounts("show-1", "date-1", "city-1", null),
      { wrapper: wrapper() },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchTierLadderCounts).not.toHaveBeenCalled();
  });

  it("is disabled when showDateId is absent", () => {
    const { result } = renderHook(
      () => useTierLadderCounts("show-1", null, "city-1", "org-1"),
      { wrapper: wrapper() },
    );
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches once showId, showDateId, and orgId are all present", async () => {
    vi.mocked(fetchTierLadderCounts).mockResolvedValue([]);
    const { result } = renderHook(
      () => useTierLadderCounts("show-1", "date-1", "city-1", "org-1"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchTierLadderCounts).toHaveBeenCalledWith(expect.anything(), {
      showId: "show-1", showDateId: "date-1", cityId: "city-1", orgId: "org-1",
    });
  });
});

describe("useTierCastMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is disabled when showId is absent", () => {
    const { result } = renderHook(() => useTierCastMap(null, "city-1"), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("is disabled when cityId is absent", () => {
    const { result } = renderHook(() => useTierCastMap("show-1", null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches when both showId and cityId are present", async () => {
    vi.mocked(fetchTierCastMap).mockResolvedValue([]);
    const { result } = renderHook(() => useTierCastMap("show-1", "city-1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchTierCastMap).toHaveBeenCalledWith(expect.anything(), { showId: "show-1", cityId: "city-1" });
  });
});
