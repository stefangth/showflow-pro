import type { TierCast, TierCastRef } from "@/data/tierLadder";

/**
 * The next-offer target for a tier: names a single cast when the tier maps to
 * exactly one, else falls back to the tier label. Owner's rule: name it only
 * when unambiguous (multi-cast tiers, tier 99 ad-hoc, and unknown tiers all
 * fall back).
 */
export type OfferTarget =
  | { kind: "cast"; tier: number; cast: TierCastRef }
  | { kind: "tier"; tier: number };

export function resolveNextOfferTarget(tierMap: TierCast[], nextTier: number): OfferTarget {
  // Tier 99 is always the ad-hoc bucket: open-offer-tier sources its candidates
  // from show_date_cast_eligibility, a DIFFERENT artist set than the ladder's
  // show_cast_eligibility/cast_city_priority rows this map is built from. The
  // `priority` column has no upper-bound CHECK (only >= 1), so a stray
  // single-cast row at priority 99 could otherwise slip through the
  // `casts.length === 1` check below and name a cast whose members open-offer-tier
  // never actually offers to. Guard tier 99 unconditionally, before that check.
  if (nextTier === 99) return { kind: "tier", tier: nextTier };

  const row = tierMap.find((r) => r.tier === nextTier);
  if (row && row.casts.length === 1) {
    return { kind: "cast", tier: nextTier, cast: row.casts[0] };
  }
  return { kind: "tier", tier: nextTier };
}

/** Label for the primary "open offers" button/CTA. Cast targets get a headcount
 *  suffix when one is known; the tier fallback names ad-hoc casts at tier 99. */
export function nextOfferButtonLabel(target: OfferTarget, headcount?: number): string {
  if (target.kind === "cast") {
    const suffix = headcount != null ? ` (${headcount} artists)` : "";
    return `Open offers to ${target.cast.name}${suffix}`;
  }
  const label = target.tier === 99 ? "ad-hoc casts" : `tier ${target.tier}`;
  return `Open ${label}`;
}
