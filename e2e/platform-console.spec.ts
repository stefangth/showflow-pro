/**
 * Platform console (Phase 4): super-admin-only access, provision → invite → accept,
 * and suspend/reactivate. DB is the source of truth (adminClient); UI drives the actions.
 */
import { expect, test } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { createConfirmedUser, deleteUserByEmail, ensurePlatformAdmin } from "./helpers/users";
import { loginAs, loginAsAndAwaitDashboard, navViaSidebar, signOut } from "./helpers/auth";
import { TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD } from "./global-setup";

const SUPER_EMAIL = tagEmail("phase4-super", "fixed");
const SUPER_PASSWORD = "E2ePlatformSuper!1";
const stamp = Date.now();
const NEW_ORG_SLUG = `e2e-org-${stamp}`;
const NEW_ORG_NAME = `E2E Org ${stamp}`;
const INVITEE_EMAIL = tagEmail("phase4-admin", stamp);
const INVITEE_PASSWORD = "E2ePlatformInvitee!1";

test.describe.configure({ mode: "serial" });

test.describe("Platform console", () => {
  test.beforeAll(async () => {
    await ensurePlatformAdmin(SUPER_EMAIL, SUPER_PASSWORD);
    // Pre-create the invitee so provision-org takes the existing-user path (deterministic).
    await deleteUserByEmail(INVITEE_EMAIL);
    await createConfirmedUser(INVITEE_EMAIL, INVITEE_PASSWORD);
  });

  test.afterAll(async () => {
    const admin = adminClient();
    await admin.from("organizations").delete().eq("slug", NEW_ORG_SLUG);
    await deleteUserByEmail(INVITEE_EMAIL);
  });

  test("non-super-admin cannot reach /platform", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD);
    await expect(page.getByRole("link", { name: /platform/i })).toHaveCount(0);
    await page.goto("/platform");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test("super-admin provisions an org, then the invitee accepts and lands in it", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, SUPER_EMAIL, SUPER_PASSWORD);
    await navViaSidebar(page, /platform/i);

    await page.getByRole("button", { name: /new organization/i }).click();
    await page.getByLabel("Name").fill(NEW_ORG_NAME);
    await page.getByLabel("Slug").fill(NEW_ORG_SLUG);
    await page.getByLabel("First admin email").fill(INVITEE_EMAIL);
    await page.getByRole("button", { name: /^create$/i }).click();

    // Org appears in the table.
    await expect(page.getByText(NEW_ORG_SLUG)).toBeVisible({ timeout: 15_000 });

    // Read the org + its pending invitation token from the DB.
    const admin = adminClient();
    const { data: org } = await admin.from("organizations").select("id").eq("slug", NEW_ORG_SLUG).single();
    expect(org?.id).toBeTruthy();
    const { data: invite } = await admin
      .from("org_invitations").select("token").eq("org_id", org!.id).eq("status", "pending").single();
    expect(invite?.token).toBeTruthy();

    // Invitee logs in and accepts via the token link.
    await signOut(page);
    await loginAs(page, INVITEE_EMAIL, INVITEE_PASSWORD);
    await page.goto(`/accept-invite?token=${invite!.token}`);
    const acceptBtn = page.getByRole("button", { name: /accept|join/i });
    if (await acceptBtn.isVisible().catch(() => false)) await acceptBtn.click();

    // Membership exists (DB is the oracle).
    await expect(async () => {
      const { count } = await admin
        .from("org_memberships")
        .select("*", { count: "exact", head: true })
        .eq("org_id", org!.id);
      expect(count ?? 0).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });
  });

  test("super-admin can suspend and reactivate an org", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, SUPER_EMAIL, SUPER_PASSWORD);
    await navViaSidebar(page, /platform/i);
    const admin = adminClient();

    const row = page.getByRole("row", { name: new RegExp(NEW_ORG_SLUG) });
    await row.getByRole("button", { name: /suspend/i }).click();
    await expect(async () => {
      const { data } = await admin.from("organizations").select("status").eq("slug", NEW_ORG_SLUG).single();
      expect(data?.status).toBe("suspended");
    }).toPass({ timeout: 15_000 });

    await row.getByRole("button", { name: /reactivate/i }).click();
    await expect(async () => {
      const { data } = await admin.from("organizations").select("status").eq("slug", NEW_ORG_SLUG).single();
      expect(data?.status).toBe("active");
    }).toPass({ timeout: 15_000 });
  });
});
