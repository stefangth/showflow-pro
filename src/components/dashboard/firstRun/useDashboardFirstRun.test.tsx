import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Hoisted, overridable mock fns for the slices the artist cases need to vary
// (entitlements, hire-order status, artist status). Their default returns keep the
// existing admin cases unchanged; individual tests override them and afterEach restores.
const h = vi.hoisted(() => ({
  entitlements: vi.fn(() => ({ features: new Set(["booking_flow"]), isLoading: false })),
  hireStatus: vi.fn(() => ({ status: { steps: [], complete: true }, isLoading: false })),
  artistStatus: vi.fn(() => ({ status: { steps: [], complete: true }, ackBlock: () => {}, ackNotify: () => {} })),
}));

// String-path vi.mock factories are not strictly type-checked (MockFactoryWithHelper
// defaults its module param to `unknown`), so these partial stubs stand in for the real
// read hooks without `as never`. They pin the pure composition under test.
vi.mock("@/hooks/useEntitlements", () => ({
  useEntitlements: () => h.entitlements(),
}));
vi.mock("@/hooks/useBookingSetup", () => ({
  useBookingSetupStatus: () => ({
    status: {
      steps: [
        { key: "flow", done: false, block: null },
        { key: "slots", done: false, block: "filling" },
        { key: "ladder", done: false, block: "offers" },
        { key: "eligibility", done: false, block: null },
        { key: "timing", done: false, block: null },
      ],
      complete: false,
    },
    coverage: null,
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useHireOrderSetup", () => ({
  useHireOrderSetupStatus: () => h.hireStatus(),
}));
vi.mock("@/hooks/useNavCounts", () => ({
  useNavCounts: () => ({ pendingConfirmations: 4, openOffers: 2, awaitingCountersign: 1 }),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: { artist_acceptance: true } }),
}));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "o1", name: "Halle Kollektiv" } }),
}));
vi.mock("@/components/setup/useRailDismissed", () => ({
  useRailDismissed: () => [false, vi.fn(), vi.fn()],
}));
vi.mock("./useArtistOnboardingStatus", () => ({
  useArtistOnboardingStatus: () => h.artistStatus(),
}));

import { useDashboardFirstRun } from "./useDashboardFirstRun";

afterEach(() => {
  h.entitlements.mockReturnValue({ features: new Set(["booking_flow"]), isLoading: false });
  h.hireStatus.mockReturnValue({ status: { steps: [], complete: true }, isLoading: false });
  h.artistStatus.mockReturnValue({ status: { steps: [], complete: true }, ackBlock: () => {}, ackNotify: () => {} });
});

describe("useDashboardFirstRun", () => {
  it("composes an incomplete admin first-run with only the enabled module", () => {
    const { result } = renderHook(() => useDashboardFirstRun("admin"));
    const s = result.current;
    expect(s.show).toBe(true);
    expect(s.complete).toBe(false);
    expect(s.steps.map((x) => x.key)).toEqual(["flow", "slots", "ladder", "eligibility", "timing"]); // hire_orders not enabled
    expect(s.welcome.headline).toContain("Halle Kollektiv");
    expect(s.offFooters).toContain("Hire orders is off for this org. Ask your account manager to switch it on.");
  });

  it("threads progress into welcome copy and section framing", () => {
    const { result } = renderHook(() => useDashboardFirstRun("admin"));
    const s = result.current;
    expect(s.welcome.progressTotal).toBe(5);
    expect(s.welcome.progressFilled).toBe(0);
    expect(s.sectionTitle).toBe("What this page becomes");
    expect(s.railOpen).toBe(false);
    expect(s.dismissed).toBe(false);
  });

  it("opening and closing the rail flips railOpen", () => {
    const { result } = renderHook(() => useDashboardFirstRun("admin"));
    act(() => result.current.openRail());
    expect(result.current.railOpen).toBe(true);
    act(() => result.current.closeRail());
    expect(result.current.railOpen).toBe(false);
  });

  it("composes the artist personal-readiness steps, not the engine steps", () => {
    h.artistStatus.mockReturnValue({
      status: {
        steps: [
          { key: "accountLinked", done: true, block: null },
          { key: "blockDates", done: false, block: null },
          { key: "notifications", done: false, block: null },
        ],
        complete: false,
      },
      ackBlock: () => {},
      ackNotify: () => {},
    });
    const { result } = renderHook(() => useDashboardFirstRun("artist"));
    const s = result.current;
    expect(s.show).toBe(true);
    expect(s.steps.map((x) => x.key)).toEqual(["accountLinked", "blockDates", "notifications"]);
    expect(s.welcome.headline).toContain("Halle Kollektiv");
  });

  it("never inherits the admin hire-order steps even when hire_orders is enabled", () => {
    h.entitlements.mockReturnValue({ features: new Set(["booking_flow", "hire_orders"]), isLoading: false });
    // A non-empty hire status: if the artist path regressed to composeOnboarding,
    // these keys would leak into the artist's steps.
    h.hireStatus.mockReturnValue({
      status: {
        steps: [
          { key: "letterhead", done: false },
          { key: "terms", done: false },
          { key: "countersign", done: false },
        ],
        complete: false,
      },
      isLoading: false,
    });
    h.artistStatus.mockReturnValue({
      status: {
        steps: [
          { key: "accountLinked", done: true, block: null },
          { key: "blockDates", done: false, block: null },
          { key: "notifications", done: false, block: null },
        ],
        complete: false,
      },
      ackBlock: () => {},
      ackNotify: () => {},
    });
    const { result } = renderHook(() => useDashboardFirstRun("artist"));
    const keys = result.current.steps.map((x) => x.key);
    expect(keys).toEqual(["accountLinked", "blockDates", "notifications"]);
    expect(keys).not.toContain("letterhead");
    expect(keys).not.toContain("terms");
    expect(keys).not.toContain("countersign");
  });
});
