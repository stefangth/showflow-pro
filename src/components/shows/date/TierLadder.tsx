import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TierLadderRow } from "@/data/tierLadder";

/** Per-opened-tier booking status counts, derived by the caller from the date's
 *  booking rows (not fetched here). */
export interface TierLadderRowStatus {
  tier: number;
  sent: number;
  accepted: number;
  pending: number;
  /** Bookings cancelled in the tier — an artist declining, or a producer/system
   *  withdrawal (promotion, expiry). "cancelled", not "declined", since the row
   *  status alone can't tell those apart. */
  cancelled: number;
}

// Produces (consumed by C3.5): TierLadderProps below. Purely presentational —
// `useTierLadderCounts`/`fetchOpenedTiers`/the date's booking rows are the caller's
// (ShowDateDetailSheet's) job; this component only renders their output and surfaces
// a `Close tier` callback for the sheet's existing `closeOfferTier` mutation.
export interface TierLadderProps {
  /** Show-specific tier ladder rows (`useTierLadderCounts`), sorted by tier ascending. */
  rows: TierLadderRow[];
  /** The city this ladder is scoped to, for the subtitle. */
  city: string;
  /** Which tiers have been opened for this date, and whether each is closed
   *  (`fetchOpenedTiers`'s return shape, narrowed to what this card needs). */
  openedTiers: { tier: number; closed: boolean }[];
  /** Per-opened-tier booking status counts, derived by the caller from booking rows. */
  statusByTier: TierLadderRowStatus[];
  /** The tier that gets the accent ring (the next tier to offer to), or null when
   *  every tier is already opened. */
  nextTier: number | null;
  /** Fires the sheet's `closeOfferTier` mutation for the given tier. */
  onCloseTier: (tier: number) => void;
}

function tierLabel(tier: number): string {
  return tier === 99 ? "Ad-hoc casts" : `Tier ${tier}`;
}

/**
 * Offers-tab main-column card (design 1e): the show-specific tier ladder, one
 * timeline row per tier. Opened tiers show live offer-status counts + a `Close
 * tier` control; unopened tiers show their match count against the tier's cast(s).
 * Purely presentational and prop-driven — no data fetching, no mutations beyond
 * the `onCloseTier` callback. Wired into ShowDateDetailSheet in Task C3.5.
 */
export function TierLadder({ rows, city, openedTiers, statusByTier, nextTier, onCloseTier }: TierLadderProps) {
  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          TIER LADDER · SHOW-SPECIFIC
        </CardTitle>
        <p className="text-sm text-muted-foreground">Casts in priority order for {city}</p>
      </CardHeader>
      <CardContent>
        <ul aria-label="Tier ladder" className="space-y-0">
          {rows.map((row) => {
            const opened = openedTiers.find((o) => o.tier === row.tier);
            const status = opened ? statusByTier.find((s) => s.tier === row.tier) : undefined;
            const isNext = row.tier === nextTier;

            const dotClass = opened
              ? "bg-[var(--green-500)]"
              : isNext
                ? "border-2 border-accent-500 bg-background"
                : "border border-border bg-muted";

            const missDetail = row.missingSkillCount > 0 ? ` · ${row.missingSkillCount} miss a required skill` : "";

            return (
              <li key={row.tier} className="flex items-start gap-3 border-b border-border py-3 last:border-b-0">
                <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", dotClass)} aria-hidden />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-medium text-foreground">{tierLabel(row.tier)}</p>
                  {opened && status ? (
                    <p className="text-xs text-muted-foreground">
                      {status.sent} offers sent · {status.accepted} accepted · {status.pending} pending ·{" "}
                      {status.cancelled} cancelled
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {row.matchCount} of {row.castTotal} artists match{missDetail}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!opened && (
                    <Badge variant="neutral" className="font-mono">{row.matchCount}</Badge>
                  )}
                  {opened && !opened.closed && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => onCloseTier(row.tier)}>
                      Close tier
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
