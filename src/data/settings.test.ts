import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchProgramSubProgramPairs, resolveOrgSetting, upsertOrgSetting } from "./settings";

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

  it("throws on error", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: { message: "boom" } } });
    await expect(fetchProgramSubProgramPairs(fake as never)).rejects.toBeTruthy();
  });
});

describe("resolveOrgSetting", () => {
  it("returns the org override when present", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: "o1", value: "orgA" }, { org_id: null, value: "plat" }], error: null },
    });
    expect(await resolveOrgSetting(fake as never, "o1", "k", "def")).toBe("orgA");
  });

  it("falls back to the platform default (org_id null) when no override", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: null, value: "plat" }], error: null },
    });
    expect(await resolveOrgSetting(fake as never, "o1", "k", "def")).toBe("plat");
  });

  it("returns the fallback when no row matches", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    expect(await resolveOrgSetting(fake as never, "o1", "k", "def")).toBe("def");
  });

  it("queries platform-only with .is when orgId is null", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [{ org_id: null, value: "plat" }], error: null } });
    expect(await resolveOrgSetting(fake as never, null, "k", "def")).toBe("plat");
    expect(fake.calls).toContainEqual({ table: "app_settings", method: "is", args: ["org_id", null] });
  });

  it("throws on query error", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: { message: "boom" } } });
    await expect(resolveOrgSetting(fake as never, "o1", "k", "def")).rejects.toBeTruthy();
  });
});

describe("upsertOrgSetting", () => {
  it("upserts with org_id + key and conflict target org_id,key", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: null } });
    await upsertOrgSetting(fake as never, "o1", "k", { a: 1 } as never);
    expect(fake.calls).toContainEqual({
      table: "app_settings", method: "upsert",
      args: [{ org_id: "o1", key: "k", value: { a: 1 } }, { onConflict: "org_id,key" }],
    });
  });

  it("throws on upsert error", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: { message: "no" } } });
    await expect(upsertOrgSetting(fake as never, "o1", "k", {} as never)).rejects.toBeTruthy();
  });
});
