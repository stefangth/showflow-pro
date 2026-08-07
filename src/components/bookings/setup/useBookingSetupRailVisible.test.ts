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
  it("is not visible without an org", () => {
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible(null));
    expect(result.current).toEqual({ visible: false, reinvocable: false });
  });
  it("is visible for an admin who can edit while setup is incomplete", () => {
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current.visible).toBe(true);
  });
  it("hides for a non-editor once offers are already possible", () => {
    canRef.value = false;
    statusRef.value = { status: { complete: false, canOffer: true } as never, isLoading: false };
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current.visible).toBe(false);
  });
  it("hides once setup is complete", () => {
    statusRef.value = { status: { complete: true, canOffer: true } as never, isLoading: false };
    const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
    expect(result.current.visible).toBe(false);
  });

  // The finding this covers: the header re-invoke button used to be gated
  // independently (`dismissed && !complete`), so it could offer to reopen a
  // rail that -- once undismissed -- would render nothing actionable.
  // `reinvocable` is exactly `visible` minus the dismissed check.
  describe("reinvocable", () => {
    it("is true once a genuinely actionable rail has been dismissed", () => {
      localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
      const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
      expect(result.current).toEqual({ visible: false, reinvocable: true });
    });

    it("is false when dismissed but nothing would be actionable once reopened (non-editor, offers already possible)", () => {
      canRef.value = false;
      statusRef.value = { status: { complete: false, canOffer: true } as never, isLoading: false };
      localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
      const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
      expect(result.current).toEqual({ visible: false, reinvocable: false });
    });

    it("is false once setup is complete, even if previously dismissed", () => {
      statusRef.value = { status: { complete: true, canOffer: true } as never, isLoading: false };
      localStorage.setItem("showflow.bookingSetup.hidden.org-1", "true");
      const { result } = renderHookWithProviders(() => useBookingSetupRailVisible("org-1"));
      expect(result.current).toEqual({ visible: false, reinvocable: false });
    });
  });
});
