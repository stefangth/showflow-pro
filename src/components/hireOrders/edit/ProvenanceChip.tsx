import { Badge } from "@/components/ui/badge";
import type { FieldSource } from "@/lib/hireOrders/types";

/** Short label + Badge tone per resolution source. `manual` reads as `hold`
 *  (amber) — it is the layer a producer is actively steering, distinct from
 *  the passively-resolved `showflow`/`sheet`/`default` layers. */
const SOURCE_CHIP: Record<FieldSource, { label: string; variant: "accent" | "secondary" | "hold" | "neutral" }> = {
  showflow: { label: "SF", variant: "accent" },
  sheet: { label: "Sheet", variant: "secondary" },
  manual: { label: "Manual", variant: "hold" },
  default: { label: "Default", variant: "neutral" },
};

/**
 * Per-field provenance pill for the V2 split builder: names which of the
 * three resolution layers (ShowFlow / spreadsheet / manual entry) — or the
 * org default fallback — a resolved field's value came from. Read straight
 * off `FieldValue['source']` on an order's `data[key]`; editing a field in
 * `HireOrderEditPage` flips its chip to Manual by re-resolving through
 * `resolveFields` with the edit staged into the manual layer.
 */
export function ProvenanceChip({ source }: { source: FieldSource }) {
  const cfg = SOURCE_CHIP[source];
  return (
    <Badge variant={cfg.variant} className="shrink-0 uppercase">
      {cfg.label}
    </Badge>
  );
}
