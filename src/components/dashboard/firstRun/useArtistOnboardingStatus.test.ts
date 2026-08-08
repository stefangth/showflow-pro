import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { partialMock } from "@/test/castHelpers";

// Stub the read hooks so the pure readiness mapping is what we assert.
// This stubs UI/read hooks (not the Supabase client), which is allowed.
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: vi.fn() }));
vi.mock("@/hooks/useMyProfile", () => ({ useMyProfile: vi.fn() }));
vi.mock("@/hooks/useMyBlockedDatesCount", () => ({ useMyBlockedDatesCount: vi.fn() }));

import { useMyArtist } from "@/hooks/useMyArtist";
import { useMyProfile } from "@/hooks/useMyProfile";
import { useMyBlockedDatesCount } from "@/hooks/useMyBlockedDatesCount";
import { useArtistOnboardingStatus } from "./useArtistOnboardingStatus";

describe("useArtistOnboardingStatus", () => {
  beforeEach(() => {
    vi.mocked(useMyBlockedDatesCount).mockReturnValue(
      partialMock<ReturnType<typeof useMyBlockedDatesCount>>({ data: 0, isLoading: false })
    );
  });

  it("no blocked dates and no phone => both steps incomplete", () => {
    vi.mocked(useMyArtist).mockReturnValue(
      partialMock<ReturnType<typeof useMyArtist>>({ data: { id: "a1", name: "Nora" } as never, isLoading: false })
    );
    vi.mocked(useMyProfile).mockReturnValue(
      partialMock<ReturnType<typeof useMyProfile>>({ data: { phone: null } as never, isLoading: false })
    );

    const { result } = renderHook(() => useArtistOnboardingStatus());
    const s = result.current.status;
    expect(s.steps.map((x) => x.key)).toEqual(["blockDates", "notifications"]);
    expect(s.steps.find((x) => x.key === "blockDates")!.done).toBe(false);
    expect(s.steps.find((x) => x.key === "notifications")!.done).toBe(false);
    expect(s.complete).toBe(false);
  });

  it("a blocked date and a phone number => complete (only real data satisfies the steps)", () => {
    vi.mocked(useMyArtist).mockReturnValue(
      partialMock<ReturnType<typeof useMyArtist>>({ data: { id: "a1", name: "Nora" } as never, isLoading: false })
    );
    vi.mocked(useMyProfile).mockReturnValue(
      partialMock<ReturnType<typeof useMyProfile>>({ data: { phone: "+49 170 0000000" } as never, isLoading: false })
    );
    vi.mocked(useMyBlockedDatesCount).mockReturnValue(
      partialMock<ReturnType<typeof useMyBlockedDatesCount>>({ data: 2, isLoading: false })
    );

    const { result } = renderHook(() => useArtistOnboardingStatus());
    const s = result.current.status;
    expect(s.steps.find((x) => x.key === "blockDates")!.done).toBe(true);
    expect(s.steps.find((x) => x.key === "notifications")!.done).toBe(true);
    expect(s.complete).toBe(true);
  });

  it("blockDates is done from real data alone; notifications still needs a phone", () => {
    vi.mocked(useMyArtist).mockReturnValue(
      partialMock<ReturnType<typeof useMyArtist>>({ data: { id: "a1", name: "Nora" } as never, isLoading: false })
    );
    vi.mocked(useMyProfile).mockReturnValue(
      partialMock<ReturnType<typeof useMyProfile>>({ data: { phone: null } as never, isLoading: false })
    );
    vi.mocked(useMyBlockedDatesCount).mockReturnValue(
      partialMock<ReturnType<typeof useMyBlockedDatesCount>>({ data: 2, isLoading: false })
    );

    const { result } = renderHook(() => useArtistOnboardingStatus());
    const s = result.current.status;
    expect(s.steps.find((x) => x.key === "blockDates")!.done).toBe(true);
    expect(s.steps.find((x) => x.key === "notifications")!.done).toBe(false);
  });

  it("surfaces the blocked-dates query loading state", () => {
    vi.mocked(useMyArtist).mockReturnValue(
      partialMock<ReturnType<typeof useMyArtist>>({ data: { id: "a1", name: "Nora" } as never, isLoading: false })
    );
    vi.mocked(useMyProfile).mockReturnValue(
      partialMock<ReturnType<typeof useMyProfile>>({ data: { phone: null } as never, isLoading: false })
    );
    vi.mocked(useMyBlockedDatesCount).mockReturnValue(
      partialMock<ReturnType<typeof useMyBlockedDatesCount>>({ data: undefined, isLoading: true })
    );

    const { result } = renderHook(() => useArtistOnboardingStatus());
    expect(result.current.isLoading).toBe(true);
  });

  it("surfaces the artist or profile query loading state even when blocked-dates is not loading", () => {
    vi.mocked(useMyArtist).mockReturnValue(
      partialMock<ReturnType<typeof useMyArtist>>({ data: undefined, isLoading: true })
    );
    vi.mocked(useMyProfile).mockReturnValue(
      partialMock<ReturnType<typeof useMyProfile>>({ data: { phone: null } as never, isLoading: false })
    );
    vi.mocked(useMyBlockedDatesCount).mockReturnValue(
      partialMock<ReturnType<typeof useMyBlockedDatesCount>>({ data: 0, isLoading: false })
    );

    const { result } = renderHook(() => useArtistOnboardingStatus());
    expect(result.current.isLoading).toBe(true);
  });
});
