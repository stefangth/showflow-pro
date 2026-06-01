/**
 * Eligibility gating — open-offer-tier only offers artists whose cast is
 * eligible for the specific show_date.
 *
 *   1. Seed the standard booking graph (eligible artist + cast + one eligible
 *      show_date via show_date_cast_eligibility).
 *   2. Invoke open-offer-tier (tier 99) on the eligible date → assert the
 *      artist gets a `suggested` booking on that date.
 *   3. Seed a SECOND show_date on the same show with NO eligibility row.
 *      Invoke open-offer-tier (tier 99) on it → assert the artist gets NO
 *      booking on that date.
 *
 * Assertions are DB-based (via adminClient), matching booking-lifecycle's
 * offer-creation step. There's no UI for offer creation — it's an edge
 * function the producer flow calls.
 */
import { expect, test } from "@playwright/test";
import { deleteUserByEmail } from "./helpers/users";
import { tagEmail } from "./helpers/supabase";
import {
  cleanupBookingFixture,
  openOfferTier,
  seedBookingFixture,
  type BookingFixture,
} from "./helpers/booking";
import {
  bookingCountForDate,
  seedIneligibleShowDate,
} from "./helpers/eligibility";

const ARTIST_EMAIL = tagEmail("artist-eligibility", Date.now());
const ARTIST_PASSWORD = "E2eEligibilityArtist!1";

let fixture: BookingFixture;
let ineligibleShowDateId: string;

test.describe.configure({ mode: "serial" });

test.describe("Eligibility gating — open-offer-tier respects per-date eligibility", () => {
  test.beforeAll(async () => {
    await deleteUserByEmail(ARTIST_EMAIL);
    fixture = await seedBookingFixture({
      artistEmail: ARTIST_EMAIL,
      artistPassword: ARTIST_PASSWORD,
    });
    // Second show_date on the SAME show, deliberately with no
    // show_date_cast_eligibility row → cast is not eligible for it.
    const ineligible = await seedIneligibleShowDate(fixture.showId);
    ineligibleShowDateId = ineligible.showDateId;
  });

  test.afterAll(async () => {
    await cleanupBookingFixture();
    await deleteUserByEmail(ARTIST_EMAIL);
  });

  test("eligible artist receives a suggested offer on the eligible date", async () => {
    await openOfferTier(fixture.showDateId, 99);

    let count = 0;
    for (let i = 0; i < 10; i++) {
      count = await bookingCountForDate(fixture.artistId, fixture.showDateId);
      if (count > 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(count).toBeGreaterThan(0);
  });

  test("artist is NOT offered on a date their cast is not eligible for", async () => {
    await openOfferTier(ineligibleShowDateId, 99);

    // Give the edge function the same grace window the positive case got,
    // then assert no booking ever appeared for the ineligible date.
    await new Promise((r) => setTimeout(r, 2_000));
    const count = await bookingCountForDate(fixture.artistId, ineligibleShowDateId);
    expect(count).toBe(0);
  });
});
