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
  // Regression (round-7 critic): this branch must never say "the daily summary" — that is
  // the product's own user-facing name for the confirmation digest EMAIL (FlowTimeline
  // renders the toggle as "Confirmation digest" / "Daily summary email..."), and this
  // branch only renders when that toggle is OFF. An earlier rewrite claimed session times
  // arrive "in the daily summary" to an admin who had just switched the daily summary off.
  it("names the account condition and the residual risk, and never names the off email, when the confirmation digest is off", () => {
    const note = scheduleChangeNote(true, { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: false }, 21);
    expect(note).toBe(
      "Session times reach booked artists in the app at 21:00h (Berlin, Germany). " +
      "That notice only goes to artists with an account. " +
      "Anyone without one is not told.",
    );
    expect(note).not.toMatch(/daily summary|by email/i);
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
  // "are also notified in the app", not "also see the change in the app": timingCopy.ts
  // establishes that what arrives at the digest hour is the NOTIFICATION — the change
  // itself is live in the artist's schedule the moment it is saved. Right after a sentence
  // that fixes a Berlin hour, "see the change" would invite the reading that in-app
  // visibility waits for that hour.
  it("splits the email and in-app claims, and names the residual gap, when the confirmation digest email is on", () => {
    const note = scheduleChangeNote(true, { ...BOOKING_FLOW_DEFAULTS, confirmation_digest: true }, 21);
    expect(note).toBe(
      "Session times go out in the daily summary at 21:00h (Berlin, Germany). " +
      "Artists with an account are also notified in the app. " +
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
