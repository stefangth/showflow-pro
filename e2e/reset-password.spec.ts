import { expect, test } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { ensureUserWithRole, deleteUserByEmail } from "./helpers/users";
import { loginAs } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";

const EMAIL = tagEmail("phase5-reset", "fixed");
const OLD_PASSWORD = "E2eReset!1old";
const NEW_PASSWORD = "E2eReset!2new";

test.describe.configure({ mode: "serial" });

test.describe("Password reset", () => {
  test.beforeEach(async ({ page }) => { await seedConsent(page); });
  test.beforeAll(async () => { await ensureUserWithRole(EMAIL, OLD_PASSWORD, "producer"); });
  test.afterAll(async () => { await deleteUserByEmail(EMAIL); });

  test("request mode renders and accepts an email", async ({ page }) => {
    await page.goto("/reset-password");
    // First navigation of the run can hit a cold Vite dev server still compiling the
    // route on demand, so give the initial render extra headroom beyond the 10s
    // default. (In the full suite the server is already warm; this only matters when
    // this spec runs first/alone.)
    await expect(page.getByRole("heading", { name: /reset your password/i })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Email").fill(EMAIL);
    // The submit button stays disabled until the typed email registers in state.
    // Wait for it to enable explicitly, so a slow first render can't leave .click()
    // hanging on a disabled button until the whole test times out.
    const sendLink = page.getByRole("button", { name: /send reset link/i });
    await expect(sendLink).toBeEnabled();
    await sendLink.click();
    await expect(page.getByText(/reset link is on its way/i)).toBeVisible({ timeout: 15_000 });
  });

  test("recovery link → set new password → sign in with it", async ({ page, baseURL }) => {
    // Drive the app's recovery route directly instead of following GoTrue's redirect.
    // The stack's redirect handling (site_url / allowlist) shifts between Supabase CLI
    // versions and would otherwise dead-end the browser on the default fallback port.
    // We mint the recovery session via the API and land the app on /reset-password with
    // the tokens in the URL hash — the exact shape the real redirect produces, and what
    // the app's recovery handler (parseRecoveryHash) + supabase-js detectSessionInUrl
    // consume — so this exercises the same UI path without depending on stack config.
    const admin = adminClient();
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: EMAIL,
    });
    expect(linkErr).toBeNull();

    const { data: verified, error: verifyErr } = await admin.auth.verifyOtp({
      type: "recovery",
      token_hash: linkData!.properties!.hashed_token,
    });
    expect(verifyErr).toBeNull();
    const session = verified!.session!;
    expect(session, "verifyOtp should return a recovery session").toBeTruthy();

    const hash = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: String(session.expires_in ?? 3600),
      token_type: "bearer",
      type: "recovery",
    }).toString();
    await page.goto(`${baseURL}/reset-password#${hash}`);

    // Extra headroom for a cold Vite compile on the first navigation of the run.
    await expect(page.getByRole("heading", { name: /set a new password/i })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: /set password/i }).click();
    // Wait for the change to actually persist before logging in with the new password.
    await expect(page.getByText(/password updated/i).first()).toBeVisible({ timeout: 15_000 });

    await page.context().clearCookies();
    await loginAs(page, EMAIL, NEW_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
