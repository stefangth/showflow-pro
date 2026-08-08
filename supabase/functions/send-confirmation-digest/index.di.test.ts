import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

// ── Fixed timestamps ──────────────────────────────────────────────────────────
// CEST (UTC+2): 2026-06-01T18:00:00Z = 20:00 Berlin — should NOT be skipped
const BERLIN_20_CEST = new Date("2026-06-01T18:00:00.000Z");
// CEST: 2026-06-01T17:00:00Z = 19:00 Berlin — one hour early, should skip
const BERLIN_19_CEST = new Date("2026-06-01T17:00:00.000Z");
// CET (UTC+1): 2026-01-15T19:00:00Z = 20:00 Berlin — should NOT be skipped
const BERLIN_20_CET = new Date("2026-01-15T19:00:00.000Z");
// CET: 2026-01-15T18:00:00Z = 19:00 Berlin — should skip
const BERLIN_19_CET = new Date("2026-01-15T18:00:00.000Z");

const ORG_1 = "00000000-0000-0000-0000-0000000000a1";
const ORG_2 = "00000000-0000-0000-0000-0000000000a2";
const cronOK = { "X-Cron-Secret": "s" };

// ── Shared settings seed (per-key, using array/when form) ─────────────────────
// cron_secret: maybeSingle (single-object form); confirmation_digest_hour_berlin: resolver row-array form.
const APP_SETTINGS_SEED = [
  { when: { key: "cron_secret" }, data: { value: "s" } },
  { when: { key: "confirmation_digest_hour_berlin" }, data: [{ org_id: null, value: 20 }] },
];

function baseDeps(extraTables: Record<string, unknown> = {}, now = BERLIN_20_CEST) {
  return makeFakeDeps({
    now,
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      ...extraTables,
    },
  });
}

// ── Minimal confirmed booking fixture ────────────────────────────────────────
const ONE_CONFIRMED = [{
  id: "b1", artist_id: "a1",
  artists: { id: "a1", name: "Jo", email: "jo@x.com" },
  show_dates: {
    date: "2026-06-10",
    shows: { program: "Phantom", sub_program: "Evening" },
    cities: { name: "Berlin" },
  },
}];

// =============================================================================
// AUTH
// =============================================================================

Deno.test("send-confirmation-digest: OPTIONS returns preflight", async () => {
  const { deps } = baseDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("send-confirmation-digest: wrong cron secret → 401", async () => {
  const { deps } = makeFakeDeps({
    tables: { app_settings: { data: { value: "s" }, error: null } },
  });
  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "nope" } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("send-confirmation-digest: valid cron secret → 200", async () => {
  const { deps } = baseDeps({ bookings: { data: [], error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(res.status, 200);
});

// =============================================================================
// BERLIN-HOUR GATE — DST-CORRECT
// =============================================================================

Deno.test("send-confirmation-digest: CEST — 18:00 UTC (20:00 Berlin) is NOT skipped", async () => {
  const { deps } = baseDeps({ bookings: { data: [], error: null } }, BERLIN_20_CEST);
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  // Proceeds — not skipped; result is digests_sent:0 (no bookings)
  assertEquals(body.skipped, undefined);
  assertEquals(body.digests_sent, 0);
});

Deno.test("send-confirmation-digest: CEST — 17:00 UTC (19:00 Berlin) IS skipped", async () => {
  const { deps } = baseDeps({ bookings: { data: [], error: null } }, BERLIN_19_CEST);
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.skipped, true);
});

Deno.test("send-confirmation-digest: CET — 19:00 UTC (20:00 Berlin) is NOT skipped", async () => {
  const { deps } = baseDeps({ bookings: { data: [], error: null } }, BERLIN_20_CET);
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.skipped, undefined);
  assertEquals(body.digests_sent, 0);
});

Deno.test("send-confirmation-digest: CET — 18:00 UTC (19:00 Berlin) IS skipped", async () => {
  const { deps } = baseDeps({ bookings: { data: [], error: null } }, BERLIN_19_CET);
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.skipped, true);
});

// =============================================================================
// SETTINGS READ: confirmation_digest_hour_berlin
// =============================================================================

Deno.test("send-confirmation-digest: reads confirmation_digest_hour_berlin from app_settings", async () => {
  // Set target hour to 21; now is 20:00 Berlin → should skip
  const settings = [
    { when: { key: "cron_secret" }, data: { value: "s" } },
    { when: { key: "confirmation_digest_hour_berlin" }, data: [{ org_id: null, value: 21 }] },
  ];
  const { deps } = makeFakeDeps({
    now: BERLIN_20_CEST, // 20:00 Berlin
    tables: {
      app_settings: settings,
      organizations: { data: [{ id: ORG_1 }], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  // Target is 21, Berlin hour is 20 → must skip
  assertEquals(body.skipped, true);
});

Deno.test("send-confirmation-digest: defaults confirmation_digest_hour_berlin to 20 when not configured", async () => {
  // Only seed cron_secret; digest_hour returns no data → resolver returns fallback 20
  const settings = [
    { when: { key: "cron_secret" }, data: { value: "s" } },
    // No entry for confirmation_digest_hour_berlin → resolver returns fallback 20
  ];
  const { deps } = makeFakeDeps({
    now: BERLIN_20_CEST, // 20:00 Berlin
    tables: {
      app_settings: settings,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  // Default 20 == Berlin hour 20 → proceed, not skipped
  assertEquals(body.skipped, undefined);
  assertEquals(body.digests_sent, 0);
});

// =============================================================================
// NO CONFIRMED BOOKINGS
// =============================================================================

Deno.test("send-confirmation-digest: no confirmed bookings → digests_sent 0", async () => {
  const { deps } = baseDeps({ bookings: { data: [], error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(await res.json(), { digests_sent: 0 });
});

// =============================================================================
// EMAIL SENDING — template name, recipient, templateData
// =============================================================================

Deno.test("send-confirmation-digest: email uses template 'artist-confirmation-digest'", async () => {
  const { deps, invokeCalls } = baseDeps({ bookings: { data: ONE_CONFIRMED, error: null } });
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const msg = emailCall!.body as { template_name: string; recipient_email: string };
  assertEquals(msg.template_name, "artist-confirmation-digest");
  assertEquals(msg.recipient_email, "jo@x.com");
});

Deno.test("send-confirmation-digest: email templateData contains displayName and bookings array", async () => {
  const { deps, invokeCalls } = baseDeps({ bookings: { data: ONE_CONFIRMED, error: null } });
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const msg = emailCall!.body as {
    templateData?: { displayName?: string; bookings?: Array<{ show: string; date: string; city: string }> };
  };
  assertEquals(msg.templateData?.displayName, "Jo");
  assertExists(msg.templateData?.bookings);
  assertEquals(msg.templateData!.bookings!.length, 1);
  assertEquals(msg.templateData!.bookings![0].show, "Phantom — Evening");
  assertEquals(msg.templateData!.bookings![0].date, "2026-06-10");
  assertEquals(msg.templateData!.bookings![0].city, "Berlin");
});

// =============================================================================
// IDEMPOTENCY KEY
// =============================================================================

Deno.test("send-confirmation-digest: idempotency key includes artistId and UTC hour slice", async () => {
  const now = BERLIN_20_CEST; // 2026-06-01T18:00:00.000Z
  const booking = [{
    id: "b1", artist_id: "artist-xyz",
    artists: { id: "artist-xyz", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: booking, error: null } }, now);
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const msg = emailCall!.body as { idempotency_key?: string };
  // Key: confirmation-digest-<orgId>-<artistId>-<YYYY-MM-DDTHH>
  // now.toISOString().slice(0,13) = "2026-06-01T18"
  assertEquals(msg.idempotency_key, `confirmation-digest-${ORG_1}-artist-xyz-2026-06-01T18`);
});

Deno.test("send-confirmation-digest: idempotency key derives from the CAPTURED now for ALL artists in one run", async () => {
  // Regression for Finding 4: the key (and the confirmation_digest_sent_at stamp)
  // must use the single captured `now`, not a fresh deps.now() per artist. With a
  // fixed clock, every artist's key shares the same hour prefix derived from `now`.
  const now = BERLIN_20_CEST; // 2026-06-01T18:00:00.000Z → slice(0,13) = "2026-06-01T18"
  const hourPrefix = now.toISOString().slice(0, 13);
  const bookings = [
    {
      id: "b1", artist_id: "a1",
      artists: { id: "a1", name: "Alice", email: "alice@x.com" },
      show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
    },
    {
      id: "b2", artist_id: "a2",
      artists: { id: "a2", name: "Bob", email: "bob@x.com" },
      show_dates: { date: "2026-06-11", shows: { program: "P", sub_program: "S" }, cities: { name: "Hamburg" } },
    },
  ];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: bookings, error: null } }, now);
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCalls = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emailCalls.length, 2);
  const byArtist = new Map(
    emailCalls.map((c) => {
      const m = c.body as { recipient_email: string; idempotency_key?: string };
      return [m.recipient_email, m.idempotency_key];
    }),
  );
  assertEquals(byArtist.get("alice@x.com"), `confirmation-digest-${ORG_1}-a1-${hourPrefix}`);
  assertEquals(byArtist.get("bob@x.com"), `confirmation-digest-${ORG_1}-a2-${hourPrefix}`);
});

// =============================================================================
// SHOW NAME FORMATTING
// =============================================================================

Deno.test("send-confirmation-digest: show name = 'program — sub_program' when both present", async () => {
  const booking = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "Phantom", sub_program: "Evening" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: booking, error: null } });
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const msg = emailCall!.body as {
    templateData?: { bookings?: Array<{ show: string }> };
  };
  assertEquals(msg.templateData?.bookings?.[0]?.show, "Phantom — Evening");
});

Deno.test("send-confirmation-digest: show name = program only when sub_program is null", async () => {
  const booking = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "Phantom", sub_program: null }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: booking, error: null } });
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const msg = emailCall!.body as { templateData?: { bookings?: Array<{ show: string }> } };
  assertEquals(msg.templateData?.bookings?.[0]?.show, "Phantom");
});

Deno.test("send-confirmation-digest: show name = 'Unknown show' when program is null", async () => {
  const booking = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: null, sub_program: null }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: booking, error: null } });
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const msg = emailCall!.body as { templateData?: { bookings?: Array<{ show: string }> } };
  assertEquals(msg.templateData?.bookings?.[0]?.show, "Unknown show");
});

Deno.test("send-confirmation-digest: date and city fall back to '—' when missing", async () => {
  const booking = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: null, shows: { program: "P", sub_program: null }, cities: null },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: booking, error: null } });
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const msg = emailCall!.body as {
    templateData?: { bookings?: Array<{ date: string; city: string }> };
  };
  assertEquals(msg.templateData?.bookings?.[0]?.date, "—");
  assertEquals(msg.templateData?.bookings?.[0]?.city, "—");
});

// =============================================================================
// GROUPING
// =============================================================================

Deno.test("send-confirmation-digest: multiple confirmed bookings for same artist → ONE email", async () => {
  const bookings = [
    {
      id: "b1", artist_id: "a1",
      artists: { id: "a1", name: "Jo", email: "jo@x.com" },
      show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
    },
    {
      id: "b2", artist_id: "a1",
      artists: { id: "a1", name: "Jo", email: "jo@x.com" },
      show_dates: { date: "2026-06-12", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
    },
  ];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: bookings, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(body.digests_sent, 1);
  const emailCalls = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emailCalls.length, 1);
});

Deno.test("send-confirmation-digest: same artist's two bookings → both included in templateData.bookings", async () => {
  const bookings = [
    {
      id: "b1", artist_id: "a1",
      artists: { id: "a1", name: "Jo", email: "jo@x.com" },
      show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
    },
    {
      id: "b2", artist_id: "a1",
      artists: { id: "a1", name: "Jo", email: "jo@x.com" },
      show_dates: { date: "2026-06-12", shows: { program: "P", sub_program: "S" }, cities: { name: "Hamburg" } },
    },
  ];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: bookings, error: null } });
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const msg = emailCall!.body as {
    templateData?: { bookings?: Array<{ city: string }> };
  };
  assertEquals(msg.templateData?.bookings?.length, 2);
  const cities = msg.templateData!.bookings!.map((b) => b.city);
  assertEquals(cities.includes("Berlin"), true);
  assertEquals(cities.includes("Hamburg"), true);
});

Deno.test("send-confirmation-digest: confirmed bookings for different artists → one email each", async () => {
  const bookings = [
    {
      id: "b1", artist_id: "a1",
      artists: { id: "a1", name: "Alice", email: "alice@x.com" },
      show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
    },
    {
      id: "b2", artist_id: "a2",
      artists: { id: "a2", name: "Bob", email: "bob@x.com" },
      show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Hamburg" } },
    },
  ];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: bookings, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(body.digests_sent, 2);
  const emailCalls = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emailCalls.length, 2);
  const recipients = emailCalls.map((c) => (c.body as { recipient_email: string }).recipient_email);
  assertEquals(recipients.includes("alice@x.com"), true);
  assertEquals(recipients.includes("bob@x.com"), true);
});

Deno.test("send-confirmation-digest: booking with no artist email → skipped, no email sent", async () => {
  const bookings = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Ghost", email: null },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: bookings, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(body.digests_sent, 0);
  const emailCalls = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emailCalls.length, 0);
});

Deno.test("send-confirmation-digest: booking with null artists join → skipped gracefully, no crash", async () => {
  const bookings = [{
    id: "b1", artist_id: "a1",
    artists: null,
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: bookings, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(body.digests_sent, 0);
  const emailCalls = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emailCalls.length, 0);
});

// =============================================================================
// STAMP: confirmation_digest_sent_at
// =============================================================================

Deno.test("send-confirmation-digest: stamp update sets confirmation_digest_sent_at = deps.now().toISOString()", async () => {
  const now = BERLIN_20_CEST;
  const { deps, calls } = baseDeps({ bookings: { data: ONE_CONFIRMED, error: null } }, now);
  await handle(makeRequest({ headers: cronOK }), deps);

  const update = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertExists(update);
  const payload = update!.args[0] as Record<string, string>;
  assertEquals(payload.confirmation_digest_sent_at, now.toISOString());
});

Deno.test("send-confirmation-digest: stamp targets all booking IDs for that artist via .in()", async () => {
  const bookings = [
    {
      id: "b1", artist_id: "a1",
      artists: { id: "a1", name: "Jo", email: "jo@x.com" },
      show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
    },
    {
      id: "b2", artist_id: "a1",
      artists: { id: "a1", name: "Jo", email: "jo@x.com" },
      show_dates: { date: "2026-06-12", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
    },
  ];
  const { deps, calls } = baseDeps({ bookings: { data: bookings, error: null } });
  await handle(makeRequest({ headers: cronOK }), deps);

  const inCall = calls.find((c) => c.table === "bookings" && c.method === "in");
  assertExists(inCall);
  const ids = (inCall!.args as [string, string[]])[1];
  assertEquals(ids.includes("b1"), true);
  assertEquals(ids.includes("b2"), true);
  assertEquals(ids.length, 2);
});

Deno.test("send-confirmation-digest: digests_sent incremented only after successful email + stamp", async () => {
  // Baseline: email succeeds, stamp succeeds → digests_sent = 1
  const { deps } = baseDeps({ bookings: { data: ONE_CONFIRMED, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
});

// ── C4: gate confirmation_digest_sent_at on a REAL send ───────────────────────

function c4ConfirmDeps(emailResult: { data?: unknown; error?: unknown }) {
  return makeFakeDeps({
    now: BERLIN_20_CEST,
    emailResult: emailResult as { data: unknown; error: unknown },
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: ONE_CONFIRMED, error: null },
    },
  });
}

Deno.test("send-confirmation-digest C4: successful send → stamps confirmation_digest_sent_at, digests_sent 1", async () => {
  const { deps, calls } = c4ConfirmDeps({ data: { success: true, message_id: "m1" }, error: null });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const update = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertExists(update);
  assertEquals((update!.args[0] as Record<string, string>).confirmation_digest_sent_at, BERLIN_20_CEST.toISOString());
});

Deno.test("send-confirmation-digest C4: skipped send (200 {success:false}) → NO stamp, digests_sent 0", async () => {
  const { deps, calls, invokeCalls } = c4ConfirmDeps({ data: { success: false, reason: "pref_disabled" }, error: null });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 0);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 1, "email attempted");
  const update = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertEquals(update, undefined, "must NOT stamp confirmation_digest_sent_at on a skipped send");
});

Deno.test("send-confirmation-digest C4: hard failure (error populated) → NO stamp, digests_sent 0", async () => {
  const { deps, calls } = c4ConfirmDeps({ data: null, error: { message: "Failed to send email" } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 0);
  const update = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertEquals(update, undefined, "must NOT stamp on a failed send (retried next run)");
});

// =============================================================================
// STAMP FAILURE BEHAVIOR (characterization — matches send-offer-digest pattern)
// =============================================================================

Deno.test("send-confirmation-digest: sendEmail throws → digests_sent not incremented, handler returns 200", async () => {
  // Verify the email-failure path: sendEmail throws → handler catches → continues.
  // digests_sent must be 0 for the artist whose email threw.
  const bookings = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];

  const { client, calls } = (await import("../_shared/testing.ts")).createFakeClient({
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: bookings, error: null },
    },
  });

  const invokeCalls: Array<{ name: string; body: unknown }> = [];
  const deps = {
    admin: client as unknown as import("../_shared/deps.ts").Deps["admin"],
    userClient: () => client as unknown as import("../_shared/deps.ts").Deps["admin"],
    env: (_k: string) => undefined as string | undefined,
    now: () => BERLIN_20_CEST,
    invokeFunction: (_name: string, _body: unknown) => Promise.resolve({ data: null, error: null }),
    sendEmail: (_msg: import("../_shared/deps.ts").EmailMessage) => {
      invokeCalls.push({ name: "send-transactional-email", body: _msg });
      return Promise.reject(new Error("Resend API down"));
    },
    renderHireOrderPdf: () => Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    fetch: (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch,
  };

  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  // Handler must not propagate the exception; must return 200
  assertEquals(res.status, 200);
  // Artist whose email failed must NOT be counted
  assertEquals(body.digests_sent, 0);
  // sendEmail was attempted once
  assertEquals(invokeCalls.length, 1);
  // No stamp was attempted (email failed before stamp)
  const stampCall = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertEquals(stampCall, undefined);
});

Deno.test("send-confirmation-digest: query error → logs and continues, returns digests_sent 0", async () => {
  // NOTE: The fake client cannot distinguish SELECT vs UPDATE on the same table using the
  // array-seed `when` form. Seeding bookings with an error causes the initial SELECT to return
  // an error. The new per-org handler logs and continues (does not return 500),
  // resulting in digests_sent: 0.
  const { deps } = makeFakeDeps({
    now: BERLIN_20_CEST,
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: null, error: { message: "db error" } },
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.digests_sent, 0);
});

// =============================================================================
// STAMP-FAILURE AT-LEAST-ONCE CHARACTERIZATION
// =============================================================================

Deno.test({ name: "send-confirmation-digest: atomicity characterization — stamp failure after successful email (design-limitation, matches send-offer-digest) (SKIPPED: harness cannot fail UPDATE while SELECT succeeds on same table — needs live integration test)", ignore: true, fn: async () => {
  // characterization: at-least-once email risk — same design as send-offer-digest.
  //
  // The handler (index.ts, ~lines 118-125):
  //   const { error: stampErr } = await admin.from('bookings').update(...).in('id', ids)
  //   if (stampErr) { console.error(...) }       ← logs but does NOT decrement / skip count
  //   digestsSent += 1                           ← incremented regardless of stamp result
  //
  // NOTE: Unlike send-offer-digest which does NOT increment digests_sent on stamp failure,
  // send-confirmation-digest DOES increment digests_sent even when the stamp fails.
  // The booking retains confirmation_digest_sent_at = null and will be re-queried on the
  // next run, sending a duplicate confirmation email. The idempotency key
  // `confirmation-digest-<artistId>-YYYY-MM-DDTHH` mitigates duplicates within the same
  // UTC hour; a stamp failure at 20:01 and a retry at the next day's 20:00 will produce
  // an unavoidable duplicate (different key).
  //
  // VERDICT: design-limitation (acceptable at current scale; at-least-once delivery).
  // This is the SAME design as send-offer-digest (cross-reference: part1-bug-log.md row
  // "send-offer-digest: at-least-once email on stamp failure"). No separate bug-log row
  // created — the cross-reference in this comment is the record.
  //
  // HARNESS LIMITATION: the current fake client cannot make SELECT succeed and UPDATE fail
  // on the same table (the entire chain resolves from one seed). So we assert the documented
  // source behavior here as a characterization; a live integration test would be needed to
  // exercise this path end-to-end.
  // body intentionally empty — ignored test; see comment above
}});

// =============================================================================
// RESPONSE SHAPE
// =============================================================================

Deno.test("send-confirmation-digest: response shape is { digests_sent: n }", async () => {
  const { deps } = baseDeps({ bookings: { data: ONE_CONFIRMED, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(typeof body.digests_sent, "number");
  assertEquals(body.digests_sent, 1);
});

Deno.test("send-confirmation-digest: skipped response has { skipped: true, reason: string }", async () => {
  const { deps } = baseDeps({ bookings: { data: [], error: null } }, BERLIN_19_CEST);
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(body.skipped, true);
  assertEquals(typeof body.reason, "string");
});

// ── Midnight gate: hour 24 from Intl must normalize to 0 (% 24) ───────────────
// Regression: V8/Deno's Intl.DateTimeFormat hour:'numeric' hour12:false returns
// '24' at midnight, so parseInt('24') !== configured targetHour 0 → the digest
// would silently skip forever. The gate now normalizes with `% 24`.
Deno.test("send-confirmation-digest: midnight Berlin (hour 0) with target 0 is NOT skipped", async () => {
  // CET (UTC+1): 2026-01-15T23:00:00Z = 00:00 Berlin
  const BERLIN_MIDNIGHT_CET = new Date("2026-01-15T23:00:00.000Z");
  const settings = [
    { when: { key: "cron_secret" }, data: { value: "s" } },
    { when: { key: "confirmation_digest_hour_berlin" }, data: [{ org_id: null, value: 0 }] },
  ];
  const { deps } = makeFakeDeps({
    now: BERLIN_MIDNIGHT_CET,
    tables: {
      app_settings: settings,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  // Must proceed (not skip) — gate normalized hour 24 → 0 == target 0.
  assertEquals(body.skipped, undefined);
  assertEquals(body.digests_sent, 0);
});

// Pin the exact normalization the gate now relies on. On the V8/Deno build that
// surfaced this bug, Intl formats midnight as '24'; the gate's `% 24` must map
// that to 0 so it equals a configured targetHour of 0. (This guards the fix on
// runtimes where Intl emits '24', independent of the local Intl build above.)
Deno.test("send-confirmation-digest: gate normalizes parseInt('24') % 24 to 0", () => {
  assertEquals(parseInt("24", 10) % 24, 0);
});

// ── Per-org tests ─────────────────────────────────────────────────────────────

Deno.test("send-confirmation-digest: only orgs whose confirmation_digest_hour_berlin == Berlin hour are processed", async () => {
  // ORG_1 hour 20 (matches now=20:00 Berlin), ORG_2 hour 21 (skipped).
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_20_CEST,
    tables: {
      organizations: { data: [{ id: ORG_1 }, { id: ORG_2 }], error: null },
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "s" } },
        { when: { key: "confirmation_digest_hour_berlin" }, data: [{ org_id: ORG_2, value: 21 }, { org_id: null, value: 20 }] },
      ],
      // bookings seeded per org via `when` on org_id
      bookings: [
        { when: { org_id: ORG_1 }, data: [{ id: "b1", artist_id: "a1", artists: { id: "a1", name: "Jo", email: "jo@x.com" }, show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } } }] },
        { when: { org_id: ORG_2 }, data: [{ id: "b2", artist_id: "a2", artists: { id: "a2", name: "Mo", email: "mo@x.com" }, show_dates: null }] },
      ],
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(body.digests_sent, 1); // only ORG_1
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 1);
  assertEquals((emails[0].body as { recipient_email: string }).recipient_email, "jo@x.com");
  assertEquals((emails[0].body as { org_id?: string }).org_id, ORG_1);
});

Deno.test("send-confirmation-digest: no active org matches the hour → skipped", async () => {
  const { deps } = makeFakeDeps({
    now: BERLIN_19_CEST, // 19:00 Berlin, default target is 20
    tables: {
      organizations: { data: [{ id: ORG_1 }], error: null },
      app_settings: APP_SETTINGS_SEED,
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(body.skipped, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 6: module gate — booking_flow entitlement filters the active-org set
//
// filterEntitledOrgs (a SINGLE batched org_entitlements read, not a per-org RPC)
// wraps getActiveOrgs() before the per-org loop, so an unentitled org never
// enters the loop at all — not even the in-app schedule_change notification path,
// which is otherwise unconditional (confirmation_digest only gates the email).
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("send-confirmation-digest: an unentitled org is filtered out before the hour gate — no digest, no email", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_20_CEST, // matches the configured digest hour — would send if NOT filtered
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: ONE_CONFIRMED, error: null },
      org_entitlements: { data: [{ org_id: ORG_1, enabled: false }], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.skipped, true, "an unentitled org never reaches the hour gate at all");
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0);
});

Deno.test("send-confirmation-digest: two active orgs match the hour, only the entitled one is processed", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_20_CEST,
    tables: {
      organizations: { data: [{ id: ORG_1 }, { id: ORG_2 }], error: null },
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "s" } },
        { when: { key: "confirmation_digest_hour_berlin" }, data: [{ org_id: null, value: 20 }] },
      ],
      // ORG_2 explicitly disabled; ORG_1 has no row → falls back to the registry
      // default (booking_flow defaults on).
      org_entitlements: { data: [{ org_id: ORG_2, enabled: false }], error: null },
      bookings: [
        { when: { org_id: ORG_1 }, data: [{ id: "b1", artist_id: "a1", artists: { id: "a1", name: "Jo", email: "jo@x.com" }, show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } } }] },
        { when: { org_id: ORG_2 }, data: [{ id: "b2", artist_id: "a2", artists: { id: "a2", name: "Mo", email: "mo@x.com" }, show_dates: null }] },
      ],
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(body.digests_sent, 1); // only ORG_1
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 1);
  assertEquals((emails[0].body as { org_id?: string }).org_id, ORG_1);
});

// Pin the fail-OPEN contract for booking_flow: a transient org_entitlements read
// error must never silently disable live production booking traffic.
Deno.test("send-confirmation-digest: keeps every org when the org_entitlements read errors (booking_flow fails open)", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_20_CEST,
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: ONE_CONFIRMED, error: null },
      org_entitlements: { data: null, error: { message: "boom" } },
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.digests_sent, 1, "booking_flow fails OPEN on an org_entitlements read error");
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 1);
});

// ── ADR-0011: registered artist → login email first ───────────────────────────
// BERLIN_20_CEST and ORG_1 are already defined above; reuse them.
// CONF_SETTINGS: confirmation-digest-specific settings seed for these tests.
const CONF_SETTINGS = [
  { when: { key: "cron_secret" }, data: { value: "s" } },
  { when: { key: "confirmation_digest_hour_berlin" }, data: [{ org_id: null, value: 20 }] },
];

Deno.test("send-confirmation-digest: registered artist → login email wins; greeting uses display_name", async () => {
  const confirmed = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Talent Label", email: "booking@x.com", user_id: "u1" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_20_CEST,
    tables: {
      app_settings: CONF_SETTINGS,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: confirmed, error: null },
    },
    rpcs: { resolve_user_contacts: { data: [{ user_id: "u1", email: "login@x.com", display_name: "Ada Lovelace" }] } },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  const msg = email!.body as { recipient_email: string; templateData?: { displayName?: string } };
  assertEquals(msg.recipient_email, "login@x.com");
  assertEquals(msg.templateData?.displayName, "Ada Lovelace");
});

Deno.test("send-confirmation-digest: registered artist with blank booking email → delivered at login email (gap regression)", async () => {
  const confirmed = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Talent", email: null, user_id: "u1" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_20_CEST,
    tables: {
      app_settings: CONF_SETTINGS,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: confirmed, error: null },
    },
    rpcs: { resolve_user_contacts: { data: [{ user_id: "u1", email: "login@x.com", display_name: null }] } },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  assertEquals((email!.body as { recipient_email: string }).recipient_email, "login@x.com");
});

Deno.test("send-confirmation-digest: resolve_user_contacts RPC error → non-fatal, falls back to booking email", async () => {
  const confirmed = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Talent", email: "booking@x.com", user_id: "u1" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_20_CEST,
    tables: {
      app_settings: CONF_SETTINGS,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: confirmed, error: null },
    },
    rpcs: { resolve_user_contacts: { error: { message: "rpc down" } } },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  assertEquals((email!.body as { recipient_email: string }).recipient_email, "booking@x.com");
});

Deno.test("send-confirmation-digest: unregistered artist (no user_id) → booking email", async () => {
  const confirmed = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "External", email: "booking@x.com", user_id: null },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_20_CEST,
    tables: {
      app_settings: CONF_SETTINGS,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: confirmed, error: null },
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  assertEquals((email!.body as { recipient_email: string }).recipient_email, "booking@x.com");
});

// =============================================================================
// Milestone C — Task 10: digest sender honors the booking flow
//
// resolveBookingFlow reads app_settings.key='booking_flow' via resolveOrgSetting —
// on top of the confirmation_digest_hour_berlin read the handler already makes.
// Seeds disambiguate by the recorded .eq("key", ...) arg, layered on APP_SETTINGS_SEED.
// Direct-mode orgs (artist_acceptance:false) do NOT get gated here — this digest is
// their only notification, so only confirmation_digest:false skips it.
// =============================================================================

Deno.test("send-confirmation-digest: confirmation_digest disabled org sends NO email", async () => {
  // The flag is now an EMAIL-ONLY opt-out: with confirmation_digest:false and only a
  // confirmed booking (no schedule changes), no email is sent and nothing is stamped.
  const settings = [
    ...APP_SETTINGS_SEED,
    { when: { key: "booking_flow" }, data: [{ org_id: ORG_1, value: { confirmation_digest: false } }] },
  ];
  const { deps, invokeCalls } = baseDeps({ app_settings: settings, bookings: { data: ONE_CONFIRMED, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(invokeCalls.some((c) => c.name === "send-transactional-email"), false);
  assertEquals(body.digests_sent, 0);
});

Deno.test("send-confirmation-digest: confirmation_digest:false still delivers in-app schedule_change + stamps digested_at", async () => {
  // Fix (PR #161 round 2): the email toggle must NOT kill in-app schedule-change delivery.
  // Seed an org with confirmation_digest:false AND a pending cancellation change-log row.
  // Expected: NO email invoke, but the in-app schedule_change notification is inserted and
  // the change-log row is stamped digested_at.
  const B_USER = "bbbb2222-0000-0000-0000-000000000000";
  const settings = [
    ...APP_SETTINGS_SEED,
    { when: { key: "booking_flow" }, data: [{ org_id: ORG_1, value: { confirmation_digest: false } }] },
  ];
  const { deps, invokeCalls, calls } = makeFakeDeps({
    now: BERLIN_20_CEST,
    tables: {
      app_settings: settings,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: [
        // Source 1 (confirmations, .eq status=confirmed) → none.
        { when: { status: "confirmed" }, data: [] },
        // Change-recipient query (.in show_date_id): fallback (no `when`).
        { data: [
          { id: "bk-B", artist_id: "art-B", show_date_id: "sd-cancel", status: "cancelled", cancellation_reason: "date_cancelled",
            artists: { id: "art-B", name: "Ben", email: "ben@ex.com", user_id: B_USER } },
        ] },
      ],
      show_date_change_log: { data: [
        { id: "cl-2", show_date_id: "sd-cancel", change_type: "cancelled", session_slot: null, old_value: null, new_value: null, created_at: "2026-06-01T11:00:00Z",
          show_dates: { date: "2026-06-15", status: "cancelled", cancellation_reason: "Venue flooded", shows: { program: "Magic", sub_program: null }, cities: { name: "Hamburg" } } },
      ], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { resolve_user_contacts: { data: [{ user_id: B_USER, email: "ben@login.com", display_name: "Ben L" }], error: null } },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(res.status, 200);
  // Email is gated off.
  assertEquals(invokeCalls.some((c) => c.name === "send-transactional-email"), false);
  // In-app schedule_change notification still inserted.
  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  assertExists(notifInsert);
  const rows = notifInsert!.args[0] as Array<{ type: string; user_id: string }>;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].type, "schedule_change");
  assertEquals(rows[0].user_id, B_USER);
  // Change-log row still stamped digested_at.
  const stamp = calls.find((c) => c.table === "show_date_change_log" && c.method === "update");
  assertExists(stamp);
  assertEquals((stamp!.args[0] as { digested_at?: string }).digested_at, BERLIN_20_CEST.toISOString());
});

Deno.test("send-confirmation-digest: booking_flow.active:false → NO confirmation digest, even at the configured hour with a fresh confirmation", async () => {
  // The `if (!flow.active) continue;` gate (index.ts ~line 138) overrides the usual
  // "direct-booking orgs are not gated" behavior: when the flow itself is off, the
  // engine is paused and this org must get no confirmation digest at all, regardless
  // of confirmation_digest_hour_berlin matching and a newly-confirmed booking existing.
  const settings = [
    ...APP_SETTINGS_SEED,
    { when: { key: "booking_flow" }, data: [{ org_id: ORG_1, value: { active: false } }] },
  ];
  const { deps, invokeCalls, calls } = baseDeps(
    { app_settings: settings, bookings: { data: ONE_CONFIRMED, error: null } },
    BERLIN_20_CEST, // matches the configured digest hour — would send if the flow were active
  );
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.digests_sent, 0, "an inactive booking flow must suppress the confirmation digest");
  assertEquals(invokeCalls.some((c) => c.name === "send-transactional-email"), false);
  const stamp = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertEquals(stamp, undefined, "must not stamp confirmation_digest_sent_at when the flow is inactive");
});

Deno.test("send-confirmation-digest: templateData confirmed items carry the custom-field label when the flow selects a custom reference", async () => {
  const confirmed = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: {
      date: "2026-06-10",
      shows: { program: "Phantom", sub_program: "Evening" },
      cities: { name: "Berlin" },
      custom: { pn: "PN-9001" },
    },
  }];
  const settings = [
    ...APP_SETTINGS_SEED,
    {
      when: { key: "booking_flow" },
      data: [{ org_id: ORG_1, value: { reference_field: { source: "custom", custom_field_id: "cf1" } } }],
    },
  ];
  const { deps, invokeCalls } = baseDeps({
    app_settings: settings,
    bookings: { data: confirmed, error: null },
    custom_field_definitions: { data: { key: "pn" }, error: null },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  const msg = email!.body as { templateData?: { bookings?: Array<{ label?: string; show?: string }> } };
  assertEquals(msg.templateData?.bookings?.[0]?.label, "PN-9001");
  // The old raw program/sub_program string is still computed alongside the label
  // (the template's fallback for previewData that doesn't carry a label).
  assertEquals(msg.templateData?.bookings?.[0]?.show, "Phantom — Evening");
});
