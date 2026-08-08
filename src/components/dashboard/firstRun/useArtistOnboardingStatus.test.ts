import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { partialMock } from "@/test/castHelpers";

// Stub the read hooks so the pure readiness mapping is what we assert.
// This stubs UI/read hooks (not the Supabase client), which is allowed.
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: vi.fn() }));
vi.mock("@/hooks/useMyBlockedDatesCount", () => ({ useMyBlockedDatesCount: vi.fn() }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
// The "visited Availability" flag is localStorage-backed via useRailDismissed; stub it
// so the readiness mapping (real data OR visited) is what we assert.
let visited = false;
vi.mock("@/components/setup/useRailDismissed", () => ({
  useRailDismissed: () => [visited, vi.fn(), vi.fn()],
}));

import { useMyArtist } from "@/hooks/useMyArtist";
import { useMyBlockedDatesCount } from "@/hooks/useMyBlockedDatesCount";
import { useAuth } from "@/features/auth/AuthContext";
import { useArtistOnboardingStatus } from "./useArtistOnboardingStatus";

describe("useArtistOnboardingStatus", () => {
  beforeEach(() => {
    visited = false;
    vi.mocked(useAuth).mockReturnValue(
      partialMock<ReturnType<typeof useAuth>>({ currentOrg: { id: "o1" } as never })
    );
    vi.mocked(useMyArtist).mockReturnValue(
      partialMock<ReturnType<typeof useMyArtist>>({ data: { id: "a1", name: "Nora" } as never, isLoading: false })
    );
    vi.mocked(useMyBlockedDatesCount).mockReturnValue(
      partialMock<ReturnType<typeof useMyBlockedDatesCount>>({ data: 0, isLoading: false })
    );
  });

  it("no blocked dates and Availability not yet visited => the single step is incomplete", () => {
    const { result } = renderHook(() => useArtistOnboardingStatus());
    const s = result.current.status;
    expect(s.steps.map((x) => x.key)).toEqual(["blockDates"]);
    expect(s.steps[0].done).toBe(false);
    expect(s.complete).toBe(false);
  });

  it("blockDates is done from real data alone (a blocked date exists)", () => {
    vi.mocked(useMyBlockedDatesCount).mockReturnValue(
      partialMock<ReturnType<typeof useMyBlockedDatesCount>>({ data: 2, isLoading: false })
    );
    const { result } = renderHook(() => useArtistOnboardingStatus());
    expect(result.current.status.steps[0].done).toBe(true);
    expect(result.current.status.complete).toBe(true);
  });

  it("blockDates is done once Availability has been visited, even with an open calendar", () => {
    visited = true; // zero blocked dates, but the page was opened at least once
    const { result } = renderHook(() => useArtistOnboardingStatus());
    expect(result.current.status.steps[0].done).toBe(true);
    expect(result.current.status.complete).toBe(true);
  });

  it("surfaces the blocked-dates query loading state", () => {
    vi.mocked(useMyBlockedDatesCount).mockReturnValue(
      partialMock<ReturnType<typeof useMyBlockedDatesCount>>({ data: undefined, isLoading: true })
    );
    const { result } = renderHook(() => useArtistOnboardingStatus());
    expect(result.current.isLoading).toBe(true);
  });

  it("surfaces the artist query loading state", () => {
    vi.mocked(useMyArtist).mockReturnValue(
      partialMock<ReturnType<typeof useMyArtist>>({ data: undefined, isLoading: true })
    );
    const { result } = renderHook(() => useArtistOnboardingStatus());
    expect(result.current.isLoading).toBe(true);
  });
});
