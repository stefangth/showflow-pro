import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { partialMock } from "@/test/castHelpers";

// Stub the read hooks so the pure readiness mapping is what we assert.
// This stubs UI/read hooks (not the Supabase client), which is allowed.
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: vi.fn() }));
vi.mock("@/hooks/useMyProfile", () => ({ useMyProfile: vi.fn() }));
vi.mock("@/hooks/useMyBlockedDatesCount", () => ({ useMyBlockedDatesCount: vi.fn() }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
// Namespace-aware: each call site passes a distinct namespace
// ("artistBlockAck" vs "artistNotifyAck"), so the mock must be able to return
// a different value per namespace, not one blanket value for every call —
// otherwise a future swap of which ack feeds which readiness flag would
// still pass.
let blockAck = false;
let notifyAck = false;
vi.mock("@/components/setup/useRailDismissed", () => ({
  useRailDismissed: (namespace: string) => [
    namespace === "artistBlockAck" ? blockAck : notifyAck,
    vi.fn(),
    vi.fn(),
  ],
}));

import { useMyArtist } from "@/hooks/useMyArtist";
import { useMyProfile } from "@/hooks/useMyProfile";
import { useMyBlockedDatesCount } from "@/hooks/useMyBlockedDatesCount";
import { useAuth } from "@/features/auth/AuthContext";
import { useArtistOnboardingStatus } from "./useArtistOnboardingStatus";

describe("useArtistOnboardingStatus", () => {
  beforeEach(() => {
    blockAck = false;
    notifyAck = false;
    vi.mocked(useAuth).mockReturnValue(
      partialMock<ReturnType<typeof useAuth>>({ currentOrg: { id: "o1" } as never })
    );
    vi.mocked(useMyBlockedDatesCount).mockReturnValue(
      partialMock<ReturnType<typeof useMyBlockedDatesCount>>({ data: 0, isLoading: false })
    );
  });

  it("account linked but block/notify not acked, no blocked dates, and no phone => incomplete", () => {
    vi.mocked(useMyArtist).mockReturnValue(
      partialMock<ReturnType<typeof useMyArtist>>({ data: { id: "a1", name: "Nora" } as never, isLoading: false })
    );
    vi.mocked(useMyProfile).mockReturnValue(
      partialMock<ReturnType<typeof useMyProfile>>({ data: { phone: null } as never, isLoading: false })
    );
    blockAck = false;
    notifyAck = false;

    const { result } = renderHook(() => useArtistOnboardingStatus());
    const s = result.current.status;
    expect(s.steps.map((x) => x.key)).toEqual(["blockDates", "notifications"]);
    expect(s.steps.find((x) => x.key === "blockDates")!.done).toBe(false);
    expect(s.steps.find((x) => x.key === "notifications")!.done).toBe(false);
    expect(s.complete).toBe(false);
  });

  it("phone set and both acks true => complete", () => {
    vi.mocked(useMyArtist).mockReturnValue(
      partialMock<ReturnType<typeof useMyArtist>>({ data: { id: "a1", name: "Nora" } as never, isLoading: false })
    );
    vi.mocked(useMyProfile).mockReturnValue(
      partialMock<ReturnType<typeof useMyProfile>>({ data: { phone: "+49 170 0000000" } as never, isLoading: false })
    );
    blockAck = true;
    notifyAck = true;

    const { result } = renderHook(() => useArtistOnboardingStatus());
    const s = result.current.status;
    expect(s.steps.find((x) => x.key === "blockDates")!.done).toBe(true);
    expect(s.steps.find((x) => x.key === "notifications")!.done).toBe(true);
    expect(s.complete).toBe(true);
  });

  it("blockDates is done from real data alone, without any ack", () => {
    vi.mocked(useMyArtist).mockReturnValue(
      partialMock<ReturnType<typeof useMyArtist>>({ data: { id: "a1", name: "Nora" } as never, isLoading: false })
    );
    vi.mocked(useMyProfile).mockReturnValue(
      partialMock<ReturnType<typeof useMyProfile>>({ data: { phone: null } as never, isLoading: false })
    );
    vi.mocked(useMyBlockedDatesCount).mockReturnValue(
      partialMock<ReturnType<typeof useMyBlockedDatesCount>>({ data: 2, isLoading: false })
    );
    blockAck = false;
    notifyAck = false;

    const { result } = renderHook(() => useArtistOnboardingStatus());
    const s = result.current.status;
    expect(s.steps.find((x) => x.key === "blockDates")!.done).toBe(true);
    // notifications is still gated on phone/ack, unaffected by blocked-dates data
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
