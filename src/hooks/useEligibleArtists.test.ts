import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useEligibleArtists } from "./useEligibleArtists";

// ── Mock Supabase client ──────────────────────────────────────────────────

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { supabase } from "@/integrations/supabase/client";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useEligibleArtists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null artistIds when no eligibility config exists (no casts)", async () => {
    // No show casts, no date casts → no cast members to query
    const noDataChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    // show_cast_eligibility and show_date_cast_eligibility both return []
    vi.mocked(supabase.from).mockReturnValue({
      ...noDataChain,
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    } as any);

    const { result } = renderHook(
      () => useEligibleArtists("show-1", "date-1", "city-1"),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => {
      expect(result.current.data).toEqual({ artistIds: null, castIds: [] });
    });
  });

  it("returns artistIds set when cast members are found", async () => {
    const callCount = 0;
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "show_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ cast_id: "cast-1" }],
                error: null,
              }),
            }),
          }),
        } as any;
      }
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        } as any;
      }
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ artist_id: "artist-1" }, { artist_id: "artist-2" }],
              error: null,
            }),
          }),
        } as any;
      }
      return {} as any;
    });

    const { result } = renderHook(
      () => useEligibleArtists("show-1", "date-1", "city-1"),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => {
      expect(result.current.data?.artistIds).toBeInstanceOf(Set);
      expect(result.current.data?.artistIds?.has("artist-1")).toBe(true);
      expect(result.current.data?.artistIds?.has("artist-2")).toBe(true);
    });
  });

  it("is disabled when showId is null", () => {
    const { result } = renderHook(
      () => useEligibleArtists(null, "date-1", "city-1"),
      { wrapper: makeWrapper() }
    );
    // Query is disabled — fetchStatus should be idle
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("is disabled when showDateId is null", () => {
    const { result } = renderHook(
      () => useEligibleArtists("show-1", null, "city-1"),
      { wrapper: makeWrapper() }
    );
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("skips show_cast_eligibility query when cityId is null", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        } as any;
      }
      return {} as any;
    });

    const { result } = renderHook(
      () => useEligibleArtists("show-1", "date-1", null),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => {
      // No city → no show casts → castIds is empty → artistIds is null
      expect(result.current.data).toEqual({ artistIds: null, castIds: [] });
    });
    // show_cast_eligibility should NOT have been called
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalledWith(
      "show_cast_eligibility"
    );
  });

  it("deduplicates castIds when a cast appears in both show+city and per-date override", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "show_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ cast_id: "cast-1" }],
                error: null,
              }),
            }),
          }),
        } as any;
      }
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ cast_id: "cast-1" }], // same cast as show+city
              error: null,
            }),
          }),
        } as any;
      }
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ artist_id: "artist-1" }],
              error: null,
            }),
          }),
        } as any;
      }
      return {} as any;
    });

    const { result } = renderHook(
      () => useEligibleArtists("show-1", "date-1", "city-1"),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.castIds).toEqual(["cast-1"]);
    expect(result.current.data?.castIds.length).toBe(1);
  });

  it("returns override cast in castIds when only show_date_cast_eligibility has it (no city)", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ cast_id: "cast-override" }],
              error: null,
            }),
          }),
        } as any;
      }
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ artist_id: "artist-override" }],
              error: null,
            }),
          }),
        } as any;
      }
      return {} as any;
    });

    const { result } = renderHook(
      () => useEligibleArtists("show-1", "date-1", null), // no city → skip show_cast_eligibility
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.castIds).toEqual(["cast-override"]);
    expect(result.current.data?.artistIds?.has("artist-override")).toBe(true);
  });

  it("reacts to changed showDateId", async () => {
    const makeChain = (dateId: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        } as any;
      }
      return makeChain("date-1") as any;
    });

    const { result, rerender } = renderHook(
      ({ dateId }) => useEligibleArtists("show-1", dateId, null),
      { wrapper: makeWrapper(), initialProps: { dateId: "date-1" } }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ dateId: "date-2" });

    // After rerender with new dateId the query key changes — hook re-fetches
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
