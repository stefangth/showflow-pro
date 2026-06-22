import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchShowsWithStats, createShow, updateShow, archiveShow, deleteShow, reorderShows } from "./shows";

describe("shows data-access", () => {
  it("fetchShowsWithStats scopes to org and attaches non-cancelled date counts", async () => {
    const fake = createFakeSupabase({
      shows: { data: [{ id: "s1", program: "A", sub_program: null, category: null, description: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null, sort_order: 1 }], error: null },
      show_dates: { data: [{ show_id: "s1" }, { show_id: "s1" }], error: null },
    });
    const res = await fetchShowsWithStats(fake as never, "org-1");
    expect(res[0]).toMatchObject({ id: "s1", dateCount: 2 });
    expect(fake.calls).toContainEqual({ table: "shows", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "neq", args: ["status", "cancelled"] });
  });

  it("fetchShowsWithStats returns [] for null org", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchShowsWithStats(fake as never, null)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("createShow inserts mapped fields (status active) and returns id", async () => {
    const fake = createFakeSupabase({ shows: { data: { id: "s9" }, error: null } });
    const res = await createShow(fake as never, {
      orgId: "org-1", createdBy: "u1", program: "Hamlet", subProgram: "Mat", category: "Drama",
      description: "d", mainCastSlots: 3, understudySlots: 1, sortOrder: 5,
    });
    expect(res).toEqual({ id: "s9" });
    expect(fake.calls).toContainEqual({ table: "shows", method: "insert", args: [{
      org_id: "org-1", created_by: "u1", program: "Hamlet", sub_program: "Mat", category: "Drama",
      description: "d", main_cast_slots: 3, understudy_slots: 1, status: "active", sort_order: 5,
    }] });
  });

  it("updateShow patches by id", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await updateShow(fake as never, "s1", { main_cast_slots: 4, description: "x" });
    expect(fake.calls).toContainEqual({ table: "shows", method: "update", args: [{ main_cast_slots: 4, description: "x" }] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "eq", args: ["id", "s1"] });
  });

  it("archiveShow toggles status", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await archiveShow(fake as never, "s1", true);
    expect(fake.calls).toContainEqual({ table: "shows", method: "update", args: [{ status: "archived" }] });
    await archiveShow(fake as never, "s1", false);
    expect(fake.calls).toContainEqual({ table: "shows", method: "update", args: [{ status: "active" }] });
  });

  it("deleteShow deletes by id", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await deleteShow(fake as never, "s1");
    expect(fake.calls).toContainEqual({ table: "shows", method: "delete", args: [] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "eq", args: ["id", "s1"] });
  });

  it("reorderShows writes sort_order = index per id", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await reorderShows(fake as never, ["a", "b", "c"]);
    expect(fake.calls).toContainEqual({ table: "shows", method: "update", args: [{ sort_order: 0 }] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "eq", args: ["id", "b"] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "update", args: [{ sort_order: 2 }] });
  });

  it("createShow throws on error", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: { message: "denied" } } });
    await expect(createShow(fake as never, {
      orgId: "o", createdBy: null, program: "P", subProgram: null, category: null,
      description: null, mainCastSlots: null, understudySlots: null, sortOrder: null,
    })).rejects.toMatchObject({ message: "denied" });
  });
});
