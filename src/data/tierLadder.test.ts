import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { fetchTierCastMap, fetchTierLadderCounts } from "./tierLadder";

describe("fetchTierCastMap", () => {
  it("show-scoped rows win outright, ignoring the city default ladder", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
      cast_city_priority: { data: [{ cast_id: "cast-z", priority: 1 }], error: null },
      casts: { data: [{ id: "cast-a", name: "Cast A" }, { id: "cast-z", name: "Cast Z" }], error: null },
    });
    const res = await fetchTierCastMap(asSupabase(fake), { showId: "show-1", cityId: "city-1" });
    expect(res).toEqual([{ tier: 1, casts: [{ id: "cast-a", name: "Cast A" }] }]);
    // Falling back would have queried cast_city_priority; assert it never did.
    expect(fake.calls.some((c) => c.table === "cast_city_priority")).toBe(false);
  });

  it("falls back to the org city ladder when the show has no prioritized rows", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [{ cast_id: "cast-b", priority: 2 }], error: null },
      casts: { data: [{ id: "cast-b", name: "Cast B" }], error: null },
    });
    const res = await fetchTierCastMap(asSupabase(fake), { showId: "show-1", cityId: "city-1" });
    expect(res).toEqual([{ tier: 2, casts: [{ id: "cast-b", name: "Cast B" }] }]);
  });

  it("groups multiple casts sharing the same priority into one tier row", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: {
        data: [{ cast_id: "cast-a", priority: 2 }, { cast_id: "cast-b", priority: 2 }],
        error: null,
      },
      casts: { data: [{ id: "cast-a", name: "Cast A" }, { id: "cast-b", name: "Cast B" }], error: null },
    });
    const res = await fetchTierCastMap(asSupabase(fake), { showId: "show-1", cityId: "city-1" });
    expect(res).toEqual([{ tier: 2, casts: [{ id: "cast-a", name: "Cast A" }, { id: "cast-b", name: "Cast B" }] }]);
  });

  it("sorts tier rows ascending", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: {
        data: [{ cast_id: "cast-b", priority: 3 }, { cast_id: "cast-a", priority: 1 }],
        error: null,
      },
      casts: { data: [{ id: "cast-a", name: "Cast A" }, { id: "cast-b", name: "Cast B" }], error: null },
    });
    const res = await fetchTierCastMap(asSupabase(fake), { showId: "show-1", cityId: "city-1" });
    expect(res.map((r) => r.tier)).toEqual([1, 3]);
  });

  it("returns [] without querying when cityId is null", async () => {
    const fake = createFakeSupabase({});
    const res = await fetchTierCastMap(asSupabase(fake), { showId: "show-1", cityId: null });
    expect(res).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("filters untiered show rows via .not('priority', 'is', null) (calls-level pin, seed data can't prove a dropped filter)", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
    });
    await fetchTierCastMap(asSupabase(fake), { showId: "show-1", cityId: "city-1" });
    expect(fake.calls).toContainEqual({
      table: "show_cast_eligibility", method: "not", args: ["priority", "is", null],
    });
  });

  it("throws on a query error", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: { data: null, error: { message: "boom" } },
    });
    await expect(
      fetchTierCastMap(asSupabase(fake), { showId: "show-1", cityId: "city-1" }),
    ).rejects.toMatchObject({ message: "boom" });
  });
});

describe("fetchTierLadderCounts", () => {
  // Fixture reproducing the design's example figures: Cast A (tier 1, 9 members,
  // 7 match: 1 inactive member + 1 blocked artist), Cast B (tier 2, small, all
  // match), Cast C (tier 3, 11 members, 4 of 11 match, 7 miss the required skill).
  const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
  const castAArtists = range("a", 9); // a1..a9
  const castBArtists = range("b", 2); // b1..b2
  const castCArtists = range("c", 11); // c1..c11

  const castMembers = [
    ...castAArtists.map((id) => ({ cast_id: "cast-a", artist_id: id, org_id: "org-1" })),
    ...castBArtists.map((id) => ({ cast_id: "cast-b", artist_id: id, org_id: "org-1" })),
    ...castCArtists.map((id) => ({ cast_id: "cast-c", artist_id: id, org_id: "org-1" })),
  ];

  const artists = [
    ...castAArtists.map((id) => ({ id, status: id === "a9" ? "inactive" : "active" })),
    ...castBArtists.map((id) => ({ id, status: "active" })),
    ...castCArtists.map((id) => ({ id, status: "active" })),
  ];

  // Only these artists hold the one required skill: a1-a7 (7 of Cast A's 8 active
  // members, the other being a8, blocked), b1-b2 (all of Cast B), c1-c4 (4 of
  // Cast C's 11, so 7 miss it).
  const skilled = [...castAArtists.slice(0, 7), ...castBArtists, ...castCArtists.slice(0, 4)];

  function baseSeed(overrides: Record<string, unknown> = {}) {
    return {
      show_cast_eligibility: {
        data: [
          { cast_id: "cast-a", priority: 1 },
          { cast_id: "cast-b", priority: 2 },
          { cast_id: "cast-c", priority: 3 },
        ],
        error: null,
      },
      casts: {
        data: [
          { id: "cast-a", name: "Cast A" },
          { id: "cast-b", name: "Cast B" },
          { id: "cast-c", name: "Cast C" },
        ],
        error: null,
      },
      cast_members: { data: castMembers, error: null },
      artists: { data: artists, error: null },
      bookings: { data: [], error: null },
      show_dates: { data: { date: "2026-08-20" }, error: null },
      blocked_dates: { data: [{ artist_id: "a8" }], error: null },
      show_required_skills: { data: [{ skill_id: "skill-1" }], error: null },
      show_date_required_skills: { data: [], error: null },
      artist_skills: { data: skilled.map((id) => ({ artist_id: id, skill_id: "skill-1" })), error: null },
      ...overrides,
    };
  }

  it("computes per-tier castTotal / matchCount / missingSkillCount matching the design's example figures", async () => {
    const fake = createFakeSupabase(baseSeed());
    const res = await fetchTierLadderCounts(asSupabase(fake), {
      showId: "show-1", showDateId: "date-1", cityId: "city-1", orgId: "org-1",
    });

    expect(res.map((r) => r.tier)).toEqual([1, 2, 3]);

    const tier1 = res.find((r) => r.tier === 1)!;
    expect(tier1.castTotal).toBe(9);
    expect(tier1.matchCount).toBe(7);
    expect(tier1.missingSkillCount).toBe(0);
    expect(tier1.blockedCount).toBe(1);
    expect(tier1.alreadyOfferedCount).toBe(0);

    const tier2 = res.find((r) => r.tier === 2)!;
    expect(tier2.castTotal).toBe(2);
    expect(tier2.matchCount).toBe(2);

    const tier3 = res.find((r) => r.tier === 3)!;
    expect(tier3.castTotal).toBe(11);
    expect(tier3.matchCount).toBe(4);
    expect(tier3.missingSkillCount).toBe(7);
    expect(tier3.blockedCount).toBe(0);
    expect(tier3.alreadyOfferedCount).toBe(0);
  });

  it("waterfall is mutually exclusive: already-offered wins over blocked, blocked wins over missing-skill", async () => {
    const fake = createFakeSupabase(baseSeed({
      // b1 already holds a non-cancelled booking for the date AND is blocked;
      // it must land in alreadyOfferedCount only.
      bookings: { data: [{ artist_id: "b1" }], error: null },
      // b2 is blocked and also missing the required skill; it must land in
      // blockedCount only.
      blocked_dates: { data: [{ artist_id: "a8" }, { artist_id: "b1" }, { artist_id: "b2" }], error: null },
      artist_skills: {
        data: [...castAArtists.slice(0, 7), ...castCArtists.slice(0, 4)]
          .map((id) => ({ artist_id: id, skill_id: "skill-1" })),
        error: null,
      },
    }));
    const res = await fetchTierLadderCounts(asSupabase(fake), {
      showId: "show-1", showDateId: "date-1", cityId: "city-1", orgId: "org-1",
    });
    const tier2 = res.find((r) => r.tier === 2)!;
    expect(tier2.alreadyOfferedCount).toBe(1); // b1
    expect(tier2.blockedCount).toBe(1); // b2
    expect(tier2.missingSkillCount).toBe(0);
    expect(tier2.matchCount).toBe(0);
  });

  it("treats no required skills as unrestricted: nobody is counted as missing a skill", async () => {
    const fake = createFakeSupabase(baseSeed({
      show_required_skills: { data: [], error: null },
      artist_skills: { data: [], error: null },
    }));
    const res = await fetchTierLadderCounts(asSupabase(fake), {
      showId: "show-1", showDateId: "date-1", cityId: "city-1", orgId: "org-1",
    });
    const tier3 = res.find((r) => r.tier === 3)!;
    expect(tier3.matchCount).toBe(11);
    expect(tier3.missingSkillCount).toBe(0);
  });

  it("returns [] without extra reads when there is no tier ladder for the (show, city)", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
    });
    const res = await fetchTierLadderCounts(asSupabase(fake), {
      showId: "show-1", showDateId: "date-1", cityId: "city-1", orgId: "org-1",
    });
    expect(res).toEqual([]);
    expect(fake.calls.some((c) => c.table === "cast_members")).toBe(false);
  });
});
