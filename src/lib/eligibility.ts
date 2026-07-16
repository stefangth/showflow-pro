// Pure eligibility helpers shared by hooks and components. Data access lives in
// src/data/eligibility.ts; the booking engine's server-side resolution lives in
// supabase/functions/_shared/eligibility.ts (deliberately not a mirror of this file).

/** Dedup + sort so the result is stable for use inside React Query keys. */
export function unionSkillIds(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}

/** Uniform-requirement test: the artist must hold every required skill. */
export function artistHasAllSkills(artistSkillIds: Set<string>, requiredSkillIds: string[]): boolean {
  return requiredSkillIds.every((id) => artistSkillIds.has(id));
}
