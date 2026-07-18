// Best-effort auto-match of hire-order import sheet headers to OrderFieldKey,
// covering both English and German header conventions.
import type { OrderFieldKey } from "@/lib/hireOrders/types";

export type OrderColumnMapping = Partial<Record<OrderFieldKey, string>>;

/**
 * Per-field patterns split into `strong` (exact/specific) and `weak` (loose,
 * substring) matches. Strong patterns are matched for ALL fields first, then weak
 * ones fill remaining fields — mirrors the strong-pass/weak-pass structure in
 * src/lib/artistImport/guessMapping.ts, so a loose match (e.g. /gage/ on
 * "Konzertgage") can't steal a column an exact match ("Gage") should own.
 *
 * `sessions` has no sheet-column convention in the source brief and is never
 * auto-guessed here — it stays a manual/default-layer field.
 */
const RULES: { field: OrderFieldKey; strong: RegExp[]; weak: RegExp[] }[] = [
  {
    field: "artist_name",
    strong: [/^artist([-_ ]?name)?$/, /^künstler$/, /^name$/],
    weak: [/artist/, /künstler/, /name/],
  },
  {
    field: "recipient_email",
    strong: [/^e[-_ ]?mail$/, /^email[-_ ]?address$/, /^recipient[-_ ]?email$/],
    weak: [/mail/],
  },
  {
    field: "role",
    strong: [/^role$/, /^rolle$/],
    weak: [/role/, /rolle/],
  },
  {
    field: "cast",
    strong: [/^cast$/, /^besetzung$/],
    weak: [/cast/, /besetzung/],
  },
  {
    field: "date",
    strong: [/^date$/, /^datum$/, /^show[-_ ]?date$/],
    weak: [/date/, /datum/],
  },
  {
    field: "venue",
    strong: [/^venue$/, /^location$/, /^ort$/],
    weak: [/venue/, /location/, /ort/],
  },
  {
    field: "city",
    strong: [/^city$/, /^stadt$/],
    weak: [/city/, /stadt/],
  },
  {
    field: "duration_min",
    strong: [/^duration([-_ ]?min)?$/, /^dauer$/, /^set([-_ ]?length)?$/],
    weak: [/duration/, /dauer/, /set/],
  },
  {
    field: "fee",
    strong: [/^fee$/, /^gage$/, /^honorar$/, /^betrag$/],
    weak: [/fee/, /gage/, /honorar/, /betrag/],
  },
  {
    field: "currency",
    strong: [/^currency$/, /^währung$/],
    weak: [/currency/, /währung/],
  },
  {
    field: "notes",
    strong: [/^notes?$/, /^notiz(en)?$/],
    weak: [/note/, /notiz/],
  },
];

const norm = (h: string) => h.trim().toLowerCase();

/**
 * Best-effort auto-match of sheet headers to hire-order fields (EN + DE). Case-
 * and punctuation-insensitive; each source header is claimed by at most one
 * field, and unmatched fields stay undefined.
 */
export function guessOrderMapping(headers: string[]): OrderColumnMapping {
  const mapping: OrderColumnMapping = {};
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
