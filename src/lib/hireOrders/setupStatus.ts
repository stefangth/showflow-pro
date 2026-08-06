import { defaultTemplateId, resolveTermsClauses, type HireOrderTermsSetting } from "./terms";

export type SetupStepKey = "letterhead" | "terms" | "countersign";

export interface SetupStep {
  key: SetupStepKey;
  done: boolean;
  /** Whether leaving this undone makes the `issue` action fail. */
  blocksIssue: boolean;
}

export interface HireOrderSetupStatus {
  /** Always all three steps, in rail order. */
  steps: SetupStep[];
  doneCount: number;
  totalCount: number;
  /** Every BLOCKING step is done: the org can issue. */
  canIssue: boolean;
  /** Every step is done, blocking or not: the rail can retire. */
  complete: boolean;
}

export interface SetupStatusInput {
  /** The org's resolved `hire_order_letterhead`. */
  letterhead: { legal_name?: string | null } | null | undefined;
  /** The org's resolved and normalized `hire_order_terms`. Undefined while the read is
   *  in flight or after it failed: an unread setting is NOT the same as an empty one,
   *  and both report the step outstanding rather than pretending to know. */
  terms: HireOrderTermsSetting | null | undefined;
  /** Whether the org has its OWN `hire_order_countersign` row (see hasOrgSettingRow).
   *  Inheriting the manual default is not a decision. */
  countersignChosen: boolean;
}

/**
 * Org-level setup readiness, for the hire-order setup rail.
 *
 * Deliberately SEPARATE from `orderReadyIssues` (./validate.ts), which answers a
 * different question about a single order and is mirrored to the edge runtime as the
 * authoritative gate. This module is client-only and drives a UI affordance.
 *
 * The two overlap on letterhead alone, and this rule is deliberately one notch STRICTER
 * than `missing_letterhead`: a whitespace-only legal name passes there and prints a
 * blank letterhead, while the rail keeps the step outstanding. Over-reporting is the
 * safe direction for a checklist. Never let it drift the other way, i.e. never let the
 * rail call letterhead done on a value `orderReadyIssues` would reject.
 */
const STEP_ORDER: Array<{ key: SetupStepKey; blocksIssue: boolean }> = [
  { key: "letterhead", blocksIssue: true },
  { key: "terms", blocksIssue: true },
  // Manual mode issues perfectly well, so an undecided countersign mode never blocks.
  { key: "countersign", blocksIssue: false },
];

function letterheadDone(letterhead: SetupStatusInput["letterhead"]): boolean {
  const name = letterhead?.legal_name;
  return typeof name === "string" && name.trim() !== "";
}

function termsDone(terms: SetupStatusInput["terms"]): boolean {
  if (!terms) return false;
  return resolveTermsClauses(terms, defaultTemplateId(terms)).length > 0;
}

export function computeSetupStatus(input: SetupStatusInput): HireOrderSetupStatus {
  const done: Record<SetupStepKey, boolean> = {
    letterhead: letterheadDone(input.letterhead),
    terms: termsDone(input.terms),
    countersign: input.countersignChosen,
  };
  const steps = STEP_ORDER.map(({ key, blocksIssue }) => ({ key, done: done[key], blocksIssue }));
  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    totalCount: steps.length,
    canIssue: steps.every((s) => !s.blocksIssue || s.done),
    complete: steps.every((s) => s.done),
  };
}
