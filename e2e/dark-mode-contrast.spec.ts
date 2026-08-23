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
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from "./global-setup";

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
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
    await forceDarkTheme(page);
    await loginAsAndAwaitDashboard(page, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
  });

  test("the Get running board and its expanded wizard pass color contrast", async ({ page }) => {
    await page.goto("/get-running");
    // Open a phase so the WizardShell (the component that carried the original
    // bug) is actually mounted and included in the audit. The hero card's
    // primary button is always present while the board is not complete.
    await page.getByRole("button", { name: /open this step/i }).click();
    await expect(page.getByRole("button", { name: /collapse/i }).first()).toBeVisible();
    await expectNoContrastViolations(page);
  });

  test("the dashboard passes color contrast", async ({ page }) => {
    await page.goto("/today");
    await expect(page.locator("main")).toBeVisible();
    await expectNoContrastViolations(page);
  });
});
