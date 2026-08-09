import { expect, test } from "@playwright/test";
import { seedConsent } from "./helpers/consent";

// The login page offers password AND a co-equal "email me a sign-in link" action.
// Following the emailed link is out of reach without a mailbox, so this spec stops at
// "request posted + generic toast shown" (the same boundary as reset-password.spec.ts).
// It asserts the locked co-equal layout and the existence-hiding request behavior.
test.describe("Login magic-link action", () => {
  test.beforeEach(async ({ page }) => { await seedConsent(page); });

  test("shows co-equal password + sign-in-link actions and posts the request", async ({ page }) => {
    await page.goto("/login");

    const signIn = page.getByRole("button", { name: /^sign in$/i });
    const emailLink = page.getByRole("button", { name: /email me a sign-in link/i });
    // Cold Vite dev server can compile the route on demand on the first navigation.
    await expect(signIn).toBeVisible({ timeout: 30_000 });
    await expect(emailLink).toBeVisible();
    // Co-equal layout: the "or" divider between the two buttons and Forgot password below both.
    await expect(page.getByText(/^or$/)).toBeVisible();
    await expect(page.getByRole("link", { name: /forgot password/i })).toBeVisible();

    // Intercept the edge-function request; the response does not matter (the toast is generic
    // either way), so this is robust even if the local edge runtime has not picked up the
    // brand-new function yet.
    const posted = page.waitForRequest(
      (r) => r.url().includes("/send-login-link") && r.method() === "POST",
      { timeout: 15_000 },
    );
    await page.getByLabel("Email").fill("e2e-magic-link@example.com");
    await emailLink.click();
    await posted;

    await expect(page.getByText(/if that email exists/i)).toBeVisible({ timeout: 15_000 });
  });
});
