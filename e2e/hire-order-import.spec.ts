/**
 * Hire orders: spreadsheet import wizard, end to end.
 *
 * The `hire_orders` module ships DARK (defaultEnabled:false in the entitlements
 * registry), so this spec first turns it ON for the bootstrap org (mirrors
 * hire-orders.spec.ts) and pins it back to dark in afterAll so the suite never
 * leaks an enabled module to the rest of the run.
 *
 * FIXTURE: e2e/fixtures/hire-orders.xlsx, 3 data rows under headers
 * `Artist, Email, Date, Venue, City, Fee` (every header `guessOrderMapping`
 * strong-matches, so the Map step prefills without any manual override):
 *
 *   Row 1 (row index 2 — the header is row 1): a CLEAN match. Artist/Email
 *     match a seeded catalog artist exactly, the date ("20.06.2099", dd.mm.yyyy)
 *     parses and matches exactly one seeded show_date, and the fee is present
 *     -> resolves "ready" with no manual work.
 *   Row 2 (row index 3): an UNKNOWN artist. Name/email match no catalog
 *     artist -> "attention" with `unknown_artist`. Its date/fee are otherwise
 *     valid (same date as row 1) so linking it in Resolve is the only fix
 *     needed to flip it to "ready".
 *   Row 3 (row index 4): a BAD date ("not-a-real-date", unparseable). Its
 *     artist/email match the SAME seeded artist used to link row 2 (a
 *     realistic "otherwise-matchable" row) so no Resolve step entry is needed
 *     for it -> "attention" with `unparseable_date` only, fixed inline in
 *     Review by typing a valid date.
 *
 * Regenerate the fixture with:
 *   node -e "
 *   const XLSX = require('xlsx');
 *   const rows = [
 *     ['Artist', 'Email', 'Date', 'Venue', 'City', 'Fee'],
 *     ['E2E Import Clean Artist', 'e2e-hireimport-clean@showflowpro.test', '20.06.2099', '', '', '1500'],
 *     ['E2E Import Ghost Artist', 'e2e-hireimport-ghost@showflowpro.test', '20.06.2099', '', '', '1200'],
 *     ['E2E Import LinkTarget Artist', 'e2e-hireimport-linktarget@showflowpro.test', 'not-a-real-date', '', '', '1800'],
 *   ];
 *   const ws = XLSX.utils.aoa_to_sheet(rows);
 *   const wb = XLSX.utils.book_new();
 *   XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
 *   XLSX.writeFile(wb, 'e2e/fixtures/hire-orders.xlsx');
 *   "
 * (run from the repo root, where the `xlsx` dependency already lives in
 * node_modules — same package the app itself uses to parse .xlsx uploads).
 *
 * SEEDING: two show_dates (SHOW_DATE_A on the fixture's 2099-06-20, matched by
 * rows 1+2; SHOW_DATE_B on 2099-07-15, never in the file — only typed into
 * row 3's Review date fix) hung off a dedicated e2e-tagged show, plus two
 * catalog artists (the clean-match artist for row 1, and a distinct existing
 * artist that both links row 2 AND directly matches row 3's own Artist/Email
 * cells). Row 2's "Ghost" artist is deliberately never seeded -- it must stay
 * unmatched so Resolve has something to link. Using far-future, fixed
 * (non-relative) dates keeps the fixture file static (no per-run date churn)
 * while remaining vanishingly unlikely to collide with any other seeded
 * show_date in the shared bootstrap org.
 *
 * Import creates DRAFT orders only (never issues), so unlike hire-orders.spec.ts
 * this spec does not need to seed hire_order_letterhead/terms -- those gates
 * only apply to issuing.
 */
import path from "node:path";
import { expect, test } from "@playwright/test";
import { adminClient, E2E_TAG } from "./helpers/supabase";
import { BOOTSTRAP_ORG_ID } from "./helpers/users";
import { loginAsAndAwaitDashboard, navViaSidebar } from "./helpers/auth";
import { seedConsent } from "./helpers/consent";
import { TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD } from "./global-setup";

const FIXTURE_PATH = path.join(process.cwd(), "e2e", "fixtures", "hire-orders.xlsx");

const SHOW_PROGRAM = `${E2E_TAG}-hireimport-program`;

const CLEAN_ARTIST_NAME = "E2E Import Clean Artist";
const CLEAN_ARTIST_EMAIL = "e2e-hireimport-clean@showflowpro.test";
/** Row 2's sheet artist name — deliberately never seeded, so it stays unknown_artist. */
const GHOST_ARTIST_NAME = "E2E Import Ghost Artist";
const LINK_TARGET_ARTIST_NAME = "E2E Import LinkTarget Artist";
const LINK_TARGET_ARTIST_EMAIL = "e2e-hireimport-linktarget@showflowpro.test";

/** Matches the fixture's row 1 + row 2 Date cell ("20.06.2099", dd.mm.yyyy). */
const SHOW_DATE_A_ISO = "2099-06-20";
/** Never in the file — typed into row 3's Review date input to fix its bad date. */
const SHOW_DATE_B_ISO = "2099-07-15";

/** Common substring across every order's resolved artist name, for the V4
 *  table's search box (both catalog artists share the "E2E Import" prefix). */
const SEARCH_TAG = "E2E Import";

/** Force the bootstrap org's hire_orders entitlement to a known value (mirrors hire-orders.spec.ts). */
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
 * Remove every artifact this spec seeds or creates: hire_orders (+ their
 * hire_order_imports row) hung off the two seeded show_dates, the show_dates
 * themselves, the show, and the two seeded catalog artists. Idempotent —
 * called from beforeAll (wipe any prior run's leftovers before re-seeding)
 * and afterAll, same convention as helpers/booking.ts's cleanupBookingFixture.
 */
async function cleanupImportFixture(): Promise<void> {
  const admin = adminClient();

  const { data: shows } = await admin.from("shows").select("id").eq("program", SHOW_PROGRAM);
  const showIds = (shows ?? []).map((s) => s.id as string);

  let showDateIds: string[] = [];
  if (showIds.length > 0) {
    const { data: dates } = await admin.from("show_dates").select("id").in("show_id", showIds);
    showDateIds = (dates ?? []).map((d) => d.id as string);
  }

  if (showDateIds.length > 0) {
    const { data: orders } = await admin
      .from("hire_orders")
      .select("id, import_id")
      .in("show_date_id", showDateIds);
    const orderIds = (orders ?? []).map((o) => o.id as string);
    const importIds = Array.from(
      new Set((orders ?? []).map((o) => o.import_id as string | null).filter((x): x is string => !!x)),
    );
    if (orderIds.length > 0) await admin.from("hire_orders").delete().in("id", orderIds);
    if (importIds.length > 0) await admin.from("hire_order_imports").delete().in("id", importIds);
  }

  // Defensive: also catch any hire_orders left pointing at our seeded artists
  // directly (e.g. a row that somehow landed with no show_date_id link). Guard
  // on non-empty like every other `.in()` call here — an empty array is not a
  // safe no-op filter to send to PostgREST.
  const seededArtistIds = await artistIdsByEmail([CLEAN_ARTIST_EMAIL, LINK_TARGET_ARTIST_EMAIL]);
  if (seededArtistIds.length > 0) {
    await admin.from("hire_orders").delete().in("artist_id", seededArtistIds);
  }

  if (showIds.length > 0) {
    await admin.from("show_dates").delete().in("show_id", showIds);
    await admin.from("shows").delete().in("id", showIds);
  }

  await admin.from("artists").delete().in("email", [CLEAN_ARTIST_EMAIL, LINK_TARGET_ARTIST_EMAIL]);
}

async function artistIdsByEmail(emails: string[]): Promise<string[]> {
  const admin = adminClient();
  const { data } = await admin.from("artists").select("id").in("email", emails);
  return (data ?? []).map((a) => a.id as string);
}

interface SeededFixture {
  showDateAId: string;
  showDateBId: string;
}

/** Seed the show/show_dates/artists the fixture's rows resolve against. */
async function seedImportFixture(): Promise<SeededFixture> {
  const admin = adminClient();
  await cleanupImportFixture();

  const { data: show, error: showErr } = await admin
    .from("shows")
    .insert({ program: SHOW_PROGRAM, sub_program: `${E2E_TAG}-sub`, org_id: BOOTSTRAP_ORG_ID })
    .select("id")
    .single();
  if (showErr || !show) throw new Error(`seed show failed: ${showErr?.message}`);

  const { data: dateA, error: dateAErr } = await admin
    .from("show_dates")
    .insert({ show_id: show.id, date: SHOW_DATE_A_ISO, org_id: BOOTSTRAP_ORG_ID, session_1: "20:00:00" })
    .select("id")
    .single();
  if (dateAErr || !dateA) throw new Error(`seed show_date A failed: ${dateAErr?.message}`);

  const { data: dateB, error: dateBErr } = await admin
    .from("show_dates")
    .insert({ show_id: show.id, date: SHOW_DATE_B_ISO, org_id: BOOTSTRAP_ORG_ID, session_1: "20:00:00" })
    .select("id")
    .single();
  if (dateBErr || !dateB) throw new Error(`seed show_date B failed: ${dateBErr?.message}`);

  const { error: cleanErr } = await admin
    .from("artists")
    .insert({ name: CLEAN_ARTIST_NAME, email: CLEAN_ARTIST_EMAIL, org_id: BOOTSTRAP_ORG_ID });
  if (cleanErr) throw new Error(`seed clean artist failed: ${cleanErr.message}`);

  const { error: linkErr } = await admin
    .from("artists")
    .insert({ name: LINK_TARGET_ARTIST_NAME, email: LINK_TARGET_ARTIST_EMAIL, org_id: BOOTSTRAP_ORG_ID });
  if (linkErr) throw new Error(`seed link-target artist failed: ${linkErr.message}`);

  return { showDateAId: dateA.id, showDateBId: dateB.id };
}

/** Ground-truth oracle: draft hire_orders created against our two seeded show_dates. */
async function countDraftOrders(showDateIds: string[]): Promise<number> {
  const admin = adminClient();
  const { count, error } = await admin
    .from("hire_orders")
    .select("id", { count: "exact", head: true })
    .in("show_date_id", showDateIds)
    .eq("status", "draft");
  if (error) throw error;
  return count ?? 0;
}

let fixture: SeededFixture;

test.describe.configure({ mode: "serial" });

test.describe("Hire orders: spreadsheet import wizard", () => {
  test.beforeAll(async () => {
    fixture = await seedImportFixture();
    await setHireOrdersEntitlement(true);
  });

  test.afterAll(async () => {
    await cleanupImportFixture();
    // Never leave the shared bootstrap org with hire_orders enabled; it ships dark.
    await clearHireOrdersEntitlement();
  });

  test.beforeEach(async ({ page }) => {
    await seedConsent(page);
  });

  test("producer imports a spreadsheet, resolves an unknown artist, fixes a bad date, and creates 3 drafts", async ({ page }) => {
    await loginAsAndAwaitDashboard(page, TEST_PRODUCER_EMAIL, TEST_PRODUCER_PASSWORD);
    await navViaSidebar(page, /^contracts$/i);

    const importButton = page.getByRole("button", { name: /import from spreadsheet/i });
    await expect(importButton).toBeVisible({ timeout: 15_000 });
    await importButton.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });

    // ── Source: upload the fixture ──────────────────────────────────────────
    await page.getByLabel("Upload spreadsheet").setInputFiles(FIXTURE_PATH);

    // ── Range: accept the defaults (header row 1, all rows) ─────────────────
    await expect(page.getByText(/6 columns · 3 rows selected/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /^continue$/i }).click();

    // ── Map: assert the auto-guessed prefill, then continue ─────────────────
    const artistSelect = page.getByRole("combobox", { name: /artist name column/i });
    const emailSelect = page.getByRole("combobox", { name: /recipient email column/i });
    const dateSelect = page.getByRole("combobox", { name: /^date column$/i });
    const feeSelect = page.getByRole("combobox", { name: /^fee column$/i });
    await expect(artistSelect).toBeVisible({ timeout: 10_000 });
    await expect(artistSelect.getByText("Artist", { exact: true })).toBeVisible();
    await expect(emailSelect.getByText("Email", { exact: true })).toBeVisible();
    await expect(dateSelect.getByText("Date", { exact: true })).toBeVisible();
    await expect(feeSelect.getByText("Fee", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // ── Resolve: only the Ghost row (row 2) needs linking ───────────────────
    await expect(page.getByText(GHOST_ARTIST_NAME)).toBeVisible({ timeout: 10_000 });
    // The clean-match and bad-date rows never appear here — they already matched.
    await expect(page.getByText(CLEAN_ARTIST_NAME)).not.toBeVisible();

    const linkCombobox = page.getByRole("combobox", {
      name: new RegExp(`link or create artist for ${GHOST_ARTIST_NAME}`, "i"),
    });
    await linkCombobox.click();
    await page.getByPlaceholder(/search artists/i).fill("LinkTarget");
    await page.getByRole("option", { name: LINK_TARGET_ARTIST_NAME, exact: true }).click();
    await expect(page.getByText("Linked")).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /^continue$/i }).click();

    // ── Review: 2 ready (clean-match + the just-linked Ghost row), 1 attention
    //    (the bad-date row) ──────────────────────────────────────────────────
    await expect(page.getByText("Needs attention")).toBeVisible({ timeout: 10_000 });

    const cleanRow = page.getByRole("row").filter({ hasText: CLEAN_ARTIST_NAME });
    const ghostRow = page.getByRole("row").filter({ hasText: GHOST_ARTIST_NAME });
    const badDateRow = page.getByRole("row").filter({ hasText: LINK_TARGET_ARTIST_NAME });

    await expect(cleanRow.getByText("Ready", { exact: true })).toBeVisible();
    await expect(ghostRow.getByText("Ready", { exact: true })).toBeVisible();
    await expect(badDateRow.getByText("Unreadable date", { exact: true })).toBeVisible();

    // Preselection: the two ready rows are checked, the attention row is not.
    await expect(page.getByRole("checkbox", { name: `Select ${CLEAN_ARTIST_NAME}` })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: `Select ${GHOST_ARTIST_NAME}` })).toBeChecked();
    const badDateCheckbox = page.getByRole("checkbox", { name: `Select ${LINK_TARGET_ARTIST_NAME}` });
    await expect(badDateCheckbox).not.toBeChecked();
    await expect(page.getByRole("button", { name: /^import 2 contracts$/i })).toBeVisible();

    // Fix the bad date inline — a valid ISO date that matches SHOW_DATE_B
    // exactly (the only way buildOrderRows resolves it without an
    // ambiguous_date issue), flipping the row to "ready".
    await page.getByLabel(`Date for ${LINK_TARGET_ARTIST_NAME}`).fill(SHOW_DATE_B_ISO);
    await expect(badDateRow.getByText("Ready", { exact: true })).toBeVisible({ timeout: 5_000 });

    // Select all 3 and submit.
    await badDateCheckbox.check();
    await expect(page.getByRole("button", { name: /^import 3 contracts$/i })).toBeVisible();
    await page.getByRole("button", { name: /^import 3 contracts$/i }).click();

    // ── Done: 3 created, none skipped/errored ───────────────────────────────
    await expect(page.getByText(/Created 3 draft contracts/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/^0 already existed$/i)).toBeVisible();

    // Ground truth: 3 draft hire_orders now exist against our seeded show_dates.
    await expect(async () => {
      const created = await countDraftOrders([fixture.showDateAId, fixture.showDateBId]);
      expect(created).toBe(3);
    }).toPass({ timeout: 15_000 });

    // ── V4 table: search scopes to our 3 new drafts ─────────────────────────
    await page.getByRole("button", { name: /open contracts/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 10_000 });

    await page.getByPlaceholder(/search contract number or artist/i).fill(SEARCH_TAG);
    const tableRows = page.locator("table tbody tr");
    await expect(tableRows).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator("table tbody").getByText("Draft", { exact: true })).toHaveCount(3);
  });
});
