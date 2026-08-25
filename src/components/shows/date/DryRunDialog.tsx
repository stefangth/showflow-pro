import { useTranslation } from "react-i18next";
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
  /** True when the dry-run query failed (e.g. the open-offer-tier edge function is
   *  unavailable). Renders an error state instead of falling through to a false
   *  "send 0 asks" body, which is indistinguishable from a real zero-eligibility result. */
  error?: boolean;
  /** Re-run the failed dry-run, from the error state. */
  onRetry?: () => void;
  flow: Pick<BookingFlow, "offer_delivery">;
  /** True while the open-tier mutation is in flight — blocks a double confirm. */
  confirmPending?: boolean;
  onConfirm: () => void;
}

/** Preview-who-gets-offers dialog for a tier, backed by `dryRunOfferTier`.
 *  Presentational: the caller owns the dry-run query and the actual open-tier mutation. */
export function DryRunDialog({
  open, onOpenChange, tier, result, loading, error = false, onRetry, flow, confirmPending = false, onConfirm,
}: DryRunDialogProps) {
  const { t } = useTranslation("showsDetail");
  const candidates = result?.candidates ?? [];
  const n = candidates.length;
  const hasMessage = !!result?.message;
  const notReady = loading || tier == null || !result;
  // Zero candidates means nobody would get an offer: disable even without an explicit
  // `message` (e.g. every eligible artist is already booked, blocked, or inactive).
  // `confirmPending` blocks a second click while the open-tier mutation is in flight.
  // A failed check (`error`) can never be confirmed either.
  const confirmDisabled = notReady || error || hasMessage || n === 0 || confirmPending;

  const deliverySentence = flow.offer_delivery === "digest"
    ? t("dryRunDialog.deliveryDigest")
    : t("dryRunDialog.deliveryImmediate");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label={t("dryRunDialog.previewOfferTier")}>
        <DialogHeader>
          <DialogTitle>
            {loading || tier == null
              ? t("dryRunDialog.checkingTitle")
              : error
                ? t("dryRunDialog.errorTitle")
                : t("dryRunDialog.openingTitle", { tier, count: n })}
          </DialogTitle>
          <DialogDescription>
            {loading
              ? t("dryRunDialog.checkingDesc")
              : error
                ? t("dryRunDialog.errorDesc")
                : hasMessage
                  ? t("dryRunDialog.notReadyDesc")
                  : deliverySentence}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2" role="status" aria-label={t("dryRunDialog.loadingPreview")}>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : error ? (
          onRetry && (
            <div>
              <Button variant="outline" size="sm" onClick={onRetry}>{t("dryRunDialog.retry")}</Button>
            </div>
          )
        ) : hasMessage ? (
          <p className="text-sm text-muted-foreground">{result?.message}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t("dryRunDialog.excludedLine", {
                alreadyBooked: result?.excluded.alreadyBooked ?? 0,
                blocked: result?.excluded.blocked ?? 0,
                inactive: result?.excluded.inactive ?? 0,
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("dryRunDialog.notEligible", { count: result?.excluded.notEligible ?? 0 })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("dryRunDialog.missingSkills", { count: result?.excluded.missingSkills ?? 0 })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center rounded-full border border-border bg-well-tint px-2.5 py-1 text-xs"
                >
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("dryRunDialog.cancel")}</Button>
          <Button onClick={onConfirm} disabled={confirmDisabled}>
            {error || tier == null ? t("dryRunDialog.openTier") : t("dryRunDialog.openTierConfirm", { tier, count: n })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
