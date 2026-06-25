import { describe, it, expect } from "vitest";
import { resolveColumnTemplate, pageColumnDefs } from "./columnRegistries";

describe("shows-productions column spec", () => {
  it("defaults to program, sub_program, category, slots, date_count, status (in order)", () => {
    const cols = resolveColumnTemplate("shows-productions", "admin", {});
    const visible = cols.filter((c) => c.visible).map((c) => c.columnId);
    expect(visible).toEqual([
      "shows.program",
      "shows.sub_program",
      "shows.category",
      "_computed.slots",
      "_computed.date_count",
      "shows.status",
    ]);
  });

  it("exposes extra shows columns as available-but-hidden", () => {
    const ids = pageColumnDefs("shows-productions").map((d) => d.id);
    expect(ids).toContain("shows.sort_order");
    expect(ids).toContain("shows.main_cast_slots");
    expect(ids).toContain("shows.understudy_slots");
    expect(ids).toContain("shows.created_at");
  });
});
