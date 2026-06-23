/** Why the Airtable schema dropdowns fell back to manual entry — drives the Alert copy. */
export type FallbackCause = "no-scope" | "per-base" | "error";

/**
 * Explains the manual-entry fallback. The cause matters: telling a user to grant
 * `schema.bases:read` is wrong (and misleading) when the key already has it and the
 * failure is a per-base permission or a transient network/edge error.
 */
export function airtableFallbackMessage(cause: FallbackCause): string {
  switch (cause) {
    case "per-base":
      return "Your key can't read this base's tables — it may not have access to this specific base. Enter the table name manually below.";
    case "error":
      return 'Couldn\'t reach Airtable to read the schema. Enter the names manually below, or click "Load from Airtable" to retry.';
    case "no-scope":
    default:
      return "Your Airtable key lacks the schema.bases:read scope. Grant it to pick base/table/fields from dropdowns; until then, type the names below.";
  }
}
