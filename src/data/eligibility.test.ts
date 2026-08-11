import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import {
  fetchRequiredSkillIds, fetchSkillEligibleArtistIds, fetchShowPriorityRows,
  setShowCastPriority, clearShowCastPriority,
  addShowDateRequiredSkill, removeShowDateRequiredSkill,
  fetchShowRequiredSkillIds, fetchLadderCoverageInputs,
} from "./eligibility";

describe("fetchRequiredSkillIds", () => {
  it("returns show and date lists plus their union", async () => {
    const fake = createFakeSupabase({
      show_required_skills: { data: [{ skill_id: "s1" }], error: null },
      show_date_required_skills: { data: [{ skill_id: "s1" }, { skill_id: "s2" }], error: null },
    });
    const res = await fetchRequiredSkillIds(fake as never, { showId: "sh1", showDateId: "d1" });
    expect(res).toEqual({ showSkillIds: ["s1"], dateSkillIds: ["s1", "s2"], all: ["s1", "s2"] });
  });
});

describe("fetchShowRequiredSkillIds", () => {
  it("returns the show's skill ids", async () => {
    const fake = createFakeSupabase({ show_required_skills: { data: [{ skill_id: "s1" }], error: null } });
    expect(await fetchShowRequiredSkillIds(fake as never, "sh1")).toEqual(["s1"]);
  });
});

describe("fetchSkillEligibleArtistIds", () => {
  it("returns null when nothing is required (unrestricted)", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchSkillEligibleArtistIds(fake as never, { requiredSkillIds: [] })).toBeNull();
  });
  it("returns only artists holding ALL required skills", async () => {
    const fake = createFakeSupabase({
      artist_skills: { data: [
        { artist_id: "a1", skill_id: "s1" }, { artist_id: "a1", skill_id: "s2" },
        { artist_id: "a2", skill_id: "s1" },
      ], error: null },
    });
    const res = await fetchSkillEligibleArtistIds(fake as never, { requiredSkillIds: ["s1", "s2"] });
    expect([...res!]).toEqual(["a1"]);
  });
  it("returns an EMPTY set (not null) when skills are required but nobody holds them", async () => {
    // null means unrestricted; zero qualifying artists must stay a restriction, never fail open.
    const fake = createFakeSupabase({ artist_skills: { data: [], error: null } });
    const res = await fetchSkillEligibleArtistIds(fake as never, { requiredSkillIds: ["s1"] });
    expect(res).not.toBeNull();
    expect(res).toBeInstanceOf(Set);
    expect(res!.size).toBe(0);
  });
});

describe("fetchShowPriorityRows", () => {
  it("maps rows to camelCase, ordered by priority", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: {
        data: [{ id: "row1", city_id: "c1", cast_id: "ca1", priority: 2 }],
        error: null,
      },
    });
    const res = await fetchShowPriorityRows(fake as never, "sh1");
    expect(res).toEqual([{ id: "row1", cityId: "c1", castId: "ca1", priority: 2 }]);
  });
  it("filters to prioritized rows only and scopes to the show (calls-level pin, seed data can't prove a dropped filter)", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: { data: [{ id: "row1", city_id: "c1", cast_id: "ca1", priority: 1 }], error: null },
    });
    await fetchShowPriorityRows(fake as never, "sh1");
    expect(fake.calls).toContainEqual({ table: "show_cast_eligibility", method: "eq", args: ["show_id", "sh1"] });
    expect(fake.calls).toContainEqual({ table: "show_cast_eligibility", method: "not", args: ["priority", "is", null] });
  });
});

describe("show priority mutations", () => {
  it("updates the existing row when one exists for (show, city, cast)", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: { data: [{ id: "row1" }], error: null },
    });
    await setShowCastPriority(fake as never, { showId: "sh1", cityId: "c1", castId: "ca1", priority: 2, orgId: "o1" });
    expect(fake.calls.some((c) => c.table === "show_cast_eligibility" && c.method === "update")).toBe(true);
  });
  it("inserts a new prioritized row when none exists", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: { data: [], error: null },
    });
    await setShowCastPriority(fake as never, { showId: "sh1", cityId: "c1", castId: "ca1", priority: 1, orgId: "o1" });
    const ins = fake.calls.find((c) => c.table === "show_cast_eligibility" && c.method === "insert");
    expect(ins?.args[0]).toEqual({ show_id: "sh1", city_id: "c1", cast_id: "ca1", org_id: "o1", priority: 1 });
  });
  it("clearShowCastPriority nulls priority and keeps the row", async () => {
    const fake = createFakeSupabase({ show_cast_eligibility: { data: null, error: null } });
    await clearShowCastPriority(fake as never, "row1");
    const upd = fake.calls.find((c) => c.table === "show_cast_eligibility" && c.method === "update");
    expect(upd?.args[0]).toEqual({ priority: null });
  });
});

describe("required-skill mutations", () => {
  it("addShowDateRequiredSkill inserts the pair", async () => {
    const fake = createFakeSupabase({ show_date_required_skills: { data: null, error: null } });
    await addShowDateRequiredSkill(fake as never, { showDateId: "d1", skillId: "s1", orgId: "o1" });
    const ins = fake.calls.find((c) => c.table === "show_date_required_skills" && c.method === "insert");
    expect(ins?.args[0]).toEqual({ show_date_id: "d1", skill_id: "s1", org_id: "o1" });
  });
  it("removeShowDateRequiredSkill deletes by pair", async () => {
    const fake = createFakeSupabase({ show_date_required_skills: { data: null, error: null } });
    await removeShowDateRequiredSkill(fake as never, { showDateId: "d1", skillId: "s1" });
    expect(fake.calls.some((c) => c.table === "show_date_required_skills" && c.method === "delete")).toBe(true);
    expect(fake.calls).toContainEqual({ table: "show_date_required_skills", method: "eq", args: ["show_date_id", "d1"] });
    expect(fake.calls).toContainEqual({ table: "show_date_required_skills", method: "eq", args: ["skill_id", "s1"] });
  });
});

describe("fetchLadderCoverageInputs", () => {
  it("returns future pairs, show priorities, and city priorities", async () => {
    const client = createFakeSupabase({
      show_dates: { data: [{ show_id: "s1", city_id: "c1" }, { show_id: "s1", city_id: null }], error: null },
      show_cast_eligibility: { data: [{ show_id: "s1", city_id: "c1", cast_id: "k1", priority: 1 }], error: null },
      cast_city_priority: { data: [{ city_id: "c1", cast_id: "k2", priority: 2 }], error: null },
    });
    const r = await fetchLadderCoverageInputs(asSupabase(client), { orgId: "org-1", today: "2026-08-07" });
    expect(r.futurePairs).toEqual([{ showId: "s1", cityId: "c1" }, { showId: "s1", cityId: null }]);
    expect(r.showPriorities).toEqual([{ showId: "s1", cityId: "c1", castId: "k1", priority: 1 }]);
    expect(r.cityPriorities).toEqual([{ cityId: "c1", castId: "k2", priority: 2 }]);
  });

  it("scopes show_cast_eligibility to prioritized rows, and show_dates to future non-cancelled dates (calls-level pin, seed data can't prove a dropped filter)", async () => {
    const client = createFakeSupabase({
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
    });
    await fetchLadderCoverageInputs(asSupabase(client), { orgId: "org-1", today: "2026-08-07" });
    expect(client.calls).toContainEqual({ table: "show_cast_eligibility", method: "not", args: ["priority", "is", null] });
    expect(client.calls).toContainEqual({ table: "show_dates", method: "neq", args: ["status", "cancelled"] });
    expect(client.calls).toContainEqual({ table: "show_dates", method: "gte", args: ["date", "2026-08-07"] });
  });
});
