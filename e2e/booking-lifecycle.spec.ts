/**
 * Flow B — Booking lifecycle.
 *
 *   1. Seed a show + future date + cast + artist + eligibility
 *   2. Producer triggers the offer tier (via the open-offer-tier edge function,
 *      the same call the producer flow ultimately makes) → suggested booking
 *   3. Artist accepts the offer in the Availability UI → soft_booked
 *   4. Producer confirms the soft-booked artist in ShowDateDetailSheet → confirmed
 *   5. Verify an email was queued in email_send_log for the artist
 */
import { expect, test } from "@playwright/test";
import { loginAs, loginAsAndAwaitDashboard } from "./helpers/auth";
import { deleteUserByEmail } from "./helpers/users";
import { tagEmail } from "./helpers/supabase";
import {
  cleanupBookingFixture,
  emailLogCountSince,
  getLatestBooking,
  openOfferTier,
  seedBookingFixture,
  type BookingFixture,
} from "./helpers/booking";
import { TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD } from "./global-setup";

const ARTIST_EMAIL = tagEmail("artist-booking", Date.now());
const ARTIST_PASSWORD = "E2eBookingArtist!1";

let fixture: BookingFixture;
let runStartISO: string;

test.describe.configure({ mode: "serial" });

test.describe("Flow B — booking lifecycle", () => {
  test.beforeAll(async () => {
    runStartISO = new Date().toISOString();
    await deleteUserByEmail(ARTIST_EMAIL);
    fixture = await seedBookingFixture({
      artistEmail: ARTIST_EMAIL,
      artistPassword: ARTIST_PASSWORD,
    });
    // Producer triggers an offer for the seeded date — creates a `suggested` booking
    // for the seeded artist (the only eligible artist in the seeded cast).
    await openOfferTier(fixture.showDateId, 1);

    const booking = await getLatestBooking(fixture.artistId);
    if (!booking || booking.status !== "suggested") {
      throw new Error(
        `expected a suggested booking after openOfferTier, got ${JSON.stringify(booking)}`
      );
    }
  });

  test.afterAll(async () => {
    await cleanupBookingFixture();
    await deleteUserByEmail(ARTIST_EMAIL);
  });

  test("artist sees the pending offer and accepts it", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, ARTIST_EMAIL, ARTIST_PASSWORD);
    await page.goto("/availability");

    // The row for our seeded date renders an Accept button via OfferResponseButtons.
    const acceptButton = page.getByRole("button", { name: /accept/i }).first();
    await expect(acceptButton).toBeVisible({ timeout: 15_000 });
    await acceptButton.click();

    await expect(page.getByText(/offer accepted/i)).toBeVisible({ timeout: 10_000 });

    const booking = await getLatestBooking(fixture.artistId);
    expect(booking?.status).toBe("soft_booked");
  });

  test("producer confirms the soft-booked artist", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD);
    await page.goto("/bookings");

    // The seeded show's program ("e2e-program") is shown in a TableCell. Click
    // the row that contains it to open ShowDateDetailSheet.
    const dateRow = page.getByRole("row", { name: /e2e-program/i }).first();
    await expect(dateRow).toBeVisible({ timeout: 15_000 });
    await dateRow.click();

    // ShowDateDetailSheet renders a Confirm button on each soft_booked row.
    const confirmButton = page.getByRole("button", { name: /^confirm$/i }).first();
    await expect(confirmButton).toBeVisible({ timeout: 15_000 });
    await confirmButton.click();

    await expect(page.getByText(/booking updated/i)).toBeVisible({ timeout: 10_000 });

    const booking = await getLatestBooking(fixture.artistId);
    expect(booking?.status).toBe("confirmed");
  });

  test("a notification email is queued for the artist", async () => {
    // The booking-status-change trigger / digest pipeline writes a row into
    // email_send_log (or queues one). Either a pending or sent row counts.
    // Allow some slack for async writes.
    let count = 0;
    for (let i = 0; i < 10; i++) {
      count = await emailLogCountSince(ARTIST_EMAIL, runStartISO);
      if (count > 0) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    expect(count).toBeGreaterThan(0);
  });
});
