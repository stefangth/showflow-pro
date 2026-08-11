import { it, expect } from "vitest";
import { SETUP_BLOCK_CHIPS } from "./setupBlocks";
import type { SetupBlock } from "./types";
import { computeBookingSetupStatus } from "@/lib/bookings/setupStatus";
import { computeSetupStatus } from "@/lib/hireOrders/setupStatus";

// One vocabulary, one home. "Blocks booking" used to exist as a string literal in two
// private maps (BookingSetupRail and DashboardSetupRail) that render the SAME step to the
// same viewer on two surfaces, with nothing holding them together: only one of the two was
// even typechecked against the union. This module is that source, and both rails import it,
// so a rename can no longer land on one surface and not the other.

it("covers every block a setup engine can actually produce", () => {
  // Derived from the engines rather than restated: a new BlockKind added to either status
  // computation shows up here as a missing chip instead of as an undefined label at render.
  const booking = computeBookingSetupStatus({
    flowChosen: false, hasAnyShows: false, shows: [], timingChosen: false,
    coverage: null, artistCount: null, artistAcceptance: null,
  }).steps.map((s) => s.block);
  const bookingOffers = computeBookingSetupStatus({
    flowChosen: false, hasAnyShows: false, shows: [], timingChosen: false,
    coverage: null, artistCount: null, artistAcceptance: true,
  }).steps.map((s) => s.block);
  // The hire-order engine carries `blocksIssue: boolean` rather than a block kind; both
  // compositions (useDashboardFirstRun, useModuleOnboardingRail) map it to "issuing" so the
  // letterhead/terms rows chip like booking's blockers. Mirrored here so the chip a hire
  // step actually renders is covered too.
  const hire: SetupBlock[] = computeSetupStatus({ letterhead: null, terms: null, countersignChosen: false })
    .steps.map((s) => (s.blocksIssue ? "issuing" : null));
  for (const block of [...booking, ...bookingOffers, ...hire]) {
    if (block === null) continue;
    expect(Object.keys(SETUP_BLOCK_CHIPS)).toContain(block);
  }
});

it("gives the two wordings of the hard gate the same weight", () => {
  // "offers" and "booking" are one gate seen under two flows (setupStatus.blockFor picks
  // between them from the org's artist_acceptance). A direct-book org reading a muted chip
  // where an offers org reads an amber one would be told its blocker is the softer kind.
  expect(SETUP_BLOCK_CHIPS.offers.tone).toBe("risk");
  expect(SETUP_BLOCK_CHIPS.booking.tone).toBe("risk");
  expect(SETUP_BLOCK_CHIPS.issuing.tone).toBe("risk");
  expect(SETUP_BLOCK_CHIPS.filling.tone).toBe("neutral");
});

it("labels each block distinctly, in user voice, with no em/en dashes", () => {
  const labels = Object.values(SETUP_BLOCK_CHIPS).map((c) => c.label);
  expect(new Set(labels).size).toBe(labels.length);
  for (const label of labels) {
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toMatch(/[—–]/);
    expect(label).toMatch(/^Blocks /);
  }
});
