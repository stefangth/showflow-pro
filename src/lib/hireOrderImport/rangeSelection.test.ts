import { describe, it, expect } from "vitest";
import { applyRange } from "./rangeSelection";

describe("applyRange", () => {
  it("uses row 1 as the header and everything after as data by default", () => {
    const rows = [
      ["Name", "Email"],
      ["Ada", "ada@x.com"],
      ["Grace", "grace@x.com"],
    ];
    const { headers, dataRows } = applyRange(rows, { headerRow: 1, mode: "all" });
    expect(headers).toEqual(["Name", "Email"]);
    expect(dataRows).toEqual([
      { rowIndex: 2, cells: ["Ada", "ada@x.com"] },
      { rowIndex: 3, cells: ["Grace", "grace@x.com"] },
    ]);
  });

  it("shifts the data start when headerRow is 2", () => {
    const rows = [
      ["ignore this preamble line"],
      ["Name", "Email"],
      ["Ada", "ada@x.com"],
      ["Grace", "grace@x.com"],
    ];
    const { headers, dataRows } = applyRange(rows, { headerRow: 2, mode: "all" });
    expect(headers).toEqual(["Name", "Email"]);
    expect(dataRows).toEqual([
      { rowIndex: 3, cells: ["Ada", "ada@x.com"] },
      { rowIndex: 4, cells: ["Grace", "grace@x.com"] },
    ]);
  });

  it("'picked' mode returns exactly the picked rows, in the given order", () => {
    const rows = [["Name"], ["Ada"], ["Grace"], ["Hedy"]];
    const { dataRows } = applyRange(rows, { headerRow: 1, mode: "picked", picked: [4, 2] });
    expect(dataRows).toEqual([
      { rowIndex: 4, cells: ["Hedy"] },
      { rowIndex: 2, cells: ["Ada"] },
    ]);
  });

  it("drops out-of-range picks (beyond the sheet, or at/before the header)", () => {
    const rows = [["Name"], ["Ada"], ["Grace"]];
    const { dataRows } = applyRange(rows, { headerRow: 1, mode: "picked", picked: [1, 2, 3, 99] });
    // row 1 is the header itself, 99 is past the end of the sheet -> both dropped
    expect(dataRows.map((r) => r.rowIndex)).toEqual([2, 3]);
  });

  it("'all' mode returns every row after the header", () => {
    const rows = [["Name"], ["Ada"], ["Grace"], ["Hedy"]];
    const { dataRows } = applyRange(rows, { headerRow: 1, mode: "all" });
    expect(dataRows.map((r) => r.rowIndex)).toEqual([2, 3, 4]);
  });

  it("'range' mode returns rows from..to inclusive", () => {
    const rows = [["Name"], ["Ada"], ["Grace"], ["Hedy"], ["Marie"]];
    const { dataRows } = applyRange(rows, { headerRow: 1, mode: "range", from: 2, to: 4 });
    expect(dataRows.map((r) => r.rowIndex)).toEqual([2, 3, 4]);
  });

  it("'range' mode clamps an out-of-bounds 'to' to the sheet length", () => {
    const rows = [["Name"], ["Ada"], ["Grace"]];
    const { dataRows } = applyRange(rows, { headerRow: 1, mode: "range", from: 2, to: 999 });
    expect(dataRows.map((r) => r.rowIndex)).toEqual([2, 3]);
  });

  it("'range' mode clamps a 'from' before the header to the first data row", () => {
    const rows = [["Name"], ["Ada"], ["Grace"]];
    const { dataRows } = applyRange(rows, { headerRow: 1, mode: "range", from: 0, to: 2 });
    expect(dataRows.map((r) => r.rowIndex)).toEqual([2]);
  });
});
