import { resolveTermsClauses, type HireOrderTermsSetting } from "./terms";
import type { OrderData } from "./types";
import { orderReadyIssues } from "./validate";

export type BlockerKey =
  | "missing_fee"
  | "missing_recipient_email"
  | "missing_date"
  | "missing_letterhead"
  | "missing_terms";

export interface Blocker {
  key: BlockerKey;
  /** `order`: fixable on the order itself. `org`: an app_settings value. */
  scope: "order" | "org";
  /** Whether THIS viewer may fix it. Order scope always; org scope by capability. */
  fixable: boolean;
}

export interface BlockerInput {
  data: OrderData;
  /** The org's resolved `hire_order_letterhead`. */
  letterhead: unknown;
  /** The org's resolved and normalized `hire_order_terms`. */
  terms: HireOrderTermsSetting;
  /** The order's own `terms_variant`. */
  termsVariant: string | null;
  /** `useCan("edit_hire_order_settings")`. */
  canEditSettings: boolean;
}

/** Order-scoped first, so the rows a producer can act on read before the ones they
 *  may not be able to. Also the display order in both preflight surfaces. */
const BLOCKER_ORDER: readonly BlockerKey[] = [
  "missing_fee",
  "missing_recipient_email",
  "missing_date",
  "missing_letterhead",
  "missing_terms",
];

const ORG_SCOPED: ReadonlySet<BlockerKey> = new Set(["missing_letterhead", "missing_terms"]);

function isBlockerKey(value: string): value is BlockerKey {
  return (BLOCKER_ORDER as readonly string[]).includes(value);
}

/** User-facing copy per blocker. Kept beside the rule so a new code cannot ship
 *  without text, unlike ISSUE_FAILURE_COPY which deliberately falls back to the raw
 *  code for internal failure modes. */
export const BLOCKER_COPY: Record<BlockerKey, { label: string; detail: string }> = {
  missing_fee: {
    label: "Engagement fee",
    detail: "This order has no fee. An order cannot go out without one.",
  },
  missing_recipient_email: {
    label: "Recipient email",
    detail: "There is no address to send the order to.",
  },
  missing_date: {
    label: "Engagement date",
    detail: "This order has no date on it.",
  },
  missing_letterhead: {
    label: "Letterhead legal name",
    detail: "The document header is empty. A hire order needs a legal party on it.",
  },
  missing_terms: {
    label: "Terms template",
    detail: "No clauses are configured for this order's terms, so the back page would be blank.",
  },
};

/**
 * Every reason this order cannot be issued yet, tagged with whether the current viewer
 * can fix it.
 *
 * Delegates to `orderReadyIssues` rather than restating its rules: that function is the
 * mirrored pair the edge function's `issueOne` actually gates on, so a change there
 * flows here automatically. The terms check below mirrors the one extra line `issueOne`
 * adds on top of it (`resolveTermsClauses(setting, order.terms_variant).length === 0`).
 *
 * This is a pre-check for the UI, never the enforcement. The server gate is unchanged.
 */
export function computeBlockers(input: BlockerInput): Blocker[] {
  const codes = new Set<BlockerKey>(orderReadyIssues(input.data, input.letterhead).filter(isBlockerKey));
  if (resolveTermsClauses(input.terms, input.termsVariant).length === 0) codes.add("missing_terms");

  return BLOCKER_ORDER.filter((key) => codes.has(key)).map((key) => {
    const scope = ORG_SCOPED.has(key) ? ("org" as const) : ("order" as const);
    return { key, scope, fixable: scope === "order" || input.canEditSettings };
  });
}
