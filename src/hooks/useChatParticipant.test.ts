import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useChatParticipant } from "./useChatParticipant";
import { partialMock } from "@/test/castHelpers";
import type { User, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

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


/** Route a shared chain stub through the single sanctioned boundary cast. */
function mockFromChain(chain: unknown) {
  vi.mocked(supabase.from).mockImplementation(
    partialMock<SupabaseClient<Database>["from"]>(() => chain),
  );
}

describe("useChatParticipant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true immediately for admin without querying bookings", async () => {
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: partialMock<User>({ id: "user-admin" }),
      hasRole: (role: string) => role === "admin",
    }));

    const { result } = renderHook(() => useChatParticipant("date-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(true);
    });
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled();
  });

  it("returns true immediately for producer without querying bookings", async () => {
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: partialMock<User>({ id: "user-producer" }),
      hasRole: (role: string) => role === "producer",
    }));

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
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: partialMock<User>({ id: userId }),
      hasRole: () => false,
    }));

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{ id: "booking-1", artist: { user_id: userId } }],
        error: null,
      }),
    };
    mockFromChain(mockChain);

    const { result } = renderHook(() => useChatParticipant("date-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(true);
    });
  });

  it("returns false for artist without a booking on the date", async () => {
    const userId = "user-artist-2";
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: partialMock<User>({ id: userId }),
      hasRole: () => false,
    }));

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{ id: "booking-1", artist: { user_id: "different-user" } }],
        error: null,
      }),
    };
    mockFromChain(mockChain);

    const { result } = renderHook(() => useChatParticipant("date-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBe(false);
    });
  });

  it("is disabled when showDateId is null", () => {
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: partialMock<User>({ id: "user-1" }),
      hasRole: () => false,
    }));

    const { result } = renderHook(() => useChatParticipant(null), {
      wrapper: makeWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
  });

  it("is disabled when user is null", () => {
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: null,
      hasRole: () => false,
    }));

    const { result } = renderHook(() => useChatParticipant("date-1"), {
      wrapper: makeWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
  });

  it("reacts to changed showDateId", async () => {
    const userId = "user-artist-1";
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({
      user: partialMock<User>({ id: userId }),
      hasRole: () => false,
    }));

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    mockFromChain(mockChain);

    const { rerender, result } = renderHook(
      ({ dateId }) => useChatParticipant(dateId),
      { wrapper: makeWrapper(), initialProps: { dateId: "date-1" } }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ dateId: "date-2" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
