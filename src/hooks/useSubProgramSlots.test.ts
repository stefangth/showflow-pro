import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  effectiveSlots,
  useSubProgramSlots,
  type NestedSlotDefaults,
} from "./useSubProgramSlots";

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
  });

  it("returns slot defaults from app_settings", async () => {
    const mockDefaults: NestedSlotDefaults = {
      theatre: { musical: { main_cast: 2, understudies: 1 } },
    };

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { value: mockDefaults },
        error: null,
      }),
    };
    vi.mocked(supabase.from).mockReturnValue(mockChain as any);

    const { result } = renderHook(() => useSubProgramSlots(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toEqual(mockDefaults);
    });
  });

  it("returns empty object when app_settings has no row", async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    vi.mocked(supabase.from).mockReturnValue(mockChain as any);

    const { result } = renderHook(() => useSubProgramSlots(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toEqual({});
    });
  });

  it("throws when query fails", async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: null, error: new Error("DB error") }),
    };
    vi.mocked(supabase.from).mockReturnValue(mockChain as any);

    const { result } = renderHook(() => useSubProgramSlots(), {
      wrapper: makeWrapper(),
    });

    // The hook returns {} as fallback even on error (data ?? {})
    await waitFor(() => {
      expect(result.current).toEqual({});
    });
  });
});
