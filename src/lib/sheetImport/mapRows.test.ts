import { describe, it, expect } from "vitest";
import type { ParsedSheet } from "@/lib/artistImport/parseSheet";
import { isSheetMapComplete, mapSheetRows } from "@/lib/sheetImport/mapRows";

// Built in the exact shape parseSheet() actually returns:
// { headers: string[]; rows: Record<string, string>[] } (see src/lib/artistImport/parseSheet.ts).
// The brief's literal used string[][] rows; corrected here to Record<string,string>[] rows.
const parsed: ParsedSheet = {
  headers: ["Show", "Variant", "Day", "Town", "Eve", "House"],
  rows: [
    { Show: "Cats", Variant: "Evening", Day: "2026-09-01", Town: "Berlin", Eve: "19:30", House: "Theater am Potsdamer" },
    { Show: "Cats", Variant: "Evening", Day: "2026-09-02", Town: "", Eve: "20:00", House: "" },
    { Show: "", Variant: "", Day: "", Town: "", Eve: "", House: "" }, // fully empty -> skipped
  ],
};
const map = { program: "Show", subProgram: "Variant", date: "Day", city: "Town", session1: "Eve", venue: "House" };

describe("mapSheetRows", () => {
  it("maps columns to rows by header name and skips empty rows", () => {
    const out = mapSheetRows(parsed, map);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      program: "Cats", subProgram: "Evening", date: "2026-09-01",
      city: "Berlin", session_1: "19:30", venue: "Theater am Potsdamer", rowIndex: 1,
    });
    expect(out[1]).toMatchObject({ city: "", session_1: "20:00", venue: null, rowIndex: 2 });
  });

  it("normalizes a non-time session value to null", () => {
    const out = mapSheetRows(
      { headers: ["Show", "Day", "Eve"], rows: [{ Show: "Cats", Day: "2026-09-01", Eve: "matinee" }] },
      { program: "Show", date: "Day", session1: "Eve" },
    );
    expect(out[0].session_1).toBeNull();
  });
});

describe("isSheetMapComplete", () => {
  it("requires program and date", () => {
    expect(isSheetMapComplete({ program: "Show", date: "Day" })).toBe(true);
    expect(isSheetMapComplete({ program: "Show" })).toBe(false);
    expect(isSheetMapComplete({ date: "Day" })).toBe(false);
  });
});
