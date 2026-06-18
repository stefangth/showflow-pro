/** Custom-field value type. Mirrors src/lib/customFields.ts (separate runtime, no shared import). */
export type CustomFieldType = "text" | "number" | "date" | "boolean" | "select";

/**
 * Coerce a raw Airtable field value to a storable custom value for the show_dates.custom bag.
 * `ok:false` means OMIT the key — custom fields are non-fatal and NEVER hold or drop a date,
 * and they NEVER drive booking logic (eligibility/offers/slots/status run on core columns).
 */
export function coerceCustomValue(
  raw: unknown,
  type: CustomFieldType,
): { ok: true; value: string | number | boolean } | { ok: false } {
  if (raw === null || raw === undefined || raw === "") return { ok: false };
  switch (type) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case "date": {
      const m = String(raw).match(/^\d{4}-\d{2}-\d{2}/);
      return m ? { ok: true, value: m[0] } : { ok: false };
    }
    case "boolean":
      return { ok: true, value: raw === true };
    case "select":
    case "text":
      if (typeof raw === "object") return { ok: false };
      return { ok: true, value: String(raw) };
  }
}
