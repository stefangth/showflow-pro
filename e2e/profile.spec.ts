import { expect, test } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { ensureUserWithRole, deleteUserByEmail, findUserByEmail } from "./helpers/users";
import { loginAsAndAwaitDashboard, loginAs } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";

const EMAIL = tagEmail("phase5-profile", "fixed");
const PASSWORD = "E2eProfile!1";
const NEW_PASSWORD = "E2eProfile!2new";

test.describe.configure({ mode: "serial" });

test.describe("Profile self-service", () => {
  test.beforeEach(async ({ page }) => { await seedConsent(page); });
  test.beforeAll(async () => { await ensureUserWithRole(EMAIL, PASSWORD, "producer"); });
  test.afterAll(async () => { await deleteUserByEmail(EMAIL); });

  test("edits display name (DB is the oracle)", async ({ page }) => {
    const u = await findUserByEmail(EMAIL);
    await loginAsAndAwaitDashboard(page, EMAIL, PASSWORD);
    await page.goto("/profile");
    await page.getByLabel("Display name").fill("Phase Five Tester");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(async () => {
      const { data } = await adminClient().from("profiles").select("display_name").eq("user_id", u!.id).single();
      expect(data?.display_name).toBe("Phase Five Tester");
    }).toPass({ timeout: 15_000 });
  });

  test("changes password and can sign in with the new one", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, EMAIL, PASSWORD);
    await page.goto("/profile");
    await page.getByLabel("Current password").fill(PASSWORD);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: /change password/i }).click();
    await expect(page.getByText(/password changed/i)).toBeVisible({ timeout: 15_000 });

    await page.context().clearCookies();
    await loginAs(page, EMAIL, NEW_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
