import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  /** Whether the date's parts are filled (its required slots are covered). Only a
   *  filled date turns its opened rounds green; on an unfilled date an opened round
   *  stays on the purple accent, so green always means "this date got cast", never
   *  just "this round was asked". */
  filled: boolean;
  /** Fires the sheet's `closeOfferTier` mutation for the given tier. */
  onCloseTier: (tier: number) => void;
}

/** The visual state of one round segment, in priority order (checked top to bottom).
 *  `filled` (green) can only be reached when the whole date is filled; an opened
 *  round on an unfilled date is `open` (amber, still taking answers) or `closed`
 *  (purple, asked and done but did not fill the date). */
type RoundState = "filled" | "open" | "closed" | "next" | "future";

function roundState(opened: boolean, closed: boolean, isNext: boolean, filled: boolean): RoundState {
  if (opened) {
    if (filled) return "filled";
    return closed ? "closed" : "open";
  }
  return isNext ? "next" : "future";
}

// The 3px left accent bar per state. Green is the fixed success stop, amber is the
// mode-aware `warning` (waiting) role, purple is the accent stop (next + closed both
// read as "in play, not filled"), and an unreached round recedes to the hairline.
const BAR: Record<RoundState, string> = {
  filled: "bg-[var(--green-500)]",
  open: "bg-warning",
  closed: "bg-accent-500",
  next: "bg-accent-500",
  future: "bg-border",
};

// Only the open round gets a fill wash (the mode-aware waiting tint); every other
// state sits on the card surface and is carried by its accent bar alone.
const FILL: Record<RoundState, string> = {
  filled: "",
  open: "bg-warning/10",
  closed: "",
  next: "",
  future: "",
};

function tierLabel(t: TFunction<"showsDetail">, tier: number): string {
  return tier === 99 ? t("tierLadder.adHocCasts") : t("tierLadder.tierN", { tier });
}

/**
 * Offers-tab main-column card (design 1e, redesigned): the show-specific tier
 * ladder as one horizontal strip of round segments, each colour-coded by state so
 * a producer reads the whole cast-flow at a glance. Green = the round filled the
 * date, amber = the round is open and taking answers, purple = a round in play but
 * not yet filled (the next one to ask, or an asked-and-closed one), hairline = a
 * round not reached yet. Stacks to one segment per row below `sm`. Purely
 * presentational and prop-driven — no data fetching, no mutations beyond the
 * `onCloseTier` callback surfaced in the action row.
 */
export function TierLadder({ rows, city, openedTiers, statusByTier, nextTier, filled, onCloseTier }: TierLadderProps) {
  const { t } = useTranslation("showsDetail");

  const segments = rows.map((row) => {
    const opened = openedTiers.find((o) => o.tier === row.tier);
    const status = opened ? statusByTier.find((s) => s.tier === row.tier) : undefined;
    const isNext = row.tier === nextTier;
    const state = roundState(!!opened, !!opened?.closed, isNext, filled);

    let detail: string;
    if (state === "filled") {
      detail = t("tierLadder.stateFilled", { accepted: status?.accepted ?? 0 });
    } else if (state === "open") {
      detail = t("tierLadder.stateOpen", { pending: status?.pending ?? 0 });
    } else if (state === "closed") {
      detail = t("tierLadder.stateClosed", { accepted: status?.accepted ?? 0 });
    } else {
      const missDetail = row.missingSkillCount > 0 ? t("tierLadder.missDetail", { count: row.missingSkillCount }) : "";
      detail = t("tierLadder.matchCounts", { matchCount: row.matchCount, castTotal: row.castTotal, missDetail });
    }
    return { tier: row.tier, state, detail };
  });

  // Every opened-but-not-closed round can be closed; surfaced once beneath the strip
  // rather than inside the narrow segments.
  const closableTiers = rows
    .filter((row) => openedTiers.some((o) => o.tier === row.tier && !o.closed))
    .map((row) => row.tier);

  return (
    <Card elevation={2}>
      <CardHeader className="space-y-1.5">
        {/* eslint-disable-next-line no-restricted-syntax -- CardTitle label, not a standard 11px/1.6px eyebrow */}
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("tierLadder.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("tierLadder.priorityOrder", { city })}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul
          aria-label={t("tierLadder.ariaLabel")}
          className="flex flex-col overflow-hidden rounded-card border border-border sm:flex-row"
        >
          {segments.map(({ tier, state, detail }) => (
            <li
              key={tier}
              className={cn(
                "relative min-w-0 flex-1 border-t-[0.5px] border-border py-3 pl-4 pr-3.5 first:border-t-0 sm:border-t-0",
                FILL[state],
              )}
            >
              <span className={cn("absolute left-0 top-0 h-full w-[3px]", BAR[state])} aria-hidden />
              <p className="text-control font-medium text-foreground">{tierLabel(t, tier)}</p>
              <div
                className={cn(
                  "mt-0.5 flex items-center gap-1 text-xs",
                  state === "open" ? "text-warning" : "text-muted-foreground",
                )}
              >
                {state === "filled" && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--green-600)]" aria-hidden />}
                <span className="min-w-0">{detail}</span>
              </div>
            </li>
          ))}
        </ul>

        {closableTiers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {closableTiers.map((tier) => (
              <Button key={tier} type="button" variant="secondary" size="sm" onClick={() => onCloseTier(tier)}>
                {closableTiers.length > 1 ? t("tierLadder.closeTierN", { tier }) : t("tierLadder.closeTier")}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
