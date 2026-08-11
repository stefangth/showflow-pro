import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SkillPicker } from "@/components/skills/SkillPicker";
import { nextOfferButtonLabel, type OfferTarget } from "@/lib/offerTarget";
import type { TierLadderRow } from "@/data/tierLadder";

// Produces (consumed by C3.5): NextOfferHeroProps below. Purely presentational
// and prop-driven — no data fetching, no mutations. The caller (ShowDateDetailSheet)
// owns resolveNextOfferTarget/fetchTierLadderCounts/dryRunOfferTier and wires the
// callbacks to the real open-offers / preview / narrow-panel flows.
export interface NextOfferHeroProps {
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
  /** Toggle the "narrow this offer" panel. */
  onNarrow: () => void;
  /** Whether the narrow panel is currently expanded. */
  narrowActive?: boolean;
  /** The extra skills available to narrow the offer by. */
  narrowSkills?: { id: string; name: string }[];
  /** Currently-selected narrow-skill ids. */
  narrowSkillIds?: string[];
  /** Toggle a single narrow-skill id on/off. */
  onToggleNarrowSkill?: (id: string) => void;
}

/** First letter of each of up to the first two name parts, e.g. "Marta Feld" -> "MF"
 *  (mirrors the house convention in PersonRow.tsx). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** The cast name for a cast target, else the tier label (design 1e's "name it only
 *  when unambiguous" rule) — shared by the title and the body sentence's `{cast}`. */
function targetLabel(target: OfferTarget): string {
  if (target.kind === "cast") return target.cast.name;
  return target.tier === 99 ? "Ad-hoc casts" : `Tier ${target.tier}`;
}

function buildBodySentence(
  target: OfferTarget,
  counts: TierLadderRow,
  requiredSkillNames: string[],
): string {
  const label = targetLabel(target);
  const artistWord = counts.castTotal === 1 ? "artist" : "artists";
  // With no required skills, "have {skillList}" would read "have no required skills"
  // (as if the artists lacked skills); state availability instead.
  const first = requiredSkillNames.length > 0
    ? `${counts.matchCount} of ${counts.castTotal} ${artistWord} in ${label} ${counts.matchCount === 1 ? "has" : "have"} ${requiredSkillNames.join(", ")}.`
    : `${counts.matchCount} of ${counts.castTotal} ${artistWord} in ${label} ${counts.matchCount === 1 ? "is" : "are"} available.`;

  const priorTier = target.tier - 1;
  if (priorTier <= 0) {
    // Tier 1 has no earlier tier — drop the already-booked-or-offered clause
    // entirely rather than imply this count is specific to a prior tier.
    return `${first} ${counts.blockedCount} blocked.`;
  }
  // alreadyOfferedCount counts ANY non-cancelled booking for the date among the
  // tier's members (confirmed/soft_booked/suggested), not specifically a
  // prior-tier offer — keep the copy honest to what the data actually says.
  const second = `${counts.blockedCount} blocked, ${counts.alreadyOfferedCount} already booked or offered.`;
  return `${first} ${second}`;
}

/**
 * Offers-tab hero card (design 1e): the next tier/cast to offer to, with the
 * live match count, a preview of who would receive the offer, and the primary
 * "open offers" action. Wired into ShowDateDetailSheet in Task C3.5.
 */
export function NextOfferHero({
  target,
  counts,
  candidates,
  requiredSkillNames,
  onOpen,
  onSeeArtists,
  onNarrow,
  narrowActive = false,
  narrowSkills = [],
  narrowSkillIds = [],
  onToggleNarrowSkill,
}: NextOfferHeroProps) {
  const title = targetLabel(target);
  const bodySentence = buildBodySentence(target, counts, requiredSkillNames);
  const primaryLabel = nextOfferButtonLabel(target, counts.matchCount);

  const exclusionParts: string[] = [];
  if (counts.missingSkillCount > 0) exclusionParts.push(`${counts.missingSkillCount} miss a required skill`);
  if (counts.blockedCount > 0) exclusionParts.push(`${counts.blockedCount} blocked on this date`);
  const exclusionLine = exclusionParts.length > 0 ? exclusionParts.join(" · ") : null;

  const shown = candidates.slice(0, 4);
  const extra = Math.max(0, candidates.length - 4);
  const namesLine = shown.length > 0
    ? `${shown.map((c) => c.name).join(", ")}${extra > 0 ? ` and ${extra} more` : ""}`
    : null;

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent-700">
              NEXT OFFER · {target.tier === 99 ? "AD-HOC CASTS" : `TIER ${target.tier}`}
            </p>
            <p className="font-display text-xl font-semibold tracking-tight text-foreground">{title}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">GET OFFERS</p>
            <p className="font-display text-3xl font-semibold leading-none text-foreground">{counts.matchCount}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
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

        {exclusionLine && (
          <p className="text-xs text-muted-foreground">{exclusionLine}</p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" onClick={onOpen} disabled={counts.matchCount === 0}>{primaryLabel}</Button>
          <Button type="button" variant="ghost" size="sm" onClick={onSeeArtists}>
            See the {counts.matchCount} artists
          </Button>
          <Button type="button" variant="outline" size="sm" aria-pressed={narrowActive} onClick={onNarrow}>
            Narrow this offer
          </Button>
        </div>

        {narrowActive && (
          <div className="space-y-1.5 pt-1">
            <p className="text-xs text-muted-foreground">Only offer to artists with</p>
            <SkillPicker
              skills={narrowSkills}
              selectedIds={narrowSkillIds}
              onToggle={(id) => onToggleNarrowSkill?.(id)}
              emptyHint="No extra skills to narrow by."
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
