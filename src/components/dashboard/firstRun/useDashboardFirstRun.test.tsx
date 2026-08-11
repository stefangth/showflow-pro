import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Hoisted, overridable mock fns for the slices the artist cases need to vary
// (entitlements, hire-order status, artist status). Their default returns keep the
// existing admin cases unchanged; individual tests override them and afterEach restores.
const h = vi.hoisted(() => {
  // Composed by the real engine (see blankOrgStatus below) rather than hand-listed, so the
  // step set and the "0 of N" headline these tests assert cannot drift from
  // computeBookingSetupStatus the next time a step is added.
  const defaultBooking = () => ({ status: blankOrgStatus(), coverage: null, isLoading: false });
  return {
    defaultBooking,
    entitlements: vi.fn(() => ({ features: new Set(["booking_flow"]), isLoading: false })),
    bookingStatus: vi.fn(defaultBooking),
    hireStatus: vi.fn(() => ({ status: { steps: [], complete: true }, isLoading: false })),
    artistStatus: vi.fn(() => ({ status: { steps: [], complete: true }, isLoading: false })),
    // The org's flow is now half of what the welcome copy and the rules block SAY, so its
    // loading state has to be overridable here the way every other read's is.
    flow: vi.fn(() => ({ data: { artist_acceptance: true }, isLoading: false })),
  };
});

// String-path vi.mock factories are not strictly type-checked (MockFactoryWithHelper
// defaults its module param to `unknown`), so these partial stubs stand in for the real
// read hooks without `as never`. They pin the pure composition under test.
vi.mock("@/hooks/useEntitlements", () => ({
  useEntitlements: () => h.entitlements(),
}));
vi.mock("@/hooks/useBookingSetup", () => ({
  useBookingSetupStatus: () => h.bookingStatus(),
}));
vi.mock("@/hooks/useHireOrderSetup", () => ({
  useHireOrderSetupStatus: () => h.hireStatus(),
}));
vi.mock("@/hooks/useNavCounts", () => ({
  useNavCounts: () => ({ pendingConfirmations: 4, openOffers: 2, awaitingCountersign: 1 }),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => h.flow(),
}));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "o1", name: "Halle Kollektiv" } }),
}));
// Producer copy is capability-aware; default the grant off so the admin/producer/artist
// composition assertions below exercise the non-capable framing.
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => false }));
vi.mock("@/components/setup/useRailDismissed", () => ({
  useRailDismissed: () => [false, vi.fn(), vi.fn()],
}));
vi.mock("./useArtistOnboardingStatus", () => ({
  useArtistOnboardingStatus: () => h.artistStatus(),
}));

import { useDashboardFirstRun } from "./useDashboardFirstRun";
import { computeBookingSetupStatus } from "@/lib/bookings/setupStatus";

/** A never-configured org, straight from the engine: every step outstanding. Declared as a
 *  hoisted function so the vi.hoisted factory above can call it once the imports are live. */
function blankOrgStatus() {
  return computeBookingSetupStatus({
    flowChosen: false, hasAnyShows: false, shows: [], timingChosen: false,
    coverage: null, artistCount: 0, artistAcceptance: null,
  });
}

afterEach(() => {
  h.entitlements.mockReturnValue({ features: new Set(["booking_flow"]), isLoading: false });
  h.bookingStatus.mockImplementation(h.defaultBooking);
  h.hireStatus.mockReturnValue({ status: { steps: [], complete: true }, isLoading: false });
  h.artistStatus.mockReturnValue({ status: { steps: [], complete: true }, isLoading: false });
  h.flow.mockReturnValue({ data: { artist_acceptance: true }, isLoading: false });
});

describe("useDashboardFirstRun", () => {
  it("composes an incomplete admin first-run with only the enabled module", () => {
    const { result } = renderHook(() => useDashboardFirstRun("admin"));
    const s = result.current;
    expect(s.show).toBe(true);
    expect(s.complete).toBe(false);
    // hire_orders is not entitled, so only the booking module contributes.
    expect(s.steps.map((x) => x.key)).toEqual(["shows", "slots", "flow", "people", "ladder", "eligibility", "timing"]);
    expect(s.welcome.headline).toContain("Halle Kollektiv");
    expect(s.offFooters).toContain("Hire orders is off for this org. Ask your account manager to switch it on.");
  });

  it("threads progress into welcome copy and section framing", () => {
    const { result } = renderHook(() => useDashboardFirstRun("admin"));
    const s = result.current;
    // The user-facing "0 of N": N is whatever the engine reports, not a literal, so adding
    // a step does not need a second edit here to stay true.
    expect(s.welcome.progressTotal).toBe(blankOrgStatus().steps.length);
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
          { key: "blockDates", done: false, block: null },
        ],
        complete: false,
      },
      isLoading: false,
    });
    const { result } = renderHook(() => useDashboardFirstRun("artist"));
    const s = result.current;
    expect(s.show).toBe(true);
    expect(s.steps.map((x) => x.key)).toEqual(["blockDates"]);
    expect(s.welcome.headline).toContain("Halle Kollektiv");
  });

  it("shows an artist nothing until the org's flow has been read", () => {
    // Both the welcome copy and the rules block branch on artist_acceptance, and the
    // fallback while the read is in flight is BOOKING_FLOW_DEFAULTS, which runs offers. For
    // admin and producer that is unobservable, because useBookingSetupStatus issues the
    // identical query key and its own isLoading already gates this card. For an ARTIST
    // every booking query is disabled (bookingOrgId is null), so nothing else was holding
    // the card back: a direct-book artist read "Your first offers are on their way" until
    // the flow landed, directly above a rules block that says there are no offers.
    h.flow.mockReturnValue({ data: undefined, isLoading: true });
    h.artistStatus.mockReturnValue({
      status: { steps: [{ key: "blockDates", done: false, block: null }], complete: false },
      isLoading: false,
    });
    expect(renderHook(() => useDashboardFirstRun("artist")).result.current.show).toBe(false);
  });

  it("holds the admin card back for the same unread flow", () => {
    // Same rule, stated for the other roles so a future refactor cannot quietly make the
    // gate artist-only again.
    h.flow.mockReturnValue({ data: undefined, isLoading: true });
    expect(renderHook(() => useDashboardFirstRun("admin")).result.current.show).toBe(false);
  });

  it("narrates direct booking to an artist once the flow says so", () => {
    h.flow.mockReturnValue({ data: { artist_acceptance: false }, isLoading: false });
    h.artistStatus.mockReturnValue({
      status: { steps: [{ key: "blockDates", done: true, block: null }], complete: true },
      isLoading: false,
    });
    const s = renderHook(() => useDashboardFirstRun("artist")).result.current;
    expect(s.show).toBe(true);
    expect(s.welcome.headline).not.toMatch(/offers/i);
    // The rules block that sits under this headline agrees with it. (Its own copy guard
    // lives in moduleOnboarding.test.ts; here the point is only that the two surfaces are
    // reading the same flow.)
    expect(s.rules.map((r) => r.title)).toContain("You are booked directly");
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
          { key: "blockDates", done: false, block: null },
        ],
        complete: false,
      },
      isLoading: false,
    });
    const { result } = renderHook(() => useDashboardFirstRun("artist"));
    const keys = result.current.steps.map((x) => x.key);
    expect(keys).toEqual(["blockDates"]);
    expect(keys).not.toContain("letterhead");
    expect(keys).not.toContain("terms");
    expect(keys).not.toContain("countersign");
  });

  it("stays hidden (no flicker) while the module setup status is still loading", () => {
    // Entitlements resolved but the heavier booking-setup read has not: the gate must
    // keep show=false so a configured org never flashes the greyed Sample state.
    h.bookingStatus.mockReturnValue({ ...h.defaultBooking(), isLoading: true });
    const { result } = renderHook(() => useDashboardFirstRun("admin"));
    expect(result.current.show).toBe(false);
  });

  it("recomposes the step set when the entitlement set changes", () => {
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

    h.entitlements.mockReturnValue({ features: new Set(["booking_flow", "hire_orders"]), isLoading: false });
    const withHire = renderHook(() => useDashboardFirstRun("admin"));
    const withHireKeys = withHire.result.current.steps.map((x) => x.key);

    h.entitlements.mockReturnValue({ features: new Set(["booking_flow"]), isLoading: false });
    const withoutHire = renderHook(() => useDashboardFirstRun("admin"));
    const withoutHireKeys = withoutHire.result.current.steps.map((x) => x.key);

    expect(withHireKeys.length).toBeGreaterThan(withoutHireKeys.length);
    expect(withHireKeys).toContain("letterhead");
    expect(withoutHireKeys).not.toContain("letterhead");
  });

  it("an artist's dismiss collapses the rail (resumable, so it just closes)", () => {
    // dismiss's only observable effect here is setRailOpen(false); completion comes from
    // the status hook, not from dismiss (that "never marks done" guarantee lives in
    // useArtistOnboardingStatus, which has no ack path). Assert the effect that a
    // regression could actually break.
    h.artistStatus.mockReturnValue({
      status: {
        steps: [
          { key: "blockDates", done: false, block: null },
        ],
        complete: false,
      },
      isLoading: false,
    });
    const { result } = renderHook(() => useDashboardFirstRun("artist"));
    act(() => result.current.openRail());
    expect(result.current.railOpen).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.railOpen).toBe(false);
  });
});
