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

/** Trim + locale-INDEPENDENT lowercase. Used for the city link key AND name-based
 *  matching/dedup. toLowerCase (not toLocaleLowerCase) so the Deno poll and the browser UI
 *  produce identical keys regardless of runtime locale — the ADR-0010 parity requirement. */
export function normalizeCityName(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

/** City link key — the city option value, normalized (trim + lowercase). Null when blank. */
export function buildCityKey(city: string | null | undefined): string | null {
  const n = normalizeCityName(city);
  return n.length ? n : null;
}
