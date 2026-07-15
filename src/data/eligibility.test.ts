import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  fetchRequiredSkillIds, fetchSkillEligibleArtistIds, fetchShowPriorityRows,
  setShowCastPriority, clearShowCastPriority,
  addShowRequiredSkill, removeShowRequiredSkill,
  addShowDateRequiredSkill, removeShowDateRequiredSkill,
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
  it("addShowRequiredSkill inserts the pair", async () => {
    const fake = createFakeSupabase({ show_required_skills: { data: null, error: null } });
    await addShowRequiredSkill(fake as never, { showId: "sh1", skillId: "s1", orgId: "o1" });
    const ins = fake.calls.find((c) => c.table === "show_required_skills" && c.method === "insert");
    expect(ins?.args[0]).toEqual({ show_id: "sh1", skill_id: "s1", org_id: "o1" });
  });
  it("removeShowRequiredSkill deletes by pair", async () => {
    const fake = createFakeSupabase({ show_required_skills: { data: null, error: null } });
    await removeShowRequiredSkill(fake as never, { showId: "sh1", skillId: "s1" });
    expect(fake.calls.some((c) => c.table === "show_required_skills" && c.method === "delete")).toBe(true);
    expect(fake.calls).toContainEqual({ table: "show_required_skills", method: "eq", args: ["show_id", "sh1"] });
    expect(fake.calls).toContainEqual({ table: "show_required_skills", method: "eq", args: ["skill_id", "s1"] });
  });
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
