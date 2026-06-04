import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  effectiveSlots,
  useSubProgramSlots,
  type NestedSlotDefaults,
} from "./useSubProgramSlots";

// useSubProgramSlots is now a thin wrapper: it reads the active org from useAuth and
// delegates to fetchSlotDefaults (the resolver is unit-tested in src/data/settings.test.ts).
// Mock those two boundaries; supabase is only passed through, never exercised here.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/data/settings", () => ({ fetchSlotDefaults: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { fetchSlotDefaults } from "@/data/settings";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

// ── effectiveSlots pure function tests ────────────────────────────────────

describe("effectiveSlots", () => {
  const defaults: NestedSlotDefaults = {
    theatre: {
      musical: { main_cast: 2, understudies: 1 },
      comedy: { main_cast: 0, understudies: 0 },
    },
  };

  it("returns config for a known (program, sub_program) pair", () => {
    const result = effectiveSlots(defaults, "theatre", "musical");
    expect(result).toEqual({ main_cast: 2, understudies: 1 });
  });

  it("returns null when program is missing", () => {
    expect(effectiveSlots(defaults, null, "musical")).toBeNull();
  });

  it("returns null when sub_program is missing", () => {
    expect(effectiveSlots(defaults, "theatre", null)).toBeNull();
  });

  it("returns null when (program, sub_program) pair is not configured", () => {
    expect(effectiveSlots(defaults, "theatre", "opera")).toBeNull();
  });

  it("returns null when program is not in defaults", () => {
    expect(effectiveSlots(defaults, "circus", "acrobatics")).toBeNull();
  });

  it("returns null when both thresholds are 0 (unconfigured pair)", () => {
    expect(effectiveSlots(defaults, "theatre", "comedy")).toBeNull();
  });

  it("returns null for empty defaults object", () => {
    expect(effectiveSlots({}, "theatre", "musical")).toBeNull();
  });

  it("handles undefined defaults gracefully", () => {
    expect(effectiveSlots(undefined as unknown as NestedSlotDefaults, "theatre", "musical")).toBeNull();
  });
});

// ── useSubProgramSlots hook tests ─────────────────────────────────────────

describe("useSubProgramSlots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-1" } } as never);
  });

  it("resolves slot defaults for the active org", async () => {
    const mockDefaults: NestedSlotDefaults = {
      theatre: { musical: { main_cast: 2, understudies: 1 } },
    };
    vi.mocked(fetchSlotDefaults).mockResolvedValue(mockDefaults);

    const { result } = renderHook(() => useSubProgramSlots(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toEqual(mockDefaults);
    });
    expect(fetchSlotDefaults).toHaveBeenCalledWith(expect.anything(), "org-1");
  });

  it("passes null org when there is no active org", async () => {
    vi.mocked(useAuth).mockReturnValue({ currentOrg: null } as never);
    vi.mocked(fetchSlotDefaults).mockResolvedValue({});

    const { result } = renderHook(() => useSubProgramSlots(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toEqual({});
    });
    expect(fetchSlotDefaults).toHaveBeenCalledWith(expect.anything(), null);
  });

  it("returns empty object when the resolver returns none", async () => {
    vi.mocked(fetchSlotDefaults).mockResolvedValue({});

    const { result } = renderHook(() => useSubProgramSlots(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toEqual({});
    });
  });

  it("returns empty object when the query fails", async () => {
    vi.mocked(fetchSlotDefaults).mockRejectedValue(new Error("DB error"));

    const { result } = renderHook(() => useSubProgramSlots(), {
      wrapper: makeWrapper(),
    });

    // The hook returns {} as fallback even on error (data ?? {}).
    await waitFor(() => {
      expect(result.current).toEqual({});
    });
  });
});
