// Visual-diff screenshot pipeline for the Show Date Cockpit.
// Captures the design reference (public/ref/cockpit.html) and the live app
// harness (/dev/cockpit) in matching states, so they can be compared 1:1.
//
//   node scripts/shoot-cockpit.mjs
//
// Requires the dev server on :8080 and Playwright chromium installed.
//
// The reference under public/ref/ is DEV-ONLY and gitignored (it embeds the
// design prototype + a copy of React UMD and must never ship in public/). It is
// not present in a fresh checkout — regenerate it before running this pipeline:
//   1. Save the design project's "Show Date Cockpit - Prototype.dc.html" +
//      "support.js" locally.
//   2. mkdir -p public/ref/assets and public/ref/_ds/<design-system-id>/
//   3. Copy support.js and node_modules/react{,-dom}/umd/*.production.min.js
//      into public/ref/, mirror src/index.css :root tokens into the DS
//      colors_and_type.css, drop an icon sprite in assets/icons.svg, and wrap
//      the prototype's <head> to load ./react.js, ./react-dom.js, ./support.js.
// (Ask the assistant to re-run the scaffold — it has the exact recipe.)
// `@playwright/test` re-exports the same launchers and is the package listed in
// package.json (the bare `playwright` package is only a transitive dep).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "screenshots");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const VIEWPORT = { width: 1160, height: 1500 };

const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  console.log("  ▸", name);
};

const main = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  // Pre-decide cookie consent so the bottom banner never renders over the shots.
  await page.addInitScript(() => {
    localStorage.setItem(
      "showflow.consent.v1",
      JSON.stringify({ version: 1, hasDecided: true, choices: { analytics: false, sessionReplay: false, errorTracking: false } }),
    );
  });

  // ---- Reference (interactive prototype; click tabs to switch panels) ----
  console.log("reference:");
  await page.goto(`${BASE}/ref/cockpit.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600); // fonts + DC runtime render
  await shot(page, "ref-cast");
  await page.getByRole("button", { name: "Offers", exact: true }).click().catch(() => {});
  await page.waitForTimeout(200);
  await shot(page, "ref-offers");

  // ---- Live app harness (URL-driven states) ----
  console.log("app:");
  for (const state of ["cast", "offers", "order", "chat", "setup"]) {
    await page.goto(`${BASE}/dev/cockpit?tab=${state}&flow=classic`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await shot(page, `app-${state}`);
  }

  // Row peek (the off-screen-overflow regression)
  await page.goto(`${BASE}/dev/cockpit?peek=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await shot(page, "app-peek");

  // Dark mode + narrow
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${BASE}/dev/cockpit?tab=cast&flow=classic`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await shot(page, "app-cast-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 760, height: 1500 });
  await page.goto(`${BASE}/dev/cockpit?tab=cast&flow=classic`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await shot(page, "app-cast-narrow");

  await browser.close();
  console.log("done →", OUT);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
