/**
 * Pure client-side mirror of the `resolve_show_assignments(p_program, p_sub_program,
 * p_city_id, p_org)` RPC's matching rule, for the Settings -> Casts & coverage ->
 * Production Ownership "routing check" tester. No Supabase call: it resolves entirely
 * from the assignments already fetched for the page via `fetchShowAssignments`.
 *
 * The RPC returns EVERY assignment row whose scope matches (specificity > 0), not a
 * single most-specific "winner" - the real callers (expire-offers, tier-at-risk-watcher,
 * the booking-transition triggers) notify the full deduped set of producer_user_ids it
 * returns. This resolver mirrors that: `notified` is the full matching set.
 *
 * Specificity (mirrors the RPC's CASE, used only to group the ladder for display):
 *   4 = sub_program + city both match  ("Exact")
 *   3 = city matches, sub_program is unset on the rule ("City")
 *   2 = sub_program matches, city is unset on the rule ("Sub")
 *   1 = program only, both unset on the rule ("Program")
 * The admin fallback (no matching rule at all) is APPLICATION-level, not part of this
 * resolver - callers render their own "falls back to admins" copy when `notified` is empty.
 */

export type RoutingRank = 1 | 2 | 3 | 4;

/** One producer/admin assignment, shaped for routing resolution (city/sub-program are
 *  the raw scope values used for equality - ids or names, whichever the caller's
 *  assignments and query agree on consistently). */
export interface RoutingAssignment {
  id: string;
  /** Stable per-producer identity used to dedup the notified set (mirrors the RPC's
   *  producer_user_id dedup). Falls back to `owner` when omitted (e.g. in tests). */
  ownerId?: string;
  /** Display name of the assigned owner. */
  owner: string;
  program: string;
  subProgram: string | null;
  city: string | null;
}

export interface RoutingQuery {
  program: string;
  subProgram: string | null;
  city: string | null;
}

export interface RoutingLadderEntry {
  rank: RoutingRank;
  label: string;
  /** Every matching owner at this specificity level, deduped by producer. */
  owners: RoutingAssignment[];
}

export interface RoutingResult {
  /** Every assignment whose scope matches the query, deduped by producer - the full set
   *  that would actually be notified (the RPC's real behavior: additive, not "winner takes all"). */
  notified: RoutingAssignment[];
  /** Precedence levels 4 (most specific) down to 1 (least specific), each with the
   *  matching owners at that level, informational only (no single level "wins"). */
  ladder: RoutingLadderEntry[];
}

/** Rank -> the same short specificity term used by the assignment-row badges
 *  (see OwnershipPanel's inline Exact/City/Sub/Program scope badge). */
export const RANK_LABEL: Record<RoutingRank, string> = {
  4: "Exact",
  3: "City",
  2: "Sub",
  1: "Program",
};

const RANKS_MOST_SPECIFIC_FIRST: RoutingRank[] = [4, 3, 2, 1];

function specificity(a: RoutingAssignment): RoutingRank {
  if (a.subProgram !== null && a.city !== null) return 4;
  if (a.city !== null) return 3;
  if (a.subProgram !== null) return 2;
  return 1;
}

function matchesQuery(a: RoutingAssignment, query: RoutingQuery): boolean {
  if (a.program !== query.program) return false;
  if (a.subProgram !== null && a.subProgram !== query.subProgram) return false;
  if (a.city !== null && a.city !== query.city) return false;
  return true;
}

/** Dedup by producer identity (ownerId, falling back to owner name), keeping the first
 *  occurrence (stable, input order preserved). Two distinct producers who happen to share
 *  a display name stay distinct, matching the RPC's producer_user_id dedup. */
function dedupeByOwner(assignments: RoutingAssignment[]): RoutingAssignment[] {
  const seen = new Set<string>();
  const result: RoutingAssignment[] = [];
  for (const a of assignments) {
    const key = a.ownerId ?? a.owner;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(a);
  }
  return result;
}

/**
 * Resolve every assignment that would receive notifications for `query` (the union of
 * all matching scopes, deduped by owner - mirrors the RPC's real all-matching-rows
 * behavior), plus the full precedence ladder grouping those matches by specificity for
 * informational display. Pure and deterministic: never mutates its inputs, and ties are
 * broken by stable input order.
 */
export function resolveRouting(assignments: RoutingAssignment[], query: RoutingQuery): RoutingResult {
  const candidates = assignments.filter((a) => matchesQuery(a, query));
  const notified = dedupeByOwner(candidates);

  const ladder: RoutingLadderEntry[] = RANKS_MOST_SPECIFIC_FIRST.map((rank) => ({
    rank,
    label: RANK_LABEL[rank],
    owners: dedupeByOwner(candidates.filter((c) => specificity(c) === rank)),
  }));

  return { notified, ladder };
}
