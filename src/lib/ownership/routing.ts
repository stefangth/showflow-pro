/**
 * Pure client-side mirror of the `resolve_show_assignments(p_program, p_sub_program,
 * p_city_id, p_org)` RPC's precedence rule, for the Settings -> Casts & coverage ->
 * Production Ownership "routing check" tester. No Supabase call: it resolves entirely
 * from the assignments already fetched for the page via `fetchShowAssignments`.
 *
 * Specificity (mirrors the RPC's CASE, ORDER BY specificity DESC):
 *   4 = sub_program + city both match  ("Exact")
 *   3 = city matches, sub_program is unset on the rule ("City")
 *   2 = sub_program matches, city is unset on the rule ("Sub")
 *   1 = program only, both unset on the rule ("Program")
 * The admin fallback (no matching rule at all) is APPLICATION-level, not part of this
 * resolver — callers render their own "falls back to admins" copy when `winner` is null.
 */

export type RoutingRank = 1 | 2 | 3 | 4;

/** One producer/admin assignment, shaped for routing resolution (city/sub-program are
 *  the raw scope values used for equality - ids or names, whichever the caller's
 *  assignments and query agree on consistently). */
export interface RoutingAssignment {
  id: string;
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
  owner: string | null;
}

export interface RoutingResult {
  winner: RoutingAssignment | null;
  rankMatched: RoutingRank | null;
  /** Precedence levels 4 (most specific) down to 1 (least specific), each with the
   *  owner that would apply at that level for this query, or null if no rule occupies it. */
  ladder: RoutingLadderEntry[];
}

/** Rank -> the same short specificity term used by the assignment-row badges
 *  (see ProductionOwnershipTab's inline Exact/City/Sub/Program badge). */
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

/**
 * Resolve which assignment would receive notifications for `query`, plus the full
 * precedence ladder for that query. Deterministic: on a specificity tie, the first
 * matching assignment in input order wins (mirrors a stable SQL ORDER BY with no
 * further tiebreaker column) and is never mutated.
 */
export function resolveRouting(assignments: RoutingAssignment[], query: RoutingQuery): RoutingResult {
  const candidates = assignments.filter((a) => matchesQuery(a, query));

  let winner: RoutingAssignment | null = null;
  let rankMatched: RoutingRank | null = null;
  for (const candidate of candidates) {
    const rank = specificity(candidate);
    if (rankMatched === null || rank > rankMatched) {
      winner = candidate;
      rankMatched = rank;
    }
  }

  const ladder: RoutingLadderEntry[] = RANKS_MOST_SPECIFIC_FIRST.map((rank) => {
    const occupant = candidates.find((c) => specificity(c) === rank) ?? null;
    return { rank, label: RANK_LABEL[rank], owner: occupant?.owner ?? null };
  });

  return { winner, rankMatched, ladder };
}
