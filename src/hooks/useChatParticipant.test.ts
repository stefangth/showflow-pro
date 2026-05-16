import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useChatParticipant } from "./useChatParticipant";

// ── Mock Supabase client ──────────────────────────────────────────────────

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

// ── Mock AuthContext ──────────────────────────────────────────────────────

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useChatParticipant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true immediately for admin without querying bookings", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-admin" } as any,
      hasRole: (role: string) => role === "admin",
    } as any);

    const { result } = renderHook(() => useChatParticipant("date-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(true);
    });
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled();
  });

  it("returns true immediately for producer without querying bookings", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-producer" } as any,
      hasRole: (role: string) => role === "producer",
    } as any);

    const { result } = renderHook(() => useChatParticipant("date-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(true);
    });
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled();
  });

  it("returns true for artist with a soft_booked/confirmed booking on the date", async () => {
    const userId = "user-artist-1";
    vi.mocked(useAuth).mockReturnValue({
      user: { id: userId } as any,
      hasRole: () => false,
    } as any);

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{ id: "booking-1", artist: { user_id: userId } }],
        error: null,
      }),
    };
    vi.mocked(supabase.from).mockReturnValue(mockChain as any);

    const { result } = renderHook(() => useChatParticipant("date-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(true);
    });
  });

  it("returns false for artist without a booking on the date", async () => {
    const userId = "user-artist-2";
    vi.mocked(useAuth).mockReturnValue({
      user: { id: userId } as any,
      hasRole: () => false,
    } as any);

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{ id: "booking-1", artist: { user_id: "different-user" } }],
        error: null,
      }),
    };
    vi.mocked(supabase.from).mockReturnValue(mockChain as any);

    const { result } = renderHook(() => useChatParticipant("date-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(false);
    });
  });

  it("is disabled when showDateId is null", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "user-1" } as any,
      hasRole: () => false,
    } as any);

    const { result } = renderHook(() => useChatParticipant(null), {
      wrapper: makeWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
  });

  it("is disabled when user is null", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      hasRole: () => false,
    } as any);

    const { result } = renderHook(() => useChatParticipant("date-1"), {
      wrapper: makeWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
  });

  it("reacts to changed showDateId", async () => {
    const userId = "user-artist-1";
    vi.mocked(useAuth).mockReturnValue({
      user: { id: userId } as any,
      hasRole: () => false,
    } as any);

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    vi.mocked(supabase.from).mockReturnValue(mockChain as any);

    const { rerender, result } = renderHook(
      ({ dateId }) => useChatParticipant(dateId),
      { wrapper: makeWrapper(), initialProps: { dateId: "date-1" } }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ dateId: "date-2" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
