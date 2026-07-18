import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseSheet, parseSheetRaw, MAX_IMPORT_ROWS } from "./parseSheet";

const CSV = `name,email,phone,bio
Ada,ada@x.com,+49 151,Soprano
"Doe, Jane",jane@x.com,,Alto`;

describe("parseSheet (csv)", () => {
  it("parses headers and rows, coercing cells to trimmed strings", async () => {
    const { headers, rows } = await parseSheet(CSV, "csv");
    expect(headers).toEqual(["name", "email", "phone", "bio"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "Ada", email: "ada@x.com", phone: "+49 151", bio: "Soprano" });
  });

  it("keeps a quoted comma as a single cell", async () => {
    const { rows } = await parseSheet(CSV, "csv");
    expect(rows[1].name).toBe("Doe, Jane");
    expect(rows[1].phone).toBe("");
  });

  it("rejects a sheet over the row cap", async () => {
    const header = "name,email\n";
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `A${i},a${i}@x.com`).join("\n");
    await expect(parseSheet(header + body, "csv")).rejects.toThrow(/exceeds/i);
  });

  // Regression guard for Finding #8's fix: parseSheet (used by the artist
  // import, unaffected by the parseSheetRaw change) still drops blank lines.
  it("still skips a blank line between data rows (unlike the fixed parseSheetRaw)", async () => {
    const csvWithBlankRow = "name,email\nAda,ada@x.com\n\nGrace,grace@x.com";
    const { rows } = await parseSheet(csvWithBlankRow, "csv");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ name: "Grace", email: "grace@x.com" });
  });
});

describe("parseSheet (xlsx)", () => {
  it("parses the first sheet into headers + rows", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["name", "email", "phone", "bio"],
      ["Ada", "ada@x.com", "+49 151", "Soprano"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const { headers, rows } = await parseSheet(buf, "xlsx");
    expect(headers).toEqual(["name", "email", "phone", "bio"]);
    expect(rows[0]).toEqual({ name: "Ada", email: "ada@x.com", phone: "+49 151", bio: "Soprano" });
  });

  // Documents (does not change) the current record-building behavior: XLSX
  // headers are used verbatim, with no dedup, so two columns sharing a header
  // name collapse into a single record key and the rightmost column wins.
  // Disambiguation is out of scope (mitigated by the manual mapping step).
  it("resolves duplicate headers last-wins in the per-row record", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Fee", "Name", "Fee"],
      [100, "Ada", 200],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const { headers, rows } = await parseSheet(buf, "xlsx");
    expect(headers).toEqual(["Fee", "Name", "Fee"]);
    // Both "Fee" columns collapse to a single key; the rightmost (last) column wins.
    expect(rows[0]).toEqual({ Fee: "200", Name: "Ada" });
  });
});

describe("parseSheetRaw (csv)", () => {
  it("returns one sheet named Sheet1 with every row as a raw string[][] (header included)", async () => {
    const { sheets } = await parseSheetRaw(CSV, "csv");
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Sheet1");
    expect(sheets[0].rows[0]).toEqual(["name", "email", "phone", "bio"]);
    expect(sheets[0].rows).toHaveLength(3); // header + 2 data rows
  });

  it("coerces cells to trimmed strings", async () => {
    const { sheets } = await parseSheetRaw("a,b\n  Ada  , ada@x.com \n", "csv");
    expect(sheets[0].rows[1]).toEqual(["Ada", "ada@x.com"]);
  });

  it("rejects a sheet over the row cap", async () => {
    const header = "name,email\n";
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `A${i},a${i}@x.com`).join("\n");
    await expect(parseSheetRaw(header + body, "csv")).rejects.toThrow(/exceeds/i);
  });

  // Finding #8: parseSheetRaw feeds rangeSelection.applyRange, which assigns
  // 1-based row numbers that must match how a user reads row numbers in a
  // spreadsheet. Dropping blank lines before that numbering shifts every
  // subsequent row's number off by however many blank lines preceded it.
  it("preserves a blank row between data rows so later rows keep their true spreadsheet row number", async () => {
    const csvWithBlankRow = "name,email\nAda,ada@x.com\n\nGrace,grace@x.com";
    const { sheets } = await parseSheetRaw(csvWithBlankRow, "csv");
    // row 1: header, row 2: Ada, row 3: blank, row 4: Grace
    expect(sheets[0].rows).toHaveLength(4);
    expect(sheets[0].rows[1]).toEqual(["Ada", "ada@x.com"]);
    expect(sheets[0].rows[2]).toEqual([""]);
    expect(sheets[0].rows[3]).toEqual(["Grace", "grace@x.com"]);
  });
});

describe("parseSheetRaw (xlsx)", () => {
  it("returns every workbook sheet, in order, as raw string[][] matrices", async () => {
    const ws1 = XLSX.utils.aoa_to_sheet([
      ["name", "email"],
      ["Ada", "ada@x.com"],
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([
      ["date", "fee"],
      ["2026-06-15", "500"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Artists");
    XLSX.utils.book_append_sheet(wb, ws2, "Dates");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const { sheets } = await parseSheetRaw(buf, "xlsx");
    expect(sheets.map((s) => s.name)).toEqual(["Artists", "Dates"]);
    expect(sheets[0].rows).toEqual([
      ["name", "email"],
      ["Ada", "ada@x.com"],
    ]);
    expect(sheets[1].rows).toEqual([
      ["date", "fee"],
      ["2026-06-15", "500"],
    ]);
  });

  it("coerces numeric/blank cells to trimmed strings", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["fee", "notes"], [500, ""]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const { sheets } = await parseSheetRaw(buf, "xlsx");
    expect(sheets[0].rows[1]).toEqual(["500", ""]);
  });

  // Finding #8, XLSX side of the same fix: a blank row in the middle of the
  // sheet must stay in the raw matrix so subsequent rows keep their true
  // 1-based spreadsheet row number.
  it("preserves a blank row between data rows so later rows keep their true spreadsheet row number", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["name", "email"],
      ["Ada", "ada@x.com"],
      [],
      ["Grace", "grace@x.com"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const { sheets } = await parseSheetRaw(buf, "xlsx");
    // row 1: header, row 2: Ada, row 3: blank, row 4: Grace
    expect(sheets[0].rows).toHaveLength(4);
    expect(sheets[0].rows[1]).toEqual(["Ada", "ada@x.com"]);
    expect(sheets[0].rows[2]).toEqual(["", ""]);
    expect(sheets[0].rows[3]).toEqual(["Grace", "grace@x.com"]);
  });
});
