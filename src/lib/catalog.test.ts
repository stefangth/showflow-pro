import { describe, it, expect } from "vitest";
import {
  isSyncedShow, isSyncedDate, canHardDeleteDate, canHardDeleteShow,
  findDuplicateDate, nextSortOrder, reconcileDragOrder,
} from "./catalog";

describe("catalog helpers", () => {
  it("isSyncedShow / isSyncedDate reflect the link key", () => {
    expect(isSyncedShow({ airtable_program_key: "K" })).toBe(true);
    expect(isSyncedShow({ airtable_program_key: null })).toBe(false);
    expect(isSyncedDate({ airtable_record_id: "rec1" })).toBe(true);
    expect(isSyncedDate({ airtable_record_id: null })).toBe(false);
  });

  it("canHardDeleteDate: only manual rows with zero bookings", () => {
    expect(canHardDeleteDate({ synced: false, bookingCount: 0 })).toBe(true);
    expect(canHardDeleteDate({ synced: false, bookingCount: 2 })).toBe(false);
    expect(canHardDeleteDate({ synced: true, bookingCount: 0 })).toBe(false);
  });

  it("canHardDeleteShow: only manual shows with zero dates", () => {
    expect(canHardDeleteShow({ synced: false, dateCount: 0 })).toBe(true);
    expect(canHardDeleteShow({ synced: false, dateCount: 1 })).toBe(false);
    expect(canHardDeleteShow({ synced: true, dateCount: 0 })).toBe(false);
  });

  it("findDuplicateDate matches same show+date, ignores cancelled, else null", () => {
    const rows = [
      { id: "d1", show_id: "s1", date: "2026-07-01", status: "open" },
      { id: "d2", show_id: "s1", date: "2026-07-02", status: "cancelled" },
    ];
    expect(findDuplicateDate(rows, { showId: "s1", date: "2026-07-01" })?.id).toBe("d1");
    expect(findDuplicateDate(rows, { showId: "s1", date: "2026-07-02" })).toBeNull(); // cancelled ignored
    expect(findDuplicateDate(rows, { showId: "s1", date: "2026-09-09" })).toBeNull();
  });

  it("nextSortOrder = max(sort_order) + 1, treating null as 0", () => {
    expect(nextSortOrder([])).toBe(1);
    expect(nextSortOrder([{ sort_order: 3 }, { sort_order: null }, { sort_order: 7 }])).toBe(8);
  });

  describe("reconcileDragOrder", () => {
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };

    it("returns the same prev reference when the sequence is already identical", () => {
      const prev = [a, b, c];
      expect(reconcileDragOrder(prev, [a, b, c])).toBe(prev);
    });

    // H6 regression: a refetch returning the same ids must NOT clobber a local reorder.
    it("preserves the local order when the id set is unchanged but reordered", () => {
      const prev = [c, a, b]; // user dragged c to the top
      const next = [a, b, c]; // server still returns the same three, original order
      expect(reconcileDragOrder(prev, next)).toBe(prev); // keep the user's order
    });

    it("adopts server data when a production was added", () => {
      const prev = [a, b];
      const next = [a, b, c];
      expect(reconcileDragOrder(prev, next)).toBe(next);
    });

    it("adopts server data when a production was removed", () => {
      const prev = [a, b, c];
      const next = [a, b];
      expect(reconcileDragOrder(prev, next)).toBe(next);
    });

    it("adopts server data when the membership changed (filter switch)", () => {
      const prev = [a, b];
      const next = [c];
      expect(reconcileDragOrder(prev, next)).toBe(next);
    });

    it("seeds from empty on first load", () => {
      const next = [a, b];
      expect(reconcileDragOrder([], next)).toBe(next);
    });
  });
});
