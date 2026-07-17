/**
 * Per-org module entitlements: a super-admin turns the Booking flow module off
 * for an org from Platform > Organizations > Edit org, and that org's admin
 * immediately sees the Settings > Booking flow tab render locked (a "not
 * enabled" notice, disabled presets, no rail Save/Discard). Turning the module
 * back on restores the interactive editor.
 *
 * Reuses the bootstrap org (TEST_ADMIN_EMAIL is already one of its admins, per
 * global-setup.ts) rather than provisioning a fresh org, since the scenario
 * only needs an org + an admin of that org, not a new tenant. `org_entitlements`
 * is the DB oracle for the super-admin's write; the org admin's UI state is
 * asserted directly, mirroring platform-console.spec.ts's pattern of driving
 * both sides of a cross-role flow through the real UI in one test.
 *
 * The bootstrap org is shared by nearly every other e2e spec, several of which
 * assume Booking flow is entitled (e.g. booking-flow-presets.spec.ts calls
 * open-offer-tier against it). beforeAll/afterAll pin the entitlement back to
 * enabled so this spec never leaks a disabled module to the rest of the suite.
 */
import { expect, test } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { ensurePlatformAdmin, BOOTSTRAP_ORG_ID } from "./helpers/users";
import { loginAs, signOut, navViaSidebar } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from "./global-setup";

const SUPER_EMAIL = tagEmail("entitlements-super", "fixed");
const SUPER_PASSWORD = "E2eEntitlementsSuper!1";

/** Force the bootstrap org's booking_flow entitlement to a known value. */
async function setBookingFlowEntitlement(enabled: boolean): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("org_entitlements")
    .upsert({ org_id: BOOTSTRAP_ORG_ID, feature: "booking_flow", enabled }, { onConflict: "org_id,feature" });
  if (error) throw error;
}

test.describe.configure({ mode: "serial" });

test.describe("Org entitlements: Booking flow module toggle", () => {
  test.beforeAll(async () => {
    await ensurePlatformAdmin(SUPER_EMAIL, SUPER_PASSWORD);
    await setBookingFlowEntitlement(true);
  });

  test.afterAll(async () => {
    // Never leave the shared bootstrap org locked for the rest of the suite.
    await setBookingFlowEntitlement(true);
  });

  // Pre-decide cookie consent so the bottom-fixed CookieConsentBanner never
  // renders (it overlaps page-bottom controls and intercepts clicks). Matches
  // the other UI specs.
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("super-admin locks and unlocks the bootstrap org's Booking flow module", async ({ page }) => {
    const admin = adminClient();

    // --- Super-admin turns the module off from Platform > Organizations > Edit org ---
    await loginAs(page, SUPER_EMAIL, SUPER_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    await page.goto("/platform");
    await expect(page.getByRole("heading", { name: /platform console/i })).toBeVisible({ timeout: 15_000 });

    const orgRow = page.getByRole("row").filter({ hasText: "Bootstrap Org" });
    await expect(orgRow).toBeVisible({ timeout: 15_000 });
    await orgRow.getByRole("button", { name: /edit org/i }).click();

    const dialog = page.getByRole("dialog");
    const bookingSwitch = dialog.getByRole("switch", { name: "Booking flow" });
    await expect(bookingSwitch).toBeVisible({ timeout: 10_000 });
    await expect(bookingSwitch).toHaveAttribute("aria-checked", "true");

    await bookingSwitch.click();
    // The switch only reflects the toggle once the mutation's onSuccess invalidation
    // refetches entitlements, so this is a durable "the write landed" signal, not an
    // optimistic client-side flip.
    await expect(bookingSwitch).toHaveAttribute("aria-checked", "false", { timeout: 15_000 });

    await expect(async () => {
      const { data } = await admin
        .from("org_entitlements")
        .select("enabled")
        .eq("org_id", BOOTSTRAP_ORG_ID)
        .eq("feature", "booking_flow")
        .single();
      expect(data?.enabled).toBe(false);
    }).toPass({ timeout: 15_000 });

    // --- The org's admin sees the Booking flow tab render locked ---
    await signOut(page);
    await loginAs(page, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    await navViaSidebar(page, /^settings$/i);
    await page.getByRole("tab", { name: /booking flow/i }).click();

    await expect(page.getByText(/booking flow is not enabled/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Classic" })).toBeDisabled();
    // FlowRail renders no Save/Discard block at all while locked; when unlocked and
    // clean it would read exactly "Saved" (never "Save"), so this is unambiguous
    // against the always-present page-level Save button.
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toHaveCount(0);

    // --- Super-admin turns the module back on ---
    await signOut(page);
    await loginAs(page, SUPER_EMAIL, SUPER_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    await page.goto("/platform");
    await expect(page.getByRole("heading", { name: /platform console/i })).toBeVisible({ timeout: 15_000 });

    const orgRow2 = page.getByRole("row").filter({ hasText: "Bootstrap Org" });
    await expect(orgRow2).toBeVisible({ timeout: 15_000 });
    await orgRow2.getByRole("button", { name: /edit org/i }).click();

    const dialog2 = page.getByRole("dialog");
    const bookingSwitch2 = dialog2.getByRole("switch", { name: "Booking flow" });
    await expect(bookingSwitch2).toBeVisible({ timeout: 10_000 });
    await expect(bookingSwitch2).toHaveAttribute("aria-checked", "false");

    await bookingSwitch2.click();
    await expect(bookingSwitch2).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });

    await expect(async () => {
      const { data } = await admin
        .from("org_entitlements")
        .select("enabled")
        .eq("org_id", BOOTSTRAP_ORG_ID)
        .eq("feature", "booking_flow")
        .single();
      expect(data?.enabled).toBe(true);
    }).toPass({ timeout: 15_000 });

    // --- The org's admin sees the interactive editor again ---
    await signOut(page);
    await loginAs(page, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    await navViaSidebar(page, /^settings$/i);
    await page.getByRole("tab", { name: /booking flow/i }).click();

    await expect(page.getByText(/booking flow is not enabled/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Classic" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 15_000 });
  });
});
