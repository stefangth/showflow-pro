import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchShowAssignments, fetchProgramSubProgramPairs } from "./showAssignments";

describe("showAssignments data-access", () => {
  describe("fetchShowAssignments", () => {
    it("filters by org_id", async () => {
      const rows = [{ id: "sa1", producer_user_id: "u1", program: "A", sub_program: "1", city_id: "c1" }];
      const fake = createFakeSupabase({
        show_assignments: [
          { when: { org_id: "org-1" }, data: rows, error: null },
          {
            when: { org_id: "org-2" },
            data: [{ id: "sa2", producer_user_id: "u2", program: "Z", sub_program: "9", city_id: "c9" }],
            error: null,
          },
        ],
      });
      const res = await fetchShowAssignments(fake as never, "org-1");
      expect(res).toEqual(rows);
      expect(fake.calls).toContainEqual({
        table: "show_assignments", method: "eq", args: ["org_id", "org-1"],
      });
      expect(res.map((r) => r.id)).not.toContain("sa2");
    });

    it("returns [] for a null org without querying", async () => {
      const fake = createFakeSupabase({});
      expect(await fetchShowAssignments(fake as never, null)).toEqual([]);
      expect(fake.calls).toEqual([]);
    });

    it("throws on error", async () => {
      const fake = createFakeSupabase({ show_assignments: { data: null, error: { message: "boom" } } });
      await expect(fetchShowAssignments(fake as never, "org-1")).rejects.toMatchObject({ message: "boom" });
    });
  });

  describe("fetchProgramSubProgramPairs", () => {
    it("filters by org_id, dedupes and sorts", async () => {
      const fake = createFakeSupabase({
        shows: [
          {
            when: { org_id: "org-1" },
            data: [
              { program: "Beta", sub_program: "2" },
              { program: "Alpha", sub_program: "1" },
              { program: "Beta", sub_program: "2" },
            ],
            error: null,
          },
          { when: { org_id: "org-2" }, data: [{ program: "Other", sub_program: "9" }], error: null },
        ],
      });
      const res = await fetchProgramSubProgramPairs(fake as never, "org-1");
      expect(res).toEqual([
        { program: "Alpha", sub_program: "1" },
        { program: "Beta", sub_program: "2" },
      ]);
      expect(fake.calls).toContainEqual({ table: "shows", method: "eq", args: ["org_id", "org-1"] });
      expect(res.map((p) => p.program)).not.toContain("Other");
    });

    it("drops rows with a null program or sub_program", async () => {
      const fake = createFakeSupabase({
        shows: { data: [{ program: "A", sub_program: null }, { program: null, sub_program: "1" }], error: null },
      });
      expect(await fetchProgramSubProgramPairs(fake as never, "org-1")).toEqual([]);
    });

    it("returns [] for a null org without querying", async () => {
      const fake = createFakeSupabase({});
      expect(await fetchProgramSubProgramPairs(fake as never, null)).toEqual([]);
      expect(fake.calls).toEqual([]);
    });
  });
});
