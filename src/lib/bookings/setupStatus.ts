// Client-only booking-setup readiness for the guided-onboarding rail (design 1a).
//
// Deliberately SEPARATE from the engine's own gates. The coverage rule mirrors
// resolveTierLadder in supabase/functions/_shared/eligibility.ts (show-scoped
// show_cast_eligibility priorities win outright, else the org-wide
// cast_city_priority for the city) and only ever OVER-reports: it drives an
// affordance, and open-offer-tier remains authoritative.

export type BookingSetupStepKey = "flow" | "slots" | "ladder" | "eligibility" | "timing";
export type BlockKind = "offers" | "filling" | null;

export interface BookingSetupStep {
  key: BookingSetupStepKey;
  done: boolean;
  block: BlockKind;
}

export interface BookingSetupStatus {
  steps: BookingSetupStep[];
  doneCount: number;
  totalCount: number;
  /** Every offers-blocking step is done: a tier can open. */
  canOffer: boolean;
  /** Every step is done: the rail retires. */
  complete: boolean;
}

export interface LadderCoverageInputs {
  /** (show, city) of every future non-cancelled date; city may be null. */
  futurePairs: { showId: string; cityId: string | null }[];
  /** show_cast_eligibility rows with a non-null priority. */
  showPriorities: { showId: string; cityId: string; castId: string; priority: number }[];
  /** cast_city_priority rows for the org. */
  cityPriorities: { cityId: string; castId: string; priority: number }[];
}

export interface CoverageResult {
  /** Pairs with a city whose effective ladder has no tier-1 cast. */
  uncoveredPairs: { showId: string; cityId: string }[];
  /** At least one future date has no city assigned. */
  hasNullCity: boolean;
}

export interface BookingSetupStatusInput {
  /** The org has its OWN booking_flow row AND that flow is active (inheriting the classic
   *  default, or a paused/off flow, is not a choice). */
  flowChosen: boolean;
  /** The org has at least one show of ANY status (active, archived, or draft). This is the
   *  "not a blank org" signal: it distinguishes a never-configured org (→ the data-driven
   *  steps stay outstanding, an honest 0-of-N) from a configured org that simply has no
   *  ACTIVE shows or no UPCOMING dates right now (e.g. between seasons). */
  hasAnyShows: boolean;
  /** active shows-with-slots; undefined while unread. Slots is done only when the org has
   *  shows (hasAnyShows) and every active show has both slot counts set. */
  shows: { main_cast_slots: number | null; understudy_slots: number | null }[] | null | undefined;
  /** The org has its own row for all three timing keys. */
  timingChosen: boolean;
  /** undefined while unread → ladder/eligibility reported outstanding. */
  coverage: LadderCoverageInputs | null | undefined;
}

/** Display title per step, shared by the rail and the producer waiting card so a rename
 *  lands in exactly one place. */
export const STEP_TITLES: Record<BookingSetupStepKey, string> = {
  flow: "Booking flow",
  slots: "Slots per show",
  ladder: "Cast priorities per city",
  eligibility: "Who is eligible",
  timing: "Response window and digests",
};

const STEP_ORDER: BookingSetupStepKey[] = ["flow", "slots", "ladder", "eligibility", "timing"];
const BLOCK: Record<BookingSetupStepKey, BlockKind> = {
  flow: null, slots: "filling", ladder: "offers", eligibility: null, timing: null,
};

export function resolveCoverage(inputs: LadderCoverageInputs): CoverageResult {
  const uncoveredPairs: { showId: string; cityId: string }[] = [];
  let hasNullCity = false;
  const seen = new Set<string>();
  for (const p of inputs.futurePairs) {
    if (p.cityId === null) { hasNullCity = true; continue; }
    const key = `${p.showId}|${p.cityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const scoped = inputs.showPriorities.filter((r) => r.showId === p.showId && r.cityId === p.cityId);
    const ladder = scoped.length > 0 ? scoped : inputs.cityPriorities.filter((r) => r.cityId === p.cityId);
    if (!ladder.some((r) => r.priority === 1)) uncoveredPairs.push({ showId: p.showId, cityId: p.cityId });
  }
  return { uncoveredPairs, hasNullCity };
}

export function computeBookingSetupStatus(input: BookingSetupStatusInput): BookingSetupStatus {
  const coverage = input.coverage ? resolveCoverage(input.coverage) : undefined;
  const futureCount = input.coverage?.futurePairs.length ?? 0;
  // A blank org (no shows at all, any status) has nothing configured, so the data-driven steps
  // stay outstanding → an honest 0-of-N. Once the org has real shows — even if none are active
  // or it has no upcoming dates — those steps fall back to "nothing left to configure", so an
  // established org between seasons is not dragged back to "setup in progress".
  const done: Record<BookingSetupStepKey, boolean> = {
    flow: input.flowChosen,
    slots: input.hasAnyShows && Array.isArray(input.shows)
      ? input.shows.every((s) => s.main_cast_slots != null && s.understudy_slots != null)
      : false,
    // With no upcoming (show, city) pairs there is nothing to cover, so a configured org is
    // done; with future pairs, every one needs a tier-1 cast (and a city, for eligibility).
    ladder: input.hasAnyShows && coverage
      ? futureCount === 0 || coverage.uncoveredPairs.length === 0
      : false,
    eligibility: input.hasAnyShows && coverage
      ? futureCount === 0 || (coverage.uncoveredPairs.length === 0 && !coverage.hasNullCity)
      : false,
    timing: input.timingChosen,
  };
  const steps = STEP_ORDER.map((key) => ({ key, done: done[key], block: BLOCK[key] }));
  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    totalCount: steps.length,
    canOffer: steps.every((s) => s.block !== "offers" || s.done),
    complete: steps.every((s) => s.done),
  };
}
