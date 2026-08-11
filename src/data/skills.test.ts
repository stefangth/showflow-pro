import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import {
  fetchSkills, fetchSkillCatalog, renameSkill, archiveSkill, restoreSkill,
  deleteSkill, fetchUpcomingDateCountsBySkill,
} from "./skills";

describe("fetchSkills", () => {
  it("asks the DB to exclude archived skills", async () => {
    const fake = createFakeSupabase({ skills: { data: [{ id: "s1", name: "Vocals" }], error: null } });
    await fetchSkills(asSupabase(fake), "o1");
    // The archived filter is DB-side; assert we issue it.
    expect(fake.calls).toContainEqual({ table: "skills", method: "is", args: ["archived_at", null] });
  });

  it("returns [] with no org", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchSkills(asSupabase(fake), null)).toEqual([]);
  });
});

describe("fetchSkillCatalog", () => {
  it("composes artist and required-by counts and keeps archived rows", async () => {
    const fake = createFakeSupabase({
      skills: { data: [
        { id: "s1", name: "Vocals", archived_at: null },
        { id: "s2", name: "Puppetry", archived_at: "2026-01-01T00:00:00Z" },
      ], error: null },
      artist_skills: { data: [
        { skill_id: "s1" }, { skill_id: "s1" }, { skill_id: "s2" },
      ], error: null },
      show_required_skills: { data: [
        { skill_id: "s1", show_id: "sh1" }, { skill_id: "s1", show_id: "sh2" },
        { skill_id: "s1", show_id: "sh1" }, // duplicate show -> counted once
      ], error: null },
    });
    const rows = await fetchSkillCatalog(asSupabase(fake), "o1");
    expect(rows).toEqual([
      { id: "s1", name: "Vocals", archivedAt: null, artistCount: 2, requiredByCount: 2 },
      { id: "s2", name: "Puppetry", archivedAt: "2026-01-01T00:00:00Z", artistCount: 1, requiredByCount: 0 },
    ]);
  });

  it("returns [] with no org", async () => {
    expect(await fetchSkillCatalog(asSupabase(createFakeSupabase({})), null)).toEqual([]);
  });
});

describe("skill mutations", () => {
  it("renameSkill trims and returns the updated row", async () => {
    const fake = createFakeSupabase({ skills: { data: { id: "s1", name: "Stage combat" }, error: null } });
    const res = await renameSkill(asSupabase(fake), "s1", "  Stage combat  ");
    expect(res).toEqual({ id: "s1", name: "Stage combat" });
    expect(fake.calls).toContainEqual({ table: "skills", method: "update", args: [{ name: "Stage combat" }] });
  });

  it("archiveSkill sets archived_at", async () => {
    const fake = createFakeSupabase({ skills: { data: null, error: null } });
    await archiveSkill(asSupabase(fake), "s1");
    const update = fake.calls.find((c) => c.table === "skills" && c.method === "update");
    expect((update?.args[0] as { archived_at: string | null }).archived_at).toEqual(expect.any(String));
  });

  it("restoreSkill clears archived_at", async () => {
    const fake = createFakeSupabase({ skills: { data: null, error: null } });
    await restoreSkill(asSupabase(fake), "s1");
    expect(fake.calls).toContainEqual({ table: "skills", method: "update", args: [{ archived_at: null }] });
  });

  it("deleteSkill issues a delete on the id", async () => {
    const fake = createFakeSupabase({ skills: { data: null, error: null } });
    await deleteSkill(asSupabase(fake), "s1");
    expect(fake.calls).toContainEqual({ table: "skills", method: "delete", args: [] });
    expect(fake.calls).toContainEqual({ table: "skills", method: "eq", args: ["id", "s1"] });
  });
});

describe("fetchUpcomingDateCountsBySkill", () => {
  it("counts upcoming dates whose show/date required-skill union includes each skill", async () => {
    const fake = createFakeSupabase({
      // Two upcoming dates: d1 on show sh1, d2 on show sh2 (already date/status filtered by the DB).
      show_dates: { data: [{ id: "d1", show_id: "sh1" }, { id: "d2", show_id: "sh2" }], error: null },
      // sh1 requires s1; sh2 requires s1 + s2 (union across both dates).
      show_required_skills: { data: [
        { show_id: "sh1", skill_id: "s1" },
        { show_id: "sh2", skill_id: "s1" }, { show_id: "sh2", skill_id: "s2" },
      ], error: null },
      // d1 additionally requires s3 (date-level).
      show_date_required_skills: { data: [{ show_date_id: "d1", skill_id: "s3" }], error: null },
    });
    const counts = await fetchUpcomingDateCountsBySkill(asSupabase(fake), "o1", "2026-08-11");
    expect(counts.get("s1")).toBe(2); // both dates
    expect(counts.get("s2")).toBe(1); // only d2
    expect(counts.get("s3")).toBe(1); // only d1 (date-level)
  });

  it("returns an empty map with no org", async () => {
    const counts = await fetchUpcomingDateCountsBySkill(asSupabase(createFakeSupabase({})), null, "2026-08-11");
    expect(counts.size).toBe(0);
  });
});
