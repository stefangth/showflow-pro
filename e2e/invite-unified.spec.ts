import { expect, test } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { ensureUserWithRole, deleteUserByEmail, findUserByEmail, BOOTSTRAP_ORG_ID } from "./helpers/users";
import { loginAsAndAwaitDashboard, loginAs } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";

const ADMIN_EMAIL = tagEmail("phase5-invadmin", "fixed");
const ADMIN_PASSWORD = "E2eInvAdmin!1";
const stamp = Date.now();
const NEW_INVITEE = tagEmail("phase5-newinvitee", stamp);
const INVITEE_PASSWORD = "E2eInvitee!1";

test.describe.configure({ mode: "serial" });

test.describe("Unified invite — net-new invitee", () => {
  test.beforeEach(async ({ page }) => { await seedConsent(page); });
  test.beforeAll(async () => {
    await ensureUserWithRole(ADMIN_EMAIL, ADMIN_PASSWORD, "admin");
    await deleteUserByEmail(NEW_INVITEE); // ensure truly net-new
  });
  test.afterAll(async () => {
    const admin = adminClient();
    await admin.from("org_invitations").delete().eq("email", NEW_INVITEE);
    await deleteUserByEmail(NEW_INVITEE);
    await deleteUserByEmail(ADMIN_EMAIL);
  });

  test("org admin invites a net-new email → account is bootstrapped → invitee accepts", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin?tab=invites");
    await page.getByPlaceholder("invitee@email.com").fill(NEW_INVITEE);
    await page.getByRole("button", { name: /^invite$/i }).click();
    await expect(page.getByText(/invitation sent/i)).toBeVisible({ timeout: 15_000 });

    // The unified flow created an auth account for the net-new invitee (the Phase-5 fix).
    await expect(async () => {
      const u = await findUserByEmail(NEW_INVITEE);
      expect(u).not.toBeNull();
    }).toPass({ timeout: 15_000 });

    // Read the pending token; set a known password (stands in for the action-link set-password step).
    const admin = adminClient();
    const { data: invite } = await admin
      .from("org_invitations").select("token").eq("email", NEW_INVITEE).eq("status", "pending").single();
    expect(invite?.token).toBeTruthy();
    const u = await findUserByEmail(NEW_INVITEE);
    // generateLink('invite') leaves the email unconfirmed (production confirms it via the
    // action-link click, which this test shortcuts); confirm it so signInWithPassword works.
    await admin.auth.admin.updateUserById(u!.id, { password: INVITEE_PASSWORD, email_confirm: true });

    // Invitee authenticates and accepts.
    await page.context().clearCookies();
    await loginAs(page, NEW_INVITEE, INVITEE_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    await page.goto(`/accept-invite?token=${invite!.token}`);

    await expect(async () => {
      const { count } = await admin
        .from("org_memberships")
        .select("*", { count: "exact", head: true })
        .eq("org_id", BOOTSTRAP_ORG_ID)
        .eq("user_id", u!.id);
      expect(count ?? 0).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });
  });
});
