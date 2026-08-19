import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import {
  describeTonight,
  describeTonightStandalone,
  timingScopeNote,
  isValidWindowHours,
  isValidDigestHour,
  timingBoundsError,
} from "./timingCopy";
import { BOOKING_FLOW_DEFAULTS, applyPreset, type FlowTimes } from "@/lib/bookingFlow";

// Copy is now sourced from the `bookingCopy` i18n namespace; bind an English `t` (named
// `tt` to avoid shadowing the `t` FlowTimes loop variable below) so these assertions pin
// the canonical (byte-identical) English output.
const tt = i18n.getFixedT("en", "bookingCopy");
const TIMING_BOUNDS_ERROR = timingBoundsError(tt);

// Built from the real presets, not hand-written literals: the whole point of this
// sentence is that it cannot drift from what the engine will actually do.
const classic = applyPreset(BOOKING_FLOW_DEFAULTS, "classic");
const fasttrack = applyPreset(BOOKING_FLOW_DEFAULTS, "fasttrack");
const direct = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
const off = applyPreset(BOOKING_FLOW_DEFAULTS, "off");
// No shipped preset sets offer_delivery: "immediate" anymore (autopilot/fasttrack
// switched to digest), but the value is still valid on a hand-configured flow, and
// describeTonight/describeTonightStandalone still have a real branch for it.
const immediateFlow = { ...classic, offer_delivery: "immediate" as const };

const times: FlowTimes = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };

describe("describeTonight", () => {
  it("narrates the digest pipeline for the classic flow", () => {
    expect(describeTonight(times, classic, tt)).toBe(
      "When a round opens, asks go out in the next 19:00h (Berlin, Germany) send. Artists get 48 hours to answer, and bookings mail at 20:00h (Berlin, Germany).",
    );
  });

  it("reads the live values, not the defaults", () => {
    expect(
      describeTonight({ windowHours: 24, offerDigestHour: 8, confirmationDigestHour: 17 }, classic, tt),
    ).toBe(
      "When a round opens, asks go out in the next 08:00h (Berlin, Germany) send. Artists get 24 hours to answer, and bookings mail at 17:00h (Berlin, Germany).",
    );
  });

  it("leaves the timezone to timingScopeNote rather than repeating it", () => {
    // The panel prints timingScopeNote directly above this sentence under EVERY flow, and
    // that note always names Berlin. Naming it here too put the word on the panel twice
    // (worst for an immediate-delivery org, where it landed in the very next clause). The
    // scope note is the single carrier; these two assertions are that coupling, written
    // together so neither side can quietly drop it.
    // `direct` is in the list because it now prints a sentence too (its confirmation hour),
    // and that sentence sits under the same single carrier of the timezone.
    const flows = [classic, fasttrack, direct, { ...classic, confirmation_digest: false }];
    for (const flow of flows) {
      expect(describeTonight(times, flow, tt)).toMatch(/Berlin, Germany/);
      expect(timingScopeNote(flow, tt)).not.toMatch(/Berlin/);
    }
  });

  it("says one hour, not 1 hours", () => {
    expect(describeTonight({ ...times, windowHours: 1 }, classic, tt)).toContain("get 1 hour to answer");
  });

  // An org with offer_delivery: "immediate" has send-offer-digest skip the hour gate for
  // it entirely; open-offer-tier mails at tier open instead, so a digest sentence would
  // describe a batch that never runs. No shipped preset sets this anymore (autopilot/
  // fasttrack switched to digest), but the raw flow value is still supported.
  it("never mentions a digest hour for an immediate-delivery org", () => {
    const line = describeTonight(times, immediateFlow, tt)!;
    expect(line).toBe(
      "When a round opens, asks email straight away. Artists get 48 hours to answer, and bookings mail at 20:00h (Berlin, Germany).",
    );
    expect(line).not.toContain("19:00h (Berlin, Germany)");
    expect(line).not.toContain("digest");
  });

  it("renders for an immediate-delivery org even while the offer-hour field is empty", () => {
    // The sentence never states that hour, so a mid-edit NaN there cannot make it wrong.
    expect(describeTonight({ ...times, offerDigestHour: Number.NaN }, immediateFlow, tt)).toContain(
      "offers email straight away",
    );
  });

  it("drops the confirmation clause when the confirmation digest is off", () => {
    // send-confirmation-digest gates its email on this flag.
    const flow = { ...classic, confirmation_digest: false };
    const line = describeTonight(times, flow, tt)!;
    expect(line).toBe(
      "When a round opens, asks go out in the next 19:00h (Berlin, Germany) send. Artists get 48 hours to answer.",
    );
    expect(line).not.toContain("bookings mail");
  });

  it("states the one hour that really does run for a direct-book org", () => {
    // The shipped "direct" preset has confirmation_digest ON, so send-confirmation-digest
    // mails that org's artists at confirmation_digest_hour_berlin every day. That is the
    // ONLY one of this panel's three fields it can act on, and it was the only one whose
    // value was never stated: the sentence fell silent on !artist_acceptance and the scope
    // note takes no times, so the org was told "confirmations still mail" and never when.
    expect(direct.confirmation_digest).toBe(true);
    expect(describeTonight(times, direct, tt)).toBe(
      "Newly booked artists get the booking send at 20:00h (Berlin, Germany).",
    );
  });

  it("names no offer window or offer hour to a direct-book org", () => {
    // No tier is ever opened there, so neither of the other two fields may appear.
    const line = describeTonight(times, direct, tt)!;
    expect(line).not.toMatch(/round|ask|48 hours|19:00h (Berlin, Germany)/i);
  });

  it("still says nothing to a direct-book org that sends no confirmation digest", () => {
    // No tier, so no offer digest and no window; no confirmation mail either. The one thing
    // that IS still true of that org's panel (its confirmation hour times the in-app
    // schedule-change notifications) is a fact about the FIELD, not a schedule, so the scope
    // note carries it and this sentence stays silent rather than printing a third variant.
    expect(describeTonight(times, { ...direct, confirmation_digest: false }, tt)).toBeNull();
    expect(timingScopeNote({ ...direct, confirmation_digest: false }, tt)).toContain(
      "The booking send hour still runs",
    );
  });

  it("says nothing rather than a NaN hour while a direct-book org retypes that field", () => {
    // Same rule as the offer branch: the sentence states this hour, so a cleared input
    // must silence it instead of announcing "NaN:00".
    expect(describeTonight({ ...times, confirmationDigestHour: Number.NaN }, direct, tt)).toBeNull();
    expect(describeTonight({ ...times, confirmationDigestHour: 24 }, direct, tt)).toBeNull();
  });

  it("does not let a direct-book org's dead offer window silence its live confirmation hour", () => {
    // The window is not stated by this branch and is not read by anything that org runs,
    // so a cleared window field must not take the one true sentence off the panel.
    expect(describeTonight({ ...times, windowHours: Number.NaN }, direct, tt)).toBe(
      "Newly booked artists get the booking send at 20:00h (Berlin, Germany).",
    );
  });

  it("says nothing while the whole flow is paused", () => {
    // send-offer-digest does `if (!flow.active) continue`, so nothing goes out at all.
    expect(off.active).toBe(false);
    expect(describeTonight(times, off, tt)).toBeNull();
  });

  it("says nothing while the flow has not been read yet", () => {
    // The caller's flow query resolves after first paint. Substituting a default here
    // would narrate the classic digest pipeline at a direct-book or paused org until the
    // real row lands, which is the one branch of this sentence that could lie.
    expect(describeTonight(times, undefined, tt)).toBeNull();
    expect(describeTonight(times, null, tt)).toBeNull();
  });

  it("says nothing rather than a half-sentence while a field is being retyped", () => {
    // The panel passes NaN for a cleared input. A narrative built on it would read
    // "NaN:00", which is worse than no narrative.
    expect(describeTonight({ ...times, windowHours: Number.NaN }, classic, tt)).toBeNull();
    expect(describeTonight({ ...times, offerDigestHour: Number.NaN }, classic, tt)).toBeNull();
    expect(describeTonight({ ...times, confirmationDigestHour: Number.NaN }, classic, tt)).toBeNull();
  });

  it("says nothing for values the save guard would reject anyway", () => {
    // Same bounds as TimingStep's mutation guard, so the sentence never describes a
    // schedule the org cannot actually save.
    expect(describeTonight({ ...times, windowHours: 0 }, classic, tt)).toBeNull();
    expect(describeTonight({ ...times, windowHours: 2.5 }, classic, tt)).toBeNull();
    expect(describeTonight({ ...times, offerDigestHour: 24 }, classic, tt)).toBeNull();
    expect(describeTonight({ ...times, confirmationDigestHour: -1 }, classic, tt)).toBeNull();
  });

  it("uses no em or en dashes", () => {
    const lines = [
      describeTonight(times, classic, tt),
      describeTonight(times, fasttrack, tt),
      describeTonight(times, direct, tt),
      describeTonight({ windowHours: 1, offerDigestHour: 0, confirmationDigestHour: 23 }, { ...classic, confirmation_digest: false }, tt),
    ];
    for (const line of lines) expect(line).not.toMatch(/[—–]/);
  });
});

// The rail footer prints this sentence where TimingStep's collapsed row would otherwise
// keep it hidden, and that surface has no `timingScopeNote` above it to carry the
// timezone. Composed here rather than at the call site so the two halves of the panel's
// division of labour stay one decision.
describe("describeTonightStandalone", () => {
  it("is the same sentence with the timezone the missing scope note would have carried", () => {
    expect(describeTonightStandalone(times, classic, tt)).toBe(
      describeTonight(times, classic, tt),
    );
  });

  it("names the timezone under every flow that says anything at all", () => {
    // The bare hours are the whole point of the sentence: printed on a surface with no
    // scope note, "19:00h (Berlin, Germany)" with no zone is a guess for any org not sitting in Berlin.
    for (const flow of [classic, fasttrack, direct]) {
      expect(describeTonightStandalone(times, flow, tt)).toMatch(/Berlin/);
    }
  });

  it("agrees in number with the clock times the sentence actually states", () => {
    // The plural is inherited from `timingScopeNote`, where it is right because that note
    // sits over three hour INPUTS. Here there are no inputs, only the times this one
    // sentence just named, and three of the four speaking flows name exactly one:
    // "Newly confirmed artists get the confirmation digest at 20:00h (Berlin, Germany). Digest times include their timezone."
    // was the panel's vocabulary printed on a surface that does not have the panel's fields.
    expect(describeTonightStandalone(times, classic, tt)).toContain("Berlin, Germany");
    for (const flow of [immediateFlow, direct, { ...classic, confirmation_digest: false }]) {
      const line = describeTonightStandalone(times, flow, tt)!;
      expect(line.match(/\d{2}:\d{2}/g)).toHaveLength(1);
      expect(line).toContain("Berlin, Germany");
      expect(line).not.toContain("Hours are");
    }
  });

  it("adds no timezone to a sentence that states no clock time at all", () => {
    // Immediate delivery with the confirmation digest off: the sentence is "offers email
    // straight away" plus a window in elapsed hours, and there is no clock time on it to
    // put a zone on. The window is a duration, not a Berlin hour, so a timezone line here
    // would have been answering a question the sentence never raised.
    const flow = { ...immediateFlow, confirmation_digest: false };
    const line = describeTonightStandalone(times, flow, tt)!;
    expect(line).toBe(describeTonight(times, flow, tt));
    expect(line).not.toMatch(/Berlin/);
  });

  it("falls silent exactly where describeTonight does, never on its own terms", () => {
    // A wrapper that spoke in a case the sentence itself refuses (an unread flow, a paused
    // org, a direct-book org with no confirmation digest, a mid-edit value the save guard
    // would reject) would put a claim on the rail that the panel below it denies.
    const cases: Array<[FlowTimes, typeof classic | null | undefined]> = [
      [times, null],
      [times, undefined],
      [times, off],
      [times, { ...direct, confirmation_digest: false }],
      [{ ...times, windowHours: Number.NaN }, classic],
    ];
    for (const [t, flow] of cases) {
      expect(describeTonight(t, flow, tt)).toBeNull();
      expect(describeTonightStandalone(t, flow, tt)).toBeNull();
    }
  });

  it("uses no em or en dashes", () => {
    for (const flow of [classic, fasttrack, direct]) {
      expect(describeTonightStandalone(times, flow, tt)).not.toMatch(/[—–]/);
    }
  });
});

// The panel used to print one fixed line above the narrative ("An artist offered at the
// digest hour has until that hour, window later"), which is only true of the classic
// digest pipeline: it contradicts the narrative at an immediate-delivery org and is the ONLY copy
// left standing at a direct-book org, where describeTonight deliberately says nothing.
// timingScopeNote is what replaces it: a line that is true under every preset.
describe("timingScopeNote", () => {
  it("states the timezone and leaves the pipeline to describeTonight", () => {
    expect(timingScopeNote(classic, tt)).toBe("Daily send times include their timezone.");
    expect(timingScopeNote(fasttrack, tt)).toBe("Daily send times include their timezone.");
  });

  it("names the timezone under every flow, because nothing else on the panel does", () => {
    // describeTonight stopped naming Berlin (it would print the word twice), and it falls
    // silent entirely for a direct-book or paused org. That makes this line the only place
    // the three hour fields are ever tied to a timezone, so no branch of it may drop it.
    const flows = [classic, fasttrack, direct, off, { ...direct, confirmation_digest: false }, null, undefined];
    for (const flow of flows) expect(timingScopeNote(flow, tt)).not.toMatch(/Berlin/);
  });

  it("states only what is true while the flow is still unread", () => {
    // Same rule as describeTonight: an unknown flow may not be narrated as the classic one.
    expect(timingScopeNote(undefined, tt)).toBe("Daily send times include their timezone.");
    expect(timingScopeNote(null, tt)).toBe("Daily send times include their timezone.");
  });

  it("scopes the paused note to the three fields on this panel", () => {
    // Both readers of these keys (send-offer-digest, send-confirmation-digest) bail on
    // `!flow.active`, so the fields themselves really are inert. What is NOT true is that
    // the product goes quiet: hire-order issue mail, org invitations and chat notifications
    // all keep sending with the booking flow off, and this panel does not read as
    // booking-scoped to someone seeing it on their first day.
    expect(timingScopeNote(off, tt)).toBe(
      "Daily send times include their timezone. These hours change nothing while the booking flow is off.",
    );
  });

  it("tells a direct-book org which of these three fields do nothing", () => {
    // This is the case the old fixed line got most wrong: no offer is ever opened, so the
    // window and the offer hour are dead settings, while the confirmation hour still runs.
    // It names the live field but not its VALUE: this note takes no times (it renders
    // before the org's hours load), and describeTonight states the hour underneath it.
    //
    // "Change nothing" is a claim about these two FIELDS, and the exact-string assertion
    // below is what keeps it from widening into one about sends, which would be false for
    // an org that switched away from offers with a tier still open. Both halves were
    // checked against every reader rather than assumed:
    //  - `offer_response_window_hours` is read in exactly two places, open-offer-tier
    //    (409s on !artist_acceptance, ~L106) and send-offer-digest (`continue`s on it,
    //    ~L103); `offer_digest_hour_berlin` only in the latter. Neither value can act for
    //    this org, so editing them here really is inert.
    //  - offers ALREADY open are unaffected by editing them too. expire-offers never reads
    //    either key: its expiry pass calls expire_soft_bookings(), which is gated on the
    //    booking_flow ENTITLEMENT (migration 20260806151909) and acts on the
    //    `offer_expires_at` stamped when each offer was created. So a live deadline cannot
    //    move from this panel, and the sentence stays silent about those rows rather than
    //    posing a puzzle to the many direct-book orgs that never ran a tier at all.
    const line = timingScopeNote(direct, tt);
    expect(line).toBe(
      "Daily send times include their timezone. You book artists directly, so the answer-by window and the daily send hour change nothing. Only the booking send hour is live.",
    );
  });

  it("never calls the confirmation hour dead, because it also times the in-app notifications", () => {
    // The correction to an earlier version of this note, which told a direct-book org with
    // the confirmation digest off that "none of these hours change anything".
    //
    // send-confirmation-digest gates its per-artist EMAIL loop on `flow.confirmation_digest`
    // and NOTHING else: the in-app `schedule_change` notification insert and the
    // `show_date_change_log.digested_at` stamp both sit ABOVE that check and run for every
    // org whose `confirmation_digest_hour_berlin` matches the current Berlin hour. That step
    // is not gated on `artist_acceptance` either, which is what makes it reachable for a
    // direct-book org at all. So with the digest off this hour still decides when a
    // cancellation or a retime reaches a booked artist, under BOTH flows, and an admin told
    // the field was inert would leave it wherever it sits and delay those by up to a day.
    // FlowTimeline renders confirmation_digest as an independent switch, so the state is one
    // click away from any preset.
    const live =
      "The booking send hour still runs: it sets when booked artists are notified of schedule changes in the app.";
    expect(timingScopeNote({ ...direct, confirmation_digest: false }, tt)).toBe(
      `Daily send times include their timezone. You book artists directly, so the answer-by window and the daily send hour change nothing. ${live}`,
    );
    // Same fact from the offers side: describeTonight drops its "confirmations mail at"
    // clause when the digest is off, so without this the "Confirmations" input sat on an
    // offers org's panel with nothing anywhere saying what it still does.
    expect(timingScopeNote({ ...classic, confirmation_digest: false }, tt)).toBe(
      `Daily send times include their timezone. ${live}`,
    );
  });

  it("leaves the confirmation hour to describeTonight while the digest is on", () => {
    // Then the sentence below this note states the hour itself ("and confirmations mail at
    // 20:00h (Berlin, Germany)" / "the confirmation digest at 20:00h (Berlin, Germany)"), so explaining the field here too would
    // put the same fact on one small panel twice.
    expect(timingScopeNote(classic, tt)).not.toMatch(/booking send hour/);
    expect(timingScopeNote(fasttrack, tt)).not.toMatch(/booking send hour/);
  });

  it("uses no em or en dashes", () => {
    const flows = [
      classic,
      fasttrack,
      direct,
      off,
      { ...direct, confirmation_digest: false },
      { ...classic, confirmation_digest: false },
      null,
    ];
    for (const flow of flows) expect(timingScopeNote(flow, tt)).not.toMatch(/[—–]/);
  });
});

// One home for the bounds. TimingStep's save guard and this module's narrative have to
// agree on what a saveable schedule is: a sentence describing hours the org cannot save,
// or a save that accepts hours the sentence refuses, is the same bug seen from two sides.
describe("timing bounds", () => {
  it("accepts a whole window of at least one hour", () => {
    expect(isValidWindowHours(1)).toBe(true);
    expect(isValidWindowHours(48)).toBe(true);
    // Number("") is 0 and a 0-hour window would expire an offer the instant it opens.
    expect(isValidWindowHours(0)).toBe(false);
    expect(isValidWindowHours(-1)).toBe(false);
    expect(isValidWindowHours(2.5)).toBe(false);
    expect(isValidWindowHours(Number.NaN)).toBe(false);
  });

  it("accepts whole digest hours from 0 to 23", () => {
    expect(isValidDigestHour(0)).toBe(true);
    expect(isValidDigestHour(23)).toBe(true);
    expect(isValidDigestHour(24)).toBe(false);
    expect(isValidDigestHour(-1)).toBe(false);
    expect(isValidDigestHour(9.5)).toBe(false);
    expect(isValidDigestHour(Number.NaN)).toBe(false);
  });

  it("ships the message that states those bounds next to them", () => {
    expect(TIMING_BOUNDS_ERROR).toBe(
      "Enter an answer-by window of at least 1 hour, and daily send hours between 0 and 23.",
    );
    expect(TIMING_BOUNDS_ERROR).not.toMatch(/[—–]/);
  });
});
