import { Badge } from "@/components/ui/badge";

/**
 * Status pill for a hire order, shared by every surface that lists or shows one
 * (the date-sheet card, the V3 document viewer, and the artist dashboard). Kept
 * as a single source of truth so the status→tone mapping never drifts between
 * them. `issued` is deliberately surfaced as "Awaiting countersign" per the
 * design, not the raw enum label.
 */
export function HireOrderStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "draft":
      return <Badge variant="secondary">Draft</Badge>;
    case "ready":
      return <Badge variant="accent">Ready</Badge>;
    case "issued":
      return <Badge variant="hold">Awaiting countersign</Badge>;
    case "countersigned":
      return <Badge variant="confirmed">Countersigned</Badge>;
    case "void":
      return <Badge variant="neutral">Void</Badge>;
    default:
      return <Badge variant="neutral">{status}</Badge>;
  }
}
