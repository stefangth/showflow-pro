import { normalizeCityName, buildCityKey, buildProgramKey } from "../../supabase/functions/_shared/airtableKey.ts";

/** Which ShowFlow field each Airtable field name maps to. Stored in app_settings.airtable_field_map.
 *  Values are Airtable field NAMES (matched against the schema-read field list) or null/absent. */
export interface AirtableFieldMap {
  date?: string | null;
  program?: string | null;
  sub_program?: string | null;
  city?: string | null;
  venue?: string | null;
  session_1?: string | null;
  session_2?: string | null;
  session_3?: string | null;
  /** Airtable single-select field name whose value signals cancellation. */
  status_field?: string | null;
  /** The option string on status_field that means "cancelled". */
  cancelled_value?: string | null;
  /** Airtable field name holding the cancellation reason text. */
  cancellation_reason_field?: string | null;
}

export interface ShowflowFieldDef { key: keyof AirtableFieldMap; label: string; optional?: boolean }

/** The core fields the admin maps, in display order. session_3 is optional (Fever's base has two). */
export const SHOWFLOW_FIELDS: ShowflowFieldDef[] = [
  { key: "date", label: "Date" },
  { key: "program", label: "Program" },
  { key: "sub_program", label: "Sub-program" },
  { key: "city", label: "City" },
  { key: "venue", label: "Venue" },
  { key: "session_1", label: "Session 1" },
  { key: "session_2", label: "Session 2" },
  { key: "session_3", label: "Session 3", optional: true },
];

// Single source of truth (ADR-0010): the link-key helpers live in the shared edge module so the
// poll and this UI compose keys identically. Re-exported here so frontend imports are unchanged.
export { buildProgramKey, buildCityKey, normalizeCityName } from "../../supabase/functions/_shared/airtableKey.ts";

/** A distinct program/sub-program pairing read from Airtable records (Mode D of airtable-schema). */
export interface ProgramPair { program: string | null; sub_program: string }

/** Plan which (program, sub_program) pairs to create as catalog shows, at the composite link grain.
 *  Dedupes against existing shows by composite key AND by sub-program for legacy (pre-grain,
 *  no-"|") keys, so re-running "Import all" during/after the grain migration never duplicates a show.
 *  Pure: no client, no side effects. Rows feed importShowsFromOptions unchanged. */
export function planProgramImport(
  pairs: ProgramPair[],
  existing: Array<{ sub_program: string | null; airtable_program_key: string | null }>,
): Array<{ program: string | null; sub_program: string; key: string }> {
  const existingKeys = new Set(
    existing.map((e) => e.airtable_program_key).filter((k): k is string => !!k),
  );
  const legacySubs = new Set(
    existing
      .filter((e) => e.airtable_program_key && !e.airtable_program_key.includes("|"))
      .map((e) => (e.sub_program ?? "").trim())
      .filter(Boolean),
  );
  const seen = new Set<string>();
  const rows: Array<{ program: string | null; sub_program: string; key: string }> = [];
  for (const p of pairs) {
    const sub = (p.sub_program ?? "").trim();
    const prog = p.program == null ? null : (p.program.trim() || null);
    const key = buildProgramKey(prog, sub);
    // A pair with no sub-program isn't a catalog show in this grain — drop it. (buildProgramKey
    // would otherwise return the program-only key, which !key wouldn't catch.)
    if (!sub || !key || existingKeys.has(key) || legacySubs.has(sub) || seen.has(key)) continue;
    seen.add(key);
    rows.push({ program: prog, sub_program: sub, key });
  }
  return rows;
}

/** A catalog city row, minimal shape needed for reconciliation/dedup (structural — no import cycle). */
export interface CityRowLike { id: string; name: string; airtable_city_key: string | null }

export interface CityReconciliation {
  /** existing unlinked cities to attach a key to (a name match) */
  toLink: Array<{ cityId: string; key: string }>;
  /** genuinely-new options to create */
  toCreate: Array<{ name: string; key: string }>;
}

/** Decide, per Airtable city option, whether to link it to an existing same-name city or create
 *  a new one — so "Import all" never creates a case/whitespace duplicate of a seeded city.
 *  Pure: no client, no side effects. */
export function planCityReconciliation(options: string[], existing: CityRowLike[]): CityReconciliation {
  const linkedKeys = new Set<string>();
  const unlinkedByNorm = new Map<string, CityRowLike>();
  for (const c of existing) {
    if (c.airtable_city_key) { linkedKeys.add(c.airtable_city_key); continue; }
    const norm = normalizeCityName(c.name);
    if (norm && !unlinkedByNorm.has(norm)) unlinkedByNorm.set(norm, c); // first unlinked match wins
  }
  const toLink: CityReconciliation["toLink"] = [];
  const toCreate: CityReconciliation["toCreate"] = [];
  const seen = new Set<string>();
  for (const opt of options) {
    const key = buildCityKey(opt);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (linkedKeys.has(key)) continue;          // already linked
    const match = unlinkedByNorm.get(key);      // key === normalizeCityName(opt)
    if (match) { toLink.push({ cityId: match.id, key }); unlinkedByNorm.delete(key); }
    else toCreate.push({ name: opt, key });
  }
  return { toLink, toCreate };
}

/** Cities whose names normalize to the same value, as groups of size >1 (duplicate detection). */
export function groupDuplicateCities(cities: CityRowLike[]): Array<{ norm: string; cities: CityRowLike[] }> {
  const byNorm = new Map<string, CityRowLike[]>();
  for (const c of cities) {
    const norm = normalizeCityName(c.name);
    if (!norm) continue;
    (byNorm.get(norm) ?? byNorm.set(norm, []).get(norm)!).push(c);
  }
  return Array.from(byNorm.entries())
    .filter(([, list]) => list.length > 1)
    .map(([norm, list]) => ({ norm, cities: list }));
}
