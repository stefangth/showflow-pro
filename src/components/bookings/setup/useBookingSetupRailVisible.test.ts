import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHookWithProviders } from "@/test/renderWithProviders";

const { statusRef, canRef } = vi.hoisted(() => ({
  statusRef: { value: { status: { complete: false, canOffer: false }, isLoading: false } },
  canRef: { value: true },
}));
vi.mock("@/hooks/useBookingSetup", () => ({ useBookingSetupStatus: () => statusRef.value }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canRef.value }));

import { useBookingSetupRailVisible } from "./useBookingSetupRailVisible";

beforeEach(() => {
  localStorage.clear();
  canRef.value = true;
  statusRef.value = { status: { complete: false, canOffer: false } as never, isLoading: false };
});

describe("useBookingSetupRailVisible", () => {
  it("is false without an org", () => {
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible(null));
    expect(result.current).toBe(false);
  });
  it("is true for an admin who can edit while setup is incomplete", () => {
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current).toBe(true);
  });
  it("hides for a non-editor once offers are already possible", () => {
    canRef.value = false;
    statusRef.value = { status: { complete: false, canOffer: true } as never, isLoading: false };
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current).toBe(false);
  });
  it("hides once setup is complete", () => {
    statusRef.value = { status: { complete: true, canOffer: true } as never, isLoading: false };
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current).toBe(false);
  });
});
