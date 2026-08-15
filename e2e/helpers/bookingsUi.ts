import { expect, type Page } from "@playwright/test";

/**
 * Open a show_date's detail sheet from the producer "Shows & Bookings" page,
 * which now renders the lens-based calendar surface instead of a flat table.
 *
 * The caller must already be on the Shows & Bookings page (e.g. via
 * `navViaSidebar(page, /^shows & bookings$/i)`).
 *
 * Unlike the old table (which listed every upcoming date), the calendar shows
 * only the anchor month, so we:
 *   1. switch to the Agenda lens (its rows carry a stable `agenda-row-<id>`
 *      testid and open the date on click),
 *   2. step the period navigator to the fixture date's month, then
 *   3. click the row for `showDateId`.
 */
export async function openBookingsDate(
  page: Page,
  { showDateId, dateISO }: { showDateId: string; dateISO: string },
): Promise<void> {
  // Agenda lens: one clickable row per date, keyed by show_date id.
  await page.getByTestId("lens-tab-agenda").click();

  // The surface anchors on "today"; walk to the fixture date's month. The CI
  // runner is UTC, so local getFullYear/getMonth match the UTC date string.
  const now = new Date();
  const [year, month] = dateISO.split("-").map(Number);
  const monthsDelta = (year - now.getFullYear()) * 12 + (month - 1 - now.getMonth());
  const step = monthsDelta >= 0 ? "period-navigator-next" : "period-navigator-prev";
  for (let i = 0; i < Math.abs(monthsDelta); i++) {
    await page.getByTestId(step).click();
  }

  const row = page.getByTestId(`agenda-row-${showDateId}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  // Click the left (date) region so the click can never land on the row's
  // right-aligned action button (Confirm holds / Generate / Open casting).
  await row.click({ position: { x: 30, y: 18 } });
}
