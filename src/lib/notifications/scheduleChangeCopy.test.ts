import { describe, it, expect } from "vitest";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import { scheduleChangeNote } from "./scheduleChangeCopy";

describe("scheduleChangeNote", () => {
  it("returns null when booking_flow is not entitled", () => {
    expect(scheduleChangeNote(false, { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: true }, 21)).toBeNull();
  });

  it("returns null when there is no flow yet", () => {
    expect(scheduleChangeNote(true, null, 21)).toBeNull();
    expect(scheduleChangeNote(true, undefined, 21)).toBeNull();
  });

  it("returns null while the org's booking flow is off", () => {
    expect(scheduleChangeNote(true, { ...BOOKING_FLOW_DEFAULTS, active: false }, 21)).toBeNull();
  });

  // Regression: `send-confirmation-digest` only inserts the in-app `schedule_change` row
  // for artists with an account (`if (b.artists?.user_id)`) — an artist added to the
  // roster but never invited has none. When the confirmation digest email is ALSO off,
  // that artist is told nothing by either channel. The note must say so instead of
  // implying every booked artist sees the change "in the app".
  //
  // Copy voice: leads with the consequence (what happens), not a qualifier (who it happens
  // to) — matching moduleOnboarding.ts's house voice of one short, direct sentence per
  // consequence. "Anyone without one is not told" replaces the earlier "hear nothing",
  // which read as legal-appendix filler rather than plain narration.
  it("names the account condition and the residual risk when the confirmation digest email is off", () => {
    const note = scheduleChangeNote(true, { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: false }, 21);
    expect(note).toBe(
      "Session times show up in the app, in the daily summary at 21:00 Berlin, for artists with an account. " +
      "Anyone without one is not told.",
    );
  });

  // The email channel resolves a recipient address from the artist record itself
  // (bookingEmail fallback), not only from a linked auth account, so it is the channel
  // that actually reaches an artist with no account yet. The in-app row is still
  // account-gated, so it gets its own, narrower clause rather than being folded into one
  // "in the app and by email" claim.
  //
  // Regression: `artists.email` is nullable and ArtistsPage only makes it `required` when
  // the admin also invites, so a roster artist can exist with no email on file. The old
  // copy claimed session times "reach booked artists ... by email" with no qualification,
  // overstating the email channel's own reach the same way the off-branch used to overstate
  // the in-app channel's. Both branches must name their own gap, not just one of them.
  //
  // Copy voice: same consequence-first rewrite as the off branch above. The old lead
  // ("Booked artists with an email on file see...") opened with a qualifier instead of the
  // consequence, and "Booked artists with neither hear nothing" read as awkward, legalistic
  // English. Every fact survives the rewrite: the digest still names who it reaches (an
  // email on file), the in-app row still names its own narrower condition (an account), and
  // the closing sentence still names the exact residual gap (neither).
  it("splits the email and in-app claims, and names the residual gap, when the confirmation digest email is on", () => {
    const note = scheduleChangeNote(true, { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: true }, 21);
    expect(note).toBe(
      "Session times go out in the daily summary at 21:00 Berlin. " +
      "Artists with an account also see the change in the app. " +
      "Anyone with no email and no account is not told.",
    );
  });

  it("never claims the notice is immediate", () => {
    const note = scheduleChangeNote(true, { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: true }, 21);
    expect(note).not.toMatch(/right away|immediately|instantly|at once/i);
  });

  it("has no em or en dashes", () => {
    const on = scheduleChangeNote(true, { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: true }, 21);
    const off = scheduleChangeNote(true, { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: false }, 21);
    expect(on).not.toMatch(/[—–]/);
    expect(off).not.toMatch(/[—–]/);
  });
});
