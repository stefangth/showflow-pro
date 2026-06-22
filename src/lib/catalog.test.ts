import { describe, it, expect } from "vitest";
import {
  isSyncedShow, isSyncedDate, canHardDeleteDate, canHardDeleteShow,
  findDuplicateDate, nextSortOrder,
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
});
