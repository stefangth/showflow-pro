/**
 * Configurable eligibility (booking flow phase 4): a show-scoped cast
 * priority ladder overrides the org-wide city ladder outright, and a show's
 * required skills exclude artists who lack them from the direct-book list.
 *
 * Two independent scenarios on the same fixture:
 *
 *   1. API-level. The org-wide ladder puts the fixture cast at tier 1 for
 *      the fixture city (`cast_city_priority`). Putting ONLY a second cast
 *      on the SHOW ladder at tier 1 for that same (show, city)
 *      (`show_cast_eligibility.priority`) must override the org list
 *      outright: `resolveTierLadder` returns the show-scoped rows whenever
 *      any exist for the pair, never merging with the org list. Opening
 *      tier 1 must offer the second artist, not the fixture artist.
 *   2. UI-level. A producer on the direct-booking preset opens a date sheet
 *      whose show requires a skill the fixture artist does not hold. The
 *      fixture artist's Book row is absent, and the empty-state copy
 *      renders.
 *
 * Contamination note: scenario 1 writes a show-scoped ladder row for
 * (fixture.showId, fixture.cityId) and a suggested booking for the second
 * artist on the fixture's own show_date. Scenario 2 avoids all of that by
 * using its OWN fresh show_date (mirroring booking-flow-presets.spec.ts's
 * freshEligibleDate / eligibility-gating.spec.ts's seedIneligibleShowDate
 * pattern), left with `city_id` null. The eligibility gate
 * (`fetchGateArtistIds`) only consults `show_cast_eligibility` when the
 * show_date has a city_id, so scenario 1's show-ladder row never enters
 * scenario 2's gate, and the second artist (not a member of scenario 2's
 * fresh date's eligible cast) never appears in its book list either. No
 * inter-test cleanup is needed for the two scenarios to stay independent.
 */
import { expect, test } from "@playwright/test";
import { loginAsAndAwaitDashboard, navViaSidebar } from "./helpers/auth";
import { deleteUserByEmail, BOOTSTRAP_ORG_ID } from "./helpers/users";
import { adminClient, E2E_TAG, tagEmail } from "./helpers/supabase";
import { seedConsent } from "./helpers/consent";
import { TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD } from "./global-setup";
import {
  addShowRequiredSkillE2E,
  cleanupBookingFixture,
  openOfferTier,
  seedBookingFixture,
  setBookingFlow,
  setShowLadderPriority,
  type BookingFixture,
} from "./helpers/booking";
import { addDateEligibility, bookingCountForDate, seedIneligibleShowDate } from "./helpers/eligibility";

const ARTIST_EMAIL = tagEmail("artist-config-eligibility", Date.now());
const ARTIST_PASSWORD = "E2eConfigEligibilityArtist!1";
const SKILL_NAME = `${E2E_TAG}-required-skill`;

let fixture: BookingFixture;
let secondCastId: string;
let secondArtistId: string;

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
 * bookings table's date cell. Mirrors booking-flow-presets.spec.ts's own
 * local copy (used to target THIS date's row when all e2e dates share the
 * same seeded show).
 */
function formatBookingsDate(dateISO: string): string {
  const [y, m, d] = dateISO.split("-");
  return `${d} ${MONTH_ABBR[Number(m) - 1]} ${y}`;
}

test.describe.configure({ mode: "serial" });

test.describe("Configurable eligibility: show ladders and required skills", () => {
  test.beforeAll(async () => {
    await deleteUserByEmail(ARTIST_EMAIL);
    // Defensive: a prior failed run may have left the tagged skill behind.
    await adminClient().from("skills").delete().like("name", `${E2E_TAG}%`);

    fixture = await seedBookingFixture({
      artistEmail: ARTIST_EMAIL,
      artistPassword: ARTIST_PASSWORD,
    });

    // A second cast + artist for the show-ladder-override scenario. Tagged
    // names so cleanupBookingFixture's LIKE-based teardown sweeps them up
    // alongside the fixture's own cast/artist.
    const admin = adminClient();
    const { data: cast, error: castErr } = await admin
      .from("casts")
      .insert({ name: `${E2E_TAG}-cast-2`, org_id: BOOTSTRAP_ORG_ID })
      .select("id")
      .single();
    if (castErr || !cast) throw new Error(`seed second cast failed: ${castErr?.message}`);
    secondCastId = cast.id;

    const { data: artist, error: artistErr } = await admin
      .from("artists")
      .insert({ name: `${E2E_TAG}-artist-2`, org_id: BOOTSTRAP_ORG_ID })
      .select("id")
      .single();
    if (artistErr || !artist) throw new Error(`seed second artist failed: ${artistErr?.message}`);
    secondArtistId = artist.id;

    const { error: cmErr } = await admin
      .from("cast_members")
      .insert({ cast_id: secondCastId, artist_id: secondArtistId });
    if (cmErr) throw new Error(`seed second cast_members failed: ${cmErr.message}`);
  });

  test.afterAll(async () => {
    await setBookingFlow(BOOTSTRAP_ORG_ID, null);
    await adminClient().from("skills").delete().like("name", `${E2E_TAG}%`);
    await cleanupBookingFixture();
    await deleteUserByEmail(ARTIST_EMAIL);
  });

  test("show-scoped ladder overrides the org city list at tier 1", async () => {
    const admin = adminClient();

    // Org-wide ladder: the fixture cast is tier 1 for this city.
    const { error: cpErr } = await admin.from("cast_city_priority").insert({
      cast_id: fixture.castId,
      city_id: fixture.cityId,
      priority: 1,
    });
    expect(cpErr).toBeNull();

    // Show ladder: only the second cast is tiered for (show, city), so it
    // must win outright over the org list above.
    await setShowLadderPriority({
      showId: fixture.showId,
      cityId: fixture.cityId,
      castId: secondCastId,
      orgId: BOOTSTRAP_ORG_ID,
      priority: 1,
    });

    // Tier 1 (unlike tier 99) resolves the ladder from the show_date's own
    // city_id. seedBookingFixture deliberately leaves it null (tier-99
    // path), so point this date at the fixture's city for the tier-1 open.
    const { error: sdErr } = await admin
      .from("show_dates")
      .update({ city_id: fixture.cityId })
      .eq("id", fixture.showDateId);
    expect(sdErr).toBeNull();

    await openOfferTier(fixture.showDateId, 1);

    const { data: secondBooking } = await admin
      .from("bookings")
      .select("status")
      .eq("show_date_id", fixture.showDateId)
      .eq("artist_id", secondArtistId)
      .maybeSingle();
    expect(secondBooking?.status).toBe("suggested");

    const fixtureCount = await bookingCountForDate(fixture.artistId, fixture.showDateId);
    expect(fixtureCount).toBe(0);
  });

  test("required skill excludes the fixture artist from the direct-book list", async ({ page }) => {
    await setBookingFlow(BOOTSTRAP_ORG_ID, { artist_acceptance: false });

    const dateISO = isoDays(50);
    const { showDateId: dateId } = await seedIneligibleShowDate(fixture.showId, dateISO);
    await addDateEligibility(dateId, fixture.castId);

    await addShowRequiredSkillE2E({
      showId: fixture.showId,
      orgId: BOOTSTRAP_ORG_ID,
      skillName: SKILL_NAME,
    });

    await seedConsent(page);
    await loginAsAndAwaitDashboard(page, TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD);
    await navViaSidebar(page, /^shows & bookings$/i);

    const dateRow = page
      .getByRole("row")
      .filter({ hasText: formatBookingsDate(dateISO) })
      .filter({ hasText: /e2e-program/i });
    await expect(dateRow).toBeVisible({ timeout: 15_000 });
    await dateRow.click();

    // Cockpit: the direct-book list (and its empty state) is under the "Book artists" tab.
    await page.getByRole("dialog").getByRole("button", { name: /^book artists$/i }).click();

    const emptyState = page.getByText(
      /No eligible artists for this date\. Check casts and city in Settings\./i
    );
    await expect(emptyState).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^book$/i })).toHaveCount(0);
  });
});
