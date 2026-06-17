/** Pure Airtable link-key composition — the SINGLE source shared by the React mapping UI
 *  (re-exported via src/data/airtableMapping.ts) and the airtable-poll edge function.
 *  No imports: must stay valid under both Deno and the Vite/tsc bundler resolver.
 *  ADR-0010: the UI and the poll MUST build keys identically or records silently fail to resolve. */

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

/** Grain-agnostic program link key. program present → "program|sub_program"; else the sub_program
 *  value alone. Returns null when neither yields content. */
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
