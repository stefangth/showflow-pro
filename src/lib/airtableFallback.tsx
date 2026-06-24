import type { ReactNode } from "react";

/** Why the Airtable schema dropdowns fell back to manual entry — drives the Alert copy. */
export type FallbackCause = "no-scope" | "per-base" | "error";

/**
 * Explains the manual-entry fallback. The cause matters: telling a user to grant
 * `schema.bases:read` is wrong (and misleading) when the key already has it and the
 * failure is a per-base permission or a transient network/edge error.
 *
 * Returns a ReactNode (not a bare string) so the `schema.bases:read` scope renders as
 * a copy-pasteable `<code>` token, matching the surrounding Airtable settings UI.
 */
export function airtableFallbackMessage(cause: FallbackCause): ReactNode {
  switch (cause) {
    case "per-base":
      return "Your key can't read this base's tables — it may not have access to this specific base. Enter the table name manually below.";
    case "error":
      return 'Couldn\'t reach Airtable to read the schema. Enter the names manually below, or click "Refresh from Airtable" to retry.';
    case "no-scope":
      return (
        <>
          Your Airtable key lacks the <code>schema.bases:read</code> scope. Grant it to pick base/table/fields from dropdowns; until then, type the names below.
        </>
      );
    default: {
      // Compile-time guard: adding a FallbackCause without a branch here fails the build
      // instead of silently showing the wrong message.
      const _exhaustive: never = cause;
      void _exhaustive;
      return "Unable to load the Airtable schema. Enter the names manually below.";
    }
  }
}
