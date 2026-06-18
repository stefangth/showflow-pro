/** Custom-field value type. Mirrors supabase/functions/_shared/customFields.ts. */
export type CustomFieldType = "text" | "number" | "date" | "boolean" | "select";

/** Map an Airtable field type to a custom field type. Unknown → 'text'. */
export function airtableTypeToCustomType(airtableType: string): CustomFieldType {
  switch (airtableType) {
    case "number":
    case "currency":
    case "percent":
    case "duration":
    case "rating":
    case "autoNumber":
      return "number";
    case "date":
    case "dateTime":
      return "date";
    case "checkbox":
      return "boolean";
    case "singleSelect":
      return "select";
    default:
      return "text";
  }
}

/** Slugify a label into a safe custom key: lowercase, [a-z0-9_], collapsed, trimmed. */
export function slugifyKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Display a custom value by type. Null/undefined/'' → '—'. Dates are stored ISO → dd.mm.yyyy. */
export function formatCustomValue(value: unknown, type: CustomFieldType): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (type) {
    case "boolean":
      return value === true || value === "true" ? "Yes" : "No";
    case "date": {
      const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[3]}.${m[2]}.${m[1]}` : String(value);
    }
    case "number":
    case "select":
    case "text":
      return String(value);
  }
}

/** Compare two custom values by type for client-side sort. Empty sorts last. */
export function compareCustomValues(a: unknown, b: unknown, type: CustomFieldType): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  switch (type) {
    case "number": {
      const na = Number(a), nb = Number(b);
      return (Number.isFinite(na) ? na : 0) - (Number.isFinite(nb) ? nb : 0);
    }
    case "boolean": {
      const ba = a === true || a === "true" ? 1 : 0;
      const bb = b === true || b === "true" ? 1 : 0;
      return ba - bb;
    }
    case "date":
    case "select":
    case "text":
      return String(a).localeCompare(String(b));
  }
}

export type CustomFilterState =
  | { kind: "text"; q: string }
  | { kind: "select"; value: string | null }
  | { kind: "number"; min: number | null; max: number | null }
  | { kind: "date"; from: string | null; to: string | null }
  | { kind: "boolean"; value: boolean | null };

/** True when the value passes the filter. An "empty" filter matches everything. */
export function customFilterMatches(
  value: unknown, type: CustomFieldType, filter: CustomFilterState,
): boolean {
  switch (filter.kind) {
    case "text": {
      if (!filter.q) return true;
      if (value === null || value === undefined) return false;
      return String(value).toLowerCase().includes(filter.q.toLowerCase());
    }
    case "select":
      return !filter.value ? true : String(value ?? "") === filter.value;
    case "number": {
      if (filter.min === null && filter.max === null) return true;
      if (value === null || value === undefined || value === "") return false;
      const n = Number(value);
      if (!Number.isFinite(n)) return false;
      if (filter.min !== null && n < filter.min) return false;
      if (filter.max !== null && n > filter.max) return false;
      return true;
    }
    case "date": {
      if (!filter.from && !filter.to) return true;
      if (value === null || value === undefined || value === "") return false;
      const v = String(value).slice(0, 10);
      if (filter.from && v < filter.from) return false;
      if (filter.to && v > filter.to) return false;
      return true;
    }
    case "boolean":
      return filter.value === null ? true : (value === true) === filter.value;
  }
}
