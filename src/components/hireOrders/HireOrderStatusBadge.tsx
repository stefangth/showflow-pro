import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

/**
 * Status pill for a hire order, shared by every surface that lists or shows one
 * (the date-sheet card, the V3 document viewer, and the artist dashboard). Kept
 * as a single source of truth so the status→tone mapping never drifts between
 * them. `issued` is deliberately surfaced as "Awaiting countersign" per the
 * design, not the raw enum label.
 */
export function HireOrderStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("hireOrdersPages");
  switch (status) {
    case "draft":
      return <Badge variant="secondary">{t("statusBadge.draft")}</Badge>;
    case "ready":
      return <Badge variant="accent">{t("statusBadge.ready")}</Badge>;
    case "issued":
      return <Badge variant="hold">{t("statusBadge.issued")}</Badge>;
    case "countersigned":
      return <Badge variant="confirmed">{t("statusBadge.countersigned")}</Badge>;
    case "void":
      return <Badge variant="neutral">{t("statusBadge.void")}</Badge>;
    default:
      return <Badge variant="neutral">{status}</Badge>;
  }
}
