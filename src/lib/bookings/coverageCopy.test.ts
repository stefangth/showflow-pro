import { describe, it, expect } from "vitest";
import { ladderScopeNote, eligibilityScopeNote } from "./coverageCopy";
import { BOOKING_FLOW_DEFAULTS, applyPreset } from "@/lib/bookingFlow";

// Built from the shipped presets rather than hand-written partials, the way timingCopy's
// tests are: these two sentences exist to state what the engine will actually do with the
// rows the panel is showing, so the flow they read has to be a real one.
const classic = applyPreset(BOOKING_FLOW_DEFAULTS, "classic");
const direct = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
const off = applyPreset(BOOKING_FLOW_DEFAULTS, "off");
// A full BookingFlow, not an inline literal: these helpers take only the one field they
// read, so a fresh `{ ...direct, active: false }` at the call site would trip TypeScript's
// excess-property check on a Pick<> parameter.
const pausedDirect = { ...direct, active: false };

describe("ladderScopeNote", () => {
  it("tells an offers org what the ranking decides", () => {
    const line = ladderScopeNote(classic);
    expect(line).toBe("Your casts ranked per city. Tier 1 is asked first, then the tiers below it.");
  });

  it("tells a direct-book org that nothing reads this ranking", () => {
    // The whole point of the fix. cast_city_priority, and the priority column on
    // show_cast_eligibility, are read by resolveTierLadder
    // (supabase/functions/_shared/eligibility.ts) and fetchOfferTiers (src/data/bookings.ts),
    // both of which exist only to open a tier. deriveDirectBookList (src/lib/bookings.ts)
    // builds the direct-book picker from useEligibleArtists, which reads the cast ROWS and
    // ignores their priority entirely. So this org books every date with nothing ranked,
    // and an afternoon spent ranking casts changes nothing it can see.
    const line = ladderScopeNote(direct);
    expect(line).toMatch(/You book artists directly/);
    expect(line).toMatch(/nothing reads this ranking/);
    // And it may not describe the pipeline that org does not run.
    expect(line).not.toMatch(/asked first/);
  });

  it("keeps saying it to a direct-book org whose flow is paused", () => {
    // The "off" preset keeps artist_acceptance from the flow it was switched off from, and
    // `active` changes nothing about who reads a ranking. The direct-book statement is the
    // one that stays true.
    expect(ladderScopeNote(pausedDirect)).toBe(ladderScopeNote(direct));
    expect(off.active).toBe(false);
  });

  it("states only what the rows hold while the flow is unread", () => {
    // Same rule as describeTonight: the panel's flow query resolves after first paint, and
    // defaulting to the classic pipeline would narrate offers at a direct-book org for as
    // long as that read takes.
    for (const flow of [null, undefined]) {
      const line = ladderScopeNote(flow);
      expect(line).toBe("Your casts ranked per city, tier 1 first.");
      expect(line).not.toMatch(/asked first|directly/);
    }
  });
});

describe("eligibilityScopeNote", () => {
  it("tells an offers org that an unmatched pair opens to nobody", () => {
    expect(eligibilityScopeNote(classic)).toBe(
      "Which casts belong to a show in a city. Without a match, a tier opens to nobody.",
    );
  });

  it("tells a direct-book org the opposite, which is what actually happens to it", () => {
    // useEligibleArtists resolves artistIds to null ("no restriction") when a (show, city)
    // has no show_cast_eligibility rows and the date has no per-date rows, and
    // deriveDirectBookList then returns every ACTIVE org artist (fetchActiveArtistOptions).
    // Telling this org that a gap opens to nobody would be exactly backwards.
    const line = eligibilityScopeNote(direct);
    expect(line).toMatch(/whole active roster/);
    expect(line).not.toMatch(/nobody/);
  });

  it("states only what the rows hold while the flow is unread", () => {
    for (const flow of [null, undefined]) {
      expect(eligibilityScopeNote(flow)).toBe("Which casts belong to a show in a city.");
    }
  });
});

it("uses no em or en dashes in any branch", () => {
  for (const flow of [classic, direct, off, pausedDirect, null, undefined]) {
    expect(ladderScopeNote(flow)).not.toMatch(/[—–]/);
    expect(eligibilityScopeNote(flow)).not.toMatch(/[—–]/);
  }
});
