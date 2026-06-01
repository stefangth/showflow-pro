import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchProgramSubProgramPairs, fetchSlotDefaults } from "./settings";

describe("fetchProgramSubProgramPairs", () => {
  it("selects non-null program/sub_program from shows and dedupes", async () => {
    const rows = [
      { program: "A", sub_program: "x" },
      { program: "A", sub_program: "x" },
    ];
    const fake = createFakeSupabase({ shows: { data: rows, error: null } });
    const result = await fetchProgramSubProgramPairs(fake as never);
    expect(result).toEqual([{ program: "A", sub_program: "x" }]);
    expect(fake.calls).toContainEqual({ table: "shows", method: "select", args: ["program, sub_program"] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "not", args: ["program", "is", null] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "not", args: ["sub_program", "is", null] });
  });
});

describe("fetchSlotDefaults", () => {
  it("returns the value object", async () => {
    const value = { A: { x: { main_cast: 2, understudies: 1 } } };
    const fake = createFakeSupabase({ app_settings: { data: { value }, error: null } });
    expect(await fetchSlotDefaults(fake as never)).toEqual(value);
    expect(fake.calls).toContainEqual({ table: "app_settings", method: "eq", args: ["key", "sub_program_slots_defaults"] });
  });
  it("returns {} when no row", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: null } });
    expect(await fetchSlotDefaults(fake as never)).toEqual({});
  });
});
