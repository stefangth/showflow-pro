import { describe, it, expect } from "vitest";
import {
  coverageStatus,
  coverageKpis,
  buildCoverageRows,
  buildPerShowCoverageRows,
  showsCountByCity,
  castCityUsage,
  distinctShowOverrideCount,
  overriddenCityCountForShow,
  isCityReferenced,
  buildCityReferences,
  type CoverageCastRef,
} from "./coverageMatrix";

const CAST_A: CoverageCastRef = { id: "cast-a", name: "Cast A", memberCount: 4 };
const CAST_B: CoverageCastRef = { id: "cast-b", name: "Cast B", memberCount: 2 };

describe("coverageStatus", () => {
  it("is blocked when Tier 1 is empty, even if Tier 2/3 are filled", () => {
    expect(coverageStatus([null, CAST_B, null])).toEqual({ status: "blocked", filledCount: 1 });
  });

  it("is single when exactly one tier (Tier 1) is filled", () => {
    expect(coverageStatus([CAST_A, null, null])).toEqual({ status: "single", filledCount: 1 });
  });

  it("is ready when two or more tiers are filled", () => {
    expect(coverageStatus([CAST_A, CAST_B, null])).toEqual({ status: "ready", filledCount: 2 });
  });

  it("is blocked (not single) for an entirely empty ladder", () => {
    expect(coverageStatus([null, null, null])).toEqual({ status: "blocked", filledCount: 0 });
  });
});

describe("coverageKpis", () => {
  it("tallies blocked/single across rows and passes through the show-override count", () => {
    const rows = [
      { cityId: "c1", cityName: "Berlin", showsCount: 2, tiers: [CAST_A, CAST_B, null] }, // ready
      { cityId: "c2", cityName: "Hamburg", showsCount: 1, tiers: [null, null, null] }, // blocked
      { cityId: "c3", cityName: "Munich", showsCount: 0, tiers: [CAST_A, null, null] }, // single
    ];
    expect(coverageKpis(rows, 3)).toEqual({ cities: 3, offersBlocked: 1, singleTier: 1, showOverrides: 3 });
  });

  it("reports zero cities for an empty matrix", () => {
    expect(coverageKpis([], 0)).toEqual({ cities: 0, offersBlocked: 0, singleTier: 0, showOverrides: 0 });
  });
});

describe("buildCoverageRows", () => {
  const cities = [{ id: "c1", name: "Berlin" }, { id: "c2", name: "Hamburg" }];
  const castsById = new Map([
    ["cast-a", { id: "cast-a", name: "Cast A" }],
    ["cast-b", { id: "cast-b", name: "Cast B" }],
  ]);
  const castCounts = { "cast-a": 4, "cast-b": 2 };

  it("places priority rows into their tier slot and pulls member counts", () => {
    const rows = buildCoverageRows({
      cities,
      castsById,
      castCounts,
      priorities: [
        { cityId: "c1", castId: "cast-a", priority: 1 },
        { cityId: "c1", castId: "cast-b", priority: 2 },
      ],
      showsCountByCity: new Map([["c1", 3]]),
    });
    expect(rows).toEqual([
      { cityId: "c1", cityName: "Berlin", showsCount: 3, tiers: [CAST_A, CAST_B, null] },
      { cityId: "c2", cityName: "Hamburg", showsCount: 0, tiers: [null, null, null] },
    ]);
  });

  it("drops a priority row for a tier outside 1..3", () => {
    const rows = buildCoverageRows({
      cities: [{ id: "c1", name: "Berlin" }],
      castsById,
      castCounts,
      priorities: [{ cityId: "c1", castId: "cast-a", priority: 5 }],
      showsCountByCity: new Map(),
    });
    expect(rows[0].tiers).toEqual([null, null, null]);
  });

  it("drops a priority row referencing an unknown cast", () => {
    const rows = buildCoverageRows({
      cities: [{ id: "c1", name: "Berlin" }],
      castsById,
      castCounts,
      priorities: [{ cityId: "c1", castId: "cast-ghost", priority: 1 }],
      showsCountByCity: new Map(),
    });
    expect(rows[0].tiers).toEqual([null, null, null]);
  });
});

describe("buildPerShowCoverageRows", () => {
  const cities = [{ id: "c1", name: "Berlin" }, { id: "c2", name: "Hamburg" }];
  const castsById = new Map([
    ["cast-a", { id: "cast-a", name: "Cast A" }],
    ["cast-b", { id: "cast-b", name: "Cast B" }],
  ]);
  const castCounts = { "cast-a": 4, "cast-b": 2 };
  const orgPriorities = [
    { cityId: "c1", castId: "cast-a", priority: 1 },
    { cityId: "c2", castId: "cast-b", priority: 1 },
  ];

  it("uses the show's own rows for a city that has any override (all-or-nothing per city)", () => {
    const rows = buildPerShowCoverageRows({
      cities,
      castsById,
      castCounts,
      orgPriorities,
      showPriorities: [{ cityId: "c1", castId: "cast-b", priority: 1 }],
      showsCountByCity: new Map(),
    });
    const berlin = rows.find((r) => r.cityId === "c1")!;
    expect(berlin.source).toBe("override");
    expect(berlin.tiers).toEqual([CAST_B, null, null]);
  });

  it("falls back to the org default for a city with no show-level rows", () => {
    const rows = buildPerShowCoverageRows({
      cities,
      castsById,
      castCounts,
      orgPriorities,
      showPriorities: [{ cityId: "c1", castId: "cast-b", priority: 1 }],
      showsCountByCity: new Map(),
    });
    const hamburg = rows.find((r) => r.cityId === "c2")!;
    expect(hamburg.source).toBe("default");
    expect(hamburg.tiers).toEqual([CAST_B, null, null]);
  });
});

describe("showsCountByCity", () => {
  it("counts distinct shows per city and drops null cities", () => {
    const map = showsCountByCity([
      { showId: "s1", cityId: "c1" },
      { showId: "s2", cityId: "c1" },
      { showId: "s1", cityId: "c1" }, // duplicate show/city should not double-count
      { showId: "s3", cityId: null },
    ]);
    expect(map.get("c1")).toBe(2);
    expect(map.has(null as unknown as string)).toBe(false);
  });
});

describe("castCityUsage", () => {
  it("counts distinct cities per cast", () => {
    const map = castCityUsage([
      { cityId: "c1", castId: "cast-a" },
      { cityId: "c2", castId: "cast-a" },
      { cityId: "c1", castId: "cast-b" },
    ]);
    expect(map.get("cast-a")).toBe(2);
    expect(map.get("cast-b")).toBe(1);
  });
});

describe("distinctShowOverrideCount", () => {
  it("counts distinct shows with at least one override row", () => {
    expect(distinctShowOverrideCount([{ showId: "s1" }, { showId: "s1" }, { showId: "s2" }])).toBe(2);
  });

  it("is zero for no rows", () => {
    expect(distinctShowOverrideCount([])).toBe(0);
  });
});

describe("overriddenCityCountForShow", () => {
  it("counts distinct overridden cities for one show only", () => {
    const rows = [
      { showId: "s1", cityId: "c1" },
      { showId: "s1", cityId: "c2" },
      { showId: "s2", cityId: "c1" },
    ];
    expect(overriddenCityCountForShow("s1", rows)).toBe(2);
    expect(overriddenCityCountForShow("s2", rows)).toBe(1);
    expect(overriddenCityCountForShow("s3", rows)).toBe(0);
  });
});

describe("isCityReferenced", () => {
  it("is false only when shows, org tiers, and overrides are all zero", () => {
    expect(isCityReferenced({ showsCount: 0, orgTierCount: 0, overrideCount: 0 })).toBe(false);
  });

  it("is true when only a future show references the city", () => {
    expect(isCityReferenced({ showsCount: 1, orgTierCount: 0, overrideCount: 0 })).toBe(true);
  });

  // Regression: a city with zero upcoming shows but a configured org-default tier
  // ladder must still block delete — cast_city_priority.city_id cascades on delete.
  it("is true when only an org-default tier ladder references the city (no upcoming shows)", () => {
    expect(isCityReferenced({ showsCount: 0, orgTierCount: 1, overrideCount: 0 })).toBe(true);
  });

  it("is true when only a per-show override references the city", () => {
    expect(isCityReferenced({ showsCount: 0, orgTierCount: 0, overrideCount: 1 })).toBe(true);
  });
});

describe("buildCityReferences", () => {
  it("tallies shows, org tiers, and overrides per city independently", () => {
    const refs = buildCityReferences({
      cities: [{ id: "c1" }, { id: "c2" }],
      showsCountByCity: new Map([["c1", 2]]),
      orgPriorities: [{ cityId: "c1" }, { cityId: "c2" }],
      showPriorities: [{ cityId: "c2" }],
    });
    expect(refs.get("c1")).toEqual({ showsCount: 2, orgTierCount: 1, overrideCount: 0 });
    expect(refs.get("c2")).toEqual({ showsCount: 0, orgTierCount: 1, overrideCount: 1 });
  });

  it("reports all-zero for a city nothing points at", () => {
    const refs = buildCityReferences({
      cities: [{ id: "c1" }],
      showsCountByCity: new Map(),
      orgPriorities: [],
      showPriorities: [],
    });
    expect(refs.get("c1")).toEqual({ showsCount: 0, orgTierCount: 0, overrideCount: 0 });
    expect(isCityReferenced(refs.get("c1")!)).toBe(false);
  });
});
