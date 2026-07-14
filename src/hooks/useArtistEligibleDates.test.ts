import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useArtistEligibleDates } from "./useArtistEligibleDates";

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock("./useMyArtist", () => ({
  useMyArtist: vi.fn(),
}));

// toDateKey is a pure utility — use its real implementation
vi.mock("@/lib/dates", () => ({
  toDateKey: (d: Date) => d.toISOString().slice(0, 10),
}));

import { supabase } from "@/integrations/supabase/client";
import { useMyArtist } from "./useMyArtist";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const ARTIST_ID = "artist-uuid-1";
const SHOW_DATE_ID = "date-uuid-1";
const SHOW_ID = "show-uuid-1";
const CAST_ID = "cast-uuid-1";
const CITY_ID = "city-uuid-1";

/** Typical show_date row returned by Supabase */
const sampleDate = {
  id: SHOW_DATE_ID,
  date: "2099-01-01",
  session_1: "19:00",
  session_2: null,
  session_3: null,
  status: "open",
  city_id: CITY_ID,
  show_id: SHOW_ID,
  venue: null,
  show: { id: SHOW_ID, program: "theatre", sub_program: "musical", status: "active" },
};

describe("useArtistEligibleDates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when artist has no cast memberships", async () => {
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: ARTIST_ID } } as any);

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        } as any;
      }
      return {} as any;
    });

    const { result } = renderHook(() => useArtistEligibleDates(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });
  });

  it("returns eligible dates matching show+city eligibility", async () => {
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: ARTIST_ID } } as any);

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ cast_id: CAST_ID }],
              error: null,
            }),
          }),
        } as any;
      }
      if (table === "show_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ show_id: SHOW_ID, city_id: CITY_ID }],
              error: null,
            }),
          }),
        } as any;
      }
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        } as any;
      }
      if (table === "show_dates") {
        return {
          select: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [sampleDate],
                  error: null,
                }),
              }),
            }),
          }),
        } as any;
      }
      return {} as any;
    });

    const { result } = renderHook(() => useArtistEligibleDates(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data?.length).toBe(1);
      expect(result.current.data?.[0].id).toBe(SHOW_DATE_ID);
    });
  });

  it("returns eligible dates from per-date overrides", async () => {
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: ARTIST_ID } } as any);

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ cast_id: CAST_ID }],
              error: null,
            }),
          }),
        } as any;
      }
      if (table === "show_cast_eligibility") {
        // No show+city match
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        } as any;
      }
      if (table === "show_date_cast_eligibility") {
        // Per-date override for SHOW_DATE_ID
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ show_date_id: SHOW_DATE_ID }],
              error: null,
            }),
          }),
        } as any;
      }
      if (table === "show_dates") {
        return {
          select: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [sampleDate],
                  error: null,
                }),
              }),
            }),
          }),
        } as any;
      }
      return {} as any;
    });

    const { result } = renderHook(() => useArtistEligibleDates(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data?.length).toBe(1);
    });
  });

  // Regression: the reference-field feature can point at a show_dates custom field
  // (booking_flow.reference_field.source === "custom"), but this hook's select never
  // fetched the `custom` jsonb column, so artist-facing views always passed `custom: null`
  // to referenceLabel and silently fell back to the show label instead of the org's chosen
  // custom reference (e.g. a production's internal booking code).
  it("includes the custom jsonb column in the show_dates select and passes it through", async () => {
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: ARTIST_ID } } as any);

    let selectArg = "";
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ cast_id: CAST_ID }], error: null }),
          }),
        } as any;
      }
      if (table === "show_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [{ show_id: SHOW_ID, city_id: CITY_ID }], error: null }),
          }),
        } as any;
      }
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        } as any;
      }
      if (table === "show_dates") {
        return {
          select: vi.fn((arg: string) => {
            selectArg = arg;
            return {
              gte: vi.fn().mockReturnValue({
                neq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [{ ...sampleDate, custom: { booking_ref: "FV-2033" } }],
                    error: null,
                  }),
                }),
              }),
            };
          }),
        } as any;
      }
      return {} as any;
    });

    const { result } = renderHook(() => useArtistEligibleDates(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data?.length).toBe(1);
    });
    expect(selectArg).toContain("custom");
    expect(result.current.data?.[0].custom).toEqual({ booking_ref: "FV-2033" });
  });

  it("is disabled when artist is not loaded yet", () => {
    vi.mocked(useMyArtist).mockReturnValue({ data: undefined } as any);

    const { result } = renderHook(() => useArtistEligibleDates(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
  });

  it("throws on query error", async () => {
    vi.mocked(useMyArtist).mockReturnValue({ data: { id: ARTIST_ID } } as any);

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ cast_id: CAST_ID }],
              error: null,
            }),
          }),
        } as any;
      }
      if (table === "show_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        } as any;
      }
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        } as any;
      }
      if (table === "show_dates") {
        return {
          select: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: null,
                  error: new Error("Network error"),
                }),
              }),
            }),
          }),
        } as any;
      }
      return {} as any;
    });

    const { result } = renderHook(() => useArtistEligibleDates(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
