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
