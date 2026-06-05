import { expect, test } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { ensureUserWithRole, deleteUserByEmail, findUserByEmail, BOOTSTRAP_ORG_ID } from "./helpers/users";
import { loginAsAndAwaitDashboard } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";

const ADMIN_EMAIL = tagEmail("phase5-rmadmin", "fixed");
const ADMIN_PASSWORD = "E2eRmAdmin!1";
const MEMBER_EMAIL = tagEmail("phase5-rmmember", "fixed");
const MEMBER_PASSWORD = "E2eRmMember!1";

test.describe.configure({ mode: "serial" });

test.describe("Member removal", () => {
  test.beforeEach(async ({ page }) => { await seedConsent(page); });
  test.beforeAll(async () => {
    await ensureUserWithRole(ADMIN_EMAIL, ADMIN_PASSWORD, "admin");
    await ensureUserWithRole(MEMBER_EMAIL, MEMBER_PASSWORD, "producer");
  });
  test.afterAll(async () => {
    await deleteUserByEmail(ADMIN_EMAIL);
    await deleteUserByEmail(MEMBER_EMAIL);
  });

  test("admin removes a member via the Members tab (DB is the oracle)", async ({ page }) => {
    const member = await findUserByEmail(MEMBER_EMAIL);
    await loginAsAndAwaitDashboard(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/admin?tab=members");

    // The member has no display name, so MembersTab shows the email on both the name and
    // sub-text lines — match the first.
    await expect(page.getByText(MEMBER_EMAIL).first()).toBeVisible({ timeout: 15_000 });
    // The shared bootstrap org has many members, so scope the Remove click to the member's
    // own row (grandparent of the email text), then confirm in the dialog.
    await page.getByText(MEMBER_EMAIL).first().locator("xpath=../..").getByRole("button", { name: /^remove$/i }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: /^remove$/i }).click(); // AlertDialog confirm

    await expect(async () => {
      const { count } = await adminClient()
        .from("org_memberships")
        .select("*", { count: "exact", head: true })
        .eq("org_id", BOOTSTRAP_ORG_ID)
        .eq("user_id", member!.id);
      expect(count ?? 0).toBe(0);
    }).toPass({ timeout: 15_000 });
  });
});
