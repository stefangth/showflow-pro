import type { ParsedSheet } from "@/lib/artistImport/parseSheet";

/**
 * User's chosen mapping from spreadsheet column names to import-row fields.
 * `program` and `date` are required (see `isSheetMapComplete`); the rest are optional.
 */
export interface SheetColumnMap {
  program: string;
  subProgram?: string;
  date: string;
  city?: string;
  session1?: string;
  session2?: string;
  session3?: string;
  venue?: string;
}

/**
 * One mapped-but-not-yet-validated import row. Empty strings are carried through
 * as-is (rather than becoming `null`) for `program`/`subProgram`/`date`/`city` so
 * the edge function can categorize a row as "held: missing date" etc.; session
 * times and venue become `null` when blank or not a recognizable HH:MM value.
 */
export interface SheetDateRaw {
  program: string;
  subProgram: string;
  date: string;
  city: string;
  session_1: string | null;
  session_2: string | null;
  session_3: string | null;
  venue: string | null;
  /** 1-based source row index, for held-cause reporting. */
  rowIndex: number;
}

/** Returns `s` unchanged if it looks like an HH:MM (or H:MM) time, else `null`. */
export function normalizeTime(s: string): string | null {
  return /^\d{1,2}:\d{2}$/.test(s) ? s : null;
}

/** Narrows a partial column map to a complete one: `program` and `date` must both be set. */
export function isSheetMapComplete(map: Partial<SheetColumnMap>): map is SheetColumnMap {
  return Boolean(map.program && map.date);
}

function cell(row: Record<string, string>, column: string | undefined): string {
  if (!column) return "";
  return (row[column] ?? "").trim();
}

/**
 * Maps parsed sheet rows to `SheetDateRaw` records using the user's column
 * mapping. Rows that are fully empty across every mapped field are skipped;
 * everything else (including rows missing only the date) is carried through
 * for the caller to categorize.
 */
export function mapSheetRows(parsed: ParsedSheet, map: SheetColumnMap): SheetDateRaw[] {
  const out: SheetDateRaw[] = [];

  parsed.rows.forEach((row, i) => {
    const program = cell(row, map.program);
    const subProgram = cell(row, map.subProgram);
    const date = cell(row, map.date);
    const city = cell(row, map.city);
    const session1Raw = cell(row, map.session1);
    const session2Raw = cell(row, map.session2);
    const session3Raw = cell(row, map.session3);
    const venueRaw = cell(row, map.venue);

    const isFullyEmpty =
      !program && !subProgram && !date && !city && !session1Raw && !session2Raw && !session3Raw && !venueRaw;
    if (isFullyEmpty) return;

    out.push({
      program,
      subProgram,
      date,
      city,
      session_1: session1Raw ? normalizeTime(session1Raw) : null,
      session_2: session2Raw ? normalizeTime(session2Raw) : null,
      session_3: session3Raw ? normalizeTime(session3Raw) : null,
      venue: venueRaw || null,
      rowIndex: i + 1,
    });
  });

  return out;
}
