import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { adminClient, tagEmail } from "./helpers/supabase";
import { ensureUserWithRole, deleteUserByEmail, findUserByEmail, BOOTSTRAP_ORG_ID } from "./helpers/users";
import { seedConsent } from "./helpers/consent";

const ADMIN_EMAIL = tagEmail("stable-invite-admin", "fixed");
const ADMIN_PASSWORD = "E2eStableInviteAdmin!1";
const stamp = Date.now();
const emails = {
  magic: tagEmail("stable-invite-magic", stamp),
  password: tagEmail("stable-invite-password", stamp),
  delayed: tagEmail("stable-invite-delayed", stamp),
  expired: tagEmail("stable-invite-expired", stamp),
};

test.describe.configure({ mode: "serial" });

async function createPasswordlessUser(email: string) {
  const admin = adminClient();
  await deleteUserByEmail(email);
  const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email });
  expect(error).toBeNull();
  return data.user!;
}

async function seedInvite(email: string, expiresAt: string) {
  const admin = adminClient();
  const inviter = await findUserByEmail(ADMIN_EMAIL);
  const token = crypto.randomUUID();
  const { data, error } = await admin.from("org_invitations").insert({
    org_id: BOOTSTRAP_ORG_ID,
    email,
    role: "producer",
    invited_by: inviter!.id,
    token,
    expires_at: expiresAt,
  }).select("id, token, expires_at").single();
  expect(error).toBeNull();
  return data!;
}

async function inviteSessionHash(email: string) {
  const admin = adminClient();
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  expect(linkError).toBeNull();
  const { data: verified, error: verifyError } = await admin.auth.verifyOtp({
    type: "magiclink",
    token_hash: link!.properties!.hashed_token,
  });
  expect(verifyError).toBeNull();
  const session = verified.session!;
  return new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in ?? 3600),
    token_type: "bearer",
    type: "magiclink",
  }).toString();
}

async function blockLocalAutoLogin(page: Page) {
  await page.route("**/auth/v1/token?grant_type=password", async (route) => {
    const body = route.request().postDataJSON() as { email?: string };
    if (body.email === "admin@example.com") {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "disabled in signed-out invitation test" }) });
    } else {
      await route.continue();
    }
  });
}

function publicClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) throw new Error("E2E: local Supabase URL and anon key are required");
  return createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function openThroughExchange(page: Page, baseURL: string, token: string, email: string) {
  const hash = await inviteSessionHash(email);
  let exchangeCount = 0;
  await blockLocalAutoLogin(page);
  await page.route("**/functions/v1/exchange-invitation", async (route) => {
    exchangeCount += 1;
    expect(route.request().postDataJSON()).toEqual({ token, app_origin: baseURL });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ action_url: `${baseURL}/auth/callback?redirect=%2Faccept-invite#${hash}` }),
    });
  });
  await page.goto(`/accept-invite?token=${token}`);
  await expect(page.getByRole("heading", { name: "You've been invited" })).toBeVisible();
  expect(exchangeCount).toBe(0);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("accept-invite-success")).toBeVisible({ timeout: 20_000 });
  expect(exchangeCount).toBe(1);
}

test.describe("Stable invitation onboarding", () => {
  test.beforeEach(async ({ page }) => { await seedConsent(page); });
  test.beforeAll(async () => {
    await ensureUserWithRole(ADMIN_EMAIL, ADMIN_PASSWORD, "admin");
    await Promise.all(Object.values(emails).map(createPasswordlessUser));
  });
  test.afterAll(async () => {
    const admin = adminClient();
    await admin.from("org_invitations").delete().in("email", Object.values(emails));
    await Promise.all([...Object.values(emails), ADMIN_EMAIL].map(deleteUserByEmail));
  });

  test("signed-out landing waits for Continue, returns through callback, and offers both unselected methods", async ({ page, baseURL }) => {
    const invite = await seedInvite(emails.magic, new Date(Date.now() + 30 * 86_400_000).toISOString());
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await openThroughExchange(page, baseURL!, invite.token, emails.magic);

    const choices = page.getByTestId("sign-in-choices");
    await expect(choices.getByRole("button", { name: /Create a password/ })).toHaveAttribute("aria-pressed", "false");
    const magic = choices.getByRole("button", { name: /Continue with magic links/ });
    await expect(magic).toHaveAttribute("aria-pressed", "false");
    await magic.focus();
    await page.keyboard.press("Enter");
    // Producer joining a booking-on org: the handoff's primary action now opens the Get
    // running board (screen 07), not the dashboard. See resolveHandoffPrimary.
    await expect(page).toHaveURL(/\/get-running/);
  });

  test("mobile keyboard flow creates a usable password after joining", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const password = "E2eJoinedPassword!2";
    const invite = await seedInvite(emails.password, new Date(Date.now() + 30 * 86_400_000).toISOString());
    await openThroughExchange(page, baseURL!, invite.token, emails.password);
    const create = page.getByRole("button", { name: /Create a password/ });
    await create.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Set a password" })).toBeFocused();
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page.getByLabel("Confirm new password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(page.getByText(/password is ready/i)).toBeVisible();
    const { error } = await adminClient().auth.signInWithPassword({ email: emails.password, password });
    expect(error).toBeNull();
  });

  test("a delayed but unexpired database invitation still accepts", async ({ page, baseURL }) => {
    const invite = await seedInvite(emails.delayed, new Date(Date.now() + 60_000).toISOString());
    await openThroughExchange(page, baseURL!, invite.token, emails.delayed);
    await expect(page.getByRole("heading", { name: /You've joined/ })).toBeVisible();
  });

  test("expired invitation returns exact 410, then the real resend endpoint renews it for exchange and acceptance", async ({ page, baseURL }) => {
    const admin = adminClient();
    const invite = await seedInvite(emails.expired, new Date(Date.now() - 60_000).toISOString());
    let requestBody: unknown;
    await blockLocalAutoLogin(page);
    await page.route("**/functions/v1/exchange-invitation", async (route) => {
      requestBody = route.request().postDataJSON();
      await route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: "Invitation unavailable" }) });
    });
    await page.goto(`/accept-invite?token=${invite.token}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(/invitation is no longer available/i)).toBeVisible();
    expect(requestBody).toEqual({ token: invite.token, app_origin: expect.any(String) });

    const beforeResend = Date.now();
    const actor = publicClient();
    const { error: signInError } = await actor.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(signInError).toBeNull();
    const { error: resendError } = await actor.functions.invoke("resend-invitation", {
      body: { invitation_id: invite.id, app_origin: baseURL },
    });
    // The local stack has no outbound email provider. A 502 is therefore the expected
    // post-renewal delivery result; any authorization/validation/internal status is a
    // real endpoint failure. Hosted environments with delivery configured return 200.
    if (resendError) {
      const context = (resendError as { context?: unknown }).context;
      expect(context).toBeInstanceOf(Response);
      expect((context as Response).status).toBe(502);
    }

    const { data: renewedRow, error: renewedError } = await admin
      .from("org_invitations").select("expires_at").eq("id", invite.id).single();
    expect(renewedError).toBeNull();
    const days = (new Date(renewedRow!.expires_at).getTime() - beforeResend) / 86_400_000;
    expect(days).toBeGreaterThan(29.99);
    expect(days).toBeLessThanOrEqual(30.01);

    await page.unroute("**/functions/v1/exchange-invitation");
    const exchange = publicClient();
    const { data: exchangeData, error: exchangeError } = await exchange.functions.invoke("exchange-invitation", {
      body: { token: invite.token, app_origin: baseURL },
    });
    expect(exchangeError).toBeNull();
    const actionUrl = (exchangeData as { action_url?: string } | null)?.action_url;
    expect(actionUrl).toBeTruthy();

    // Local GoTrue's generated action-link navigation does not establish a browser
    // session reliably in this harness. Keep the resend and exchange boundaries real,
    // then use the suite's deterministic OTP session bridge to exercise the app's real
    // accept_invitation path with the renewed stable token kept out of the URL.
    const hash = await inviteSessionHash(emails.expired);
    await page.evaluate((token) => sessionStorage.setItem("showflow.pendingInvitationToken", token), invite.token);
    await page.goto(`${baseURL}/auth/callback?redirect=%2Faccept-invite#${hash}`);
    await expect(page.getByRole("heading", { name: /You've joined/ })).toBeVisible({ timeout: 20_000 });
  });

  test("a second immediate exchange shows the exact 429 retry contract", async ({ page }) => {
    const token = crypto.randomUUID();
    let calls = 0;
    await blockLocalAutoLogin(page);
    await page.route("**/functions/v1/exchange-invitation", async (route) => {
      calls += 1;
      await route.fulfill({
        status: 429,
        headers: { "Retry-After": "30" },
        contentType: "application/json",
        body: JSON.stringify({ error: "Please wait before trying again", retry_after_seconds: 30 }),
      });
    });
    await page.goto(`/accept-invite?token=${token}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Please wait a moment, then try again.")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => calls).toBe(2);
  });
});
