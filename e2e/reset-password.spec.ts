import { expect, test } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { ensureUserWithRole, deleteUserByEmail } from "./helpers/users";
import { loginAs } from "./helpers/auth";

const EMAIL = tagEmail("phase5-reset", "fixed");
const OLD_PASSWORD = "E2eReset!1old";
const NEW_PASSWORD = "E2eReset!2new";

test.describe.configure({ mode: "serial" });

test.describe("Password reset", () => {
  test.beforeAll(async () => { await ensureUserWithRole(EMAIL, OLD_PASSWORD, "producer"); });
  test.afterAll(async () => { await deleteUserByEmail(EMAIL); });

  test("request mode renders and accepts an email", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: /reset your password/i })).toBeVisible();
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByRole("button", { name: /send reset link/i }).click();
    await expect(page.getByText(/reset link is on its way/i)).toBeVisible({ timeout: 15_000 });
  });

  test("recovery link → set new password → sign in with it", async ({ page, baseURL }) => {
    const { data, error } = await adminClient().auth.admin.generateLink({
      type: "recovery",
      email: EMAIL,
      options: { redirectTo: `${baseURL}/reset-password` },
    });
    expect(error).toBeNull();
    const link = data!.properties!.action_link;

    await page.goto(link);
    await expect(page.getByRole("heading", { name: /set a new password/i })).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: /set password/i }).click();

    await page.context().clearCookies();
    await loginAs(page, EMAIL, NEW_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
