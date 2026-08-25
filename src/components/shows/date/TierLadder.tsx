import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Check, MoreHorizontal } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SkillPicker } from "@/components/skills/SkillPicker";
import { cn } from "@/lib/utils";
import type { OfferTarget } from "@/lib/offerTarget";
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
  /** Preformatted local time of the tier's earliest still-pending offer, e.g.
   *  "17:00", or null when nothing is pending. Formatted by the caller (it owns
   *  the timestamps + locale) so this component stays presentational. */
  expiresLabel?: string | null;
}

/** The next-ask action block folded into the ladder: the round to ask next, its
 *  candidates, and the open/see/narrow callbacks. Null when there is nothing to
 *  ask next (every tier opened, or the viewer can't manage). */
export interface NextAsk {
  /** The resolved next-offer target (single cast or the tier fallback). */
  target: OfferTarget;
  /** The next tier's ladder row (counts.tier must match target.tier). */
  counts: TierLadderRow;
  /** Preview candidates for the avatar row, e.g. from `dryRunOfferTier`. */
  candidates: { id: string; name: string }[];
  /** Required skill names for this date, resolved id -> name by the caller. */
  requiredSkillNames: string[];
  /** Fire the open-offers flow for target.tier. */
  onOpen: () => void;
  /** Open the full candidate list (the existing DryRunDialog). */
  onSeeArtists: () => void;
  /** Toggle the "narrow this ask" panel. */
  onNarrow: () => void;
  /** Whether the narrow panel is currently expanded. */
  narrowActive: boolean;
  /** The extra skills available to narrow the ask by. */
  narrowSkills: { id: string; name: string }[];
  /** Currently-selected narrow-skill ids. */
  narrowSkillIds: string[];
  /** Toggle a single narrow-skill id on/off. */
  onToggleNarrowSkill: (id: string) => void;
}

export interface TierLadderProps {
  /** Show-specific tier ladder rows (`useTierLadderCounts`), sorted by tier ascending. */
  rows: TierLadderRow[];
  /** The city this ladder is scoped to, for the subtitle. */
  city: string;
  /** Which tiers have been opened for this date, and whether each is closed. */
  openedTiers: { tier: number; closed: boolean }[];
  /** Per-opened-tier booking status counts, derived by the caller from booking rows. */
  statusByTier: TierLadderRowStatus[];
  /** The tier to offer to next (its segment carries the open action), or null. */
  nextTier: number | null;
  /** Whether the date's parts are filled (its required slots are covered). Only a
   *  filled date turns its opened rounds green; on an unfilled date an opened round
   *  stays on the purple accent, so green always means "this date got cast". */
  filled: boolean;
  /** The date-level "ready to ask" headline count, or null to hide the headline. */
  headlineCount: number | null;
  /** True when no cast is configured after the current ask; the strip then shows an
   *  empty "next round" peek so a missing escalation path is visible rather than
   *  silently absent. */
  noNextCast: boolean;
  /** The next-ask action block, or null when there is nothing to ask next. */
  nextAsk: NextAsk | null;
  /** Routes to where a producer adds the next cast (the date's setup). When given,
   *  the empty next-round peek offers a "Set up a next cast" action; omit for a
   *  viewer who can't manage the date. */
  onSetUpNextCast?: () => void;
  /** Fires the sheet's `closeOfferTier` mutation for the given tier. */
  onCloseTier: (tier: number) => void;
}

/** The visual state of one round segment (checked top to bottom). `filled` (green)
 *  can only be reached when the whole date is filled; an opened round on an unfilled
 *  date is `open` (amber, taking answers) or `closed` (purple, asked and done but
 *  did not fill the date). `peek` is the synthetic empty look-ahead segment. */
type RoundState = "filled" | "open" | "closed" | "next" | "future" | "peek";

function roundState(opened: boolean, closed: boolean, isNext: boolean, filled: boolean): RoundState {
  if (opened) {
    if (filled) return "filled";
    return closed ? "closed" : "open";
  }
  return isNext ? "next" : "future";
}

// The 3px left accent bar per state. Green = filled, amber = open, purple accent =
// in-play-but-not-filled (next + closed), hairline = not reached / empty peek.
const BAR: Record<RoundState, string> = {
  filled: "bg-[var(--green-500)]",
  open: "bg-warning",
  closed: "bg-accent-500",
  next: "bg-accent-500",
  future: "bg-border",
  peek: "bg-border",
};

const FILL: Record<RoundState, string> = {
  filled: "",
  open: "bg-warning/10",
  closed: "",
  next: "",
  future: "",
  peek: "",
};

function tierLabel(t: TFunction<"showsDetail">, tier: number): string {
  return tier === 99 ? t("tierLadder.adHocCasts") : t("tierLadder.tierN", { tier });
}

/** The cast name for a cast target, else the tier label. */
function targetLabel(t: TFunction<"showsDetail">, target: OfferTarget): string {
  if (target.kind === "cast") return target.cast.name;
  return target.tier === 99 ? t("tierLadder.adHocCasts") : t("tierLadder.tierN", { tier: target.tier });
}

/** The one-sentence "who this ask reaches" body. */
function buildBodySentence(
  t: TFunction<"showsDetail">,
  target: OfferTarget,
  counts: TierLadderRow,
  requiredSkillNames: string[],
): string {
  const label = targetLabel(t, target);
  const artistWord = t("tierLadder.artistWord", { count: counts.castTotal });
  const first = requiredSkillNames.length > 0
    ? t("tierLadder.bodyWithSkills", {
        count: counts.matchCount, matchCount: counts.matchCount, castTotal: counts.castTotal,
        artistWord, label, skills: requiredSkillNames.join(", "),
      })
    : t("tierLadder.bodyAvailable", {
        count: counts.matchCount, matchCount: counts.matchCount, castTotal: counts.castTotal,
        artistWord, label,
      });
  const priorTier = target.tier - 1;
  if (priorTier <= 0) {
    return t("tierLadder.tier1Suffix", { first, blocked: counts.blockedCount });
  }
  return t("tierLadder.priorSuffix", {
    first, blocked: counts.blockedCount, alreadyOffered: counts.alreadyOfferedCount,
  });
}

/** First letter of up to the first two name parts, e.g. "Marta Feld" -> "MF". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Offers-tab main card (design 1e, consolidated): the show-specific tier ladder as
 * one horizontal strip of round segments, colour-coded by state, with the next-ask
 * action living on the round it applies to (the next round carries Open + a see/
 * narrow overflow; an open round carries Close). A headline "ready to ask" count
 * sits top-right, and the strip always ends on a look-ahead: a real next round, or
 * an empty peek that says no next cast is set up. The next ask's body sentence,
 * candidate avatars, and narrow-skills picker render beneath the strip. Purely
 * presentational and prop-driven — all mutations arrive as callbacks. Stacks to one
 * segment per row below `sm`.
 */
export function TierLadder({
  rows, city, openedTiers, statusByTier, nextTier, filled, headlineCount, noNextCast, nextAsk, onSetUpNextCast, onCloseTier,
}: TierLadderProps) {
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
      detail = status?.expiresLabel
        ? t("tierLadder.stateOpenExpires", { pending: status?.pending ?? 0, time: status.expiresLabel })
        : t("tierLadder.stateOpen", { pending: status?.pending ?? 0 });
    } else if (state === "closed") {
      detail = t("tierLadder.stateClosed", { accepted: status?.accepted ?? 0 });
    } else {
      const missDetail = row.missingSkillCount > 0 ? t("tierLadder.missDetail", { count: row.missingSkillCount }) : "";
      detail = t("tierLadder.matchCounts", { matchCount: row.matchCount, castTotal: row.castTotal, missDetail });
    }
    const canClose = !!opened && !opened.closed;
    return { key: `t${row.tier}`, tier: row.tier, label: tierLabel(t, row.tier), state, detail, canClose };
  });

  // Always look one round ahead: when no cast is configured after the current ask
  // (and the date is not already filled), append an empty peek so the dead-end is
  // visible instead of the strip just stopping.
  const showPeek = noNextCast && !filled;

  return (
    // overflow-hidden so the full-bleed strip's accent bars and open-state tint clip
    // to the card's rounded corners.
    <Card elevation={2} className="overflow-hidden">
      <CardHeader className="space-y-1.5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            {/* eslint-disable-next-line no-restricted-syntax -- CardTitle label, not a standard 11px/1.6px eyebrow */}
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("tierLadder.title")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t("tierLadder.priorityOrder", { city })}</p>
          </div>
          {headlineCount != null && (
            <div className="shrink-0 text-right">
              {/* eslint-disable-next-line no-restricted-syntax -- eyebrow label paired with a metric */}
              <p className="text-eyebrow font-semibold uppercase tracking-wide text-muted-foreground">
                {t("tierLadder.readyToAsk")}
              </p>
              <p className="font-display text-3xl font-semibold leading-none text-foreground">{headlineCount}</p>
            </div>
          )}
        </div>
      </CardHeader>
      {/* The rounds run edge to edge as regions of the card, not a bordered box inside
          it: one hairline separates them from the header, the segments' own left accent
          bars carry state and act as dividers. */}
      <ul
        aria-label={t("tierLadder.ariaLabel")}
        className="mt-4 flex flex-col border-t border-border sm:flex-row"
      >
          {segments.map((seg) => {
            const showOpen = seg.state === "next" && nextAsk != null;
            return (
              <li
                key={seg.key}
                className={cn(
                  "relative min-w-0 flex-1 border-t-[0.5px] border-border py-3 pl-4 pr-3.5 first:border-t-0 sm:border-t-0",
                  FILL[seg.state],
                )}
              >
                <span className={cn("absolute left-0 top-0 h-full w-[3px]", BAR[seg.state])} aria-hidden />
                <p className="text-control font-medium text-foreground">{seg.label}</p>
                <div
                  className={cn(
                    "mt-0.5 flex items-center gap-1 text-xs",
                    seg.state === "open" ? "text-warning" : "text-muted-foreground",
                  )}
                >
                  {seg.state === "filled" && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--green-600)]" aria-hidden />}
                  <span className="min-w-0">{seg.detail}</span>
                </div>

                {showOpen && nextAsk && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      onClick={nextAsk.onOpen}
                      disabled={nextAsk.counts.matchCount === 0}
                    >
                      {t("tierLadder.openOffers")}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="px-2" aria-label={t("tierLadder.askOptions")}>
                          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={nextAsk.onSeeArtists}>
                          {t("tierLadder.seeArtists", { count: nextAsk.counts.matchCount })}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={nextAsk.onNarrow}>
                          {t("tierLadder.narrowOffer")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}

                {seg.canClose && (
                  <div className="mt-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => onCloseTier(seg.tier)}>
                      {t("tierLadder.closeTier")}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}

          {showPeek && (
            <li className="relative min-w-0 flex-1 border-t-[0.5px] border-border py-3 pl-4 pr-3.5 first:border-t-0 sm:border-t-0">
              <span className="absolute left-0 top-0 h-full w-[3px] bg-border" aria-hidden />
              <p className="text-control font-medium text-muted-foreground">{t("tierLadder.nextRound")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("tierLadder.noNextCast")}</p>
              {onSetUpNextCast && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={onSetUpNextCast}
                >
                  {t("tierLadder.setUpNextCast")}
                </Button>
              )}
            </li>
          )}
      </ul>

      {nextAsk && (
        <div className="border-t border-border p-4">
          <NextAskDetail nextAsk={nextAsk} />
        </div>
      )}
    </Card>
  );
}

/** The next ask's supporting detail beneath the strip: the who-it-reaches sentence,
 *  a candidate avatar row, an exclusion line, and the narrow-skills picker when the
 *  ask's overflow toggled it on. */
function NextAskDetail({ nextAsk }: { nextAsk: NextAsk }) {
  const { t } = useTranslation("showsDetail");
  const { target, counts, candidates, requiredSkillNames } = nextAsk;
  const bodySentence = buildBodySentence(t, target, counts, requiredSkillNames);

  const exclusionParts: string[] = [];
  if (counts.missingSkillCount > 0) exclusionParts.push(t("tierLadder.missReqSkill", { count: counts.missingSkillCount }));
  if (counts.blockedCount > 0) exclusionParts.push(t("tierLadder.blockedOnDate", { count: counts.blockedCount }));
  const exclusionLine = exclusionParts.length > 0 ? exclusionParts.join(" · ") : null;

  const shown = candidates.slice(0, 4);
  const extra = Math.max(0, candidates.length - 4);
  const namesLine = shown.length > 0
    ? `${shown.map((c) => c.name).join(", ")}${extra > 0 ? t("tierLadder.andMore", { count: extra }) : ""}`
    : null;

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{bodySentence}</p>

      {namesLine && (
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {shown.map((c) => (
              <Avatar key={c.id} aria-hidden className="h-7 w-7 border-2 border-card">
                <AvatarFallback seed={c.id}>{initials(c.name)}</AvatarFallback>
              </Avatar>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{namesLine}</p>
        </div>
      )}

      {exclusionLine && <p className="text-xs text-muted-foreground">{exclusionLine}</p>}

      {nextAsk.narrowActive && (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs text-muted-foreground">{t("tierLadder.onlyOfferWith")}</p>
          <SkillPicker
            skills={nextAsk.narrowSkills}
            selectedIds={nextAsk.narrowSkillIds}
            onToggle={(id) => nextAsk.onToggleNarrowSkill(id)}
            emptyHint={t("tierLadder.noExtraSkills")}
          />
        </div>
      )}
    </div>
  );
}
