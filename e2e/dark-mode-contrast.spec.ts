/**
 * Dark-mode contrast backstop.
 *
 * The `eslint/ui-conventions.js` gate catches the static form of the dark-mode
 * contrast bug (a solid fixed-light accent background — `bg-accent-50/100/200` —
 * with mode-flipping text on the SAME className). What a static rule cannot see
 * is the NESTED form: a fixed-light background on a parent element and the
 * flipping text three levels down, or inherited from the body default. That is
 * exactly the shape that broke the `/get-running` wizard header (the band's
 * `bg-accent-50` on one element, the phase title's `text-foreground` on a child).
 *
 * This spec is the runtime net for that class: it forces dark mode, opens the
 * token-dense screens, and runs axe-core's `color-contrast` audit, which resolves
 * the EFFECTIVE background (walking the stack, honoring alpha) the way no grep can.
 * Scoped to `color-contrast` only, so it stays a contrast backstop and does not
 * turn into a general a11y suite.
 */
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { loginAsAndAwaitDashboard } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";
import { adminClient } from "./helpers/supabase";
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from "./global-setup";

const BOOTSTRAP_ORG_ID = "00000000-0000-0000-0000-00000000b007";
const V3_KEY = "getrunning_v3_enabled";

/**
 * The v3 board is the app default now, so it renders without any seeding. This still
 * writes an explicit `getrunning_v3_enabled = true` row so the board is pinned on
 * deterministically regardless of any org override present in the fixture, and to keep
 * the test self-documenting. `useGetRunningV3Enabled` prefers a per-org `app_settings`
 * row over the default. Removed again in `afterAll` so the org is left as it was found,
 * matching `hire-orders.spec.ts`.
 */
async function setV3Board(enabled: boolean): Promise<void> {
  const { error } = await adminClient()
    .from("app_settings")
    .upsert({ org_id: BOOTSTRAP_ORG_ID, key: V3_KEY, value: enabled }, { onConflict: "org_id,key" });
  if (error) throw error;
}

async function clearV3Board(): Promise<void> {
  await adminClient().from("app_settings").delete().eq("org_id", BOOTSTRAP_ORG_ID).eq("key", V3_KEY);
}

// Force next-themes to dark before the app mounts. next-themes reads this
// localStorage key (`attribute="class"`, default storageKey `theme`) on mount and
// stamps `.dark` on <html>; the emulated color scheme is a belt-and-suspenders
// second signal for `defaultTheme="system"` paths.
test.use({ colorScheme: "dark" });

async function forceDarkTheme(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("theme", "dark");
    } catch {
      /* localStorage unavailable — ignore */
    }
  });
}

/** Render a color-contrast violation list as a readable failure message. */
function summarize(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"],
): string {
  if (violations.length === 0) return "";
  return violations
    .flatMap((v) =>
      v.nodes.map(
        (n) =>
          `  [${v.id}] ${n.target.join(" ")}\n    ${(n.failureSummary ?? "")
            .split("\n")
            .filter(Boolean)
            .join(" | ")}`,
      ),
    )
    .join("\n");
}

async function expectNoContrastViolations(page: Page): Promise<void> {
  // Confirm dark mode is actually engaged before auditing — a light-mode scan
  // would pass vacuously and hide a regression.
  await expect(page.locator("html")).toHaveClass(/dark/);
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  expect(results.violations, `Dark-mode color-contrast violations:\n${summarize(results.violations)}`).toEqual([]);
}

test.describe("dark mode contrast", () => {
  test.beforeAll(async () => {
    await setV3Board(true);
  });

  test.afterAll(async () => {
    await clearV3Board();
  });

  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
    await forceDarkTheme(page);
    await loginAsAndAwaitDashboard(page, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
  });

  test("the Get running board and its expanded wizard pass color contrast", async ({ page }) => {
    await page.goto("/get-running");
    // Prove we are on the v3 board before auditing it: the v1 board renders entirely
    // different markup, and asserting on it would silently audit the wrong component
    // while still passing. This heading only exists on v3.
    await expect(page.getByRole("heading", { name: /^get running$/i })).toBeVisible();
    // Open a phase so the WizardShell (the component that carried the original bug) is
    // actually mounted and included in the audit. The hero card's primary action is
    // present while the board is not complete; if the board is complete there is no
    // wizard to audit, so fall through to auditing the retired board as rendered.
    const openStep = page.getByRole("button", { name: /open this step/i });
    if (await openStep.isVisible().catch(() => false)) {
      await openStep.click();
      await expect(page.getByRole("button", { name: /collapse/i }).first()).toBeVisible();
    }
    await expectNoContrastViolations(page);
  });

  test("the dashboard passes color contrast", async ({ page }) => {
    await page.goto("/today");
    await expect(page.locator("main")).toBeVisible();
    await expectNoContrastViolations(page);
  });
});
