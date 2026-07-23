import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The consent statement the artist SEES in the signing dialog must byte-match
// the text baked into the certificate PDF and stored in the hire_order_signatures
// audit row. If they drift, the audit trail would claim consent to wording the
// artist never saw. The two constants are dual-homed because the Deno edge
// runtime cannot import from src/ (same reason as the database.types mirror).
// This test is the sync contract: edit one CONSENT_TEXT, edit the other in the
// same commit.
function extractConsentText(path: string): string {
  const src = readFileSync(path, "utf8");
  const match = src.match(/const CONSENT_TEXT\s*=\s*"([^"]*)"/);
  if (!match) throw new Error(`CONSENT_TEXT literal not found in ${path}`);
  return match[1];
}

describe("hire-order consent text mirror", () => {
  it("dialog CONSENT_TEXT is byte-identical to the edge function's", () => {
    const dialog = extractConsentText(
      "src/components/hireOrders/SignHireOrderDialog.tsx",
    );
    const edge = extractConsentText(
      "supabase/functions/generate-hire-orders/index.ts",
    );
    expect(dialog).toBe(edge);
  });
});
