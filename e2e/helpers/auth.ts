/**
 * UI auth helpers for E2E tests. Use the email/password form on the login page —
 * Google OAuth is not scriptable in CI.
 */
import { expect, type Page } from "@playwright/test";

export async function loginAs(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

export async function loginAsAndAwaitDashboard(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await loginAs(page, email, password);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

export async function signOut(page: Page): Promise<void> {
  // Sign out is in the avatar menu in AppLayout; if not present, clear session via storage.
  await page.context().clearCookies();
  await page.goto("/login");
}
