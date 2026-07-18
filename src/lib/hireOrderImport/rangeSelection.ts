// Sheet range selection for hire-order import — picks which raw rows of a parsed
// sheet become import data rows, given a header row and a selection mode.
//
// Row-numbering convention: every row number in this module (`headerRow`, `from`,
// `to`, `picked`, and the returned `rowIndex`) is 1-based, matching how a user
// reads row numbers in a spreadsheet (`rows[0]` is "row 1"). This keeps the number
// stable and human-meaningful as it threads through the mapping UI and into
// `buildOrderRows`'s per-row issue reporting ("row 5: missing fee").

export interface SheetRange {
  sheetName?: string;
  headerRow: number;
  mode: "all" | "range" | "picked";
  from?: number;
  to?: number;
  picked?: number[];
}

/**
 * Split a raw sheet matrix into headers + selected data rows, per `range`.
 *
 * `headerRow` (1-based) names the header row; every row strictly after it is
 * eligible as data. `mode` narrows which of those eligible rows are returned:
 *  - "all": every eligible row, in sheet order.
 *  - "range": rows `from`..`to` (1-based, inclusive), clamped to the sheet
 *    bounds and to rows after the header.
 *  - "picked": exactly the rows named in `picked` (1-based), in the order
 *    given. Picks outside the sheet, or at/before the header row, are dropped.
 */
export function applyRange(
  rows: string[][],
  range: SheetRange
): { headers: string[]; dataRows: Array<{ rowIndex: number; cells: string[] }> } {
  const headerIdx = range.headerRow - 1; // 0-based
  const headers = rows[headerIdx] ?? [];
  const firstDataRow = range.headerRow + 1; // 1-based

  const inBounds = (n: number) => n >= firstDataRow && n <= rows.length;

  let rowNumbers: number[];
  if (range.mode === "picked") {
    rowNumbers = (range.picked ?? []).filter(inBounds);
  } else if (range.mode === "range") {
    const from = Math.max(range.from ?? firstDataRow, firstDataRow);
    const to = Math.min(range.to ?? rows.length, rows.length);
    rowNumbers = [];
    for (let n = from; n <= to; n++) rowNumbers.push(n);
  } else {
    // "all"
    rowNumbers = [];
    for (let n = firstDataRow; n <= rows.length; n++) rowNumbers.push(n);
  }

  const dataRows = rowNumbers.map((n) => ({ rowIndex: n, cells: rows[n - 1] ?? [] }));
  return { headers, dataRows };
}
