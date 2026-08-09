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
  it("is 'hidden' without an org", () => {
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible(null));
    expect(result.current).toEqual({ mode: "hidden" });
  });

  it("is 'banner' for an editor while setup is incomplete and not dismissed", () => {
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current.mode).toBe("banner");
  });

  it("is 'collapsed' for an editor once dismissed while incomplete", () => {
    localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current.mode).toBe("collapsed");
  });

  it("is 'hidden' for a non-editor once offers are already possible", () => {
    canRef.value = false;
    statusRef.value = { status: { complete: false, canOffer: true } as never, isLoading: false };
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current.mode).toBe("hidden");
  });

  it("is 'button' once complete (editor), even if previously dismissed", () => {
    statusRef.value = { status: { complete: true, canOffer: true } as never, isLoading: false };
    localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current.mode).toBe("button");
  });

  it("is 'hidden' once complete for a non-editor", () => {
    canRef.value = false;
    statusRef.value = { status: { complete: true, canOffer: true } as never, isLoading: false };
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current.mode).toBe("hidden");
  });
});
