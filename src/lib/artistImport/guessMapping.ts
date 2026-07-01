export interface FieldMapping {
  name?: string;
  email?: string;
  phone?: string;
  bio?: string;
}

const RULES: { field: keyof FieldMapping; patterns: RegExp[] }[] = [
  { field: "email", patterns: [/^e[-_ ]?mail$/, /mail/] },
  { field: "phone", patterns: [/^phone$/, /^tel$/, /mobile/, /cell/, /phone/] },
  { field: "name", patterns: [/^full[-_ ]?name$/, /^artist([-_ ]?name)?$/, /^name$/, /name/] },
  { field: "bio", patterns: [/^bio$/, /notes?/, /about/, /description/] },
];

const norm = (h: string) => h.trim().toLowerCase();

/**
 * Best-effort auto-match of source headers to artist fields. Case- and
 * punctuation-insensitive; each source header is claimed by at most one field
 * (first rule wins), and unmatched fields stay undefined.
 */
export function guessMapping(headers: string[]): FieldMapping {
  const mapping: FieldMapping = {};
  const claimed = new Set<string>();
  for (const { field, patterns } of RULES) {
    if (mapping[field]) continue;
    const hit = headers.find((h) => !claimed.has(h) && patterns.some((p) => p.test(norm(h))));
    if (hit) {
      mapping[field] = hit;
      claimed.add(hit);
    }
  }
  return mapping;
}
