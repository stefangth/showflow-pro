import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchSkills, fetchArtistSkills, createSkill } from "./skills";

describe("fetchSkills", () => {
  it("selects id,name ordered by name", async () => {
    const rows = [{ id: "s1", name: "Acro" }];
    const fake = createFakeSupabase({ skills: { data: rows, error: null } });
    expect(await fetchSkills(fake as never)).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "skills", method: "select", args: ["id, name"] });
    expect(fake.calls).toContainEqual({ table: "skills", method: "order", args: ["name"] });
  });
});

describe("fetchArtistSkills", () => {
  it("flattens the joined skill rows and sorts by name", async () => {
    const joined = [
      { skill: { id: "s2", name: "Zebra" } },
      { skill: { id: "s1", name: "Acro" } },
      { skill: null }, // defensive: a dangling join row
    ];
    const fake = createFakeSupabase({ artist_skills: { data: joined, error: null } });
    const result = await fetchArtistSkills(fake as never, "a1");
    expect(result).toEqual([
      { id: "s1", name: "Acro" },
      { id: "s2", name: "Zebra" },
    ]);
    expect(fake.calls).toContainEqual({ table: "artist_skills", method: "eq", args: ["artist_id", "a1"] });
  });
});

describe("createSkill", () => {
  it("trims the name and inserts it", async () => {
    const fake = createFakeSupabase({ skills: { data: { id: "s9", name: "Juggling" }, error: null } });
    const result = await createSkill(fake as never, "  Juggling  ", "o1");
    expect(result).toEqual({ id: "s9", name: "Juggling" });
    expect(fake.calls).toContainEqual({ table: "skills", method: "insert", args: [{ name: "Juggling", org_id: "o1" }] });
  });

  it("inserts a skill scoped to the given org", async () => {
    const fake = createFakeSupabase({ skills: { data: { id: "s1", name: "Vocals" }, error: null } });
    await createSkill(fake as never, "Vocals", "o1");
    expect(fake.calls).toContainEqual({ table: "skills", method: "insert", args: [{ name: "Vocals", org_id: "o1" }] });
  });
});
