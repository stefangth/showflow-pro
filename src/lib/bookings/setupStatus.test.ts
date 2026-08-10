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
    hasAnyShows: true,
    shows: [{ main_cast_slots: 4, understudy_slots: 1 }],
    timingChosen: true,
    coverage: doneCoverage,
    artistCount: 3,
    artistAcceptance: true,
  };

  it("orders the six steps and blocks only people/ladder/slots", () => {
    const s = computeBookingSetupStatus(base);
    expect(s.steps.map((x) => x.key)).toEqual(["flow", "people", "slots", "ladder", "eligibility", "timing"]);
    expect(s.steps.find((x) => x.key === "people")!.block).toBe("offers");
    expect(s.steps.find((x) => x.key === "ladder")!.block).toBe("offers");
    expect(s.steps.find((x) => x.key === "slots")!.block).toBe("filling");
    expect(s.steps.find((x) => x.key === "flow")!.block).toBeNull();
  });

  it("never words a blocker as an offer for an org that books directly", () => {
    // artist_acceptance false: no tier is ever opened and no offer is ever sent, so an
    // "offers" blocker would name a pipeline this org does not run. What an empty roster
    // (or an uncovered city) costs it is the booking itself.
    const s = computeBookingSetupStatus({ ...base, artistCount: 0, artistAcceptance: false });
    expect(s.steps.find((x) => x.key === "people")!.block).toBe("booking");
    expect(s.steps.every((x) => x.block !== "offers")).toBe(true);
  });

  it("keeps a direct-book org's roster gap holding the same gate", () => {
    // The wording changes, the gate does not: an org with nobody on its roster still has
    // to clear this step before the rail retires, whichever flow it runs.
    const s = computeBookingSetupStatus({ ...base, artistCount: 0, artistAcceptance: false });
    expect(s.canOffer).toBe(false);
    expect(s.complete).toBe(false);
    const filled = computeBookingSetupStatus({ ...base, artistCount: 2, artistAcceptance: false });
    expect(filled.canOffer).toBe(true);
    expect(filled.complete).toBe(true);
  });

  // The ladder is the one step whose consequence is not shared between the two flows.
  // `cast_city_priority`, and the `priority` column on `show_cast_eligibility`, are read by
  // `resolveTierLadder` (supabase/functions/_shared/eligibility.ts) and by `fetchOfferTiers`
  // (src/data/bookings.ts), both of which exist only to open a tier. The direct-book picker
  // is `deriveDirectBookList` (src/lib/bookings.ts) over `useEligibleArtists`, which reads
  // the cast ROWS and ignores their priority entirely, so an org with `artist_acceptance`
  // false books every one of its dates with no ladder ranked at all.
  const uncovered: LadderCoverageInputs = {
    futurePairs: [{ showId: "s1", cityId: "c1" }],
    showPriorities: [],
    cityPriorities: [],
  };

  it("does not hold a direct-book org up on a ladder nothing it runs reads", () => {
    const s = computeBookingSetupStatus({ ...base, coverage: uncovered, artistAcceptance: false });
    const ladder = s.steps.find((x) => x.key === "ladder")!;
    // Still outstanding (nobody ranked anything), but it costs this org nothing, so it
    // carries no chip and does not hold the readiness gate down.
    expect(ladder.done).toBe(false);
    expect(ladder.block).toBeNull();
    expect(s.canOffer).toBe(true);
  });

  it("still holds an offers org up on the very same unranked ladder", () => {
    const s = computeBookingSetupStatus({ ...base, coverage: uncovered, artistAcceptance: true });
    expect(s.steps.find((x) => x.key === "ladder")!.block).toBe("offers");
    expect(s.canOffer).toBe(false);
  });

  it("never chips the ladder as a booking blocker, under any flow", () => {
    // "Blocks booking" is the direct-book wording of a HARD gate. The ladder is not one for
    // that org, so this step may only ever say "Blocks offers" or nothing. Includes the
    // unread flow: every consumer of canOffer gates on isLoading
    // (useBookingSetupRailVisible, useDashboardFirstRun), so the optimistic null there is
    // never rendered as readiness, and it cannot print a chip that is false half the time.
    for (const artistAcceptance of [true, false, null] as const) {
      const s = computeBookingSetupStatus({ ...base, coverage: uncovered, artistAcceptance });
      expect(s.steps.find((x) => x.key === "ladder")!.block).not.toBe("booking");
    }
  });

  it("uses the flow-neutral wording until the flow has actually been read", () => {
    // null = the flow query has not resolved. "Blocks booking" is true under every preset,
    // so an unread flow states that rather than guessing at an offer pipeline.
    const s = computeBookingSetupStatus({ ...base, artistCount: 0, artistAcceptance: null });
    expect(s.steps.find((x) => x.key === "people")!.block).toBe("booking");
    expect(s.canOffer).toBe(false);
  });

  it("is complete when every step is done", () => {
    const s = computeBookingSetupStatus(base);
    expect(s.complete).toBe(true);
    expect(s.canOffer).toBe(true);
    expect(s.doneCount).toBe(6);
  });

  it("an empty roster leaves people outstanding and blocks offers on its own", () => {
    // Every other step is done: without artists there is nobody a tier could open to,
    // so `people` alone has to hold canOffer down.
    const s = computeBookingSetupStatus({ ...base, artistCount: 0 });
    expect(s.steps.find((x) => x.key === "people")!.done).toBe(false);
    expect(s.canOffer).toBe(false);
    expect(s.complete).toBe(false);
  });

  it("people is done as soon as the roster has one artist", () => {
    const s = computeBookingSetupStatus({ ...base, artistCount: 1 });
    expect(s.steps.find((x) => x.key === "people")!.done).toBe(true);
    expect(s.canOffer).toBe(true);
  });

  it("treats an unreadable artist count as an empty roster (fail-safe)", () => {
    const s = computeBookingSetupStatus({ ...base, artistCount: null });
    expect(s.steps.find((x) => x.key === "people")!.done).toBe(false);
    expect(s.canOffer).toBe(false);
  });

  it("a fresh empty org reads 0 of 6 (no shows, no dates, no artists)", () => {
    const status = computeBookingSetupStatus({
      flowChosen: false,
      hasAnyShows: false,
      shows: [],
      timingChosen: false,
      coverage: { futurePairs: [], showPriorities: [], cityPriorities: [] },
      artistCount: 0,
      artistAcceptance: null,
    });
    expect(status.doneCount).toBe(0);
    expect(status.totalCount).toBe(6);
    expect(status.steps.find((s) => s.key === "people")!.done).toBe(false);
    expect(status.steps.find((s) => s.key === "slots")!.done).toBe(false);
    expect(status.steps.find((s) => s.key === "ladder")!.done).toBe(false);
    expect(status.steps.find((s) => s.key === "eligibility")!.done).toBe(false);
  });

  it("slots/ladder/eligibility flip to done once real data covers them", () => {
    const status = computeBookingSetupStatus({
      flowChosen: true,
      hasAnyShows: true,
      shows: [{ main_cast_slots: 4, understudy_slots: 1 }],
      timingChosen: true,
      coverage: {
        futurePairs: [{ showId: "s1", cityId: "c1" }],
        showPriorities: [{ showId: "s1", cityId: "c1", castId: "k1", priority: 1 }],
        cityPriorities: [],
      },
      artistCount: 2,
      artistAcceptance: true,
    });
    expect(status.complete).toBe(true);
  });

  it("an established org with shows but no upcoming dates stays complete (between seasons)", () => {
    // hasAnyShows is true (the org has real shows, though none are active/upcoming) and there
    // are no future (show,city) pairs to cover, so ladder/eligibility are done, not outstanding.
    const status = computeBookingSetupStatus({
      flowChosen: true,
      hasAnyShows: true,
      shows: [{ main_cast_slots: 4, understudy_slots: 1 }],
      timingChosen: true,
      coverage: { futurePairs: [], showPriorities: [], cityPriorities: [] },
      artistCount: 5,
      artistAcceptance: true,
    });
    expect(status.steps.find((s) => s.key === "ladder")!.done).toBe(true);
    expect(status.steps.find((s) => s.key === "eligibility")!.done).toBe(true);
    expect(status.complete).toBe(true);
  });

  it("a blank org with no shows is not vacuously complete even with empty coverage", () => {
    // Same empty coverage as above, but hasAnyShows is false → the data-driven steps stay
    // outstanding so a never-configured org reads 0-of-N rather than falsely complete.
    const status = computeBookingSetupStatus({
      flowChosen: true,
      hasAnyShows: false,
      shows: [],
      timingChosen: true,
      coverage: { futurePairs: [], showPriorities: [], cityPriorities: [] },
      artistCount: 0,
      artistAcceptance: true,
    });
    expect(status.steps.find((s) => s.key === "slots")!.done).toBe(false);
    expect(status.steps.find((s) => s.key === "ladder")!.done).toBe(false);
    expect(status.steps.find((s) => s.key === "eligibility")!.done).toBe(false);
    expect(status.complete).toBe(false);
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
      flowChosen: false, hasAnyShows: false, shows: undefined, timingChosen: false, coverage: undefined,
      artistCount: null, artistAcceptance: null,
    });
    expect(s.doneCount).toBe(0);
    expect(s.canOffer).toBe(false);
    expect(s.complete).toBe(false);
  });
});
