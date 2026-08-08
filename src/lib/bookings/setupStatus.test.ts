import { describe, it, expect } from "vitest";
import { resolveCoverage, computeBookingSetupStatus, type LadderCoverageInputs } from "./setupStatus";

describe("resolveCoverage", () => {
  it("covers a pair when the city list has a tier-1 cast", () => {
    const r = resolveCoverage({
      futurePairs: [{ showId: "s1", cityId: "c1" }],
      showPriorities: [],
      cityPriorities: [{ cityId: "c1", castId: "k1", priority: 1 }],
    });
    expect(r.uncoveredPairs).toEqual([]);
    expect(r.hasNullCity).toBe(false);
  });

  it("reports uncovered when the city ladder starts at tier 2", () => {
    const r = resolveCoverage({
      futurePairs: [{ showId: "s1", cityId: "c1" }],
      showPriorities: [],
      cityPriorities: [{ cityId: "c1", castId: "k1", priority: 2 }],
    });
    expect(r.uncoveredPairs).toEqual([{ showId: "s1", cityId: "c1" }]);
  });

  it("lets show-scoped priorities override the city list outright", () => {
    // City list HAS a tier 1, but the show-scoped rows for this (show,city) do not,
    // so the show scope wins and the pair is uncovered (mirrors resolveTierLadder).
    const r = resolveCoverage({
      futurePairs: [{ showId: "s1", cityId: "c1" }],
      showPriorities: [{ showId: "s1", cityId: "c1", castId: "k9", priority: 2 }],
      cityPriorities: [{ cityId: "c1", castId: "k1", priority: 1 }],
    });
    expect(r.uncoveredPairs).toEqual([{ showId: "s1", cityId: "c1" }]);
  });

  it("flags a future date with no city and skips it as a pair", () => {
    const r = resolveCoverage({
      futurePairs: [{ showId: "s1", cityId: null }],
      showPriorities: [], cityPriorities: [],
    });
    expect(r.hasNullCity).toBe(true);
    expect(r.uncoveredPairs).toEqual([]);
  });

  it("dedupes repeated (show,city) pairs", () => {
    const r = resolveCoverage({
      futurePairs: [{ showId: "s1", cityId: "c1" }, { showId: "s1", cityId: "c1" }],
      showPriorities: [], cityPriorities: [],
    });
    expect(r.uncoveredPairs).toEqual([{ showId: "s1", cityId: "c1" }]);
  });
});

describe("computeBookingSetupStatus", () => {
  const doneCoverage: LadderCoverageInputs = {
    futurePairs: [{ showId: "s1", cityId: "c1" }],
    showPriorities: [{ showId: "s1", cityId: "c1", castId: "k1", priority: 1 }],
    cityPriorities: [],
  };
  const base = {
    flowChosen: true,
    shows: [{ main_cast_slots: 4, understudy_slots: 1 }],
    timingChosen: true,
    coverage: doneCoverage,
  };

  it("orders the five steps and blocks only ladder/slots", () => {
    const s = computeBookingSetupStatus(base);
    expect(s.steps.map((x) => x.key)).toEqual(["flow", "slots", "ladder", "eligibility", "timing"]);
    expect(s.steps.find((x) => x.key === "ladder")!.block).toBe("offers");
    expect(s.steps.find((x) => x.key === "slots")!.block).toBe("filling");
    expect(s.steps.find((x) => x.key === "flow")!.block).toBeNull();
  });

  it("is complete when every step is done", () => {
    const s = computeBookingSetupStatus(base);
    expect(s.complete).toBe(true);
    expect(s.canOffer).toBe(true);
    expect(s.doneCount).toBe(5);
  });

  it("a fresh empty org reads 0 of 5 (no shows, no dates)", () => {
    const status = computeBookingSetupStatus({
      flowChosen: false,
      shows: [],
      timingChosen: false,
      coverage: { futurePairs: [], showPriorities: [], cityPriorities: [] },
    });
    expect(status.doneCount).toBe(0);
    expect(status.steps.find((s) => s.key === "slots")!.done).toBe(false);
    expect(status.steps.find((s) => s.key === "ladder")!.done).toBe(false);
    expect(status.steps.find((s) => s.key === "eligibility")!.done).toBe(false);
  });

  it("slots/ladder/eligibility flip to done once real data covers them", () => {
    const status = computeBookingSetupStatus({
      flowChosen: true,
      shows: [{ main_cast_slots: 4, understudy_slots: 1 }],
      timingChosen: true,
      coverage: {
        futurePairs: [{ showId: "s1", cityId: "c1" }],
        showPriorities: [{ showId: "s1", cityId: "c1", castId: "k1", priority: 1 }],
        cityPriorities: [],
      },
    });
    expect(status.complete).toBe(true);
  });

  it("slots outstanding when any show has a null count", () => {
    const s = computeBookingSetupStatus({ ...base, shows: [{ main_cast_slots: null, understudy_slots: 2 }] });
    expect(s.steps.find((x) => x.key === "slots")!.done).toBe(false);
    expect(s.complete).toBe(false);
    expect(s.canOffer).toBe(true); // slots does not block offers
  });

  it("ladder outstanding blocks offers; eligibility also fails on a null city", () => {
    const s = computeBookingSetupStatus({
      ...base,
      coverage: {
        futurePairs: [{ showId: "s1", cityId: "c1" }, { showId: "s2", cityId: null }],
        showPriorities: [], cityPriorities: [],
      },
    });
    expect(s.steps.find((x) => x.key === "ladder")!.done).toBe(false);
    expect(s.steps.find((x) => x.key === "eligibility")!.done).toBe(false);
    expect(s.canOffer).toBe(false);
  });

  it("treats unread inputs as outstanding (fail-safe)", () => {
    const s = computeBookingSetupStatus({
      flowChosen: false, shows: undefined, timingChosen: false, coverage: undefined,
    });
    expect(s.doneCount).toBe(0);
    expect(s.canOffer).toBe(false);
    expect(s.complete).toBe(false);
  });
});
