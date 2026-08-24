import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import {
  fetchSkills, fetchSkillCatalog, renameSkill, archiveSkill, restoreSkill,
  deleteSkill, fetchUpcomingDateCountsBySkill, fetchSkillEligibilityGaps, setArtistSkills,
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
  it("maps the skill_catalog RPC rows to camelCase SkillCatalogRow[], converting bigint counts with Number", async () => {
    // Finding 5: the 4 full-table client-side-counted reads were replaced by a
    // single server-side aggregate RPC. supabase-js returns Postgres bigint as a
    // string, so the mapping must Number(...) each count column.
    const fake = createFakeSupabase({
      "rpc:skill_catalog": {
        data: [
          { id: "s1", name: "Vocals", archived_at: null, artist_count: "2", required_by_count: "2", required_by_date_count: "0" },
          { id: "s2", name: "Puppetry", archived_at: "2026-01-01T00:00:00Z", artist_count: "1", required_by_count: "0", required_by_date_count: "0" },
          { id: "s3", name: "Acrobatics", archived_at: null, artist_count: "0", required_by_count: "0", required_by_date_count: "2" },
        ],
        error: null,
      },
    });
    const rows = await fetchSkillCatalog(asSupabase(fake), "o1");
    expect(rows).toEqual([
      { id: "s1", name: "Vocals", archivedAt: null, artistCount: 2, requiredByCount: 2, requiredByDateCount: 0 },
      { id: "s2", name: "Puppetry", archivedAt: "2026-01-01T00:00:00Z", artistCount: 1, requiredByCount: 0, requiredByDateCount: 0 },
      { id: "s3", name: "Acrobatics", archivedAt: null, artistCount: 0, requiredByCount: 0, requiredByDateCount: 2 },
    ]);
    expect(fake.calls).toContainEqual({ table: "rpc:skill_catalog", method: "rpc", args: [{ p_org: "o1" }] });
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

describe("fetchSkillEligibilityGaps", () => {
  it("returns skills required by a part that no active artist holds, naming the productions", async () => {
    const client = createFakeSupabase({
      show_required_skills: {
        data: [
          { skill_id: "sk-1", show: { program: "Winter Gala" } },
          { skill_id: "sk-1", show: { program: "Autumn Revue" } },
          { skill_id: "sk-2", show: { program: "Winter Gala" } },
        ],
        error: null,
      },
      artist_skills: { data: [{ skill_id: "sk-2" }], error: null },
      skills: { data: [{ id: "sk-1", name: "Lead Vocals" }, { id: "sk-2", name: "Piano" }], error: null },
    });
    const gaps = await fetchSkillEligibilityGaps(asSupabase(client), "org-1");
    // Productions are deduped and sorted, so the callout copy reads the same on every render.
    expect(gaps).toEqual([{ skillId: "sk-1", name: "Lead Vocals", productions: ["Autumn Revue", "Winter Gala"] }]);
  });

  it("reports a gap with no production names when the requiring show has no program", async () => {
    const client = createFakeSupabase({
      show_required_skills: { data: [{ skill_id: "sk-1", show: { program: null } }], error: null },
      artist_skills: { data: [], error: null },
      skills: { data: [{ id: "sk-1", name: "Lead Vocals" }], error: null },
    });
    // shows.program is nullable, so the gap must still surface, just without a name to blame.
    expect(await fetchSkillEligibilityGaps(asSupabase(client), "org-1")).toEqual([
      { skillId: "sk-1", name: "Lead Vocals", productions: [] },
    ]);
  });

  it("returns no gaps when no part requires a skill", async () => {
    const client = createFakeSupabase({
      show_required_skills: { data: [], error: null },
      artist_skills: { data: [], error: null },
      skills: { data: [], error: null },
    });
    expect(await fetchSkillEligibilityGaps(asSupabase(client), "org-1")).toEqual([]);
  });
});

describe("setArtistSkills", () => {
  it("inserts the added rows with the org id and deletes only the removed skills", async () => {
    const client = createFakeSupabase({ artist_skills: { data: [], error: null } });
    await setArtistSkills(asSupabase(client), {
      artistId: "a1", orgId: "org-1", add: ["sk-1", "sk-2"], remove: ["sk-9"],
    });
    const calls = client.calls.filter((c) => c.table === "artist_skills");
    expect(calls.find((c) => c.method === "insert")?.args[0]).toEqual([
      { artist_id: "a1", skill_id: "sk-1", org_id: "org-1" },
      { artist_id: "a1", skill_id: "sk-2", org_id: "org-1" },
    ]);
    expect(calls.some((c) => c.method === "delete")).toBe(true);
    expect(calls.find((c) => c.method === "in")?.args).toEqual(["skill_id", ["sk-9"]]);
  });

  it("writes nothing when both lists are empty", async () => {
    const client = createFakeSupabase({ artist_skills: { data: [], error: null } });
    await setArtistSkills(asSupabase(client), { artistId: "a1", orgId: "org-1", add: [], remove: [] });
    expect(client.calls.filter((c) => c.table === "artist_skills")).toHaveLength(0);
  });
});
