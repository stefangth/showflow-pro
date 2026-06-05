import type { Page } from "@playwright/test";

/**
 * Pre-decide GDPR cookie consent so the bottom-fixed CookieConsentBanner never
 * renders (it overlaps page-bottom controls and intercepts Playwright clicks).
 * Registered via addInitScript so it applies to every navigation in the page.
 */
export async function seedConsent(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "showflow.consent.v1",
        JSON.stringify({
          version: 1,
          hasDecided: true,
          choices: { analytics: false, sessionReplay: false, errorTracking: false },
        }),
      );
    } catch {
      /* localStorage unavailable — ignore */
    }
  });
}
