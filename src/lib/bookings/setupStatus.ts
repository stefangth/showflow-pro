// Client-only booking-setup readiness for the guided-onboarding rail (design 1a).
//
// Deliberately SEPARATE from the engine's own gates. The coverage rule mirrors
// resolveTierLadder in supabase/functions/_shared/eligibility.ts (show-scoped
// show_cast_eligibility priorities win outright, else the org-wide
// cast_city_priority for the city) and only ever OVER-reports: it drives an
// affordance, and open-offer-tier remains authoritative.

export type BookingSetupStepKey = "flow" | "people" | "slots" | "ladder" | "eligibility" | "timing" | "shows";
/** What an outstanding step costs the org, in that org's own vocabulary. "offers" and
 *  "booking" are the SAME hard gate seen under two flows: an org that runs offers reads the
 *  specific consequence, a direct-book org (which never opens a tier) reads the general one
 *  that is true either way. "filling" is the soft one: the pipeline still runs. `null` is
 *  not only "soft": a step can cost a given org nothing at all (see `blockFor`). */
export type BlockKind = "offers" | "booking" | "filling" | null;

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
  /** How many ACTIVE artists the org has on its roster (fetchArtistCount scopes to
   *  `status = 'active'`, the same population open-offer-tier reads, so this gate cannot
   *  clear for an org whose whole roster is parked). `null` = unreadable (loading or a
   *  failed read) and is treated as 0, so the step reports outstanding rather than falsely
   *  done. */
  artistCount: number | null;
  /** Whether this org's resolved flow runs offers (`booking_flow.artist_acceptance`).
   *  `null` = not read yet. It changes no step's DONE-ness, only what an outstanding step
   *  costs: the wording of the hard gate `people` holds under either flow, and whether
   *  `ladder` is a gate at all (it is one only for an org that opens tiers). See `blockFor`,
   *  which is the single place both of those are decided. */
  artistAcceptance: boolean | null;
}

/** Display title per step, shared by the rail and the producer waiting card so a rename
 *  lands in exactly one place. */
export const STEP_TITLES: Record<BookingSetupStepKey, string> = {
  flow: "Booking flow",
  people: "Add your artists",
  slots: "Slots per show",
  ladder: "Cast priorities per city",
  eligibility: "Who is eligible",
  timing: "Email timing",
  shows: "Get your shows in",
};

const STEP_ORDER: BookingSetupStepKey[] = ["shows", "slots", "flow", "people", "ladder", "eligibility", "timing"];

/** The two wordings of the same hard gate. Both are counted by `canOffer`, so which one a
 *  step carries changes what the chip says and nothing else. */
const HARD_BLOCKS: readonly BlockKind[] = ["offers", "booking"];

/**
 * What an outstanding step costs THIS org, read from its flow.
 *
 * Two different questions are answered here, and they were briefly answered the same way,
 * which is what made the ladder chip false:
 *
 * - `people` is a hard gate under every preset. An empty roster means there is nobody to
 *   offer a date to AND nobody to book one to. Only the WORDING branches: a direct-book org
 *   never opens a tier, so "Blocks offers" would name a pipeline it does not run, while
 *   "Blocks booking" is true either way (and so is also what an unread flow says, since it
 *   cannot become false once the flow lands).
 *
 * - `ladder` is not a gate for a direct-book org at all. `cast_city_priority`, and the
 *   `priority` column on `show_cast_eligibility`, are read by `resolveTierLadder`
 *   (supabase/functions/_shared/eligibility.ts) and by `fetchOfferTiers`
 *   (src/data/bookings.ts): both exist only to open a tier. The direct-book picker is
 *   `deriveDirectBookList` (src/lib/bookings.ts) over `useEligibleArtists`, which reads the
 *   cast ROWS and ignores their priority entirely, so that org books every date with no
 *   ladder ranked at all. It therefore chips "Blocks offers" or nothing, never "Blocks
 *   booking". The unread flow takes the same `null`: `canOffer` is read only by surfaces
 *   that gate on `isLoading` first (`useBookingSetupRailVisible`, `useDashboardFirstRun`),
 *   so an optimistic null is never rendered as readiness, whereas a chip that is false for
 *   half the orgs would be rendered as fact.
 *
 * `eligibility` stays unchipped under both flows: it is the per-pair detail behind the same
 * coverage rule `ladder` already gates on, so chipping it too would double-count one gap.
 */
function blockFor(key: BookingSetupStepKey, artistAcceptance: boolean | null): BlockKind {
  switch (key) {
    case "people":
      return artistAcceptance === true ? "offers" : "booking";
    case "ladder":
      return artistAcceptance === true ? "offers" : null;
    case "slots":
      return "filling";
    default:
      // shows/flow/eligibility/timing are all non-blocking (they never chip).
      return null;
  }
}

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
    shows: input.hasAnyShows,
    flow: input.flowChosen,
    // Unlike the show-driven steps this needs no hasAnyShows guard: a roster is a roster
    // whether or not the org has scheduled anything yet. Counted against the ACTIVE roster
    // so this agrees with what a tier would actually resolve to.
    people: (input.artistCount ?? 0) > 0,
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
  const steps = STEP_ORDER.map((key) => ({
    key,
    done: done[key],
    block: blockFor(key, input.artistAcceptance),
  }));
  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    totalCount: steps.length,
    // Both hard wordings gate this, so a direct-book org's rail stays up for exactly the
    // same gaps as an offers org's. Reading only "offers" here would have let a direct-book
    // org's empty roster count as ready.
    canOffer: steps.every((s) => !HARD_BLOCKS.includes(s.block) || s.done),
    complete: steps.every((s) => s.done),
  };
}
