import Papa from "papaparse";

export type SheetKind = "csv" | "xlsx";
export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

/** Hard cap on imported rows — keeps the browser responsive and bounds the RPC payload. */
export const MAX_IMPORT_ROWS = 5000;

function guard(rows: unknown[]): void {
  if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Sheet exceeds ${MAX_IMPORT_ROWS} rows`);
}

function coerceRows(headers: string[], raw: Record<string, unknown>[]): Record<string, string>[] {
  return raw.map((r) => {
    const out: Record<string, string> = {};
    for (const h of headers) out[h] = String(r[h] ?? "").trim();
    return out;
  });
}

/**
 * Parse a CSV string or an XLSX ArrayBuffer into { headers, rows }. Header order is
 * preserved; every cell is coerced to a trimmed string (missing → ""). The `xlsx`
 * library is heavy, so it is dynamically imported only when an .xlsx is provided.
 */
export async function parseSheet(input: string | ArrayBuffer, kind: SheetKind): Promise<ParsedSheet> {
  if (kind === "csv") {
    const parsed = Papa.parse<Record<string, string>>(String(input), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });
    const headers = (parsed.meta.fields ?? []).map((h) => h.trim());
    guard(parsed.data);
    return { headers, rows: coerceRows(headers, parsed.data) };
  }

  const XLSX = await import("xlsx");
  const wb = XLSX.read(input, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" });
  const headers = ((matrix[0] as unknown[]) ?? []).map((h) => String(h).trim());
  const body = matrix.slice(1);
  guard(body);
  const rows = body.map((arr) => {
    const cells = arr as unknown[];
    const out: Record<string, string> = {};
    headers.forEach((h, i) => { out[h] = String(cells[i] ?? "").trim(); });
    return out;
  });
  return { headers, rows };
}

export interface RawSheet {
  name: string;
  rows: string[][];
}
export interface ParsedSheetRaw {
  sheets: RawSheet[];
}

/**
 * Parse a CSV string or an XLSX ArrayBuffer into raw string-matrix sheets, with
 * NO header inference — every row (including whatever the sheet's actual header
 * row is) comes back as a plain `string[][]`. This feeds the hire-order import
 * wizard's Range step, which lets the user pick the header row and row scope
 * themselves (a single sheet may have a title/preamble row before the real
 * header). Every cell is coerced to a trimmed string; the row cap reuses the
 * same `MAX_IMPORT_ROWS` guard as `parseSheet`, applied per sheet.
 *
 * CSV always yields a single sheet named "Sheet1" (CSV has no sheet concept).
 * XLSX yields one entry per workbook sheet, in workbook order, so a multi-sheet
 * workbook can offer a sheet picker.
 *
 * Blank rows are PRESERVED (unlike `parseSheet` above, which drops them): this
 * feeds `rangeSelection.applyRange`, whose 1-based row numbers are documented
 * to match how a user reads row numbers in a spreadsheet. Dropping a blank row
 * here first would shift every later row's number off by however many blank
 * rows preceded it. A fully-blank data row still ends up "skipped" downstream
 * in `buildOrderRows` (which already treats an all-empty record as skipped),
 * so nothing gets imported from it — it just keeps its true row number.
 */
export async function parseSheetRaw(input: string | ArrayBuffer, kind: SheetKind): Promise<ParsedSheetRaw> {
  if (kind === "csv") {
    const parsed = Papa.parse<string[]>(String(input), { header: false, skipEmptyLines: false });
    const rows = parsed.data.map((r) => r.map((cell) => String(cell ?? "").trim()));
    guard(rows);
    return { sheets: [{ name: "Sheet1", rows }] };
  }

  const XLSX = await import("xlsx");
  const wb = XLSX.read(input, { type: "array" });
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: "" });
    const rows = matrix.map((arr) => (arr as unknown[]).map((cell) => String(cell ?? "").trim()));
    guard(rows);
    return { name, rows };
  });
  return { sheets };
}
