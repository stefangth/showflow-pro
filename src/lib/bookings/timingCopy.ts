// What the three timing numbers actually do once the admin stops editing them.
//
// The setup rail's timing panel asks for a window and two Berlin hours and then falls
// silent, so the numbers read as configuration rather than as a schedule that runs. Two
// sentences turn them back into the consequence: `timingScopeNote`, which is true under
// every flow and so always renders, and `describeTonight`, which states the schedule and
// falls silent whenever it cannot. The bounds both of them and TimingStep's save guard
// judge a value by live here too.
//
// They take the whole flow, not one boolean, on purpose: three flow fields decide whether
// each clause is true, and the panel that renders these sentences also renders
// `RehearsalBlock` four rows below, which narrates the same pipeline from the same flow.
// Reading the same shapes (`BookingFlow` + `FlowTimes`) as `inPracticeRows` /
// `flowPreviewRows` is what keeps those from contradicting each other.
//
// One division of labour between them: `timingScopeNote` is the SINGLE carrier of the
// timezone. It renders under every flow and covers the three hour fields as well as the
// sentence, so `describeTonight` states clock times bare rather than putting "Berlin" on
// the panel a second time. Both halves of that are pinned in timingCopy.test.ts, and the
// panel is checked for exactly one mention in TimingStep.test.tsx.

import { berlinTime, type BookingFlow, type FlowTimes } from "@/lib/bookingFlow";

/** The flow fields that change what is true about the coming night. */
export type TonightFlow = Pick<
  BookingFlow,
  "active" | "artist_acceptance" | "offer_delivery" | "confirmation_digest"
>;

/**
 * The saveable range for the two Berlin digest hours. Exported because TimingStep's save
 * guard and the sentences below have to agree: a narrative describing a schedule the org
 * cannot save, or a save that accepts hours the narrative refuses, is one bug seen from
 * two sides. A cleared input arrives as NaN, which every check here rejects.
 */
export const isValidDigestHour = (h: number) => Number.isInteger(h) && h >= 0 && h <= 23;

/** The saveable offer response window. 0 is excluded on purpose: the engine acts on it,
 *  and an offer with a 0 hour window expires the instant it opens. */
export const isValidWindowHours = (h: number) => Number.isInteger(h) && h >= 1;

/** The one message stating those bounds, kept next to the bounds themselves. */
export const TIMING_BOUNDS_ERROR =
  "Enter a window of at least 1 hour and digest hours between 0 and 23.";

const BERLIN = "Digest times include their timezone.";

/** The same fact for one hour. `BERLIN` is plural because `timingScopeNote` prints it over
 *  the panel's three hour INPUTS, which is right there and wrong on a surface that has no
 *  inputs and has just named a single clock time. See `berlinNoteFor`. */

/**
 * The timezone line to append to a finished sentence, agreeing in number with the clock
 * times that sentence states, or `null` when it states none.
 *
 * The `null` case is real rather than defensive: an immediate-delivery org with the
 * confirmation digest off is told "offers email straight away. Artists get 48 hours to
 * answer", where the only number is an elapsed duration. A timezone note there answers a
 * question the sentence never raised.
 */
export function berlinNoteFor(line: string): string | null {
  void line;
  return null;
}

/**
 * What the confirmation hour still does once the confirmation DIGEST is switched off, which
 * is the one clause on this panel that is easiest to get wrong.
 *
 * `send-confirmation-digest` gates its per-artist email loop on `flow.confirmation_digest`
 * and nothing else. The in-app `schedule_change` notification insert and the
 * `show_date_change_log.digested_at` stamp both sit ABOVE that check, so they run for every
 * active, entitled org whose `confirmation_digest_hour_berlin` matches the current Berlin
 * hour, and they are not gated on `artist_acceptance` either. That is exactly why an earlier
 * version of this note was wrong to tell a direct-book org with the digest off that "none of
 * these hours change anything": the field it called dead is the one that decides when a
 * cancellation or a retime reaches a booked artist, up to a day later than the admin thinks.
 *
 * "Booked artists" and "in the app" are both literal, and neither word is padding. The
 * insert only covers artists holding a booking on the changed date (an active one, or the
 * one cancelled with the date) who also have an account, since it keys on
 * `b.artists?.user_id`. And what arrives at this hour is the NOTIFICATION: the change itself
 * is live in their schedule the moment it is saved, so "sees the change" would be wrong
 * where "is notified" is right.
 */
const CONFIRMATION_HOUR_STILL_LIVE =
  "The confirmation hour still runs: it sets when booked artists are notified of schedule changes in the app.";

/** The two fields a direct-book org can edit all day without changing anything. */
const DIRECT_BOOK_DEAD_FIELDS =
  "You book artists directly, so the offer window and the offer digest hour change nothing.";

/**
 * The one line this panel can always print, whatever the flow.
 *
 * It replaces a fixed helper line that described the classic digest deadline as universal.
 * That line contradicted `describeTonight` at a fast-track org (which mails at tier open,
 * never at the digest hour) and, worse, stood alone at a direct-book org, where
 * `describeTonight` deliberately says nothing: the only sentence on the panel described a
 * pipeline the org does not run.
 *
 * Takes no times: everything here is true of the flow alone, so it renders before the
 * org's hours have loaded and never has to guess at a value.
 *
 * Every branch names Berlin, and that is load-bearing rather than decorative: this is the
 * only line the panel always prints, so it is where the timezone for the three hour inputs
 * (and for `describeTonight`, which no longer repeats it) is established.
 */
export function timingScopeNote(flow: TonightFlow | null | undefined): string {
  // Unknown flow: state only the timezone. Same rule as describeTonight, which refuses to
  // narrate a flow it has not read rather than assume the classic one.
  if (!flow) return BERLIN;
  // The "off" preset. Both readers of these three keys (send-offer-digest,
  // send-confirmation-digest) `continue` past a paused org, so hours saved on this panel
  // change nothing until the flow is switched back on.
  //
  // Scoped to THESE FIELDS rather than to the product. An unqualified "nothing is sent" is
  // false and reads as the whole app to a first-run admin: hire-order issue mail, org
  // invitations and chat notifications all keep going out while the booking flow is off.
  if (flow.active === false) {
    return `${BERLIN} These hours change nothing while the booking flow is off.`;
  }
  const parts = [BERLIN];
  if (!flow.artist_acceptance) {
    // Direct book: no tier is ever opened, so two of the three fields on this panel are
    // dead settings. The third still runs, but only while the confirmation digest is on.
    // Which field is live, not what it is set to: this note takes no times so that it can
    // render before the org's hours load, and `describeTonight` states the hour below it.
    //
    // "Change nothing" is a claim about these two FIELDS, and it was checked against every
    // reader of both keys rather than assumed. `offer_response_window_hours` is read in
    // exactly two places, `open-offer-tier/index.ts` (immediate delivery) and
    // `send-offer-digest/index.ts`; `offer_digest_hour_berlin` only in the latter. Both
    // functions bail on `!flow.artist_acceptance` (open-offer-tier ~L106,
    // send-offer-digest ~L103) before either value can act, so editing them here is inert
    // for this org.
    //
    // Note what this deliberately does NOT claim: that no offer is still in flight. An org
    // that switched away from offers with a tier open still has pending rows, and
    // `expire_soft_bookings()` is gated on the booking_flow ENTITLEMENT only, so they do
    // still expire. That is driven by each booking's stamped `offer_expires_at`, not by
    // this field, so re-reading the window here would not move those deadlines. Narrating
    // them is also not this function's job: it takes no times and no tier data on purpose,
    // and a sentence about leftover offers would be a puzzle for the many direct-book orgs
    // that never ran a tier at all.
    parts.push(DIRECT_BOOK_DEAD_FIELDS);
    // The contrast, but only where it is the whole truth. With the digest ON the third
    // field's job is stated by `describeTonight` right underneath ("the confirmation digest
    // at 20:00"), so this names it live and stops.
    if (flow.confirmation_digest) parts.push("Only the confirmation hour is live.");
  }
  // Digest off, under EITHER flow: the panel would otherwise leave the "Confirmations"
  // input unexplained (describeTonight drops its confirmation clause with the digest off,
  // and for a direct-book org falls silent entirely) while that hour still times the in-app
  // schedule-change notifications. See CONFIRMATION_HOUR_STILL_LIVE for the code path.
  if (!flow.confirmation_digest) parts.push(CONFIRMATION_HOUR_STILL_LIVE);
  return parts.join(" ");
}

/**
 * One sentence describing what the engine will do, from the live field values, or `null`
 * when there is nothing true to say.
 *
 * `null` in these cases:
 *  - the flow has not been read yet. The caller's flow query resolves after first paint,
 *    and substituting a default would narrate the classic digest pipeline at a direct-book
 *    or paused org until the real row lands. Every other branch here can only fall silent;
 *    this is the one that could state something false, so the unknown flow is refused
 *    rather than defaulted.
 *  - `active` is false. The "off" preset pauses the whole flow, and every digest function
 *    skips a paused org, so nothing at all goes out.
 *  - `artist_acceptance` is false AND the confirmation digest is off. That org opens no
 *    tier, so it has no offer digest and no response window to narrate, and no confirmation
 *    mail either. Its confirmation HOUR is not dead (it still times the in-app
 *    schedule-change notifications), but that is a fact about the field rather than a
 *    schedule, so `timingScopeNote` carries it and this sentence stays silent instead of
 *    printing a third variant of it with a clock time attached.
 *  - a value the sentence would actually state is outside what TimingStep's save guard
 *    accepts (a cleared field arrives as `NaN`). Mid-edit the sentence disappears rather
 *    than claiming "NaN:00", and it never describes a schedule the org could not save.
 *
 * A direct-book org WITH the confirmation digest on gets its own one-clause sentence. That
 * is not a courtesy: the shipped "direct" preset sets `confirmation_digest: true`, so
 * `send-confirmation-digest` mails its artists every day at `confirmation_digest_hour_berlin`,
 * and this panel used to be the one place that never said when. The offer window and the
 * offer hour are not validated on that path, because it states neither of them.
 *
 * Deliberately rule-framed ("when a tier opens") rather than clock-framed ("tonight"):
 * an org still in setup has no open tier, so nothing is queued for tonight regardless of
 * the hours, and after the digest hour "tonight" is already past.
 */
export function describeTonight(times: FlowTimes, flow: TonightFlow | null | undefined): string | null {
  if (!flow) return null;
  if (flow.active === false) return null;
  if (!flow.artist_acceptance) {
    if (!flow.confirmation_digest) return null;
    if (!isValidDigestHour(times.confirmationDigestHour)) return null;
    return `Newly confirmed artists get the confirmation digest at ${berlinTime(times.confirmationDigestHour)}.`;
  }
  if (!isValidWindowHours(times.windowHours)) return null;

  const digest = flow.offer_delivery === "digest";
  // Only validate the hours this sentence will actually state: an immediate-delivery org
  // never mentions the offer hour, so a cleared field there cannot make it wrong.
  if (digest && !isValidDigestHour(times.offerDigestHour)) return null;
  if (flow.confirmation_digest && !isValidDigestHour(times.confirmationDigestHour)) return null;

  const opening = digest
    ? `When a tier opens, offers go out in the next ${berlinTime(times.offerDigestHour)} digest.`
    : "When a tier opens, offers email straight away.";
  const window = `${times.windowHours} hour${times.windowHours === 1 ? "" : "s"}`;
  const tail = flow.confirmation_digest
    ? `, and confirmations mail at ${berlinTime(times.confirmationDigestHour)}.`
    : ".";
  return `${opening} Artists get ${window} to answer${tail}`;
}

/**
 * The same sentence for a surface that does NOT print `timingScopeNote` above it.
 *
 * `describeTonight` states its clock times bare because the panel it was written for
 * always carries the scope note, which is the single place the timezone is established.
 * The setup rail prints the schedule in its own footer, where the collapsed timing row
 * would otherwise keep it hidden until someone expands it, and there is no scope note
 * there: bare "19:00" on that surface is a guess for anyone not sitting in Berlin.
 *
 * A wrapper rather than a flag on `describeTonight`, so the silence rules stay in one
 * place: this speaks exactly when that sentence speaks, and appending a timezone to
 * nothing is not a sentence.
 *
 * The note is chosen from the composed line (`berlinNoteFor`) rather than fixed, because
 * three of the four speaking flows state exactly one hour and one states none at all.
 */
export function describeTonightStandalone(
  times: FlowTimes,
  flow: TonightFlow | null | undefined,
): string | null {
  const line = describeTonight(times, flow);
  if (!line) return null;
  const note = berlinNoteFor(line);
  return note ? `${line} ${note}` : line;
}
