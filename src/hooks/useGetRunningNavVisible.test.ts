import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Hoisted, overridable mock fns — same pattern as useDashboardFirstRun.test.tsx.
type NavModel = { complete: boolean; bookingOn: boolean; hireOrdersOn: boolean };
const onOrg = (complete: boolean): NavModel => ({ complete, bookingOn: true, hireOrdersOn: true });

const h = vi.hoisted(() => ({
  hasRole: vi.fn((r: string) => r === "admin"),
  model: vi.fn((): { complete: boolean; bookingOn: boolean; hireOrdersOn: boolean } | null => ({
    complete: false,
    bookingOn: true,
    hireOrdersOn: true,
  })),
  dismissed: vi.fn(() => false),
}));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" }, hasRole: h.hasRole }),
}));
vi.mock("@/hooks/useGetRunning", () => ({
  useGetRunning: () => ({ model: h.model(), isLoading: false }),
}));
vi.mock("@/components/setup/useRailDismissed", () => ({
  useRailDismissed: () => [h.dismissed(), vi.fn(), vi.fn()],
}));

import { useGetRunningNavVisible } from "./useGetRunningNavVisible";

afterEach(() => {
  h.hasRole.mockImplementation((r: string) => r === "admin");
  h.model.mockReturnValue(onOrg(false));
  h.dismissed.mockReturnValue(false);
});

describe("useGetRunningNavVisible", () => {
  it("stays visible for an artist without reading the model", () => {
    h.hasRole.mockReturnValue(false);
    const { result } = renderHook(() => useGetRunningNavVisible());
    expect(result.current).toBe(true);
  });

  it("stays visible while the board is not complete", () => {
    h.model.mockReturnValue(onOrg(false));
    const { result } = renderHook(() => useGetRunningNavVisible());
    expect(result.current).toBe(true);
  });

  it("stays visible once complete but not yet dismissed", () => {
    h.model.mockReturnValue(onOrg(true));
    h.dismissed.mockReturnValue(false);
    const { result } = renderHook(() => useGetRunningNavVisible());
    expect(result.current).toBe(true);
  });

  it("hides once complete AND dismissed", () => {
    h.model.mockReturnValue(onOrg(true));
    h.dismissed.mockReturnValue(true);
    const { result } = renderHook(() => useGetRunningNavVisible());
    expect(result.current).toBe(false);
  });

  it("hides for a nothing-on org (no module entitled), even if not dismissed", () => {
    // complete is vacuously true for an empty task list, but there is nothing to set up.
    h.model.mockReturnValue({ complete: true, bookingOn: false, hireOrdersOn: false });
    h.dismissed.mockReturnValue(false);
    const { result } = renderHook(() => useGetRunningNavVisible());
    expect(result.current).toBe(false);
  });

  it("fails open (visible) while the model is still loading (null)", () => {
    h.model.mockReturnValue(null);
    h.dismissed.mockReturnValue(true);
    const { result } = renderHook(() => useGetRunningNavVisible());
    expect(result.current).toBe(true);
  });
});
