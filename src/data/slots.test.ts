import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { fetchShowSlots, saveShowSlots, type SlotDraft } from "./slots";

describe("fetchShowSlots", () => {
  it("maps rows to SlotDraft and groups skill ids by slot", async () => {
    const fake = createFakeSupabase({
      show_slots: {
        data: [
          { id: "s1", name: "Leads", slot_count: 3, kind: "main", sort_order: 0 },
          { id: "s2", name: "Understudies", slot_count: 2, kind: "understudy", sort_order: 1 },
        ],
        error: null,
      },
      show_slot_required_skills: {
        data: [
          { slot_id: "s1", skill_id: "vocals" },
          { slot_id: "s1", skill_id: "combat" },
          { slot_id: "s2", skill_id: "vocals" },
        ],
        error: null,
      },
    });
    const res = await fetchShowSlots(asSupabase(fake), "sh1");
    expect(res).toEqual<SlotDraft[]>([
      { id: "s1", name: "Leads", count: 3, kind: "main", skillIds: ["vocals", "combat"] },
      { id: "s2", name: "Understudies", count: 2, kind: "understudy", skillIds: ["vocals"] },
    ]);
  });

  it("returns [] and skips the skills query when the show has no slots", async () => {
    const fake = createFakeSupabase({ show_slots: { data: [], error: null } });
    const res = await fetchShowSlots(asSupabase(fake), "sh1");
    expect(res).toEqual([]);
    expect(fake.calls.some((c) => c.table === "show_slot_required_skills")).toBe(false);
  });

  it("a slot with no required skills gets an empty skillIds array", async () => {
    const fake = createFakeSupabase({
      show_slots: { data: [{ id: "s1", name: "Leads", slot_count: 3, kind: "main", sort_order: 0 }], error: null },
      show_slot_required_skills: { data: [], error: null },
    });
    const res = await fetchShowSlots(asSupabase(fake), "sh1");
    expect(res).toEqual([{ id: "s1", name: "Leads", count: 3, kind: "main", skillIds: [] }]);
  });

  it("scopes to the show and orders by sort_order (calls-level pin, seed data can't prove a dropped filter)", async () => {
    const fake = createFakeSupabase({ show_slots: { data: [], error: null } });
    await fetchShowSlots(asSupabase(fake), "sh1");
    expect(fake.calls).toContainEqual({ table: "show_slots", method: "eq", args: ["show_id", "sh1"] });
    expect(fake.calls).toContainEqual({ table: "show_slots", method: "order", args: ["sort_order", { ascending: true }] });
  });
});

describe("saveShowSlots", () => {
  it("inserts a brand-new slot (no id) with sort_order = index and the show/org ids", async () => {
    const fake = createFakeSupabase({
      show_slots: [
        { when: { show_id: "sh1" }, data: [], error: null }, // current rows: none
        { data: { id: "new-slot" }, error: null }, // fallback: insert().select().single()
      ],
      show_slot_required_skills: { data: [], error: null },
    });
    const slots: SlotDraft[] = [{ name: "Leads", count: 3, kind: "main", skillIds: [] }];
    await saveShowSlots(asSupabase(fake), { showId: "sh1", orgId: "o1", slots });
    const ins = fake.calls.find((c) => c.table === "show_slots" && c.method === "insert");
    expect(ins?.args[0]).toEqual({
      show_id: "sh1", org_id: "o1", name: "Leads", slot_count: 3, kind: "main", sort_order: 0,
    });
  });

  it("updates an existing slot only when a tracked field actually changed", async () => {
    const current = [{ id: "s1", name: "Leads", slot_count: 3, kind: "main", sort_order: 0 }];
    const fake = createFakeSupabase({
      show_slots: [
        { when: { show_id: "sh1" }, data: current, error: null },
        { when: { id: "s1" }, data: null, error: null },
      ],
      show_slot_required_skills: { data: [], error: null },
    });
    const slots: SlotDraft[] = [{ id: "s1", name: "Leads", count: 5, kind: "main", skillIds: [] }];
    await saveShowSlots(asSupabase(fake), { showId: "sh1", orgId: "o1", slots });
    const upd = fake.calls.find((c) => c.table === "show_slots" && c.method === "update");
    expect(upd?.args[0]).toEqual({ name: "Leads", slot_count: 5, kind: "main", sort_order: 0 });
    expect(fake.calls).toContainEqual({ table: "show_slots", method: "eq", args: ["id", "s1"] });
  });

  it("does not write anything when the desired slots exactly match the current rows and skills", async () => {
    const current = [{ id: "s1", name: "Leads", slot_count: 3, kind: "main", sort_order: 0 }];
    const seeded = createFakeSupabase({
      show_slots: [{ when: { show_id: "sh1" }, data: current, error: null }],
      show_slot_required_skills: [
        { data: [{ slot_id: "s1", skill_id: "vocals" }], error: null },
      ],
    });
    const slots: SlotDraft[] = [{ id: "s1", name: "Leads", count: 3, kind: "main", skillIds: ["vocals"] }];
    await saveShowSlots(asSupabase(seeded), { showId: "sh1", orgId: "o1", slots });
    expect(seeded.calls.some((c) => c.table === "show_slots" && c.method === "insert")).toBe(false);
    expect(seeded.calls.some((c) => c.table === "show_slots" && c.method === "update")).toBe(false);
    expect(seeded.calls.some((c) => c.table === "show_slots" && c.method === "delete")).toBe(false);
    expect(seeded.calls.some((c) => c.table === "show_slot_required_skills" && c.method === "insert")).toBe(false);
    expect(seeded.calls.some((c) => c.table === "show_slot_required_skills" && c.method === "delete")).toBe(false);
  });

  it("deletes current slots absent from the desired list", async () => {
    const current = [
      { id: "s1", name: "Leads", slot_count: 3, kind: "main", sort_order: 0 },
      { id: "s2", name: "Understudies", slot_count: 2, kind: "understudy", sort_order: 1 },
    ];
    const fake = createFakeSupabase({
      show_slots: [
        { when: { show_id: "sh1" }, data: current, error: null },
        { when: { id: "s2" }, data: null, error: null },
      ],
      show_slot_required_skills: { data: [], error: null },
    });
    const slots: SlotDraft[] = [{ id: "s1", name: "Leads", count: 3, kind: "main", skillIds: [] }];
    await saveShowSlots(asSupabase(fake), { showId: "sh1", orgId: "o1", slots });
    const del = fake.calls.find((c) => c.table === "show_slots" && c.method === "delete");
    expect(del).toBeTruthy();
    expect(fake.calls).toContainEqual({ table: "show_slots", method: "eq", args: ["id", "s2"] });
    // s1 is kept: no delete call scoped to it.
    expect(fake.calls.filter((c) => c.table === "show_slots" && c.method === "delete")).toHaveLength(1);
  });

  it("diffs a slot's skill set: inserts newly added skills and deletes stale ones", async () => {
    const current = [{ id: "s1", name: "Leads", slot_count: 3, kind: "main", sort_order: 0 }];
    const fake = createFakeSupabase({
      show_slots: [{ when: { show_id: "sh1" }, data: current, error: null }],
      show_slot_required_skills: [
        { when: { slot_id: "s1", skill_id: "combat" }, data: null, error: null }, // the delete call
        { data: [{ slot_id: "s1", skill_id: "combat" }], error: null }, // fallback: current-skills select + insert
      ],
    });
    const slots: SlotDraft[] = [{ id: "s1", name: "Leads", count: 3, kind: "main", skillIds: ["vocals"] }];
    await saveShowSlots(asSupabase(fake), { showId: "sh1", orgId: "o1", slots });

    const ins = fake.calls.find((c) => c.table === "show_slot_required_skills" && c.method === "insert");
    expect(ins?.args[0]).toEqual({ slot_id: "s1", skill_id: "vocals", org_id: "o1" });

    expect(fake.calls).toContainEqual({ table: "show_slot_required_skills", method: "eq", args: ["slot_id", "s1"] });
    expect(fake.calls).toContainEqual({ table: "show_slot_required_skills", method: "eq", args: ["skill_id", "combat"] });
  });

  it("skips the skill-diff query entirely when there are no slots left", async () => {
    const fake = createFakeSupabase({
      show_slots: [{ when: { show_id: "sh1" }, data: [], error: null }],
    });
    await saveShowSlots(asSupabase(fake), { showId: "sh1", orgId: "o1", slots: [] });
    expect(fake.calls.some((c) => c.table === "show_slot_required_skills")).toBe(false);
  });
});
