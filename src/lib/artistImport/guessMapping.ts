export interface FieldMapping {
  name?: string;
  email?: string;
  phone?: string;
  bio?: string;
}

/**
 * Per-field patterns split into `strong` (exact/specific) and `weak` (loose,
 * substring) matches. Strong patterns are matched for ALL fields first, then weak
 * ones fill remaining fields — so a loose match (e.g. /mail/ on "Mailing Address")
 * can't steal a column an exact match (e.g. "Email") should own.
 */
const RULES: { field: keyof FieldMapping; strong: RegExp[]; weak: RegExp[] }[] = [
  { field: "email", strong: [/^e[-_ ]?mail$/, /^email[-_ ]?address$/], weak: [/mail/] },
  { field: "phone", strong: [/^phone$/, /^tel$/, /^mobile$/, /^cell$/, /^phone[-_ ]?number$/], weak: [/mobile/, /cell/, /phone/, /tel/] },
  { field: "name", strong: [/^full[-_ ]?name$/, /^artist([-_ ]?name)?$/, /^name$/], weak: [/name/] },
  { field: "bio", strong: [/^bio$/, /^notes?$/, /^about$/, /^description$/], weak: [/notes?/, /about/, /description/] },
];

const norm = (h: string) => h.trim().toLowerCase();

/**
 * Best-effort auto-match of source headers to artist fields. Case- and
 * punctuation-insensitive; each source header is claimed by at most one field, and
 * unmatched fields stay undefined.
 */
export function guessMapping(headers: string[]): FieldMapping {
  const mapping: FieldMapping = {};
  const claimed = new Set<string>();

  const pass = (pick: (r: (typeof RULES)[number]) => RegExp[]) => {
    for (const rule of RULES) {
      if (mapping[rule.field]) continue;
      const patterns = pick(rule);
      const hit = headers.find((h) => !claimed.has(h) && patterns.some((p) => p.test(norm(h))));
      if (hit) {
        mapping[rule.field] = hit;
        claimed.add(hit);
      }
    }
  };

  pass((r) => r.strong); // exact matches win first, across all fields
  pass((r) => r.weak); // then loose fallbacks fill any remaining fields
  return mapping;
}
