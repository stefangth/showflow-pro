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
 *                     books straight to confirmed instead. The artist never
 *                     sees an offer but the date shows as confirmed on login.
 *
 * Each scenario gets its own fresh show_date on the fixture's show/cast
 * (`freshEligibleDate` below) so the three serial tests never fight over the
 * same booking row, mirroring how eligibility-gating.spec.ts layers a second
 * show_date on top of the shared fixture.
 */
import { expect, test } from "@playwright/test";
import { loginAsAndAwaitDashboard, navViaSidebar } from "./helpers/auth";
import { deleteUserByEmail, BOOTSTRAP_ORG_ID } from "./helpers/users";
import { adminClient, tagEmail } from "./helpers/supabase";
import { seedConsent } from "./helpers/consent";
import {
  cleanupBookingFixture,
  getLatestBooking,
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

/** `YYYY-MM-DD` to `dd/MM/yyyy`, matching src/lib/dates.ts's formatDateDMY. */
function formatDMY(dateISO: string): string {
  const [y, m, d] = dateISO.split("-");
  return `${d}/${m}/${y}`;
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

  test("direct: offers are refused, a straight booking lands confirmed", async ({ page }) => {
    await setBookingFlow(BOOTSTRAP_ORG_ID, { artist_acceptance: false });

    const dateISO = isoDays(42);
    const dateId = await freshEligibleDate(dateISO);

    const { error } = await tryOpenOfferTier(dateId, 99);
    expect(error).toBeTruthy();
    expect(error).toMatch(/direct booking/i);

    // No offer was created, so a producer books the artist straight to confirmed
    // instead, the same shape createBooking (src/data/bookings.ts) inserts when
    // the org's booking_flow disables artist acceptance.
    const admin = adminClient();
    const { error: insertErr } = await admin.from("bookings").insert({
      show_date_id: dateId,
      artist_id: fixture.artistId,
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      is_understudy: false,
      org_id: BOOTSTRAP_ORG_ID,
    });
    expect(insertErr).toBeNull();

    const booking = await getLatestBooking(fixture.artistId);
    expect(booking?.status).toBe("confirmed");

    await loginAsAndAwaitDashboard(page, ARTIST_EMAIL, ARTIST_PASSWORD);
    await navViaSidebar(page, /^availability$/i);

    const row = page.getByRole("row").filter({ hasText: formatDMY(dateISO) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText(/^confirmed$/i)).toBeVisible();
  });
});
