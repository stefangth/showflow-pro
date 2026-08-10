// What the two coverage panels of the booking setup rail are actually for, read from the
// org's own flow.
//
// LadderStep and EligibilityStep are read-only summaries of the same rows, and each opened
// with one fixed sentence describing the offer pipeline ("The order offers go out in.
// Tier 1 is asked first...", "Without a match the tier opens to nobody."). A direct-book org
// (`artist_acceptance` false) never opens a tier, so both sentences described a pipeline it
// does not run, on a rail whose chips this WP had just taught to speak that org's language.
//
// The split between these sentences and the step hints in
// `src/lib/dashboard/moduleOnboarding.ts` is deliberate. That registry is a FLAT record with
// no ctx at either consumer, so its hints can only name what a row HOLDS. These functions
// have the flow, so they carry the consequence, which is the half that genuinely differs:
//
//  - the ladder is read by nothing a direct-book org runs. `cast_city_priority`, and the
//    `priority` column on `show_cast_eligibility`, are read by `resolveTierLadder`
//    (supabase/functions/_shared/eligibility.ts) and `fetchOfferTiers`
//    (src/data/bookings.ts), both of which exist only to open a tier;
//    `deriveDirectBookList` (src/lib/bookings.ts) builds the direct-book picker from
//    `useEligibleArtists`, which reads the cast rows and ignores their priority.
//  - eligibility is read by both paths, but with OPPOSITE consequences. An offers org with
//    no matching cast opens a tier to nobody; a direct-book org with no matching cast gets
//    `artistIds: null` ("no restriction") and books from every active artist on the roster.
//
// Both mirror `timingCopy`'s rule for an unread flow: state only what is true of the rows
// themselves rather than defaulting to the classic pipeline, because the panel's flow query
// resolves after first paint.

import type { BookingFlow } from "@/lib/bookingFlow";

/** The one flow field that changes what these two panels are for. */
export type CoverageFlow = Pick<BookingFlow, "artist_acceptance">;

/**
 * The opening line of LadderStep.
 *
 * `active` is deliberately not read: pausing a flow stops sends, it does not change who
 * reads a ranking, and the paused org's own scope note (TimingStep) already says nothing
 * goes out. What matters here is only whether tiers are ever opened at all.
 */
export function ladderScopeNote(flow: CoverageFlow | null | undefined): string {
  if (!flow) return "Your casts ranked per city, tier 1 first.";
  if (!flow.artist_acceptance) {
    return "Your casts ranked per city. You book artists directly, so nothing reads this ranking today. It starts to matter if you switch to offers.";
  }
  // No escalation promise: `auto_escalate` is per org and can be off, in which case the
  // next tier waits for a producer. "Then the tiers below it" is true either way.
  return "Your casts ranked per city. Tier 1 is asked first, then the tiers below it.";
}

/** The opening line of EligibilityStep. */
export function eligibilityScopeNote(flow: CoverageFlow | null | undefined): string {
  const what = "Which casts belong to a show in a city.";
  if (!flow) return what;
  if (!flow.artist_acceptance) {
    // "Active" is load-bearing: the direct-book picker is built from
    // fetchActiveArtistOptions, so a parked artist is not in it either way.
    //
    // The trailing clause is load-bearing too. `artistIds: null` means "this pair adds no
    // restriction", NOT "the picker lists everyone": `deriveDirectBookList`
    // (src/lib/bookings.ts) then filters that set by `fetchRequiredSkillIds` and
    // `fetchBlockedArtistIds`, both wired at ShowDateDetailSheet.tsx. Naming them keeps the
    // sentence from promising a roster the Book dialog will not show, while the contrast
    // this line exists for (wide open, not "nobody") is untouched.
    return `${what} A show and city with no match can be booked from your whole active roster, minus anyone blocked on that date or missing a required skill.`;
  }
  return `${what} Without a match, a tier opens to nobody.`;
}
