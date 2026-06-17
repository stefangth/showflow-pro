/** Which Showflow field each Airtable field name maps to. Stored in app_settings.airtable_field_map.
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

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

/** Grain-agnostic program link key. program present → "program|sub_program"; else the sub_program
 *  value alone. Returns null when neither yields content. Must match the Phase 3 poll's resolver. */
export function buildProgramKey(program: string | null | undefined, subProgram: string | null | undefined): string | null {
  const p = clean(program);
  const s = clean(subProgram);
  if (p && s) return `${p}|${s}`;
  return s ?? p;
}

/** City link key — the city option value, trimmed. */
export function buildCityKey(city: string | null | undefined): string | null {
  return clean(city);
}
