/**
 * Booking flow presets: one happy path per preset.
 *
 * The org's `booking_flow` app_settings row (Settings > Booking Engine) changes
 * how a booking moves from offer to confirmed. This spec drives all three
 * presets end to end on the SAME fixture, one after another:
 *
 *   1. classic     : booking_flow cleared back to defaults. An accepted offer
 *                     lands soft_booked; a producer still has to confirm it.
 *   2. fast-track   : producer_confirmation:false. An accepted offer confirms
 *                     in one step (status confirmed, confirmed_at set). This
 *                     exercises the suggested to confirmed DB guard change and
 *                     the RLS policy that lets an artist self-confirm only
 *                     under this org setting.
 *   3. direct       : artist_acceptance:false. open-offer-tier refuses with an
 *                     error (offers are disabled for the org), so a producer
 *                     books straight to confirmed from the date sheet's "Book
 *                     artists" card. Booking and confirming happen in one step,
 *                     driven through the real UI, with no offer for the artist
 *                     to accept.
 *
 * Each scenario gets its own fresh show_date on the fixture's show/cast
 * (`freshEligibleDate` below) so the three serial tests never fight over the
 * same booking row, mirroring how eligibility-gating.spec.ts layers a second
 * show_date on top of the shared fixture.
 */
import { expect, test } from "@playwright/test";
import { loginAsAndAwaitDashboard, navViaSidebar } from "./helpers/auth";
import { deleteUserByEmail, BOOTSTRAP_ORG_ID } from "./helpers/users";
import { tagEmail } from "./helpers/supabase";
import { seedConsent } from "./helpers/consent";
import { TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD } from "./global-setup";
import {
  cleanupBookingFixture,
  getLatestBooking,
  getNotification,
  openOfferTier,
  seedBookingFixture,
  setBookingFlow,
  tryOpenOfferTier,
  type BookingFixture,
} from "./helpers/booking";
import { addDateEligibility, seedIneligibleShowDate } from "./helpers/eligibility";

const ARTIST_EMAIL = tagEmail("artist-flow-presets", Date.now());
const ARTIST_PASSWORD = "E2eFlowPresetsArtist!1";

let fixture: BookingFixture;

function isoDays(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * `YYYY-MM-DD` to `dd MMM yyyy` (e.g. `26 Aug 2026`), matching the producer
 * bookings table's date cell (`format(parseDateOnly(sd.date), 'dd MMM yyyy')`
 * in ShowsBookingsPage). Used to target THIS date's row when all e2e dates
 * share the same seeded show. The ISO day is already zero-padded, so the parts
 * map straight to date-fns' default (en-US) output with no Date construction.
 */
function formatBookingsDate(dateISO: string): string {
  const [y, m, d] = dateISO.split("-");
  return `${d} ${MONTH_ABBR[Number(m) - 1]} ${y}`;
}

/**
 * A fresh show_date on the fixture's show, eligible via a direct per-date
 * override for the fixture's cast (mirrors seedBookingFixture's own show_date,
 * just without re-seeding the whole graph).
 */
async function freshEligibleDate(dateISO: string): Promise<string> {
  const { showDateId } = await seedIneligibleShowDate(fixture.showId, dateISO);
  await addDateEligibility(showDateId, fixture.castId);
  return showDateId;
}

test.describe.configure({ mode: "serial" });

test.describe("Booking flow presets: one happy path per preset", () => {
  test.beforeAll(async () => {
    await deleteUserByEmail(ARTIST_EMAIL);
    fixture = await seedBookingFixture({
      artistEmail: ARTIST_EMAIL,
      artistPassword: ARTIST_PASSWORD,
    });
  });

  test.afterAll(async () => {
    await setBookingFlow(BOOTSTRAP_ORG_ID, null);
    await cleanupBookingFixture();
    await deleteUserByEmail(ARTIST_EMAIL);
  });

  // Pre-decide cookie consent so the bottom-fixed CookieConsentBanner never
  // renders; it would otherwise intercept the Accept button clicks below.
  // Matches the pattern in booking-lifecycle.spec.ts.
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("classic: an accepted offer lands soft_booked", async ({ page }) => {
    await setBookingFlow(BOOTSTRAP_ORG_ID, null);

    await openOfferTier(fixture.showDateId, 99);
    const suggested = await getLatestBooking(fixture.artistId);
    expect(suggested?.status).toBe("suggested");

    await loginAsAndAwaitDashboard(page, ARTIST_EMAIL, ARTIST_PASSWORD);
    await navViaSidebar(page, /^availability$/i);

    // See booking-lifecycle.spec.ts for why this retries the click and waits
    // on the button disappearing rather than the transient sonner toast.
    const acceptButton = page.getByRole("button", { name: /accept/i }).first();
    await expect(acceptButton).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      if (await acceptButton.isVisible()) {
        await acceptButton.click();
      }
      await expect(acceptButton).toBeHidden({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    const booking = await getLatestBooking(fixture.artistId);
    expect(booking?.status).toBe("soft_booked");
  });

  test("fast-track: an accepted offer confirms in one step", async ({ page }) => {
    await setBookingFlow(BOOTSTRAP_ORG_ID, { producer_confirmation: false });

    const dateId = await freshEligibleDate(isoDays(41));
    await openOfferTier(dateId, 99);
    const suggested = await getLatestBooking(fixture.artistId);
    expect(suggested?.status).toBe("suggested");

    await loginAsAndAwaitDashboard(page, ARTIST_EMAIL, ARTIST_PASSWORD);
    await navViaSidebar(page, /^availability$/i);

    const acceptButton = page.getByRole("button", { name: /accept/i }).first();
    await expect(acceptButton).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      if (await acceptButton.isVisible()) {
        await acceptButton.click();
      }
      await expect(acceptButton).toBeHidden({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    const booking = await getLatestBooking(fixture.artistId);
    expect(booking?.status).toBe("confirmed");
    expect(booking?.confirmed_at).toBeTruthy();
  });

  test("direct: a producer books the artist straight to confirmed via the UI", async ({ page }) => {
    await setBookingFlow(BOOTSTRAP_ORG_ID, { artist_acceptance: false });

    const dateISO = isoDays(42);
    const dateId = await freshEligibleDate(dateISO);

    // Direct-booking orgs disable open offers: open-offer-tier refuses, so there
    // is no suggested/offer step for the artist to accept. Assert the refusal,
    // preserving the old test's "no offer step" coverage.
    const { error } = await tryOpenOfferTier(dateId, 99);
    expect(error).toBeTruthy();
    expect(error).toMatch(/direct booking/i);

    // Drive the real direct-booking UI instead of inserting the booking: a
    // producer opens the date sheet and books the artist from the "Book artists"
    // card (EligibilityBookList), which books AND confirms in one step.
    await loginAsAndAwaitDashboard(page, TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD);
    await navViaSidebar(page, /^shows & bookings$/i);

    // Every e2e date hangs off the same seeded "e2e-program" show, so open THIS
    // date by its formatted date cell (the producer table renders "dd MMM yyyy")
    // AND the program, not by program alone as booking-lifecycle can.
    const dateRow = page
      .getByRole("row")
      .filter({ hasText: formatBookingsDate(dateISO) })
      .filter({ hasText: /e2e-program/i });
    await expect(dateRow).toBeVisible({ timeout: 15_000 });
    await dateRow.click();

    // Cockpit: the direct-book list lives under the "Book artists" tab.
    await page.getByRole("dialog").getByRole("button", { name: /^book artists$/i }).click();

    // EligibilityBookList fails closed with Skeletons until the eligibility,
    // blocked, org-artist and bookings queries all resolve, so wait for the
    // seeded artist's Book button itself, not just the card. Only that artist is
    // eligible (cast-restricted), so there is exactly one Book button.
    const bookButton = page.getByRole("button", { name: /^book$/i }).first();
    await expect(bookButton).toBeVisible({ timeout: 20_000 });

    // Clicking Book opens a confirm AlertDialog ("Book <name> for this date?")
    // with a "Book and confirm" action. Retry the open until that action is
    // present, since the dialog content mounts after the click. Guarding re-click
    // on the action NOT being visible means we only click while the dialog is
    // closed (no overlay), so it never double-fires.
    const confirmBooking = page.getByRole("button", { name: /^book and confirm$/i });
    await expect(async () => {
      if (!(await confirmBooking.isVisible())) {
        await bookButton.click();
      }
      await expect(confirmBooking).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    // Commit the booking, retrying the confirm click until the DURABLE signal
    // (the row flipping from a Book button to a "Booked" badge) lands, rather
    // than the transient "Artist booked" sonner toast. Once the dialog closes
    // the action unmounts, so the guard stops any duplicate booking.
    const bookedBadge = page.getByText(/^booked$/i);
    await expect(async () => {
      if (await confirmBooking.isVisible()) {
        await confirmBooking.click();
      }
      await expect(bookedBadge).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    // Ground-truth DB check the badge stands in for: a single confirmed booking,
    // created directly with no offer step (mirrors the old assertion).
    const booking = await getLatestBooking(fixture.artistId);
    expect(booking?.status).toBe("confirmed");

    // Phase 3: the direct INSERT itself fires the booking_confirmed in-app
    // notification (DB trigger), since no offer/accept transition ever runs.
    // The trigger writes the notification in the same transaction as the
    // booking, so getLatestBooking having returned the row means it is already
    // committed. No polling needed.
    const notification = await getNotification(
      fixture.artistUser.id,
      "booking_confirmed",
      booking!.id
    );
    expect(notification).not.toBeNull();
  });
});
