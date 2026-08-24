import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  fetchCasts,
  fetchCastMemberCounts,
  fetchCastRosterCounts,
  fetchCastMembers,
  fetchCastEligibility,
  fetchCastCityPriority,
  fetchCastsByArtist,
  createCast,
  updateCast,
  addCastMember,
  removeCastMember,
  setCastEligibility,
  clearCastEligibility,
  setCastCityPriority,
  clearCastCityPriority,
} from "./casts";

/** Two orgs' rows seeded together: god-mode RLS returns both, so every assertion
 *  below is really asserting that the explicit org_id filter is what scopes the result. */
const CASTS_TWO_ORGS = [
  { when: { org_id: "org-1" }, data: [{ id: "cast-1", name: "Main Cast", org_id: "org-1" }], error: null },
  { when: { org_id: "org-2" }, data: [{ id: "cast-2", name: "Cast 1", org_id: "org-2" }], error: null },
];

describe("casts data-access", () => {
  describe("fetchCasts", () => {
    it("filters by org_id and orders by name", async () => {
      const fake = createFakeSupabase({ casts: CASTS_TWO_ORGS });
      const res = await fetchCasts(fake as never, "org-1");
      expect(res).toEqual([{ id: "cast-1", name: "Main Cast", org_id: "org-1" }]);
      expect(fake.calls).toContainEqual({ table: "casts", method: "eq", args: ["org_id", "org-1"] });
      expect(fake.calls).toContainEqual({ table: "casts", method: "order", args: ["name"] });
    });

    it("never returns another org's cast", async () => {
      const fake = createFakeSupabase({ casts: CASTS_TWO_ORGS });
      const res = await fetchCasts(fake as never, "org-1");
      expect(res.map((c) => c.name)).not.toContain("Cast 1");
    });

    it("returns [] for a null org without querying", async () => {
      const fake = createFakeSupabase({});
      expect(await fetchCasts(fake as never, null)).toEqual([]);
      expect(fake.calls).toEqual([]);
    });

    it("throws on error", async () => {
      const fake = createFakeSupabase({ casts: { data: null, error: { message: "boom" } } });
      await expect(fetchCasts(fake as never, "org-1")).rejects.toMatchObject({ message: "boom" });
    });
  });

  describe("fetchCastRosterCounts", () => {
    it("counts every member, including one whose artist is inactive", async () => {
      const fake = createFakeSupabase({
        cast_members: [
          {
            when: { org_id: "org-1" },
            data: [{ cast_id: "cast-1" }, { cast_id: "cast-1" }, { cast_id: "cast-1" }],
            error: null,
          },
        ],
      });
      const res = await fetchCastRosterCounts(fake as never, "org-1");
      expect(res).toEqual({ "cast-1": 3 });
      expect(fake.calls).toContainEqual({ table: "cast_members", method: "eq", args: ["org_id", "org-1"] });
      // The roster count must NOT narrow to active artists the way the coverage count
      // does: the Casts card sits one click from a sheet listing every member.
      expect(fake.calls).not.toContainEqual({
        table: "cast_members",
        method: "eq",
        args: ["artists.status", "active"],
      });
    });

    it("returns an empty tally with no org", async () => {
      const fake = createFakeSupabase({});
      expect(await fetchCastRosterCounts(fake as never, null)).toEqual({});
      expect(fake.calls).toEqual([]);
    });
  });

  describe("fetchCastMemberCounts", () => {
    it("filters by org_id and tallies per cast", async () => {
      const fake = createFakeSupabase({
        cast_members: [
          {
            when: { org_id: "org-1" },
            data: [{ cast_id: "cast-1" }, { cast_id: "cast-1" }, { cast_id: "cast-9" }],
            error: null,
          },
          { when: { org_id: "org-2" }, data: [{ cast_id: "cast-2" }], error: null },
        ],
      });
      const res = await fetchCastMemberCounts(fake as never, "org-1");
      expect(res).toEqual({ "cast-1": 2, "cast-9": 1 });
      expect(fake.calls).toContainEqual({ table: "cast_members", method: "eq", args: ["org_id", "org-1"] });
      // The other org's cast must not appear in the tally.
      expect(res["cast-2"]).toBeUndefined();
    });

    it("counts only ACTIVE members, so an all-inactive cast reads as empty", async () => {
      // The pickers disable a 0-member cast, and the coverage rule refuses to treat one as
      // staffing a city. A cast whose members have all gone inactive can be asked by
      // nobody (open-offer-tier filters on status = 'active'), so it must count as empty
      // in both places or the picker would offer a cast coverage then rejects.
      const fake = createFakeSupabase({
        cast_members: [
          { when: { org_id: "org-1", "artists.status": "active" }, data: [{ cast_id: "cast-1" }], error: null },
          { when: { org_id: "org-1" }, data: [{ cast_id: "cast-1" }, { cast_id: "cast-gone" }], error: null },
        ],
      });
      expect(await fetchCastMemberCounts(fake as never, "org-1")).toEqual({ "cast-1": 1 });
      expect(fake.calls).toContainEqual({ table: "cast_members", method: "eq", args: ["artists.status", "active"] });
    });

    it("returns {} for a null org without querying", async () => {
      const fake = createFakeSupabase({});
      expect(await fetchCastMemberCounts(fake as never, null)).toEqual({});
      expect(fake.calls).toEqual([]);
    });
  });

  describe("fetchCastMembers", () => {
    it("scopes by cast_id (a uuid belongs to exactly one org)", async () => {
      const rows = [{ id: "m1", artist_id: "a1", artist: { id: "a1", name: "Ada" } }];
      const fake = createFakeSupabase({ cast_members: { data: rows, error: null } });
      const res = await fetchCastMembers(fake as never, "cast-1");
      expect(res).toEqual(rows);
      expect(fake.calls).toContainEqual({ table: "cast_members", method: "eq", args: ["cast_id", "cast-1"] });
    });

    it("returns [] for a null cast without querying", async () => {
      const fake = createFakeSupabase({});
      expect(await fetchCastMembers(fake as never, null)).toEqual([]);
      expect(fake.calls).toEqual([]);
    });
  });

  describe("fetchCastEligibility", () => {
    it("scopes by cast_id", async () => {
      const rows = [{ id: "e1", city_id: "city-1", show_id: "show-1" }];
      const fake = createFakeSupabase({ show_cast_eligibility: { data: rows, error: null } });
      expect(await fetchCastEligibility(fake as never, "cast-1")).toEqual(rows);
      expect(fake.calls).toContainEqual({
        table: "show_cast_eligibility", method: "eq", args: ["cast_id", "cast-1"],
      });
    });

    it("returns [] for a null cast without querying", async () => {
      const fake = createFakeSupabase({});
      expect(await fetchCastEligibility(fake as never, null)).toEqual([]);
      expect(fake.calls).toEqual([]);
    });
  });

  describe("fetchCastCityPriority", () => {
    it("filters by org_id", async () => {
      const rows = [{ id: "p1", cast_id: "cast-1", city_id: "city-1", priority: 1 }];
      const fake = createFakeSupabase({
        cast_city_priority: [
          { when: { org_id: "org-1" }, data: rows, error: null },
          { when: { org_id: "org-2" }, data: [{ id: "p2", cast_id: "cast-2", city_id: "c9", priority: 1 }], error: null },
        ],
      });
      const res = await fetchCastCityPriority(fake as never, "org-1");
      expect(res).toEqual(rows);
      expect(fake.calls).toContainEqual({
        table: "cast_city_priority", method: "eq", args: ["org_id", "org-1"],
      });
    });

    it("returns [] for a null org without querying", async () => {
      const fake = createFakeSupabase({});
      expect(await fetchCastCityPriority(fake as never, null)).toEqual([]);
      expect(fake.calls).toEqual([]);
    });
  });

  describe("fetchCastsByArtist", () => {
    it("filters by org_id and groups casts per artist", async () => {
      const fake = createFakeSupabase({
        cast_members: [
          {
            when: { org_id: "org-1" },
            data: [
              { artist_id: "a1", cast: { id: "cast-1", name: "Main Cast" } },
              { artist_id: "a1", cast: { id: "cast-3", name: "Swing" } },
              { artist_id: "a2", cast: { id: "cast-1", name: "Main Cast" } },
            ],
            error: null,
          },
        ],
      });
      const res = await fetchCastsByArtist(fake as never, "org-1");
      expect(res.get("a1")).toEqual([{ id: "cast-1", name: "Main Cast" }, { id: "cast-3", name: "Swing" }]);
      expect(res.get("a2")).toEqual([{ id: "cast-1", name: "Main Cast" }]);
      expect(fake.calls).toContainEqual({ table: "cast_members", method: "eq", args: ["org_id", "org-1"] });
    });

    it("skips rows whose cast embed is missing", async () => {
      const fake = createFakeSupabase({
        cast_members: { data: [{ artist_id: "a1", cast: null }], error: null },
      });
      expect((await fetchCastsByArtist(fake as never, "org-1")).size).toBe(0);
    });

    it("returns {} for a null org without querying", async () => {
      const fake = createFakeSupabase({});
      expect((await fetchCastsByArtist(fake as never, null)).size).toBe(0);
      expect(fake.calls).toEqual([]);
    });
  });

  describe("mutations stamp org_id", () => {
    it("createCast inserts with org_id", async () => {
      const fake = createFakeSupabase({});
      await createCast(fake as never, "org-1", { name: "Swing", description: null });
      expect(fake.calls).toContainEqual({
        table: "casts", method: "insert",
        args: [{ org_id: "org-1", name: "Swing", description: null, created_by: null }],
      });
    });

    it("addCastMember inserts with org_id", async () => {
      const fake = createFakeSupabase({});
      await addCastMember(fake as never, "org-1", { castId: "cast-1", artistId: "a1" });
      expect(fake.calls).toContainEqual({
        table: "cast_members", method: "insert", args: [{ org_id: "org-1", cast_id: "cast-1", artist_id: "a1" }],
      });
    });

    it("setCastEligibility inserts with org_id", async () => {
      const fake = createFakeSupabase({});
      await setCastEligibility(fake as never, "org-1", { castId: "cast-1", showId: "s1", cityId: "c1" });
      expect(fake.calls).toContainEqual({
        table: "show_cast_eligibility",
        method: "insert",
        args: [{ org_id: "org-1", cast_id: "cast-1", show_id: "s1", city_id: "c1" }],
      });
    });

    it("updateCast / removeCastMember / clearCastEligibility scope by row id", async () => {
      const fake = createFakeSupabase({});
      await updateCast(fake as never, "cast-1", { name: "X", description: null });
      await removeCastMember(fake as never, "m1");
      await clearCastEligibility(fake as never, "e1");
      expect(fake.calls).toContainEqual({ table: "casts", method: "eq", args: ["id", "cast-1"] });
      expect(fake.calls).toContainEqual({ table: "cast_members", method: "eq", args: ["id", "m1"] });
      expect(fake.calls).toContainEqual({ table: "show_cast_eligibility", method: "eq", args: ["id", "e1"] });
    });

    it("propagates insert errors", async () => {
      const fake = createFakeSupabase({ casts: { data: null, error: { message: "denied" } } });
      await expect(createCast(fake as never, "org-1", { name: "X", description: null }))
        .rejects.toMatchObject({ message: "denied" });
    });
  });

  describe("setCastCityPriority", () => {
    it("inserts a new row when the cast has no row in this city and the tier is empty", async () => {
      const fake = createFakeSupabase({ cast_city_priority: { data: [], error: null } });
      await setCastCityPriority(fake as never, { orgId: "org-1", cityId: "c1", castId: "cast-a", priority: 1 });
      expect(fake.calls).toContainEqual({
        table: "cast_city_priority",
        method: "insert",
        args: [{ org_id: "org-1", city_id: "c1", cast_id: "cast-a", priority: 1 }],
      });
      expect(fake.calls.some((c) => c.method === "delete")).toBe(false);
    });

    it("moves the cast's own row to the new tier without touching any other row", async () => {
      const fake = createFakeSupabase({
        cast_city_priority: [
          { when: { city_id: "c1", cast_id: "cast-a" }, data: [{ id: "row-a" }], error: null },
          { when: { city_id: "c1", priority: 2 }, data: [{ id: "row-a" }], error: null },
        ],
      });
      await setCastCityPriority(fake as never, { orgId: "org-1", cityId: "c1", castId: "cast-a", priority: 2 });
      expect(fake.calls).toContainEqual({ table: "cast_city_priority", method: "update", args: [{ priority: 2 }] });
      expect(fake.calls).toContainEqual({ table: "cast_city_priority", method: "eq", args: ["id", "row-a"] });
      expect(fake.calls.some((c) => c.method === "delete")).toBe(false);
      expect(fake.calls.some((c) => c.method === "insert")).toBe(false);
    });

    it("bumps out the cast currently holding the tier, then inserts the new assignment", async () => {
      const fake = createFakeSupabase({
        cast_city_priority: [
          { when: { city_id: "c1", cast_id: "cast-b" }, data: [], error: null },
          { when: { city_id: "c1", priority: 1 }, data: [{ id: "row-a" }], error: null },
        ],
      });
      await setCastCityPriority(fake as never, { orgId: "org-1", cityId: "c1", castId: "cast-b", priority: 1 });
      expect(fake.calls).toContainEqual({ table: "cast_city_priority", method: "delete", args: [] });
      expect(fake.calls).toContainEqual({ table: "cast_city_priority", method: "eq", args: ["id", "row-a"] });
      expect(fake.calls).toContainEqual({
        table: "cast_city_priority",
        method: "insert",
        args: [{ org_id: "org-1", city_id: "c1", cast_id: "cast-b", priority: 1 }],
      });
    });

    it("bumps out the other occupant AND moves the requesting cast's own row when both exist", async () => {
      const fake = createFakeSupabase({
        cast_city_priority: [
          { when: { city_id: "c1", cast_id: "cast-a" }, data: [{ id: "row-a" }], error: null },
          { when: { city_id: "c1", priority: 1 }, data: [{ id: "row-b" }], error: null },
        ],
      });
      await setCastCityPriority(fake as never, { orgId: "org-1", cityId: "c1", castId: "cast-a", priority: 1 });
      expect(fake.calls).toContainEqual({ table: "cast_city_priority", method: "delete", args: [] });
      expect(fake.calls).toContainEqual({ table: "cast_city_priority", method: "eq", args: ["id", "row-b"] });
      expect(fake.calls).toContainEqual({ table: "cast_city_priority", method: "update", args: [{ priority: 1 }] });
      expect(fake.calls).toContainEqual({ table: "cast_city_priority", method: "eq", args: ["id", "row-a"] });
      expect(fake.calls.some((c) => c.method === "insert")).toBe(false);
    });

    it("propagates a read error from the first lookup", async () => {
      const fake = createFakeSupabase({
        cast_city_priority: { data: null, error: { message: "read failed" } },
      });
      await expect(
        setCastCityPriority(fake as never, { orgId: "org-1", cityId: "c1", castId: "cast-a", priority: 1 }),
      ).rejects.toMatchObject({ message: "read failed" });
    });
  });

  describe("clearCastCityPriority", () => {
    it("deletes by row id", async () => {
      const fake = createFakeSupabase({});
      await clearCastCityPriority(fake as never, "row-a");
      expect(fake.calls).toContainEqual({ table: "cast_city_priority", method: "eq", args: ["id", "row-a"] });
      expect(fake.calls).toContainEqual({ table: "cast_city_priority", method: "delete", args: [] });
    });

    it("propagates delete errors", async () => {
      const fake = createFakeSupabase({
        cast_city_priority: { data: null, error: { message: "denied" } },
      });
      await expect(clearCastCityPriority(fake as never, "row-a")).rejects.toMatchObject({ message: "denied" });
    });
  });
});
