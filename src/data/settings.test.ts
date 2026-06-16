import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchShowsWithSlots, updateShowSlots, resolveOrgSetting, upsertOrgSetting } from "./settings";

describe("fetchShowsWithSlots", () => {
  it("selects the correct columns from shows filtered by org_id", async () => {
    const rows = [
      { id: "s1", program: "A", sub_program: "x", main_cast_slots: 2, understudy_slots: 1 },
      { id: "s2", program: "A", sub_program: "y", main_cast_slots: null, understudy_slots: null },
    ];
    const fake = createFakeSupabase({ shows: { data: rows, error: null } });
    const result = await fetchShowsWithSlots(fake as never, "org-1");
    expect(result).toEqual(rows);
    expect(fake.calls).toContainEqual({
      table: "shows",
      method: "select",
      args: ["id, program, sub_program, main_cast_slots, understudy_slots"],
    });
    expect(fake.calls).toContainEqual({
      table: "shows",
      method: "eq",
      args: ["org_id", "org-1"],
    });
    expect(fake.calls).toContainEqual({
      table: "shows",
      method: "order",
      args: ["program"],
    });
    expect(fake.calls).toContainEqual({
      table: "shows",
      method: "order",
      args: ["sub_program"],
    });
  });

  it("returns empty array when no rows", async () => {
    const fake = createFakeSupabase({ shows: { data: [], error: null } });
    const result = await fetchShowsWithSlots(fake as never, "org-1");
    expect(result).toEqual([]);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: { message: "boom" } } });
    await expect(fetchShowsWithSlots(fake as never, "org-1")).rejects.toBeTruthy();
  });
});

describe("updateShowSlots", () => {
  it("updates main_cast_slots and understudy_slots on the correct show", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await updateShowSlots(fake as never, "show-abc", 3, 1);
    expect(fake.calls).toContainEqual({
      table: "shows",
      method: "update",
      args: [{ main_cast_slots: 3, understudy_slots: 1 }],
    });
    expect(fake.calls).toContainEqual({
      table: "shows",
      method: "eq",
      args: ["id", "show-abc"],
    });
  });

  it("allows null values to clear slots", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await updateShowSlots(fake as never, "show-abc", null, null);
    expect(fake.calls).toContainEqual({
      table: "shows",
      method: "update",
      args: [{ main_cast_slots: null, understudy_slots: null }],
    });
  });

  it("throws on update error", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: { message: "fail" } } });
    await expect(updateShowSlots(fake as never, "show-abc", 2, 0)).rejects.toBeTruthy();
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
