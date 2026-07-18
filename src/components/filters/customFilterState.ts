import type { CustomFieldDefinition } from "@/data/customFields";
import type { CustomFilterState } from "@/lib/customFields";

/** The empty (matches-all) filter state for a field type. */
export function emptyCustomFilter(type: CustomFieldDefinition["type"]): CustomFilterState {
  switch (type) {
    case "select": return { kind: "select", value: null };
    case "number": return { kind: "number", min: null, max: null };
    case "date": return { kind: "date", from: null, to: null };
    case "boolean": return { kind: "boolean", value: null };
    default: return { kind: "text", q: "" };
  }
}
