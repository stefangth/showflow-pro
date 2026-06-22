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
import { loginAs, loginAsAndAwaitDashboard, navViaSidebar } from "./helpers/auth";
import { deleteUserByEmail } from "./helpers/users";
import { tagEmail } from "./helpers/supabase";
import { seedConsent } from "./helpers/consent";
import {
  cleanupBookingFixture,
  confirmedNotificationsSince,
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
    // Producer triggers an offer for the seeded date. Tier 99 is the "ad-hoc"
    // path that reads from `show_date_cast_eligibility` directly — tiers 1-N
    // require `show_dates.city_id` + `cast_city_priority`, which would mean
    // dragging the whole priority graph into the fixture.
    await openOfferTier(fixture.showDateId, 99);

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

  // Pre-decide cookie consent so the bottom-fixed CookieConsentBanner never
  // renders. It overlaps page-bottom controls (intercepting Playwright clicks),
  // and its "Accept all" button would otherwise also match the /accept/i offer
  // locator below — making `.first()` ambiguous. Matches the other UI specs.
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("artist sees the pending offer and accepts it", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, ARTIST_EMAIL, ARTIST_PASSWORD);
    // Sidebar link is artist-gated → click it instead of goto'ing so we don't
    // race AuthContext.fetchRoles.
    await navViaSidebar(page, /^availability$/i);

    // The row for our seeded date renders an Accept button via OfferResponseButtons.
    // With consent pre-seeded (beforeEach) the cookie banner is gone, so /accept/i
    // no longer matches its "Accept all" button — only offer Accept buttons remain.
    // The fixture seeds one booking, so there's a single such button; .first() is
    // defensive against a future fixture seeding more.
    const acceptButton = page.getByRole("button", { name: /accept/i }).first();
    await expect(acceptButton).toBeVisible({ timeout: 15_000 });

    // Retry the click until it takes effect, then wait on DURABLE state — the
    // Accept button disappearing — not the transient sonner toast. Accepting flips
    // the booking out of "suggested", which unmounts OfferResponseButtons, so the
    // button is gone for good: a monotonic signal `toPass` converges on. (The old
    // toast assertion flaked because sonner auto-dismisses "Offer accepted", so a
    // slow CI run could miss the 20s window. The deeper intermittent cause — the
    // offer button rendering with bookingId=undefined and the accept erroring — was
    // a React Query key collision fixed in AvailabilityPage/ArtistDashboard/
    // ArtistBookingsView, not a test-timing issue.) Guarding the re-click on
    // visibility stops us clicking once the accept lands, so no duplicate PATCH.
    await expect(async () => {
      if (await acceptButton.isVisible()) {
        await acceptButton.click();
      }
      await expect(acceptButton).toBeHidden({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    // Ground-truth check on the persisted state the disappearing button stands in for.
    const booking = await getLatestBooking(fixture.artistId);
    expect(booking?.status).toBe("soft_booked");
  });

  test("producer confirms the soft-booked artist", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD);
    await navViaSidebar(page, /^shows & bookings$/i);

    // The seeded show's program ("e2e-program") is shown in a TableCell. Click
    // the row that contains it to open ShowDateDetailSheet.
    const dateRow = page.getByRole("row", { name: /e2e-program/i }).first();
    await expect(dateRow).toBeVisible({ timeout: 15_000 });
    await dateRow.click();

    // ShowDateDetailSheet renders a Confirm button only on a soft_booked row
    // (`b.status === 'soft_booked' && …`), so it unmounts once the booking flips
    // to confirmed — the same durable signal we lean on above. Retry the click
    // (the sheet mounts its content after the row click, so the first click can
    // race the button) and wait for it to disappear instead of the transient
    // "Booking updated" toast. The fixture has one soft_booked booking, so a
    // single Confirm button; .first() is defensive.
    const confirmButton = page.getByRole("button", { name: /^confirm$/i }).first();
    await expect(confirmButton).toBeVisible({ timeout: 15_000 });

    await expect(async () => {
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }
      await expect(confirmButton).toBeHidden({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    // Ground-truth check on the persisted state the disappearing button stands in for.
    const booking = await getLatestBooking(fixture.artistId);
    expect(booking?.status).toBe("confirmed");
  });

  test("a confirmation notification is queued for the artist", async () => {
    // The booking_status_change trigger writes a `booking_confirmed`
    // notification when status moves to confirmed. The transactional email
    // itself is sent by the daily digest cron — we verify the trigger fired,
    // which is the integration boundary the ticket calls an "email stub".
    let count = 0;
    for (let i = 0; i < 10; i++) {
      count = await confirmedNotificationsSince(fixture.artistUser.id, runStartISO);
      if (count > 0) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    expect(count).toBeGreaterThan(0);
  });
});
