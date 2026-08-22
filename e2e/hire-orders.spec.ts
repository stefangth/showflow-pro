/**
 * Hire orders: end-to-end happy path (producer issues, artist downloads).
 *
 * The `hire_orders` module ships DARK (defaultEnabled:false in the entitlements
 * registry), so this spec first turns it ON for the bootstrap org, then drives
 * the two roles through the real UI:
 *
 *   1. Producer opens the date sheet for a date with a confirmed booking, uses
 *      the hire-orders card's "Generate hire orders" button to create a DRAFT,
 *      opens the review dialog, sets an engagement fee, and issues the order.
 *      The edge function renders the PDF, uploads it, and stamps the order
 *      `issued`.
 *   2. Artist signs in, sees the dashboard "Your contracts" card listing that
 *      issued order, and downloads it. The test captures the signed URL the
 *      download-url action returns and asserts it responds 200 with
 *      `content-type: application/pdf`, the concrete "the artist can get the
 *      PDF" guarantee.
 *
 * SCOPE: deterministic draft, not the fully-filled auto-draft trigger.
 * The auto-draft path (a date reaching `fully_filled` dispatches a draft via
 * `net.http_post`) is deliberately NOT exercised here. Two reasons:
 *   - The CI E2E harness runs against a LOCAL Supabase stack, but the dispatch
 *     trigger's `net.http_post` targets the hardcoded LIVE function URL
 *     (`epweartpzwvcasrzyueh…`, see 20260717161030_fully_filled_hire_order_dispatch.sql),
 *     so it can never create a draft row in the local DB; the async step is
 *     unobservable in this environment (and pg_net timing would be flaky even
 *     if it could).
 *   - The trigger itself is covered by Task 9's pgTAP, which observes
 *     `net.http_request_queue` directly without needing the request to land.
 * Driving the producer's "Generate hire orders" button instead reaches the same
 * draft state deterministically (awaitable UI mutation), keeping this test
 * reliable while still asserting the artist download of a genuinely issued PDF.
 *
 * A CONFIRMED booking is seeded directly (admin client) rather than driven
 * through the offer→accept→confirm UI: that lifecycle is already covered by
 * booking-lifecycle.spec.ts / booking-flow-presets.spec.ts, and the code under
 * test here is the hire-order engine, not booking confirmation. The seeded date
 * hangs off the shared `${E2E_TAG}-program` fixture so cleanupBookingFixture
 * tears it down; hire_orders rows (FK ON DELETE SET NULL, so they'd survive the
 * graph teardown as orphans) are deleted explicitly first. beforeAll/afterAll
 * pin `hire_orders` back to its dark default so this spec never leaks an enabled
 * module (or seeded settings) to the rest of the suite.
 */
import { expect, test } from "@playwright/test";
import { adminClient, tagEmail } from "./helpers/supabase";
import { BOOTSTRAP_ORG_ID, deleteUserByEmail } from "./helpers/users";
import { loginAsAndAwaitDashboard, navViaSidebar } from "./helpers/auth";
import { openBookingsDate } from "./helpers/bookingsUi";
import { seedConsent } from "./helpers/consent";
import {
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_PRODUCER_EMAIL,
  TEST_PRODUCER_PASSWORD,
} from "./global-setup";
import {
  cleanupBookingFixture,
  seedBookingFixture,
  type BookingFixture,
} from "./helpers/booking";

const ARTIST_EMAIL = tagEmail("artist-hire-orders", Date.now());
const ARTIST_PASSWORD = "E2eHireOrdersArtist!1";

/** Fixed date for the fixture's show_date so the producer can target its /bookings row. */
function isoDays(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
const DATE_ISO = isoDays(37);

let fixture: BookingFixture;

/** Force the bootstrap org's hire_orders entitlement to a known value. */
async function setHireOrdersEntitlement(enabled: boolean): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("org_entitlements")
    .upsert({ org_id: BOOTSTRAP_ORG_ID, feature: "hire_orders", enabled }, { onConflict: "org_id,feature" });
  if (error) throw error;
}

/** Delete the entitlement row so hire_orders reverts to its dark registry default (false). */
async function clearHireOrdersEntitlement(): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("org_entitlements")
    .delete()
    .match({ org_id: BOOTSTRAP_ORG_ID, feature: "hire_orders" });
  if (error) throw error;
}

/**
 * Seed the org settings an order needs to be ISSUABLE: a letterhead with a legal
 * name (the readiness gate's `missing_letterhead`) and a non-empty `standard`
 * terms variant (the issue-time `missing_terms` gate). hire_orders ships with
 * both empty, so without this the issue action would fail closed.
 */
async function seedHireOrderSettings(): Promise<void> {
  const admin = adminClient();
  const rows = [
    {
      org_id: BOOTSTRAP_ORG_ID,
      key: "hire_order_letterhead",
      value: { legal_name: "E2E Productions Ltd", address_lines: ["1 Test Street", "Berlin"] },
    },
    {
      org_id: BOOTSTRAP_ORG_ID,
      key: "hire_order_terms",
      value: {
        lean: [],
        standard: [{ title: "Engagement", body: "The artist agrees to perform on the date shown." }],
        full: [],
      },
    },
  ];
  const { error } = await admin.from("app_settings").upsert(rows, { onConflict: "org_id,key" });
  if (error) throw error;
}

/** Remove the seeded hire-order app_settings so the org is left as it was found. */
async function clearHireOrderSettings(): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("app_settings")
    .delete()
    .eq("org_id", BOOTSTRAP_ORG_ID)
    .in("key", ["hire_order_letterhead", "hire_order_terms"]);
  if (error) throw error;
}

/**
 * Insert a CONFIRMED booking for the fixture's artist on the fixture's date.
 * Direct-to-confirmed INSERT is legal (the booking transition guard is BEFORE
 * UPDATE only; the direct-book UI does the same), and org consistency is
 * satisfied because both artist and show_date live in the bootstrap org.
 */
async function seedConfirmedBooking(): Promise<void> {
  const admin = adminClient();
  const { error } = await admin.from("bookings").insert({
    org_id: BOOTSTRAP_ORG_ID,
    artist_id: fixture.artistId,
    show_date_id: fixture.showDateId,
    status: "confirmed",
    confirmed_at: new Date().toISOString(),
  });
  if (error) throw new Error(`seed confirmed booking failed: ${error.message}`);
}

interface HireOrderProbe {
  id: string;
  order_no: string;
  status: string;
  pdf_path: string | null;
  artist_id: string | null;
}

/** Newest hire order for a show date (ground-truth oracle behind the UI). */
async function getHireOrderForDate(showDateId: string): Promise<HireOrderProbe | null> {
  const admin = adminClient();
  const { data } = await admin
    .from("hire_orders")
    .select("id, order_no, status, pdf_path, artist_id")
    .eq("show_date_id", showDateId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as HireOrderProbe | null) ?? null;
}

/**
 * Delete every hire order created for the run's artist, plus its stored PDF.
 * MUST run before cleanupBookingFixture: hire_orders' booking/artist/show_date
 * FKs are ON DELETE SET NULL, so tearing the graph down first would orphan these
 * rows (org_id still points at the bootstrap org) instead of removing them.
 */
async function cleanupHireOrders(artistId: string): Promise<void> {
  const admin = adminClient();
  const { data: rows } = await admin.from("hire_orders").select("id, pdf_path").eq("artist_id", artistId);
  const paths = (rows ?? [])
    .map((r) => (r as { pdf_path: string | null }).pdf_path)
    .filter((p): p is string => !!p);
  if (paths.length > 0) await admin.storage.from("hire-orders").remove(paths);
  await admin.from("hire_orders").delete().eq("artist_id", artistId);
}

test.describe.configure({ mode: "serial" });

test.describe("Hire orders: producer issues, artist downloads", () => {
  test.beforeAll(async () => {
    await deleteUserByEmail(ARTIST_EMAIL);
    fixture = await seedBookingFixture({
      artistEmail: ARTIST_EMAIL,
      artistPassword: ARTIST_PASSWORD,
      dateISO: DATE_ISO,
    });
    await setHireOrdersEntitlement(true);
    await seedHireOrderSettings();
    await seedConfirmedBooking();
  });

  test.afterAll(async () => {
    // Orders (+ PDFs) first, before the graph teardown nulls their FKs.
    await cleanupHireOrders(fixture.artistId);
    await cleanupBookingFixture();
    await clearHireOrderSettings();
    // Never leave the shared bootstrap org with hire_orders enabled; it ships dark.
    await clearHireOrdersEntitlement();
    await deleteUserByEmail(ARTIST_EMAIL);
  });

  // Pre-decide cookie consent so the bottom-fixed CookieConsentBanner never
  // renders (it overlaps page-bottom controls and intercepts clicks). Matches
  // the other UI specs.
  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("producer generates a draft, sets a fee, and issues the hire order", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD);
    await navViaSidebar(page, /^dates$/i);

    // Open THIS date's sheet via the calendar surface (every e2e date hangs off
    // the same seeded show, so target by show_date id).
    await openBookingsDate(page, { showDateId: fixture.showDateId, dateISO: DATE_ISO });

    // Cockpit: the hire-orders card (with its Generate banner) is under the "Contract" tab.
    await page.getByRole("dialog").getByRole("button", { name: /^contract$/i }).click();

    // The hire-orders card shows a "Generate hire order" banner because there is
    // a confirmed booking with no active order yet. Clicking it drafts one order
    // (the draft action is idempotent per booking, so a re-click is a no-op), which
    // then renders a "Review and issue" button. Retry the click until that durable
    // signal lands, mirroring the other specs' toPass idiom. Scope to the open sheet
    // dialog (so the bookings table's per-row Generate button behind the overlay is
    // excluded) and take the first match, since a fully-filled date can show both the
    // sheet's top CTA and the card banner (both draft the same single-date order).
    const generateBtn = page
      .getByRole("dialog")
      .getByRole("button", { name: /generate contract/i })
      .first();
    const reviewBtn = page.getByRole("button", { name: /review and issue/i });
    await expect(generateBtn).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      if ((await generateBtn.isVisible()) && (await generateBtn.isEnabled())) {
        await generateBtn.click();
      }
      await expect(reviewBtn).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    // Open the review dialog and set an engagement fee (v1 is fee-only). The dialog
    // mounts its content after the click, so retry the open until the fee input is
    // present (guarding on it not being visible means we only click while closed).
    const feeInput = page.locator("#hire-order-fee");
    await expect(async () => {
      if (!(await feeInput.isVisible())) {
        await reviewBtn.click();
      }
      await expect(feeInput).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await feeInput.fill("1500");

    // Issue and send. The terms variant defaults to "standard" (seeded above), the
    // recipient email + date come from the snapshot, and the letterhead has a legal
    // name, so the readiness + terms gates pass and the order is issued. On success
    // the dialog closes, so wait on the Issue button disappearing rather than the
    // transient sonner toast. Guarding the re-click on visible+enabled means we never
    // double-fire once the (idempotent) issue lands.
    const issueBtn = page.getByRole("button", { name: /issue and send/i });
    await expect(issueBtn).toBeVisible({ timeout: 10_000 });
    await expect(async () => {
      if ((await issueBtn.isVisible()) && (await issueBtn.isEnabled())) {
        await issueBtn.click();
      }
      await expect(issueBtn).toBeHidden({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    // The producer card's row now shows the issued status. Scope to the open sheet
    // dialog: the bookings table behind it now also shows the order's status chip in
    // the per-row hire-order cell, so an unscoped match is ambiguous (two badges).
    await expect(
      page.getByRole("dialog").getByText(/awaiting countersign/i),
    ).toBeVisible({ timeout: 15_000 });

    // Ground-truth: the order is persisted as issued with an uploaded PDF path.
    await expect(async () => {
      const order = await getHireOrderForDate(fixture.showDateId);
      expect(order?.status).toBe("issued");
      expect(order?.pdf_path).toBeTruthy();
    }).toPass({ timeout: 15_000 });
  });

  test("the artist sees their issued hire order and downloads a PDF", async ({ page }) => {
    // Neutralize window.open: the card's Download handler opens the signed URL in a
    // new tab, which would spawn a popup / download that can destabilize the run. We
    // assert the signed URL from the download-url response instead of the popup.
    await page.addInitScript(() => {
      (window as unknown as { open: () => null }).open = () => null;
    });

    await loginAsAndAwaitDashboard(page, ARTIST_EMAIL, ARTIST_PASSWORD);

    // The dashboard "Your contracts" card lists the issued order.
    await expect(page.getByText("Your contracts")).toBeVisible({ timeout: 15_000 });
    const order = await getHireOrderForDate(fixture.showDateId);
    expect(order?.order_no).toBeTruthy();
    await expect(page.getByText(order!.order_no)).toBeVisible({ timeout: 15_000 });

    // Click Download and capture the download-url edge response (the app's supabase
    // client sends the artist's JWT, so this is the real artist-authorized path).
    const downloadBtn = page.getByRole("button", { name: /download/i }).first();
    await expect(downloadBtn).toBeVisible({ timeout: 15_000 });
    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/functions/v1/generate-hire-orders") &&
          r.request().method() === "POST",
        { timeout: 20_000 },
      ),
      downloadBtn.click(),
    ]);
    expect(resp.ok()).toBeTruthy();
    const payload = (await resp.json()) as { url?: string };
    expect(payload.url).toBeTruthy();

    // The signed URL must serve the actual PDF: 200 + application/pdf, non-empty body.
    // The edge function runs inside the Docker network and signs URLs with its internal
    // Supabase host (kong:8000), which the host-side Playwright runner cannot resolve.
    // Rewrite the origin to the host-reachable Supabase URL; the path and signed token
    // stay valid, so this still fetches the real stored PDF.
    const hostBase = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    if (!hostBase) throw new Error("E2E: SUPABASE_URL is required to reach storage");
    const signed = new URL(payload.url!);
    const base = new URL(hostBase);
    signed.protocol = base.protocol;
    signed.host = base.host; // host includes the port
    const pdf = await page.request.get(signed.toString());
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect((await pdf.body()).byteLength).toBeGreaterThan(0);
  });
});

/**
 * The PDF template editor: Settings > Hire orders > PDF template opens a
 * three-pane workspace (TemplateEditorPage) over the SAME hire_order_theme /
 * hire_order_copy org settings the old PdfCopyCard used to edit directly.
 * This spec enters through the real UI entry point (the PdfTemplateCard's
 * "Open template editor" link, not a direct `page.goto`), changes a
 * document-wide control and a per-role control, saves, then leaves and
 * re-enters the editor via the same UI path to prove the change round-tripped
 * through `app_settings` rather than only living in React state.
 *
 * A separate `test.describe` (own beforeAll/afterAll) rather than folding
 * into the block above: this exercises the settings surface, not the
 * producer/artist issue-and-download lifecycle, and the file's top-level
 * `test.describe.configure({ mode: "serial" })` already guarantees this runs
 * strictly after that block's afterAll has cleared the entitlement, so there
 * is no race re-enabling it here.
 */
test.describe("Hire orders: PDF template editor", () => {
  test.beforeAll(async () => {
    await setHireOrdersEntitlement(true);
  });

  test.afterAll(async () => {
    // Leave no stray hire_order_theme override behind for later specs/runs.
    const admin = adminClient();
    const { error } = await admin
      .from("app_settings")
      .delete()
      .eq("org_id", BOOTSTRAP_ORG_ID)
      .eq("key", "hire_order_theme");
    if (error) throw error;
    await clearHireOrdersEntitlement();
  });

  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("admin can retheme the hire order PDF", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    await navViaSidebar(page, /^settings$/i);
    // The tab's accessible name carries its module-state badge inline
    // ("Contracts On"/"Contracts Off" — see SettingsPage.tsx's TabsTrigger), so
    // match the prefix rather than the exact label.
    await page.getByRole("tab", { name: /^contracts\b/i }).click();

    // Enter via the card this task ships, not a deep link, so the spec also
    // proves PdfTemplateCard actually wires up to the editor route.
    await page.getByRole("link", { name: "Open template editor" }).click();
    await expect(page).toHaveURL(/\/settings\/contracts\/template$/);
    await expect(page.getByRole("navigation", { name: "Document outline" })).toBeVisible();

    // Document pane: nudge the whole-document text scale. This control is a
    // Radix Slider (an ARIA role="slider" span backed by a visually-hidden
    // bubble <input> that only exists to make the value participate in form
    // submission) rather than a real <input>, so `.fill()` does not apply to
    // it - drive it with arrow keys instead. Six ArrowRight presses at the
    // slider's 0.05 step land exactly on 1.30 (rendered as "130%"), which
    // doubles as a precise, non-flaky assertion that the control responded.
    await page.getByRole("button", { name: "Document" }).click();
    const scaleSlider = page.getByRole("slider", { name: "Text size" });
    await scaleSlider.focus();
    for (let i = 0; i < 6; i++) {
      await scaleSlider.press("ArrowRight");
    }
    await expect(page.getByText("130%")).toBeVisible();
    await expect(page.getByTitle("Contract preview")).toBeVisible();

    // Section heading: a real number <input>, so `.fill()` is correct here.
    await page.getByRole("button", { name: "Section heading" }).click();
    await page.getByLabel("Size").fill("18");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("PDF template saved")).toBeVisible();

    // Leave the editor and come back through the same UI path (rather than
    // page.reload(), which would re-run the ProtectedRoute role check against
    // a freshly-mounted AuthContext and risks the async-role-load race
    // navViaSidebar's own comment describes) - this still forces a genuine
    // remount of TemplateEditorPage, so the values shown below can only have
    // come from the org's persisted `hire_order_theme` setting.
    // Scoped to main: the sidebar also has a "Settings" link, so an unscoped
    // getByRole is a strict-mode violation. The editor's own back-link is the
    // one this step means, and clicking it exercises the real return path.
    await page.getByRole("main").getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole("tab", { name: /^contracts\b/i }).click();
    await page.getByRole("link", { name: "Open template editor" }).click();
    await expect(page.getByRole("navigation", { name: "Document outline" })).toBeVisible();

    await page.getByRole("button", { name: /Section heading, modified/ }).click();
    await expect(page.getByLabel("Size")).toHaveValue("18");
  });
});
