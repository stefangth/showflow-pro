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

import { hh, type BookingFlow, type FlowTimes } from "@/lib/bookingFlow";

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

const BERLIN = "Hours are Berlin time.";

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
  // The "off" preset. Every digest function skips a paused org, so hours saved on this
  // panel change nothing until the flow is switched back on.
  if (flow.active === false) return `${BERLIN} Nothing is sent while the booking flow is off.`;
  if (!flow.artist_acceptance) {
    // Direct book: no tier is ever opened, so two of the three fields on this panel are
    // dead settings. The third still runs, but only while the confirmation digest is on.
    // Which field is live, not what it is set to: this note takes no times so that it can
    // render before the org's hours load, and `describeTonight` states the hour below it.
    return flow.confirmation_digest
      ? `${BERLIN} You book artists directly, so the offer window and the offer digest hour change nothing. Only the confirmation hour is live.`
      : `${BERLIN} You book artists directly and send no confirmation digest, so none of these hours change anything.`;
  }
  return BERLIN;
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
 *    tier, so it has no offer digest and no response window to narrate, and with the
 *    confirmation digest off there is nothing left on this panel that runs at all.
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
    return `Newly confirmed artists get the confirmation digest at ${hh(times.confirmationDigestHour)}.`;
  }
  if (!isValidWindowHours(times.windowHours)) return null;

  const digest = flow.offer_delivery === "digest";
  // Only validate the hours this sentence will actually state: an immediate-delivery org
  // never mentions the offer hour, so a cleared field there cannot make it wrong.
  if (digest && !isValidDigestHour(times.offerDigestHour)) return null;
  if (flow.confirmation_digest && !isValidDigestHour(times.confirmationDigestHour)) return null;

  const opening = digest
    ? `When a tier opens, offers go out in the next ${hh(times.offerDigestHour)} digest.`
    : "When a tier opens, offers email straight away.";
  const window = `${times.windowHours} hour${times.windowHours === 1 ? "" : "s"}`;
  const tail = flow.confirmation_digest
    ? `, and confirmations mail at ${hh(times.confirmationDigestHour)}.`
    : ".";
  return `${opening} Artists get ${window} to answer${tail}`;
}
