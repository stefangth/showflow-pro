/**
 * Workspace type: an org admin changes the kind in Settings, Organization; the value
 * persists across a reload and is written to organizations.org_kind. Pins the bootstrap
 * org back to production afterwards so no other spec sees a staffing org.
 */
import { expect, test } from "@playwright/test";
import { adminClient } from "./helpers/supabase";
import { BOOTSTRAP_ORG_ID } from "./helpers/users";
import { loginAsAndAwaitDashboard, navViaSidebar } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from "./global-setup";

async function setKind(kind: "production" | "staffing"): Promise<void> {
  const { error } = await adminClient().from("organizations").update({ org_kind: kind, org_kind_set_at: null }).eq("id", BOOTSTRAP_ORG_ID);
  if (error) throw error;
}

test.describe.configure({ mode: "serial" });

test.describe("Workspace type", () => {
  test.beforeAll(async () => { await setKind("production"); });
  test.afterAll(async () => { await setKind("production"); });

  test("admin switches the org to staffing in Settings and it persists", async ({ page }) => {
    await seedConsent(page);
    await loginAsAndAwaitDashboard(page, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    await navViaSidebar(page, /^settings$/i);
    await page.getByRole("tab", { name: /^organization\b/i }).click();

    const picker = page.getByLabel(/workspace type/i);
    await expect(picker).toContainText(/live production/i);
    await picker.click();
    await page.getByRole("option", { name: /staffing agency/i }).click();
    await expect(page.getByText(/workspace type updated/i)).toBeVisible();

    await page.reload();
    await page.getByRole("tab", { name: /^organization\b/i }).click();
    await expect(page.getByLabel(/workspace type/i)).toContainText(/staffing agency/i);

    // The vocabulary follows the org: the sidebar now reads staffing nouns. The
    // Shifts link (bookings) can grow a trailing count badge, so tolerate one.
    await expect(page.getByRole("link", { name: /^people$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^shifts(\s+\d+)?$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^artists$/i })).toHaveCount(0);

    const { data } = await adminClient().from("organizations").select("org_kind, org_kind_set_at").eq("id", BOOTSTRAP_ORG_ID).single();
    expect(data?.org_kind).toBe("staffing");
    expect(data?.org_kind_set_at).not.toBeNull();
  });

  test("switching back restores the production vocabulary", async ({ page }) => {
    await seedConsent(page);
    await loginAsAndAwaitDashboard(page, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    await navViaSidebar(page, /^settings$/i);
    await page.getByRole("tab", { name: /^organization\b/i }).click();
    await page.getByLabel(/workspace type/i).click();
    await page.getByRole("option", { name: /live production/i }).click();
    await expect(page.getByText(/workspace type updated/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /^artists$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^dates(\s+\d+)?$/i })).toBeVisible();
  });
});
