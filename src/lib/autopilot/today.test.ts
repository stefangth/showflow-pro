import { describe, expect, it } from "vitest";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import type { TierAttentionInput } from "@/lib/bookingCockpit";
import {
  computeToday,
  feedAffordance,
  type AtRiskDateFacts,
  type BouncedAsk,
  type CancelledUntoldInput,
  type FeedInput,
  type TodayInput,
} from "./today";

const TIMES = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };
const DIGEST_FLOW = { offer_delivery: "digest" as const };
const IMMEDIATE_FLOW = { offer_delivery: "immediate" as const };

describe("feedAffordance", () => {
  it("returns review when emailedAt is non-null, regardless of clock", () => {
    // now is deep in the small hours, well before the digest hour — would be
    // "undo" on the clock alone, but the email already went out.
    const now = new Date("2026-07-15T02:00:00Z");
    const affordance = feedAffordance(
      { emailedAt: "2026-07-15T01:00:00Z", actedAt: "2026-07-14T20:00:00Z" },
      DIGEST_FLOW,
      TIMES,
      now,
    );
    expect(affordance).toBe("review");
  });

  it("returns undo for a digest org before the digest hour on the action's Berlin day", () => {
    // Acted at 08:00 Berlin (06:00Z, CEST); now is 10:00 Berlin the same day — before 19:00.
    const affordance = feedAffordance(
      { emailedAt: null, actedAt: "2026-07-15T06:00:00Z" },
      DIGEST_FLOW,
      TIMES,
      new Date("2026-07-15T08:00:00Z"),
    );
    expect(affordance).toBe("undo");
  });

  it("returns review for a digest org once past the digest hour on the action's Berlin day", () => {
    // Acted at 08:00 Berlin (06:00Z); now is 20:00 Berlin the same day — past 19:00.
    const affordance = feedAffordance(
      { emailedAt: null, actedAt: "2026-07-15T06:00:00Z" },
      DIGEST_FLOW,
      TIMES,
      new Date("2026-07-15T18:00:00Z"),
    );
    expect(affordance).toBe("review");
  });

  it("returns review immediately for an immediate-delivery org", () => {
    // The mail is already gone the instant the action happened — no undo window at all.
    const affordance = feedAffordance(
      { emailedAt: null, actedAt: "2026-07-15T06:00:00Z" },
      IMMEDIATE_FLOW,
      TIMES,
      new Date("2026-07-15T06:00:01Z"),
    );
    expect(affordance).toBe("review");
  });

  it("evaluates the digest boundary in Europe/Berlin, matching the brief's own example", () => {
    // 20:00 UTC on the 17th is already 22:00 in Berlin (CEST, UTC+2) — after that
    // day's 19:00 digest has already run. The action therefore rides TOMORROW's
    // (the 18th's) digest instead, so it stays undoable at 22:15 Berlin the same
    // (17th) evening — this used to wrongly read "review" by checking the clock
    // against the digest that had already left without it.
    const affordance = feedAffordance(
      { emailedAt: null, actedAt: "2026-08-17T20:00:00Z" },
      DIGEST_FLOW,
      TIMES,
      new Date("2026-08-17T20:15:00Z"),
    );
    expect(affordance).toBe("undo");
  });

  it("evaluates the digest boundary in Berlin, not in raw UTC hours", () => {
    // Acted at 17:30 UTC = 19:30 Berlin — already past that day's 19:00 digest,
    // so the action rides the NEXT (tomorrow's) digest instead and is still
    // undoable. "now" is 18:00 UTC = 20:00 Berlin, the SAME Berlin calendar day
    // as actedAt, still well before tomorrow's digest — must stay "undo". (This
    // is also the corrected case for finding 1: the code used to check `now`
    // against the digest hour on actedAt's OWN day, so an action taken at 19:30
    // — after that digest had already gone — read as reviewable a mere 30
    // minutes later, 23 hours before the digest that actually carries it.) A
    // UTC-hour-only implementation would see 18 < 19 and also answer "undo",
    // but for the wrong reason — it would just as wrongly say "undo" for a
    // `now` of, say, 2026-08-18T17:00:00Z (19:00 Berlin the NEXT day, i.e. the
    // exact moment the carrying digest fires), which the Berlin-anchored
    // boundary correctly flips to "review".
    const affordance = feedAffordance(
      { emailedAt: null, actedAt: "2026-08-17T17:30:00Z" },
      DIGEST_FLOW,
      TIMES,
      new Date("2026-08-17T18:00:00Z"),
    );
    expect(affordance).toBe("undo");
  });

  it("rolls undo over to the NEXT digest when the action landed at/after today's digest hour (finding 1)", () => {
    // Acted 19:30 Berlin Monday (2026-08-17) — at/after that day's 19:00 digest,
    // so it rides Tuesday's digest instead of Monday's. Still undoable the next
    // evening, right up to but not including Tuesday's own 19:00 digest.
    const actedAt = "2026-08-17T17:30:00Z"; // 19:30 Berlin, Mon 17 Aug
    expect(
      feedAffordance({ emailedAt: null, actedAt }, DIGEST_FLOW, TIMES, new Date("2026-08-18T16:00:00Z")), // 18:00 Berlin Tue
    ).toBe("undo");
    expect(
      feedAffordance({ emailedAt: null, actedAt }, DIGEST_FLOW, TIMES, new Date("2026-08-18T17:30:00Z")), // 19:30 Berlin Tue
    ).toBe("review");
  });

  // The three cases below all exercise the DAY-KEY comparison branches
  // (`nowDay > actedDay` / `nowDay < actedDay`), which every case above leaves untouched
  // by keeping actedAt and now on the same Berlin calendar day. None of the branches
  // above can regress to a naive UTC-day (or local-day) comparison without being caught,
  // because a Berlin calendar day and its UTC calendar day only ever disagree in the
  // narrow band either side of midnight Berlin time (23:00-24:00 UTC in CEST, the summer
  // dates used here) — exactly the band these three cases sit in.

  it("keeps undo across a Berlin day rollover its UTC calendar day has not shown yet", () => {
    // actedAt: 2026-08-17T23:30:00Z is CEST (UTC+2) 2026-08-18 01:30 -- already Berlin day
    // 18, but still UTC day 17. now: 2026-08-18T08:00:00Z is Berlin 10:00 on the 18th (UTC
    // day 18 too) -- the SAME Berlin day as actedAt, well before the 19:00 digest, so this
    // must be "undo". A UTC-day comparison would see actedDay=17 and nowDay=18, read that
    // as a later day, and wrongly answer "review".
    const affordance = feedAffordance(
      { emailedAt: null, actedAt: "2026-08-17T23:30:00Z" },
      DIGEST_FLOW,
      TIMES,
      new Date("2026-08-18T08:00:00Z"),
    );
    expect(affordance).toBe("undo");
  });

  it("flips to review once now crosses into the next Berlin day, even while its own UTC day still reads as the acted day", () => {
    // actedAt: 2026-08-18T10:00:00Z is Berlin 12:00 on the 18th -- Berlin day 18, UTC day
    // 18. now: 2026-08-18T23:15:00Z is CEST 2026-08-19 01:15 -- already Berlin day 19, but
    // still UTC day 18, the same UTC day as actedAt. The real (Berlin) comparison must see
    // this as a later day and answer "review", even though the digest boundary itself
    // (19:00) has nothing to do with it here -- the day alone already settles it.
    const affordance = feedAffordance(
      { emailedAt: null, actedAt: "2026-08-18T10:00:00Z" },
      DIGEST_FLOW,
      TIMES,
      new Date("2026-08-18T23:15:00Z"),
    );
    expect(affordance).toBe("review");
  });

  it("is the symmetric case under CET (winter): a UTC-day comparison would wrongly fall through to undo", () => {
    // Same mechanism as the CEST case above -- now has rolled into the next Berlin day
    // while its UTC day still matches actedAt's -- checked under the OTHER Berlin UTC
    // offset (CET, UTC+1, winter) so the day-key fix is not incidentally only correct
    // during summer time. actedAt: 2026-01-18T10:00:00Z is Berlin 11:00 on the 18th
    // (Berlin day 18, UTC day 18). now: 2026-01-18T23:15:00Z is CET 2026-01-19 00:15 --
    // already Berlin day 19, but still UTC day 18, matching actedAt's UTC day. Correctly
    // this is a later Berlin day, so "review". A UTC-day comparison sees the same UTC day
    // for both, falls through to the minutes-since-midnight check, and reads now's Berlin
    // clock time (00:15, just after midnight) as long before the 19:00 digest -- wrongly
    // answering "undo".
    const affordance = feedAffordance(
      { emailedAt: null, actedAt: "2026-01-18T10:00:00Z" },
      DIGEST_FLOW,
      TIMES,
      new Date("2026-01-18T23:15:00Z"),
    );
    expect(affordance).toBe("review");
  });
});

const NOW = new Date("2026-07-15T12:00:00Z"); // Berlin day key 2026-07-15

const attentionBase: TierAttentionInput = {
  showDateId: "d1",
  date: "2026-07-20",
  program: "Hamlet",
  subProgram: "Abend",
  custom: null,
  slots: { main_cast: 2, understudies: 1 },
  tier: 1,
  bookings: [{ status: "soft_booked", offer_tier: 1, offer_expires_at: null }], // filled=1, required=3 -> at risk
};

const factsBase: AtRiskDateFacts = {
  showDateId: "d1",
  where: "Thalia Theater, Hamburg",
  hasUnopenedTier: false,
  unaskedEligibleCount: 0,
  nextCastName: "Ensemble Nord",
  nextCastFreeCount: 6,
  rosterCount: 14,
  rosterFreeCount: 9,
  nextTierNumber: null,
};

const cancelledBase: CancelledUntoldInput = {
  showDateId: "c1",
  date: "2026-07-18",
  program: "Die Zauberflöte",
  subProgram: null,
  venue: "Opera House, Berlin",
  cancellationReason: "venue_unavailable",
  castNotifiedAt: null,
  artistNames: ["Anna K.", "Ben O."],
};

function buildInput(overrides: Partial<TodayInput>): TodayInput {
  return {
    tierAttention: [],
    atRiskFacts: [],
    cancelledUntold: [],
    bounced: [],
    feed: [],
    flow: BOOKING_FLOW_DEFAULTS,
    times: TIMES,
    fillingOnTheirOwn: 0,
    bookedOvernight: 0,
    ...overrides,
  };
}

describe("computeToday: exhausted", () => {
  it("is true only when there is no unopened tier AND no unasked eligible artist", () => {
    const model = computeToday(
      buildInput({
        tierAttention: [attentionBase],
        atRiskFacts: [{ ...factsBase, hasUnopenedTier: false, unaskedEligibleCount: 0 }],
      }),
      NOW,
    );
    expect(model.items).toHaveLength(1);
    expect(model.items[0]).toMatchObject({ kind: "at_risk", exhausted: true });
  });

  it("is false when a further tier could still be opened", () => {
    const model = computeToday(
      buildInput({
        tierAttention: [attentionBase],
        atRiskFacts: [{ ...factsBase, hasUnopenedTier: true, unaskedEligibleCount: 0 }],
      }),
      NOW,
    );
    expect(model.items[0]).toMatchObject({ exhausted: false });
  });

  it("is false when an eligible artist has not yet been asked", () => {
    const model = computeToday(
      buildInput({
        tierAttention: [attentionBase],
        atRiskFacts: [{ ...factsBase, hasUnopenedTier: false, unaskedEligibleCount: 3 }],
      }),
      NOW,
    );
    expect(model.items[0]).toMatchObject({ exhausted: false });
  });
});

describe("computeToday: at-risk date mapping", () => {
  it("carries the resolution-option figures and computed places/daysOut", () => {
    const model = computeToday(
      buildInput({ tierAttention: [attentionBase], atRiskFacts: [factsBase] }),
      NOW,
    );
    expect(model.items[0]).toMatchObject({
      kind: "at_risk",
      showDateId: "d1",
      date: "2026-07-20",
      title: "Hamlet, Abend",
      where: "Thalia Theater, Hamburg",
      placesEmpty: 2, // required 3 - filled 1
      daysOut: 5, // 2026-07-20 minus 2026-07-15
      nextCastName: "Ensemble Nord",
      nextCastFreeCount: 6,
      rosterCount: 14,
      rosterFreeCount: 9,
    });
  });

  it("drops an at-risk date with no matching facts row rather than guessing", () => {
    const model = computeToday(
      buildInput({ tierAttention: [attentionBase], atRiskFacts: [] }),
      NOW,
    );
    expect(model.items).toHaveLength(0);
  });
});

describe("computeToday: cancelled, cast not told", () => {
  it("excludes a cancelled date whose cast_notified_at is set", () => {
    const model = computeToday(
      buildInput({ cancelledUntold: [{ ...cancelledBase, castNotifiedAt: "2026-07-10T09:00:00Z" }] }),
      NOW,
    );
    expect(model.items).toHaveLength(0);
  });

  it("excludes a cancelled date with no confirmed or soft-booked artists (nobody to tell)", () => {
    const model = computeToday(
      buildInput({ cancelledUntold: [{ ...cancelledBase, artistNames: [] }] }),
      NOW,
    );
    expect(model.items).toHaveLength(0);
  });

  it("includes a cancelled date with someone still holding it and not yet told", () => {
    const model = computeToday(buildInput({ cancelledUntold: [cancelledBase] }), NOW);
    expect(model.items).toHaveLength(1);
    expect(model.items[0]).toMatchObject({
      kind: "cancelled_untold",
      showDateId: "c1",
      date: "2026-07-18",
      title: "Die Zauberflöte",
      where: "Opera House, Berlin",
      daysOut: 3,
      artistNames: ["Anna K.", "Ben O."],
    });
  });
});

describe("computeToday: openCount", () => {
  it("counts the bounced banner once, not once per bounced ask", () => {
    const bounced: BouncedAsk[] = [
      { artistId: "a1", artistName: "Anna K.", email: "anna@example.com", showDateId: "d1", dateLabel: "Hamlet on 20 Jul", bouncedAt: "2026-07-14T09:00:00Z" },
      { artistId: "a2", artistName: "Ben O.", email: "ben@example.com", showDateId: "d1", dateLabel: "Hamlet on 20 Jul", bouncedAt: "2026-07-14T09:05:00Z" },
      { artistId: "a3", artistName: "Cara M.", email: "cara@example.com", showDateId: "d1", dateLabel: "Hamlet on 20 Jul", bouncedAt: "2026-07-14T09:10:00Z" },
    ];
    const model = computeToday(
      buildInput({
        tierAttention: [attentionBase],
        atRiskFacts: [factsBase],
        bounced,
      }),
      NOW,
    );
    expect(model.items).toHaveLength(1);
    expect(model.bounced).toHaveLength(3);
    expect(model.openCount).toBe(2); // 1 item + 1 banner, not 1 + 3
  });

  it("adds nothing for the banner when there are no bounced asks", () => {
    const model = computeToday(
      buildInput({ tierAttention: [attentionBase], atRiskFacts: [factsBase], bounced: [] }),
      NOW,
    );
    expect(model.openCount).toBe(1);
  });
});

describe("computeToday: sorting", () => {
  it("sorts items by date ascending, mixing kinds", () => {
    const laterAtRisk: TierAttentionInput = { ...attentionBase, showDateId: "d2", date: "2026-07-25" };
    const laterFacts: AtRiskDateFacts = { ...factsBase, showDateId: "d2" };
    const earlierCancelled: CancelledUntoldInput = { ...cancelledBase, showDateId: "c1", date: "2026-07-16" };

    const model = computeToday(
      buildInput({
        tierAttention: [laterAtRisk],
        atRiskFacts: [laterFacts],
        cancelledUntold: [earlierCancelled],
      }),
      NOW,
    );
    expect(model.items.map((i) => i.date)).toEqual(["2026-07-16", "2026-07-25"]);
    expect(model.items.map((i) => i.kind)).toEqual(["cancelled_untold", "at_risk"]);
  });
});

describe("computeToday: feed and pass-through counts", () => {
  it("maps feed rows through feedAffordance and passes fillingOnTheirOwn/bookedOvernight through", () => {
    const feed: FeedInput[] = [
      { id: "f1", kind: "ask", text: "Asked Anna K.", at: "07:02", actedAt: "2026-07-15T06:00:00Z", emailedAt: "2026-07-15T06:01:00Z", bookingIds: [] },
      { id: "f2", kind: "book", text: "Booked Ben O.", at: "07:05", actedAt: "2026-07-15T06:00:00Z", emailedAt: null, bookingIds: ["b1"] },
    ];
    const model = computeToday(
      buildInput({ feed, fillingOnTheirOwn: 4, bookedOvernight: 2 }),
      new Date("2026-07-15T08:00:00Z"), // 10:00 Berlin — before the 19:00 digest
    );
    expect(model.feed).toEqual([
      { id: "f1", kind: "ask", text: "Asked Anna K.", at: "07:02", affordance: "review", bookingIds: [] }, // already emailed
      { id: "f2", kind: "book", text: "Booked Ben O.", at: "07:05", affordance: "undo", bookingIds: ["b1"] }, // not yet emailed, before digest
    ]);
    expect(model.fillingOnTheirOwn).toBe(4);
    expect(model.bookedOvernight).toBe(2);
  });
});
