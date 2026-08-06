import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useArtistEligibleDates } from "./useArtistEligibleDates";
import { partialMock } from "@/test/castHelpers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Artist } from "@/types";

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock("./useMyArtist", () => ({
  useMyArtist: vi.fn(),
}));

// The hook is org-scoped now: it reads the active org and passes it to
// fetchUpcomingShowDates, so the show_dates read can never span orgs.
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-uuid-1" } }),
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

/** Install a table→chain-stub factory as the `from` mock. The stubs stay plain
 *  objects; the single sanctioned boundary cast happens once, here. */
function mockFrom(impl: (table: string) => unknown) {
  vi.mocked(supabase.from).mockImplementation(
    partialMock<SupabaseClient<Database>["from"]>(impl),
  );
}

/** show_dates chain stub: select -> eq(org_id) -> gte -> neq -> order -> result.
 *  The eq() link is the org filter fetchUpcomingShowDates applies. */
function showDatesStub(result: { data: unknown; error: unknown }) {
  const order = vi.fn().mockResolvedValue(result);
  const neq = vi.fn().mockReturnValue({ order });
  const gte = vi.fn().mockReturnValue({ neq });
  const eq = vi.fn().mockReturnValue({ gte });
  return { select: vi.fn().mockReturnValue({ eq }) };
}

const ARTIST_ID = "artist-uuid-1";
const SHOW_DATE_ID = "date-uuid-1";
const SHOW_DATE_ID_2 = "date-uuid-2";
const SHOW_ID = "show-uuid-1";
const CAST_ID = "cast-uuid-1";
const CITY_ID = "city-uuid-1";
const SKILL_JUDGE = "skill-judge";

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

const sampleDate2 = {
  ...sampleDate,
  id: SHOW_DATE_ID_2,
  date: "2099-01-02",
};

/**
 * Default (empty) mocks for the three tables added by the hard-skill-requirement
 * step (step 5). Tests that exercise cases where eligible.length > 0 must supply
 * these or the fallback `{}` fallback branch makes `.select` blow up, since the new
 * fetches run unconditionally once there is at least one eligible date.
 */
function emptySkillRequirementTables(table: string) {
  if (table === "artist_skills") {
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    };
  }
  if (table === "show_required_skills") {
    return {
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    };
  }
  if (table === "show_date_required_skills") {
    return {
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    };
  }
  return undefined;
}

describe("useArtistEligibleDates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when artist has no cast memberships", async () => {
    vi.mocked(useMyArtist).mockReturnValue(partialMock<ReturnType<typeof useMyArtist>>({ data: partialMock<Artist>({ id: ARTIST_ID }) }));

    mockFrom((table) => {
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      return {};
    });

    const { result } = renderHook(() => useArtistEligibleDates(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });
  });

  it("returns eligible dates matching show+city eligibility", async () => {
    vi.mocked(useMyArtist).mockReturnValue(partialMock<ReturnType<typeof useMyArtist>>({ data: partialMock<Artist>({ id: ARTIST_ID }) }));

    mockFrom((table) => {
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ cast_id: CAST_ID }],
              error: null,
            }),
          }),
        };
      }
      if (table === "show_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ show_id: SHOW_ID, city_id: CITY_ID }],
              error: null,
            }),
          }),
        };
      }
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === "show_dates") {
        return showDatesStub({ data: [sampleDate], error: null, });
      }
      return emptySkillRequirementTables(table) ?? ({});
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
    vi.mocked(useMyArtist).mockReturnValue(partialMock<ReturnType<typeof useMyArtist>>({ data: partialMock<Artist>({ id: ARTIST_ID }) }));

    mockFrom((table) => {
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ cast_id: CAST_ID }],
              error: null,
            }),
          }),
        };
      }
      if (table === "show_cast_eligibility") {
        // No show+city match
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
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
        };
      }
      if (table === "show_dates") {
        return showDatesStub({ data: [sampleDate], error: null, });
      }
      return emptySkillRequirementTables(table) ?? ({});
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
    vi.mocked(useMyArtist).mockReturnValue(partialMock<ReturnType<typeof useMyArtist>>({ data: partialMock<Artist>({ id: ARTIST_ID }) }));

    let selectArg = "";
    mockFrom((table) => {
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ cast_id: CAST_ID }], error: null }),
          }),
        };
      }
      if (table === "show_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [{ show_id: SHOW_ID, city_id: CITY_ID }], error: null }),
          }),
        };
      }
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === "show_dates") {
        return {
          select: vi.fn((arg: string) => {
            selectArg = arg;
            return {
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  neq: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({
                      data: [{ ...sampleDate, custom: { booking_ref: "FV-2033" } }],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }),
        };
      }
      return emptySkillRequirementTables(table) ?? ({});
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

  it("hides a date whose show-level required skill the artist lacks", async () => {
    vi.mocked(useMyArtist).mockReturnValue(partialMock<ReturnType<typeof useMyArtist>>({ data: partialMock<Artist>({ id: ARTIST_ID }) }));

    mockFrom((table) => {
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ cast_id: CAST_ID }], error: null }),
          }),
        };
      }
      if (table === "show_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [{ show_id: SHOW_ID, city_id: CITY_ID }], error: null }),
          }),
        };
      }
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === "show_dates") {
        return showDatesStub({ data: [sampleDate], error: null });
      }
      // Artist has no skills at all, so the s-judge requirement is unmet.
      if (table === "artist_skills") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === "show_required_skills") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ show_id: SHOW_ID, skill_id: SKILL_JUDGE }],
              error: null,
            }),
          }),
        };
      }
      if (table === "show_date_required_skills") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      return {};
    });

    const { result } = renderHook(() => useArtistEligibleDates(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });
    // Pin the intended path: the date really did reach the skill-requirement
    // step (eligible.length was > 0), it was not filtered out earlier.
    expect(vi.mocked(supabase.from)).toHaveBeenCalledWith("show_required_skills");
  });

  it("keeps a date visible when the artist holds the required show-level skill", async () => {
    vi.mocked(useMyArtist).mockReturnValue(partialMock<ReturnType<typeof useMyArtist>>({ data: partialMock<Artist>({ id: ARTIST_ID }) }));

    mockFrom((table) => {
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ cast_id: CAST_ID }], error: null }),
          }),
        };
      }
      if (table === "show_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [{ show_id: SHOW_ID, city_id: CITY_ID }], error: null }),
          }),
        };
      }
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === "show_dates") {
        return showDatesStub({ data: [sampleDate], error: null });
      }
      // Artist holds the required skill this time, so the date stays eligible.
      if (table === "artist_skills") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ skill_id: SKILL_JUDGE }], error: null }),
          }),
        };
      }
      if (table === "show_required_skills") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ show_id: SHOW_ID, skill_id: SKILL_JUDGE }],
              error: null,
            }),
          }),
        };
      }
      if (table === "show_date_required_skills") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      return {};
    });

    const { result } = renderHook(() => useArtistEligibleDates(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data?.length).toBe(1);
      expect(result.current.data?.[0].id).toBe(SHOW_DATE_ID);
    });
  });

  it("hides only the specific date carrying an unmet date-level requirement", async () => {
    vi.mocked(useMyArtist).mockReturnValue(partialMock<ReturnType<typeof useMyArtist>>({ data: partialMock<Artist>({ id: ARTIST_ID }) }));

    mockFrom((table) => {
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ cast_id: CAST_ID }], error: null }),
          }),
        };
      }
      if (table === "show_cast_eligibility") {
        // Both dates belong to the same show+city, so both are eligible via cast.
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [{ show_id: SHOW_ID, city_id: CITY_ID }], error: null }),
          }),
        };
      }
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === "show_dates") {
        return showDatesStub({ data: [sampleDate, sampleDate2], error: null });
      }
      if (table === "artist_skills") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      // The show itself requires nothing.
      if (table === "show_required_skills") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      // Only the second date carries a per-date requirement the artist lacks.
      if (table === "show_date_required_skills") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ show_date_id: SHOW_DATE_ID_2, skill_id: SKILL_JUDGE }],
              error: null,
            }),
          }),
        };
      }
      return {};
    });

    const { result } = renderHook(() => useArtistEligibleDates(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data?.length).toBe(1);
    });
    expect(result.current.data?.[0].id).toBe(SHOW_DATE_ID);
    expect(result.current.data?.some((d) => d.id === SHOW_DATE_ID_2)).toBe(false);
  });

  it("keeps all dates when no skill requirements exist anywhere (regression)", async () => {
    vi.mocked(useMyArtist).mockReturnValue(partialMock<ReturnType<typeof useMyArtist>>({ data: partialMock<Artist>({ id: ARTIST_ID }) }));

    mockFrom((table) => {
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ cast_id: CAST_ID }], error: null }),
          }),
        };
      }
      if (table === "show_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [{ show_id: SHOW_ID, city_id: CITY_ID }], error: null }),
          }),
        };
      }
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === "show_dates") {
        return showDatesStub({ data: [sampleDate, sampleDate2], error: null });
      }
      // No requirement rows anywhere, and the artist has no skills either.
      return emptySkillRequirementTables(table) ?? ({});
    });

    const { result } = renderHook(() => useArtistEligibleDates(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data?.length).toBe(2);
    });
    expect(result.current.data?.map((d) => d.id).sort()).toEqual(
      [SHOW_DATE_ID, SHOW_DATE_ID_2].sort()
    );
  });

  it("is disabled when artist is not loaded yet", () => {
    vi.mocked(useMyArtist).mockReturnValue(partialMock<ReturnType<typeof useMyArtist>>({ data: undefined }));

    const { result } = renderHook(() => useArtistEligibleDates(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
  });

  it("throws on query error", async () => {
    vi.mocked(useMyArtist).mockReturnValue(partialMock<ReturnType<typeof useMyArtist>>({ data: partialMock<Artist>({ id: ARTIST_ID }) }));

    mockFrom((table) => {
      if (table === "cast_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ cast_id: CAST_ID }],
              error: null,
            }),
          }),
        };
      }
      if (table === "show_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === "show_date_cast_eligibility") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === "show_dates") {
        return showDatesStub({ data: null, error: new Error("Network error"), });
      }
      return {};
    });

    const { result } = renderHook(() => useArtistEligibleDates(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
