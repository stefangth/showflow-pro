/**
 * Flow A — Signup → admin approves → artist sees dashboard.
 *
 * The app's only UI signup path is Google OAuth, which isn't scriptable in CI.
 * We model "signup" by creating the auth user with the admin API, which fires
 * the same `handle_new_user` trigger as OAuth and lands the user in
 * `user_approvals` with status='pending'. Everything else — admin login,
 * approval click, artist login, dashboard render — exercises the real UI.
 */
import { expect, test } from "@playwright/test";
import { loginAs, loginAsAndAwaitDashboard } from "./helpers/auth";
import {
  createConfirmedUser,
  deleteUserByEmail,
  resetUserToPending,
} from "./helpers/users";
import { tagEmail } from "./helpers/supabase";
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from "./global-setup";

const ARTIST_EMAIL = tagEmail("artist-signup", Date.now());
const ARTIST_PASSWORD = "E2eArtistPass!1";

test.describe.configure({ mode: "serial" });

test.describe("Flow A — signup to dashboard", () => {
  test.beforeAll(async () => {
    // Make sure the test artist starts fresh.
    await deleteUserByEmail(ARTIST_EMAIL);
    const created = await createConfirmedUser(ARTIST_EMAIL, ARTIST_PASSWORD);
    // The handle_new_user trigger should have created a pending row, but
    // re-assert pending state in case the project has been bootstrapped
    // with a different default.
    await resetUserToPending(created.id, created.email);
  });

  test.afterAll(async () => {
    await deleteUserByEmail(ARTIST_EMAIL);
  });

  test("new artist signs in and lands on the pending-approval screen", async ({ page }) => {
    await loginAs(page, ARTIST_EMAIL, ARTIST_PASSWORD);
    await expect(page.getByText(/awaiting approval/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
  });

  test("admin approves the pending artist from the admin panel", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /pending approvals/i })).toBeVisible();

    // Approval rows are divs that contain both the artist email and the
    // Approve button. `.last()` picks the innermost matching ancestor — the
    // row itself rather than an outer Card/Tab container.
    const row = page
      .locator("div")
      .filter({
        hasText: ARTIST_EMAIL,
        has: page.getByRole("button", { name: /approve/i }),
      })
      .last();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: /approve/i }).click();

    await expect(page.getByText(/user approved/i)).toBeVisible({ timeout: 10_000 });
  });

  test("approved artist signs in and reaches the dashboard", async ({ page }) => {
    await loginAs(page, ARTIST_EMAIL, ARTIST_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    // ArtistDashboard renders an h1 "Dashboard" for users with only the artist role.
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
    await expect(page.getByText(/awaiting approval/i)).not.toBeVisible();
  });
});
