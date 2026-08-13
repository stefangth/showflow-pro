import { expect, test } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { BOOTSTRAP_ORG_ID, deleteUserByEmail } from "./helpers/users";
import { loginAs } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";

const EMAIL = tagEmail("passwordless-profile", Date.now());
const PASSWORD = "E2eProfileAdded!1";
const NEW_PASSWORD = "E2eProfileChanged!2";

test.describe.configure({ mode: "serial" });

test.describe("Profile sign-in methods", () => {
  test.beforeEach(async ({ page }) => { await seedConsent(page); });
  test.beforeAll(async () => {
    const admin = adminClient();
    await deleteUserByEmail(EMAIL);
    const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email: EMAIL });
    expect(error).toBeNull();
    const { error: membershipError } = await admin.from("org_memberships").insert({ org_id: BOOTSTRAP_ORG_ID, user_id: data.user!.id, role: "producer" });
    expect(membershipError).toBeNull();
  });
  test.afterAll(async () => { await deleteUserByEmail(EMAIL); });

  test("passwordless session adds, reloads, and changes a password while magic links remain active", async ({ page, baseURL }) => {
    const admin = adminClient();
    const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
    const { data: verified, error } = await admin.auth.verifyOtp({ type: "magiclink", token_hash: link!.properties!.hashed_token });
    expect(error).toBeNull();
    const session = verified.session!;
    const hash = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: String(session.expires_in ?? 3600),
      token_type: "bearer",
      type: "magiclink",
    }).toString();
    await page.goto(`${baseURL}/auth/callback?redirect=%2Fprofile#${hash}`);
    await expect(page).toHaveURL(/\/profile/, { timeout: 15_000 });

    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByText("Not set", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add password" }).click();
    await page.getByLabel("New password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm new password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(page.getByRole("button", { name: "Change password" })).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText("Set", { exact: true })).toBeVisible();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Change password" }).click();
    await page.getByLabel("Current password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).last().click();
    await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();

    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await loginAs(page, EMAIL, NEW_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
