import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { DryRunResult } from "@/data/bookings";
import type { BookingFlow } from "@/lib/bookingFlow";

export interface DryRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tier being previewed. Null while no preview is pending (dialog should be closed). */
  tier: number | null;
  /** The dry-run result once the preview query resolves; null before/while loading. */
  result: DryRunResult | null;
  loading: boolean;
  flow: Pick<BookingFlow, "offer_delivery">;
  /** True while the open-tier mutation is in flight — blocks a double confirm. */
  confirmPending?: boolean;
  onConfirm: () => void;
}

/** Preview-who-gets-offers dialog for a tier, backed by `dryRunOfferTier`.
 *  Presentational: the caller owns the dry-run query and the actual open-tier mutation. */
export function DryRunDialog({
  open, onOpenChange, tier, result, loading, flow, confirmPending = false, onConfirm,
}: DryRunDialogProps) {
  const candidates = result?.candidates ?? [];
  const n = candidates.length;
  const hasMessage = !!result?.message;
  const notReady = loading || tier == null || !result;
  // Zero candidates means nobody would get an offer: disable even without an explicit
  // `message` (e.g. every eligible artist is already booked, blocked, or inactive).
  // `confirmPending` blocks a second click while the open-tier mutation is in flight.
  const confirmDisabled = notReady || hasMessage || n === 0 || confirmPending;

  const deliverySentence = flow.offer_delivery === "digest"
    ? "Offers go out with the next daily digest."
    : "Offer emails send immediately.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label="Preview offer tier">
        <DialogHeader>
          <DialogTitle>
            {loading || tier == null
              ? "Checking who gets offers…"
              : `Opening tier ${tier} would send ${n} offers`}
          </DialogTitle>
          <DialogDescription>
            {loading
              ? "Checking who is eligible for this tier…"
              : hasMessage
                ? "This tier isn't ready to open yet."
                : deliverySentence}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2" role="status" aria-label="Loading preview">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : hasMessage ? (
          <p className="text-sm text-muted-foreground">{result?.message}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Excluded: {result?.excluded.alreadyBooked ?? 0} already booked ·{" "}
              {result?.excluded.blocked ?? 0} blocked · {result?.excluded.inactive ?? 0} inactive
            </p>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs"
                >
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onConfirm} disabled={confirmDisabled}>
            {tier != null ? `Open tier ${tier} · send ${n} offers` : "Open tier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
