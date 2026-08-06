// Hire order readiness validation — returns string codes only, never copy;
// the UI is responsible for translating codes into user-facing text.
// MIRROR: supabase/functions/_shared/hireOrders.ts carries the same logic
// (the two runtimes cannot share an import). Change both files in the same commit.

import type { OrderData } from "./types";

/** Whitespace counts as blank. A legal name of "   " is not a legal party, and a
 *  fee or email of "   " is not a value either. Without the trim, the rail's
 *  `computeSetupStatus` (which does trim) and this rule disagree, so one surface
 *  says "Blocks issue" while the other enables Issue and the PDF goes out with an
 *  empty letterhead header. */
function isBlank(value: unknown): boolean {
  if (typeof value === "string") return value.trim() === "";
  return value === undefined || value === null;
}

/**
 * A hire order is ready to issue once it has a fee, a recipient email, a
 * date, and the org's letterhead has a legal name. Returns [] when ready.
 */
export function orderReadyIssues(data: OrderData, letterhead: unknown): string[] {
  const issues: string[] = [];
  if (isBlank(data.fee?.value)) issues.push("missing_fee");
  if (isBlank(data.recipient_email?.value)) issues.push("missing_recipient_email");
  if (isBlank(data.date?.value)) issues.push("missing_date");
  const legalName = (letterhead as { legal_name?: unknown } | null | undefined)?.legal_name;
  if (isBlank(legalName)) issues.push("missing_letterhead");
  return issues;
}
