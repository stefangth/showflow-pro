import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimestampDMY } from "@/lib/dates";
import { tierFillCounts } from "@/lib/bookingCockpit";
import {
  buildOfferTierOptions, offerConfirmCopy, closeConfirmCopy, pendingOfferCount,
} from "@/lib/bookings";
import type { OpenedTier } from "@/data/bookings";
import type { BookingFlow } from "@/lib/bookingFlow";

export interface TierTimelineProps {
  /** Identity of the date/city this timeline is scoped to — not read internally
   *  beyond display/debug hooks; the caller owns the queries keyed on these. */
  showDateId: string;
  cityId: string | null;
  /** Human date label (e.g. "Mon 14 Jul 2026") for the open-tier confirm copy. */
  dateLabel: string;
  flow: Pick<BookingFlow, "artist_acceptance">;
  bookings: Array<{ status: string; offer_tier: number | null }>;
  canManage: boolean;
  /** Whether the date has any session time configured — gates the Open button. */
  hasSession: boolean;
  /** Raw per-city tier priorities + ad-hoc flag (fetchOfferTiers' return shape). */
  tiers: { priorities: number[]; hasAdHoc: boolean };
  /** Tiers already opened for this date (fetchOpenedTiers' return shape). */
  openedTiers: OpenedTier[];
  isLoadingTiers?: boolean;
  isLoadingOpened?: boolean;
  openPending?: boolean;
  closePending?: boolean;
  onOpenTier: (tier: number) => void;
  onCloseTier: (tier: number, withdraw: boolean) => void;
  onPreviewTier: (tier: number) => void;
}

/** Opened-tiers list + open/close/preview controls, ported from ShowDateDetailSheet's
 *  Offers card. Presentational: all mutations arrive as callbacks; the caller owns the
 *  underlying queries and mutations. */
export function TierTimeline({
  showDateId,
  cityId,
  dateLabel,
  flow,
  bookings,
  canManage,
  hasSession,
  tiers,
  openedTiers,
  isLoadingTiers = false,
  isLoadingOpened = false,
  openPending = false,
  closePending = false,
  onOpenTier,
  onCloseTier,
  onPreviewTier,
}: TierTimelineProps) {
  const [selectedTier, setSelectedTier] = useState<number | null>(null);
  const [closeTarget, setCloseTarget] = useState<number | null>(null);

  if (!flow.artist_acceptance) {
    return (
      <p className="text-sm text-muted-foreground" aria-label="Offer tiers">
        Direct booking: producers book from the eligibility list
      </p>
    );
  }

  const tierOptions = buildOfferTierOptions(tiers);
  // Fall back to the first option unless the explicit selection is still valid
  // (e.g. a city change can drop the previously-selected tier).
  const effectiveTier =
    selectedTier != null && tierOptions.some((o) => o.value === selectedTier)
      ? selectedTier
      : tierOptions[0]?.value ?? null;
  const alreadyOpened = openedTiers.some((o) => o.tier === effectiveTier);
  const confirmCopy = effectiveTier != null
    ? offerConfirmCopy({ tier: effectiveTier, dateLabel, alreadyOpened })
    : null;
  const closeCopy = closeTarget !== null
    ? closeConfirmCopy({ tier: closeTarget, pendingCount: pendingOfferCount(bookings, closeTarget) })
    : null;

  return (
    <div className="space-y-4" data-show-date-id={showDateId} aria-label="Offer tier timeline">
      {/* Opened tiers */}
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Opened tiers</p>
        {isLoadingOpened ? (
          <Skeleton className="h-5 w-40" />
        ) : openedTiers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tiers opened yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {openedTiers.map((o) => {
              const counts = tierFillCounts(bookings, o.tier);
              return (
                <Badge key={o.tier} variant="outline" className="flex items-center gap-2 py-1">
                  <span>
                    {o.tier === 99 ? "Ad-hoc casts" : `Tier ${o.tier}`}
                    <span className="ml-1 opacity-60">
                      · {counts.accepted} accepted · {counts.pending} pending
                      {o.closedAt
                        ? ` · closed ${formatTimestampDMY(o.closedAt)}`
                        : ` · opened ${formatTimestampDMY(o.openedAt)}`}
                    </span>
                  </span>
                  {!o.closedAt && canManage && (
                    <button
                      type="button"
                      onClick={() => setCloseTarget(o.tier)}
                      className="text-destructive hover:underline text-xs"
                    >
                      Close
                    </button>
                  )}
                </Badge>
              );
            })}
          </div>
        )}
      </div>

      {/* Open a tier */}
      {canManage && (
        isLoadingTiers ? (
          <Skeleton className="h-9 w-64" />
        ) : tierOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {cityId
              ? "No offer tiers configured for this city · set cast priorities in Settings → Cities & Casts."
              : "Select a city to configure offer tiers."}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={effectiveTier != null ? String(effectiveTier) : undefined}
              onValueChange={(v) => setSelectedTier(Number(v))}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select tier" />
              </SelectTrigger>
              <SelectContent>
                {tierOptions.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={!hasSession || openPending || effectiveTier == null}>
                  {openPending
                    ? "Opening…"
                    : `Open ${effectiveTier === 99 ? "ad-hoc casts" : `tier ${effectiveTier}`}`}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                {effectiveTier != null && confirmCopy && (
                  <>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{confirmCopy.title}</AlertDialogTitle>
                      <AlertDialogDescription>{confirmCopy.body}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onOpenTier(effectiveTier)}>
                        Open offers
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </>
                )}
              </AlertDialogContent>
            </AlertDialog>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={effectiveTier == null}
              onClick={() => { if (effectiveTier != null) onPreviewTier(effectiveTier); }}
            >
              Preview who gets offers
            </Button>

            {!hasSession && (
              <span className="text-xs text-muted-foreground">
                Add a session time before opening offers.
              </span>
            )}
          </div>
        )
      )}

      {/* Close-tier confirmation (choose withdraw vs keep) */}
      <AlertDialog open={closeTarget !== null} onOpenChange={(o) => { if (!o) setCloseTarget(null); }}>
        <AlertDialogContent>
          {closeTarget !== null && closeCopy && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{closeCopy.title}</AlertDialogTitle>
                <AlertDialogDescription>{closeCopy.intro}</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <AlertDialogAction asChild>
                  <button
                    type="button"
                    disabled={closePending}
                    onClick={() => onCloseTier(closeTarget, true)}
                    className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted disabled:opacity-50"
                  >
                    <p className="text-sm font-medium">{closeCopy.withdraw.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{closeCopy.withdraw.caption}</p>
                  </button>
                </AlertDialogAction>
                <AlertDialogAction asChild>
                  <button
                    type="button"
                    disabled={closePending}
                    onClick={() => onCloseTier(closeTarget, false)}
                    className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted disabled:opacity-50"
                  >
                    <p className="text-sm font-medium">{closeCopy.keep.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{closeCopy.keep.caption}</p>
                  </button>
                </AlertDialogAction>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
