// Hire-order import row resolution: parses mapped sheet cells into typed values,
// matches each row to a catalog artist + show_date, and flags rows that need
// human attention before they can become a draft hire order.
import type { EditableOrderFieldKey } from "@/lib/hireOrders/types";
import type { OrderColumnMapping } from "./guessOrderMapping";

export interface ImportRowInput {
  rowIndex: number;
  record: Record<string, string>;
}

export interface ResolvedImportRow {
  rowIndex: number;
  /** Typed/parsed sheet layer — feeds FieldLayers.sheet verbatim. Only fields present via the mapping are set. */
  sheet: Partial<Record<EditableOrderFieldKey, unknown>>;
  matchedArtistId?: string;
  matchedShowDateId?: string;
  status: "ready" | "attention" | "skipped";
  issues: string[];
}

export interface ImportCatalogArtist {
  id: string;
  name: string;
  email: string | null;
}

export interface ImportCatalogDate {
  id: string;
  date: string;
  venue: string | null;
  city: string | null;
}

export interface ImportCatalog {
  artists: ImportCatalogArtist[];
  dates: ImportCatalogDate[];
}

// ---------------------------------------------------------------------------
// Date parsing — explicit regexes only, never Date.parse / new Date(string).
// Tried in this order: dd.mm.yyyy, then yyyy-mm-dd, then mm/dd/yyyy. Pure string
// and number manipulation throughout, so it is timezone-safe (consistent with
// src/lib/dates.ts, which parses YYYY-MM-DD with an explicit T00:00:00 rather
// than trusting the platform's date parser).
// ---------------------------------------------------------------------------

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

const DATE_PATTERNS: Array<{ re: RegExp; toISO: (m: RegExpMatchArray) => string }> = [
  // dd.mm.yyyy
  { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, toISO: (m) => `${m[3]}-${pad2(Number(m[2]))}-${pad2(Number(m[1]))}` },
  // yyyy-mm-dd
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, toISO: (m) => `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}` },
  // mm/dd/yyyy
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, toISO: (m) => `${m[3]}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}` },
];

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

function isValidCalendarDate(iso: string): boolean {
  const [y, mo, d] = iso.split("-").map(Number);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const max = mo === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[mo - 1];
  return d <= max;
}

/** Parse a date cell to an ISO `yyyy-mm-dd` string, or null if unparseable. */
export function parseImportDate(raw: string): string | null {
  const trimmed = raw.trim();
  for (const { re, toISO } of DATE_PATTERNS) {
    const match = trimmed.match(re);
    if (match) {
      const iso = toISO(match);
      return isValidCalendarDate(iso) ? iso : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Money parsing — strip currency symbols/spaces, detect decimal comma vs point
// by whichever separator appears LAST, normalize to a fixed 2-decimal string.
// ---------------------------------------------------------------------------

// A single separator ("." or ",") followed by exactly three trailing digits
// (e.g. "4.500", "12,500") is genuinely ambiguous for a 2-decimal currency: it
// could be thousands grouping (4500) or a fat-fingered decimal (4.50) — three
// digits can never be a valid 2-decimal fraction, so neither reading is safe
// to guess. The `$` anchor means a second separator anywhere in the string
// (e.g. "4.500,00") disqualifies the match, since that case is unambiguous.
const AMBIGUOUS_MONEY_RE = /^-?\d+[.,]\d{3}$/;

/**
 * Parse a money cell to a fixed 2-decimal string (e.g. "4500.00").
 * Returns `null` when the cell is empty or not a number at all.
 * Returns `undefined` when the amount is AMBIGUOUS (see `AMBIGUOUS_MONEY_RE`)
 * — the caller must surface this for human review rather than silently
 * picking a reading.
 */
export function parseImportMoney(raw: string): string | null | undefined {
  const stripped = raw.replace(/[^0-9.,-]/g, "").trim();
  if (stripped === "") return null;

  if (AMBIGUOUS_MONEY_RE.test(stripped)) return undefined;

  const lastComma = stripped.lastIndexOf(",");
  const lastDot = stripped.lastIndexOf(".");

  let normalized: string;
  if (lastComma === -1 && lastDot === -1) {
    normalized = stripped;
  } else if (lastComma > lastDot) {
    // comma is the decimal separator; any dots are thousands separators
    normalized = stripped.replace(/\./g, "").replace(",", ".");
  } else {
    // dot is the decimal separator; any commas are thousands separators
    normalized = stripped.replace(/,/g, "");
  }

  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  return num.toFixed(2);
}

// ---------------------------------------------------------------------------
// Row resolution
// ---------------------------------------------------------------------------

const cell = (record: Record<string, string>, header?: string): string =>
  header ? (record[header] ?? "").trim() : "";

function matchArtist(email: string, name: string, artists: ImportCatalogArtist[]): string | undefined {
  if (email) {
    const lower = email.toLowerCase();
    const byEmail = artists.find((a) => (a.email ?? "").trim().toLowerCase() === lower);
    if (byEmail) return byEmail.id;
  }
  if (name) {
    const lower = name.toLowerCase();
    const byName = artists.find((a) => a.name.trim().toLowerCase() === lower);
    if (byName) return byName.id;
  }
  return undefined;
}

/** True when a mapped, non-blank raw field disagrees with the matched date's
 *  corresponding field (case-insensitive). An unmapped field, or a blank raw
 *  cell, never counts as a mismatch — there is nothing provided to disagree. */
function fieldDisagrees(mappedColumn: string | undefined, raw: string, dateField: string | null): boolean {
  if (!mappedColumn || raw === "" || dateField === null) return false;
  return dateField.trim().toLowerCase() !== raw.toLowerCase();
}

function matchShowDate(
  iso: string,
  venue: string,
  city: string,
  mapping: OrderColumnMapping,
  dates: ImportCatalogDate[]
): { id?: string; ambiguous: boolean; mismatch?: boolean } {
  const byDate = dates.filter((d) => d.date === iso);

  const columnsMapped = Boolean(mapping.venue || mapping.city);
  const hasNarrowingValue = Boolean(venue || city);
  let narrowingFailed = false;
  let matched: ImportCatalogDate | undefined;

  if (columnsMapped && hasNarrowingValue) {
    const narrowed = byDate.filter(
      (d) =>
        (venue !== "" && d.venue !== null && d.venue.trim().toLowerCase() === venue.toLowerCase()) ||
        (city !== "" && d.city !== null && d.city.trim().toLowerCase() === city.toLowerCase())
    );
    if (narrowed.length === 1) {
      // The OR-narrowing above resolves to exactly one date as soon as EITHER
      // venue or city matches it — a wrong venue with a right city (or vice
      // versa) can still narrow to one date here. That's a genuine partial
      // mismatch, checked below via fieldDisagrees, not caught by this branch.
      matched = narrowed[0];
    } else if (narrowed.length > 1) {
      return { ambiguous: true };
    } else {
      // narrowed.length === 0: venue/city didn't match any same-day date —
      // fall through to the plain date-only check below, flagging a mismatch
      // if that resolves unambiguously (a wrong venue/city on an otherwise
      // single-date day still deserves human review, even though the date
      // link is kept).
      narrowingFailed = true;
    }
  }

  if (!matched) {
    if (byDate.length !== 1) return { ambiguous: true };
    matched = byDate[0];
  }

  const mismatch =
    narrowingFailed ||
    fieldDisagrees(mapping.venue, venue, matched.venue) ||
    fieldDisagrees(mapping.city, city, matched.city);

  return mismatch ? { id: matched.id, ambiguous: false, mismatch: true } : { id: matched.id, ambiguous: false };
}

/**
 * Resolve raw import rows into typed sheet values, catalog matches, and a
 * per-row status. A completely blank row (every cell empty) is "skipped" and
 * never enters resolution. Otherwise the row is "ready" when it resolved with
 * no issues, or "attention" when at least one issue was flagged — an
 * "attention" row is still importable as a draft; the flags just mark what a
 * human should double-check before issuing it.
 */
export function buildOrderRows(
  rows: ImportRowInput[],
  mapping: OrderColumnMapping,
  catalog: ImportCatalog
): ResolvedImportRow[] {
  return rows.map(({ rowIndex, record }) => {
    const isCompletelyEmpty = Object.values(record).every((v) => v.trim() === "");
    if (isCompletelyEmpty) {
      return { rowIndex, sheet: {}, status: "skipped", issues: [] };
    }

    const sheet: Partial<Record<EditableOrderFieldKey, unknown>> = {};
    const issues: string[] = [];

    const rawArtistName = cell(record, mapping.artist_name);
    const rawEmail = cell(record, mapping.recipient_email);
    const rawRole = cell(record, mapping.role);
    const rawCast = cell(record, mapping.cast);
    const rawDate = cell(record, mapping.date);
    const rawVenue = cell(record, mapping.venue);
    const rawCity = cell(record, mapping.city);
    const rawDuration = cell(record, mapping.duration_min);
    const rawFee = cell(record, mapping.fee);
    const rawCurrency = cell(record, mapping.currency);
    const rawNotes = cell(record, mapping.notes);

    if (rawArtistName) sheet.artist_name = rawArtistName;
    if (rawEmail) sheet.recipient_email = rawEmail;
    if (rawRole) sheet.role = rawRole;
    if (rawCast) sheet.cast = rawCast;
    if (rawVenue) sheet.venue = rawVenue;
    if (rawCity) sheet.city = rawCity;
    if (rawDuration) sheet.duration_min = rawDuration;
    if (rawCurrency) sheet.currency = rawCurrency.toUpperCase();
    if (rawNotes) sheet.notes = rawNotes;

    let isoDate: string | undefined;
    if (rawDate) {
      const parsed = parseImportDate(rawDate);
      if (parsed) {
        isoDate = parsed;
        sheet.date = parsed;
      } else {
        issues.push("unparseable_date");
      }
    } else if (mapping.date) {
      // Date column is mapped but this row's cell is blank — flag it (mirrors
      // the missing_fee handling below). An unmapped date column is left
      // alone: there's no per-row cell to be blank, so nothing to flag.
      issues.push("missing_date");
    }

    if (rawFee) {
      const parsedFee = parseImportMoney(rawFee);
      if (parsedFee) {
        sheet.fee = parsedFee;
      } else if (parsedFee === undefined) {
        // Ambiguous single-separator amount (e.g. "4.500") — surfaced
        // separately from missing_fee so the producer knows to disambiguate
        // rather than just fill in a blank. sheet.fee is deliberately left
        // unset: guessing wrong here silently under/over-pays the artist.
        issues.push("ambiguous_fee");
      } else {
        issues.push("missing_fee");
      }
    } else if (mapping.fee) {
      // Fee column is mapped but this row's cell is blank — flag it (mirrors
      // the missing_date handling above). An unmapped fee column is left
      // alone: there's no per-row cell to be blank, so nothing to flag.
      issues.push("missing_fee");
    }

    const matchedArtistId = matchArtist(rawEmail, rawArtistName, catalog.artists);
    if (!matchedArtistId) issues.push("unknown_artist");

    let matchedShowDateId: string | undefined;
    if (isoDate) {
      const result = matchShowDate(isoDate, rawVenue, rawCity, mapping, catalog.dates);
      matchedShowDateId = result.id;
      if (result.ambiguous) issues.push("ambiguous_date");
      if (result.mismatch) issues.push("venue_city_mismatch");
    }

    const status: ResolvedImportRow["status"] = issues.length > 0 ? "attention" : "ready";

    return { rowIndex, sheet, matchedArtistId, matchedShowDateId, status, issues };
  });
}
