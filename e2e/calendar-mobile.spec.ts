/**
 * Calendar Phase 5 — mobile smoke.
 *
 * Exercises the mobile calendar shell (`useIsMobile` branch of
 * `CalendarSurface`, Phase 5 tasks 1-9) at a real mobile viewport, on both
 * roles:
 *
 *   - Artist: `/availability` lands on the Offers lens (the artist mobile
 *     default), then the Month lens day tap opens the `CalendarDaySheet`
 *     bottom sheet for the seeded offer's date, and its "Accept offer"
 *     primary button accepts the booking (ground-truth verified via the DB,
 *     same pattern as `booking-lifecycle.spec.ts`).
 *   - Producer: `/bookings` lands on the Needs-you lens (the producer mobile
 *     default), the Agenda lens's row tap opens the same bottom sheet (its
 *     mobile behavior differs from desktop, which navigates straight to
 *     `ShowDateDetailSheet` — see `CalendarSurface.tsx`'s mobile branch), and
 *     the "New date" `SurfaceFab` (shown only on the landing/Needs-you lens)
 *     opens the new-date dialog.
 *
 * Below 1024px (`lg` in `AppLayout`) the sidebar collapses behind a
 * hamburger — `navViaMobileNav` below opens it before clicking a nav link,
 * mirroring `helpers/auth.ts`'s `navViaSidebar` (including its
 * badge-tolerant name pattern) but for the mobile overlay drawer.
 */
import { expect, test, type Page } from "@playwright/test";
import { loginAsAndAwaitDashboard } from "./helpers/auth";
import { deleteUserByEmail } from "./helpers/users";
import { tagEmail } from "./helpers/supabase";
import { seedConsent } from "./helpers/consent";
import {
  cleanupBookingFixture,
  getLatestBooking,
  openOfferTier,
  seedBookingFixture,
  type BookingFixture,
} from "./helpers/booking";
import { TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD } from "./global-setup";

// `useIsMobile` (src/hooks/use-mobile.ts) gates on viewport width alone, but
// a mobile user agent keeps the run honest about what surface actually loads.
test.use({
  viewport: { width: 402, height: 874 },
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
});

const ARTIST_EMAIL = tagEmail("mobile-artist", Date.now());
const ARTIST_PASSWORD = "E2eMobileArtist!1";

let fixture: BookingFixture;

test.describe.configure({ mode: "serial" });

/**
 * Opens the mobile nav overlay (hamburger in `AppLayout`'s topbar) and clicks
 * a link inside it. Below `lg` the sidebar itself is not rendered — only the
 * "Open navigation" button and, once tapped, the overlay drawer are.
 */
async function navViaMobileNav(page: Page, linkName: RegExp): Promise<void> {
  await page.getByRole("button", { name: /open navigation/i }).click();
  // Same badge-tolerant pattern as `helpers/auth.ts`'s `navViaSidebar` — nav
  // links grow a numeric count once `useNavCounts` resolves.
  const namePattern = new RegExp(
    linkName.source.replace(/\$$/, String.raw`(\s+\d+)?$`),
    linkName.flags,
  );
  const link = page.getByRole("link", { name: namePattern });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
}

/**
 * Steps the calendar surface's `PeriodNavigator` from "today" to the month
 * containing `dateISO`. Mirrors `helpers/bookingsUi.ts`'s `openBookingsDate`
 * month-stepping logic — duplicated here (not imported) because that helper
 * also drives the desktop Agenda-row-opens-ShowDateDetailSheet flow, which
 * mobile does not use. Only the Month lens (used by the artist flow below)
 * has a period navigator on mobile — the mobile Agenda lens does not (see
 * `nearFutureSameMonthISO` below), so this is never called for it.
 */
async function stepToMonth(page: Page, dateISO: string): Promise<void> {
  const now = new Date();
  const [year, month] = dateISO.split("-").map(Number);
  const monthsDelta = (year - now.getFullYear()) * 12 + (month - 1 - now.getMonth());
  const step = monthsDelta >= 0 ? "period-navigator-next" : "period-navigator-prev";
  for (let i = 0; i < Math.abs(monthsDelta); i++) {
    await page.getByTestId(step).click();
  }
}

/**
 * Tomorrow's date (YYYY-MM-DD, UTC — matching `helpers/booking.ts`'s
 * `isoDays`). The mobile Agenda lens has no `PeriodNavigator` — unlike
 * desktop, which also shows one for Agenda, mobile only wires it for
 * Month/Week/Season (`CalendarSurface.tsx`'s mobile branch) — so it always
 * shows the anchor's ("today's") month with no way to page it from the UI.
 * The producer flow below needs the fixture's date to land in that same
 * window, so it must stay within the current calendar month; a date 30 days
 * out (this repo's other booking fixtures' default) would usually land in
 * the following month instead. Not proofed against running on the last day
 * of the month (tomorrow would roll into next month) — an accepted, narrow
 * edge case for a smoke test.
 */
function nearFutureSameMonthISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test.describe("Calendar mobile smoke", () => {
  test.beforeAll(async () => {
    await deleteUserByEmail(ARTIST_EMAIL);
    fixture = await seedBookingFixture({
      artistEmail: ARTIST_EMAIL,
      artistPassword: ARTIST_PASSWORD,
      dateISO: nearFutureSameMonthISO(),
    });
    // Tier 99 is the ad-hoc path that reads `show_date_cast_eligibility`
    // directly — see `booking-lifecycle.spec.ts` for why.
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
  // renders — on a 402px viewport it would otherwise overlap the mobile
  // day-sheet / FAB region entirely. Matches the other UI specs.
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("artist: Offers lens shows, Month day tap opens the sheet, Accept confirms the offer", async ({
    page,
  }) => {
    await loginAsAndAwaitDashboard(page, ARTIST_EMAIL, ARTIST_PASSWORD);
    await navViaMobileNav(page, /^availability$/i);

    // Offers is the artist mobile landing lens (CalendarSurface's
    // `defaultLensKey`) and renders the live offer directly, with its own
    // Accept/Decline/Block buttons on the card — no sheet involved for this
    // lens (see `OffersLens.tsx`). Assert it's the one that shows first.
    // The card's testid is keyed by `ArtistDateEntry.id`, which is the
    // show_date id (`artistData.ts`'s `toArtistEntries`: `id: ed.id`) — NOT
    // the booking id (that's the separate `entry.bookingId` field the
    // Accept button's handler reads).
    await expect(page.getByTestId("lens-tab-offers")).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("offers-lens")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`offer-card-${fixture.showDateId}`)).toBeVisible();

    // Switch to Month: on mobile a day tap opens the `CalendarDaySheet`
    // bottom sheet (replacing the desktop side `DayRail` — see
    // `CalendarSurface.tsx`'s mobile branch), which is where the sheet-driven
    // Accept flow the brief describes actually lives.
    await page.getByTestId("lens-tab-month").click();
    await expect(page.getByTestId("month-grid")).toBeVisible({ timeout: 15_000 });
    await stepToMonth(page, fixture.dateISO);

    await page.getByTestId(`month-grid-cell-${fixture.dateISO}`).click();
    const sheet = page.getByTestId("calendar-day-sheet");
    await expect(sheet).toBeVisible({ timeout: 15_000 });

    // The sheet's primary button defaults to "Accept offer" for a day with a
    // suggested booking (`DayDetail.tsx`'s `artistPrimaryLabel`). Retry the
    // click until it takes effect, then wait on the button disappearing
    // (accepting flips the booking out of "suggested", which removes the
    // primary label) — same durable-signal pattern as
    // `booking-lifecycle.spec.ts`, not the transient sonner toast.
    const acceptButton = page.getByTestId("day-rail-primary");
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

  test("producer: Needs-you lens shows, Agenda row opens the sheet, FAB opens the new-date dialog", async ({
    page,
  }) => {
    await loginAsAndAwaitDashboard(page, TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD);
    await navViaMobileNav(page, /^dates$/i);

    // Needs-you is the producer mobile landing lens and default (spec §3);
    // the FAB only renders here (`CalendarSurface.tsx`: `activeLens ===
    // 'needs-you'`), so we start and end this test on it.
    await expect(page.getByTestId("lens-tab-needs-you")).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("needs-you-lens")).toBeVisible({ timeout: 15_000 });

    // Agenda's mobile row tap opens the day sheet (unlike desktop, which
    // navigates straight into `ShowDateDetailSheet` — see
    // `CalendarSurface.tsx`'s mobile branch, `onOpenEntry={(entry) =>
    // handleMobileDayTap(entry.date)}`). Mobile Agenda has no period
    // navigator (see `nearFutureSameMonthISO`'s doc comment), so there is no
    // month to step to here — the fixture date is already within the
    // current, un-navigable window.
    await page.getByTestId("lens-tab-agenda").click();
    await expect(page.getByTestId("agenda-lens")).toBeVisible({ timeout: 15_000 });

    const row = page.getByTestId(`agenda-row-${fixture.showDateId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    // Click the left (date) region so the click can never land on the row's
    // right-aligned action button, matching `helpers/bookingsUi.ts`.
    await row.click({ position: { x: 30, y: 18 } });

    const sheet = page.getByTestId("calendar-day-sheet");
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByTestId("day-sheet-open-date")).toBeVisible();

    // Dismiss the sheet (Escape is the Radix-Dialog-backed vaul Drawer's
    // native close) and return to the landing lens to reach the FAB.
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden({ timeout: 10_000 });
    await page.getByTestId("lens-tab-needs-you").click();

    const fab = page.getByTestId("surface-fab");
    await expect(fab).toBeVisible({ timeout: 15_000 });
    await fab.click();

    // `ShowDateFormDialog` (shadcn `Dialog`/Radix) — assert by role, not
    // translated title text, so this doesn't couple to i18n copy.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByTestId("date-trigger")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });
});
