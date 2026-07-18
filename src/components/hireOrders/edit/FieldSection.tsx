import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import type { FieldSource } from "@/lib/hireOrders/types";
import { ProvenanceChip } from "./ProvenanceChip";

interface Props {
  /** The OrderFieldKey this row edits (or any stable key, for non-order-field
   *  rows like the terms variant control). Drives both the label's `htmlFor`
   *  (paired with the input's `id`, which callers set to `ho-edit-${fieldKey}`)
   *  and a `data-testid` for scoping in tests. */
  fieldKey: string;
  label: string;
  /** Omitted for rows with no FieldValue of their own (e.g. terms variant) — no
   *  chip renders. */
  source?: FieldSource;
  /** The input control. Left to the caller so each field can use the input
   *  type/formatting it needs (text, number, textarea, select). */
  children: ReactNode;
}

/**
 * One labeled field row in the V2 split builder's left column: a label, the
 * caller's input control, and a ProvenanceChip naming the field's resolved
 * source. The four numbered sections (Parties, Engagement, Fees and payment,
 * Terms detail) are built by stacking these.
 */
export function FieldSection({ fieldKey, label, source, children }: Props) {
  return (
    <div className="space-y-1.5" data-testid={`field-${fieldKey}`}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`ho-edit-${fieldKey}`} className="text-xs text-muted-foreground">
          {label}
        </Label>
        {source && <ProvenanceChip source={source} />}
      </div>
      {children}
    </div>
  );
}
