import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { fetchTierCastMap } from "./tierLadder";

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
