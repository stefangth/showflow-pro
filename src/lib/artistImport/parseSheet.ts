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
