import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Hoisted, overridable mock fns for every slice this hook reads. Their default returns
// keep the "normal admin org" cases passing without per-test setup; individual tests
// override one or more and afterEach restores every default.
const h = vi.hoisted(() => {
  // Composed by the real engine (see blankOrgStatus below) rather than hand-listed, so
  // the step set cannot drift from computeBookingSetupStatus the next time a step is
  // added.
  const defaultBooking = () => ({ status: blankOrgStatus(), coverage: null, isLoading: false });
  const defaultMetrics = () => ({
    metrics: {
      datesIn: 0, readyToOffer: 0, bookableDates: 0, confirmed: 0, hireDrafts: 0,
      eligibleDates: 0, blockedDates: 0, arriving: 0, toSign: 0,
    },
    timing: { digestHourBerlin: 19, responseWindowHours: 48 },
    isLoading: false,
  });
  const defaultProvenance = () => ({ byYou: true, actorName: null, changedAt: null });
  return {
    defaultBooking,
    defaultMetrics,
    defaultProvenance,
    entitlements: vi.fn(() => ({ features: new Set(["booking_flow"]), isLoading: false })),
    bookingStatus: vi.fn(defaultBooking),
    producerCount: vi.fn((): number | null => 0),
    hireStatus: vi.fn(() => ({ status: { steps: [], complete: true }, isLoading: false })),
    artistStatus: vi.fn(() => ({ status: { steps: [], complete: true }, isLoading: false })),
    flow: vi.fn(() => ({ data: { artist_acceptance: true }, isLoading: false })),
    metrics: vi.fn(defaultMetrics),
    provenance: vi.fn(defaultProvenance),
    dismissFn: vi.fn(),
    undismissFn: vi.fn(),
    dismissedValue: false,
  };
});

// String-path vi.mock factories are not strictly type-checked (MockFactoryWithHelper
// defaults its module param to `unknown`), so these partial stubs stand in for the real
// read hooks without `as never`. They pin the pure composition under test. Never mocks
// the supabase client itself — every hook that touches it (useFirstRunMetrics,
// useBookingFlowProvenance) is mocked whole instead.
vi.mock("@/hooks/useEntitlements", () => ({
  useEntitlements: () => h.entitlements(),
}));
vi.mock("@/hooks/useBookingSetup", () => ({
  useBookingSetupStatus: () => h.bookingStatus(),
  useProducerCount: () => h.producerCount(),
}));
vi.mock("@/hooks/useHireOrderSetup", () => ({
  useHireOrderSetupStatus: () => h.hireStatus(),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => h.flow(),
}));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "o1", name: "Halle Kollektiv" } }),
}));
// Producer copy is capability-aware; default the grant off so the non-capable framing is
// exercised unless a test opts in.
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => false }));
vi.mock("@/components/setup/useRailDismissed", () => ({
  useRailDismissed: () => [h.dismissedValue, h.dismissFn, h.undismissFn],
}));
vi.mock("./useArtistOnboardingStatus", () => ({
  useArtistOnboardingStatus: () => h.artistStatus(),
}));
vi.mock("@/hooks/useFirstRunMetrics", () => ({
  useFirstRunMetrics: () => h.metrics(),
}));
vi.mock("@/hooks/useBookingFlowProvenance", () => ({
  useBookingFlowProvenance: () => h.provenance(),
}));

import { useDashboardFirstRun } from "./useDashboardFirstRun";
import { computeBookingSetupStatus } from "@/lib/bookings/setupStatus";

/** A never-configured org, straight from the engine: every step outstanding. Declared as
 *  a hoisted function so the vi.hoisted factory above can call it once the imports are
 *  live. */
function blankOrgStatus() {
  return computeBookingSetupStatus({
    flowChosen: false, hasAnyShows: false, shows: [], timingChosen: false,
    coverage: null, artistCount: 0, artistAcceptance: null,
  });
}

afterEach(() => {
  h.entitlements.mockReturnValue({ features: new Set(["booking_flow"]), isLoading: false });
  h.bookingStatus.mockImplementation(h.defaultBooking);
  h.producerCount.mockReturnValue(0);
  h.hireStatus.mockReturnValue({ status: { steps: [], complete: true }, isLoading: false });
  h.artistStatus.mockReturnValue({ status: { steps: [], complete: true }, isLoading: false });
  h.flow.mockReturnValue({ data: { artist_acceptance: true }, isLoading: false });
  h.metrics.mockImplementation(h.defaultMetrics);
  h.provenance.mockImplementation(h.defaultProvenance);
  h.dismissedValue = false;
  h.dismissFn.mockClear();
  h.undismissFn.mockClear();
});

describe("useDashboardFirstRun", () => {
  it("composes a running chain for a normal admin org (booking on, some dates)", () => {
    h.metrics.mockReturnValue({
      metrics: { ...h.defaultMetrics().metrics, datesIn: 5, readyToOffer: 2 },
      timing: { digestHourBerlin: 19, responseWindowHours: 48 },
      isLoading: false,
    });

    const { result } = renderHook(() => useDashboardFirstRun("admin"));
    const s = result.current;

    expect(s.show).toBe(true);
    // Non-artist always composes exactly 4 stages (dates/offers/confirm/hire), whether
    // or not every module is licensed — an unlicensed one renders "off", it isn't absent.
    expect(s.result.stages.length).toBe(4);
    expect(s.result.nothingOn).toBe(false);
    expect(s.result.hasChain).toBe(true);
  });

  it("regression: renders the no-modules floor state instead of vanishing (the bug this task fixes)", () => {
    h.entitlements.mockReturnValue({ features: new Set(), isLoading: false });

    const { result } = renderHook(() => useDashboardFirstRun("admin"));
    const s = result.current;

    // Under the old gate (`composed.steps.length > 0`) this org composed zero steps and
    // the whole surface vanished. It must now render the floor state explaining why.
    expect(s.show).toBe(true);
    expect(s.result.nothingOn).toBe(true);
    expect(s.result.hasChain).toBe(false);
    expect(s.result.headline).toBe("No modules are switched on for Halle Kollektiv");
  });

  it("assembles the admin sample queueRows from SAMPLE_PREVIEW, mapping tone to dot", () => {
    const { result } = renderHook(() => useDashboardFirstRun("admin"));
    const rows = result.current.queueRows;

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      dot: "accent",
      title: "6 artists accepted and are waiting on a confirm",
      hint: "Kammerkonzert 12 Aug, Nachtstück 14 Aug",
      when: "now",
      cta: "Confirm",
    });
    // "warning" tone (no third dot state) collapses into "accent".
    expect(rows[1].dot).toBe("accent");
    expect(rows[2]).toMatchObject({ dot: "faint", cta: "Review" });
  });

  it("assembles the producer sample queueRows from SAMPLE_PREVIEW", () => {
    const { result } = renderHook(() => useDashboardFirstRun("producer"));
    const rows = result.current.queueRows;

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.cta)).toEqual(["Confirm", "Open date", "Sign"]);
  });

  it("assembles live artist queueRows (offers on, imported): digest row + blocked-dates row, using the configured digest hour", () => {
    // Digest hour deliberately not the default (19) and not the old hardcoded "09:00" —
    // proves the row reads timing.digestHourBerlin instead of a literal.
    h.metrics.mockReturnValue({
      metrics: { ...h.defaultMetrics().metrics, eligibleDates: 4, arriving: 3, blockedDates: 2 },
      timing: { digestHourBerlin: 7, responseWindowHours: 24 },
      isLoading: false,
    });
    h.flow.mockReturnValue({ data: { artist_acceptance: true }, isLoading: false });

    const { result } = renderHook(() => useDashboardFirstRun("artist"));
    const rows = result.current.queueRows;

    expect(rows).toEqual([
      { dot: "accent", title: "3 offers arriving in tomorrow's digest", hint: "Your producer's schedule", when: "07:00", cta: "Open" },
      { dot: "faint", title: "2 dates blocked", hint: "Kept out of every list before anyone books you", when: "", cta: "Edit" },
    ]);
    // No em-dash anywhere in the "when" columns (house rule): a middot or empty string
    // only, never "—".
    expect(rows.every((r) => !r.when.includes("—"))).toBe(true);
  });

  it("assembles live artist queueRows using the default digest hour (19:00) when the org has not customized it", () => {
    h.metrics.mockReturnValue({
      metrics: { ...h.defaultMetrics().metrics, eligibleDates: 4, arriving: 1, blockedDates: 0 },
      timing: { digestHourBerlin: 19, responseWindowHours: 48 },
      isLoading: false,
    });
    h.flow.mockReturnValue({ data: { artist_acceptance: true }, isLoading: false });

    const { result } = renderHook(() => useDashboardFirstRun("artist"));
    const rows = result.current.queueRows;

    expect(rows[0].when).toBe("19:00");
  });

  it("assembles live artist queueRows (direct booking, imported): confirmed-dates row, singular offer wording never applies", () => {
    h.metrics.mockReturnValue({
      metrics: { ...h.defaultMetrics().metrics, eligibleDates: 4, confirmed: 4, arriving: 0 },
      timing: { digestHourBerlin: 19, responseWindowHours: 48 },
      isLoading: false,
    });
    h.flow.mockReturnValue({ data: { artist_acceptance: false }, isLoading: false });

    const { result } = renderHook(() => useDashboardFirstRun("artist"));
    const rows = result.current.queueRows;

    expect(rows[0].title).toBe("4 dates booked for you");
  });

  it("assembles the not-imported artist placeholder queueRow, worded for the org's flow", () => {
    h.flow.mockReturnValue({ data: { artist_acceptance: true }, isLoading: false });

    const { result } = renderHook(() => useDashboardFirstRun("artist"));
    const rows = result.current.queueRows;

    expect(rows).toEqual([
      { dot: "faint", title: "Nothing yet", hint: "Your first offer lands here once Halle Kollektiv has dates for your cast.", when: "", cta: "" },
    ]);
  });

  it("feeds a synthesized team step into bookingSteps so the admin nudge tracks the real producer count", () => {
    h.producerCount.mockReturnValue(0);
    const notInvited = renderHook(() => useDashboardFirstRun("admin"));
    const confirmSteps1 = notInvited.result.current.result.stages.find((st) => st.key === "confirm")!.steps;
    expect(confirmSteps1.find((st) => st.key === "team")?.done).toBe(false);

    h.producerCount.mockReturnValue(2);
    const invited = renderHook(() => useDashboardFirstRun("admin"));
    const confirmSteps2 = invited.result.current.result.stages.find((st) => st.key === "confirm")!.steps;
    expect(confirmSteps2.find((st) => st.key === "team")?.done).toBe(true);
  });

  it("stays hidden (no flicker) while useFirstRunMetrics is still loading", () => {
    h.metrics.mockReturnValue({ ...h.defaultMetrics(), isLoading: true });
    const { result } = renderHook(() => useDashboardFirstRun("admin"));
    expect(result.current.show).toBe(false);
  });

  it("stays hidden while the module setup status is still loading", () => {
    h.bookingStatus.mockReturnValue({ ...h.defaultBooking(), isLoading: true });
    const { result } = renderHook(() => useDashboardFirstRun("admin"));
    expect(result.current.show).toBe(false);
  });

  it("holds the card back until the org's booking flow has been read (fallback would misreport offers)", () => {
    h.flow.mockReturnValue({ data: undefined, isLoading: true });
    expect(renderHook(() => useDashboardFirstRun("artist")).result.current.show).toBe(false);
    expect(renderHook(() => useDashboardFirstRun("admin")).result.current.show).toBe(false);
  });

  it("passes dismissed/dismiss/undismiss straight through from useRailDismissed", () => {
    h.dismissedValue = true;
    const { result } = renderHook(() => useDashboardFirstRun("admin"));
    expect(result.current.dismissed).toBe(true);

    act(() => result.current.dismiss());
    expect(h.dismissFn).toHaveBeenCalledTimes(1);

    act(() => result.current.undismiss());
    expect(h.undismissFn).toHaveBeenCalledTimes(1);
  });

  it("assembled queueRows (admin sample, producer sample, and every artist branch) never contain an em/en dash", () => {
    // queueRows are hook-assembled from SAMPLE_PREVIEW + artist strings, bypassing the
    // composer's own copy path entirely, so they need their own direct dash check.
    const hasDash = (rows: { title: string; hint: string; when: string; cta: string }[]) =>
      rows.some((r) => [r.title, r.hint, r.when, r.cta].some((f) => /[—–]/.test(f)));

    expect(hasDash(renderHook(() => useDashboardFirstRun("admin")).result.current.queueRows)).toBe(false);
    expect(hasDash(renderHook(() => useDashboardFirstRun("producer")).result.current.queueRows)).toBe(false);

    // Artist, imported + offers on.
    h.metrics.mockReturnValue({
      metrics: { ...h.defaultMetrics().metrics, eligibleDates: 4, arriving: 3, blockedDates: 2 },
      timing: { digestHourBerlin: 7, responseWindowHours: 24 },
      isLoading: false,
    });
    h.flow.mockReturnValue({ data: { artist_acceptance: true }, isLoading: false });
    expect(hasDash(renderHook(() => useDashboardFirstRun("artist")).result.current.queueRows)).toBe(false);

    // Artist, imported + direct booking.
    h.metrics.mockReturnValue({
      metrics: { ...h.defaultMetrics().metrics, eligibleDates: 4, confirmed: 4, arriving: 0 },
      timing: { digestHourBerlin: 19, responseWindowHours: 48 },
      isLoading: false,
    });
    h.flow.mockReturnValue({ data: { artist_acceptance: false }, isLoading: false });
    expect(hasDash(renderHook(() => useDashboardFirstRun("artist")).result.current.queueRows)).toBe(false);

    // Artist, not imported (the placeholder row).
    h.metrics.mockImplementation(h.defaultMetrics);
    h.flow.mockReturnValue({ data: { artist_acceptance: true }, isLoading: false });
    expect(hasDash(renderHook(() => useDashboardFirstRun("artist")).result.current.queueRows)).toBe(false);
  });

  it("exposes openSetupAt as a callable passthrough (the real opener is owned by the page, wired in C3)", () => {
    const { result } = renderHook(() => useDashboardFirstRun("admin"));
    expect(typeof result.current.openSetupAt).toBe("function");
    expect(() => result.current.openSetupAt("booking_flow", "slots")).not.toThrow();
  });
});
