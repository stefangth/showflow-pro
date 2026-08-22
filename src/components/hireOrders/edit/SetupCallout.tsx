import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Blocker } from "@/lib/hireOrders/preflight";
import { BlockerList } from "@/components/hireOrders/BlockerList";

export interface SetupCalloutProps {
  orgId: string | null;
  blockers: Blocker[];
  /** The org-settings read behind `blockers` has not landed yet. */
  isLoading: boolean;
  /** The org-settings read behind `blockers` failed. */
  isError: boolean;
}

/**
 * Org-level gaps, called out over the live document preview.
 *
 * Only org-scoped blockers appear here: the order's own fields are already on screen in
 * the left column, with their own provenance chips, so repeating them would be noise.
 * The point is the gap you can SEE on the document but cannot fix from the form.
 *
 * Renders nothing when there is nothing org-level to say, so it never occupies space on
 * a configured org.
 *
 * `isLoading` / `isError` are required, not optional, because the blockers handed down
 * here are deliberately fail-safe: an unread or failed settings read produces
 * missing_letterhead and missing_terms exactly as an unconfigured org does. Stating that
 * as a fact about the customer's document would be a confident, wrong claim, so this
 * says nothing until the read has landed and says the check failed when it did.
 */
export function SetupCallout({ orgId, blockers, isLoading, isError }: SetupCalloutProps) {
  const { t } = useTranslation("hireOrdersPages");
  if (isLoading) return null;

  if (isError) {
    return (
      <div className="mb-3 flex items-center gap-2.5 rounded-l border border-border p-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--amber-600)]" />
        <p className="text-sm text-muted-foreground">
          {t("setupCallout.checkError")}
        </p>
      </div>
    );
  }

  const orgBlockers = blockers.filter((b) => b.scope === "org");
  if (orgBlockers.length === 0) return null;

  const missingLetterhead = orgBlockers.some((b) => b.key === "missing_letterhead");
  const missingTerms = orgBlockers.some((b) => b.key === "missing_terms");
  const headline =
    missingLetterhead && missingTerms
      ? t("setupCallout.headlineBoth")
      : missingLetterhead
        ? t("setupCallout.headlineHeader")
        : t("setupCallout.headlineBack");

  return (
    <div className="mb-3 rounded-l border border-accent-200 bg-accent-50 p-3">
      <p className="text-sm font-semibold text-accent-text">{headline}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t("setupCallout.body")}
      </p>
      <div className="mt-3">
        <BlockerList orgId={orgId} blockers={orgBlockers} idPrefix="callout" onFixOrderField={() => {}} />
      </div>
    </div>
  );
}
