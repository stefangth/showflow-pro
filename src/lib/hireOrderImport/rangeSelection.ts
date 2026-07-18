// Sheet range selection for hire-order import — picks which raw rows of a parsed
// sheet become import data rows, given a header row and a selection mode.
//
// Row-numbering convention: every row number in this module (`headerRow`, `from`,
// `to`, `picked`, and the returned `rowIndex`) is 1-based, matching how a user
// reads row numbers in a spreadsheet (`rows[0]` is "row 1"). This keeps the number
// stable and human-meaningful as it threads through the mapping UI and into
// `buildOrderRows`'s per-row issue reporting ("row 5: missing fee").

import { MAX_IMPORT_ROWS } from "@/lib/artistImport/parseSheet";

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

/**
 * Parse a free-text list of 1-based row numbers/ranges (e.g. "3, 5, 12-18") into
 * a sorted, de-duplicated array of row numbers. Backs the "Pick rows" mode's
 * row-number entry, which lets a user reach rows beyond RangeStep's bounded
 * preview (only the first MAX_PREVIEW_ROWS rows render checkboxes) — this
 * parser has no notion of a sheet size and never clamps; out-of-bounds picks
 * are dropped later by `applyRange`, same as an out-of-bounds checkbox pick.
 * Tokens that don't parse as a number or range are silently skipped so one bad
 * token doesn't block the valid ones around it; a reversed range (e.g. "18-12")
 * is swapped rather than dropped.
 *
 * Span cap: a picked set can never usefully exceed `MAX_IMPORT_ROWS` (the same
 * hard cap `parseSheet` enforces on the sheet itself), so a typo'd range like
 * "12-99999999" must not expand into a tens-of-millions-entry Set and hang the
 * tab. Each range's `end` is clamped to however many slots remain under the
 * cap, and token processing stops entirely once the cap is reached.
 */
export function parsePickedRows(input: string): number[] {
  const picked = new Set<number>();
  for (const rawToken of input.split(",")) {
    if (picked.size >= MAX_IMPORT_ROWS) break;
    const token = rawToken.trim();
    if (token === "") continue;

    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      let start = Number(rangeMatch[1]);
      let end = Number(rangeMatch[2]);
      if (start > end) [start, end] = [end, start];
      const remaining = MAX_IMPORT_ROWS - picked.size;
      const clampedEnd = Math.min(end, start + remaining - 1);
      for (let n = start; n <= clampedEnd; n++) picked.add(n);
      continue;
    }

    if (/^\d+$/.test(token)) picked.add(Number(token));
  }
  return Array.from(picked).sort((a, b) => a - b);
}
