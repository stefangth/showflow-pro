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
  /** The org has its OWN booking_flow row (inheriting the classic default is not a choice). */
  flowChosen: boolean;
  /** shows-with-slots; undefined while unread → slots reported outstanding. */
  shows: { main_cast_slots: number | null; understudy_slots: number | null }[] | null | undefined;
  /** The org has its own row for all three timing keys. */
  timingChosen: boolean;
  /** undefined while unread → ladder/eligibility reported outstanding. */
  coverage: LadderCoverageInputs | null | undefined;
}

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
  const done: Record<BookingSetupStepKey, boolean> = {
    flow: input.flowChosen,
    // An empty shows array is vacuously done (nothing unconfigured); undefined is unread.
    slots: Array.isArray(input.shows)
      ? input.shows.every((s) => s.main_cast_slots != null && s.understudy_slots != null)
      : false,
    ladder: coverage ? coverage.uncoveredPairs.length === 0 : false,
    eligibility: coverage ? coverage.uncoveredPairs.length === 0 && !coverage.hasNullCity : false,
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
