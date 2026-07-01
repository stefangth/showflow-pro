import type { FieldMapping } from "./guessMapping";

export type ImportRowStatus = "new" | "skipped_existing" | "error";
export interface ImportValues {
  name: string;
  email: string | null;
  phone: string | null;
  bio: string | null;
}
export interface ImportRow {
  index: number;
  values: ImportValues;
  status: ImportRowStatus;
  error?: string;
}

// Mirrors EMAIL_RE in supabase/functions/create-invitation/index.ts. The two live in
// separate runtimes (Vite frontend vs Deno edge) with no shared import boundary, so the
// pattern is intentionally duplicated — keep them in sync if either changes.
export const IMPORT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cell = (row: Record<string, string>, col?: string): string => (col ? (row[col] ?? "").trim() : "");
const orNull = (s: string): string | null => (s === "" ? null : s);

/**
 * Normalize parsed rows against a field mapping, validate, and mark dedup status.
 * Name is required (error, precedence over email); a present-but-malformed email is
 * an error; a present email already in `existingEmails` (case-insensitive) is skipped;
 * everything else is new. No-email rows are always new (never dedup'd).
 */
export function buildImportRows(
  rows: Record<string, string>[],
  mapping: FieldMapping,
  existingEmails: Iterable<string>,
): ImportRow[] {
  const existing = new Set<string>();
  for (const e of existingEmails) existing.add(e.trim().toLowerCase());

  return rows.map((row, index) => {
    const name = cell(row, mapping.name);
    const email = cell(row, mapping.email);
    const values: ImportValues = {
      name,
      email: orNull(email),
      phone: orNull(cell(row, mapping.phone)),
      bio: orNull(cell(row, mapping.bio)),
    };
    if (name === "") return { index, values, status: "error", error: "Name is required" };
    if (email !== "" && !IMPORT_EMAIL_RE.test(email)) {
      return { index, values, status: "error", error: "Invalid email" };
    }
    if (email !== "" && existing.has(email.toLowerCase())) {
      return { index, values, status: "skipped_existing" };
    }
    return { index, values, status: "new" };
  });
}
