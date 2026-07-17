import { useState } from "react";
import { Ticket } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatDateDMY } from "@/lib/dates";
import type { OrderData } from "@/lib/hireOrders/types";
import type { HireOrderRow } from "@/data/hireOrders";
import { useHireOrderAction, useUpdateHireOrderReview } from "@/hooks/useHireOrders";
import type { HireOrderShowDate } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: HireOrderRow;
  showDate: HireOrderShowDate;
  orgId: string;
  producerName: string;
}

/** The plan's terms variants, in order. Labels double as the persisted keys. */
const TERMS_VARIANTS = [
  { key: "lean", label: "Lean" },
  { key: "standard", label: "Standard" },
  { key: "full", label: "Full" },
] as const;

/** Read a resolved snapshot field as a trimmed string ("" when absent). */
function snapshot(data: OrderData, key: keyof OrderData): string {
  const v = data[key]?.value;
  if (v === null || v === undefined) return "";
  return String(v);
}

/** Open a base64 PDF in a new tab via a Blob URL. A `data:` URL is blocked by
 *  many browsers when opened in a new tab, so a revocable object URL is used. */
function openPdf(base64: string): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Read-only fact cell for the review grid. `mono` renders the value in the
 *  mono face (dates, durations) per the design. */
function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-sm text-foreground", mono && "font-mono")}>{value || "Not set"}</p>
    </div>
  );
}

/**
 * Review-and-issue modal for a single draft/ready hire order. Facts are read from
 * the order snapshot (what the PDF renders), falling back to the loaded show date.
 * v1 is FEE-ONLY: one engagement-fee input, no deposit/balance. Preview and Issue
 * persist the fee + terms variant first (the edge actions render from the stored
 * order), then call the preview / issue actions.
 */
export function GenerateHireOrderDialog({ open, onOpenChange, order, showDate, orgId, producerName }: Props) {
  const data = (order.data ?? {}) as OrderData;
  const artistName = order.artists?.name || snapshot(data, "artist_name");
  const dateStr = snapshot(data, "date") || showDate.date;
  const venue = snapshot(data, "venue") || showDate.venue || "";
  const durationRaw = snapshot(data, "duration_min") || (showDate.duration_minutes ?? "");
  const duration = durationRaw === "" ? "" : `${durationRaw} min`;
  const castRef =
    snapshot(data, "cast") ||
    [showDate.show?.program, showDate.show?.sub_program].filter(Boolean).join(" · ");
  const currency = order.fee_currency || "EUR";

  // The loaded order's fee/variant, captured once as the comparison baseline
  // for persist() below (the dialog is remounted per order via `key={order.id}`
  // in HireOrdersCard, so `order` itself never changes under an open dialog).
  const initialFeeAmount = order.fee_amount ?? null;
  const initialVariant = order.terms_variant || "standard";

  const [fee, setFee] = useState<string>(order.fee_amount != null ? String(order.fee_amount) : "");
  const [variant, setVariant] = useState<string>(initialVariant);

  const review = useUpdateHireOrderReview();
  const action = useHireOrderAction();
  const busy = review.isPending || action.isPending;

  const feeAmount = fee.trim() === "" ? null : Number(fee);

  // Preview/Issue call this on every click. Only write (and only re-tag
  // data.fee.source to "manual") when the producer actually edited the fee or
  // terms variant — otherwise an untouched sheet/showflow-sourced fee would be
  // silently re-tagged as manual on every click.
  async function persist(): Promise<void> {
    const changed = feeAmount !== initialFeeAmount || variant !== initialVariant;
    if (!changed) return;
    await review.mutateAsync({ id: order.id, review: { feeAmount, termsVariant: variant }, currentData: order.data });
  }

  function handlePreview(): void {
    void (async () => {
      await persist();
      const res = await action.mutateAsync({ action: "preview", org_id: orgId, order_id: order.id });
      const b64 = (res as { pdf_base64?: string } | null)?.pdf_base64;
      if (b64) openPdf(b64);
    })().catch(() => {
      /* review/action hooks already toast the failure */
    });
  }

  function handleIssue(): void {
    void (async () => {
      await persist();
      const res = await action.mutateAsync({ action: "issue", org_id: orgId, order_ids: [order.id] });
      const issued = (res as { issued?: string[] } | null)?.issued ?? [];
      if (issued.length > 0) onOpenChange(false); // hook toasts the outcome; keep open on failure
    })().catch(() => {
      /* review/action hooks already toast the failure */
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Ticket className="h-5 w-5 text-accent-700" />
            Generate hire order
          </DialogTitle>
          <DialogDescription>
            Review the terms before issuing to {artistName || "the artist"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Read-only facts, sourced from the order snapshot */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Producer" value={producerName} />
            <Fact label="Artist" value={artistName} />
            <Fact label="Date" value={dateStr ? formatDateDMY(dateStr) : ""} mono />
            <Fact label="Venue" value={venue} />
            <Fact label="Duration" value={duration} mono />
            <Fact label="Cast reference" value={castRef} />
          </div>

          {/* Engagement fee — the only editable monetary field (v1 is fee-only) */}
          <div className="rounded-lg border border-accent-200 bg-accent-50 p-3 space-y-1.5">
            <Label htmlFor="hire-order-fee" className="text-xs text-accent-700">Engagement fee</Label>
            <div className="flex items-center gap-2">
              <Input
                id="hire-order-fee"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                placeholder="0.00"
                className="bg-background"
              />
              <span className="text-sm font-medium text-muted-foreground">{currency}</span>
            </div>
          </div>

          {/* Terms variant */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Terms</Label>
            <div role="radiogroup" aria-label="Terms variant" className="flex gap-2">
              {TERMS_VARIANTS.map((v) => {
                const selected = variant === v.key;
                return (
                  <Button
                    key={v.key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    variant={selected ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => setVariant(v.key)}
                  >
                    {v.label}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Info note (fee-only copy) */}
          <div className="rounded-lg bg-muted p-3">
            <p className="text-xs text-muted-foreground">
              The PDF includes the running order and a countersignature block. The artist receives it by email.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={handlePreview} disabled={busy}>Preview PDF</Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleIssue} disabled={busy}>Issue and send</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
