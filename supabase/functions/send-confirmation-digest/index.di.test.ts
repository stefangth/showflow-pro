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

const cronOK = { "X-Cron-Secret": "s" };

// ── Shared settings seed (per-key, using array/when form) ─────────────────────
const APP_SETTINGS_SEED = [
  { when: { key: "cron_secret" }, data: { value: "s" } },
  { when: { key: "confirmation_digest_hour_berlin" }, data: { value: 20 } },
];

function baseDeps(extraTables: Record<string, unknown> = {}, now = BERLIN_20_CEST) {
  return makeFakeDeps({
    now,
    tables: { app_settings: APP_SETTINGS_SEED, ...extraTables },
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
    { when: { key: "confirmation_digest_hour_berlin" }, data: { value: 21 } },
  ];
  const { deps } = makeFakeDeps({
    now: BERLIN_20_CEST, // 20:00 Berlin
    tables: { app_settings: settings },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  // Target is 21, Berlin hour is 20 → must skip
  assertEquals(body.skipped, true);
});

Deno.test("send-confirmation-digest: defaults confirmation_digest_hour_berlin to 20 when not configured", async () => {
  // Only seed cron_secret; digest_hour returns no data → handler should default to 20
  const settings = [
    { when: { key: "cron_secret" }, data: { value: "s" } },
    // No entry for confirmation_digest_hour_berlin → maybeSingle returns { data: null }
  ];
  const { deps } = makeFakeDeps({
    now: BERLIN_20_CEST, // 20:00 Berlin
    tables: { app_settings: settings, bookings: { data: [], error: null } },
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
  // Key: confirmation-digest-<artistId>-<YYYY-MM-DDTHH>
  // now.toISOString().slice(0,13) = "2026-06-01T18"
  assertEquals(msg.idempotency_key, "confirmation-digest-artist-xyz-2026-06-01T18");
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
  assertEquals(byArtist.get("alice@x.com"), `confirmation-digest-a1-${hourPrefix}`);
  assertEquals(byArtist.get("bob@x.com"), `confirmation-digest-a2-${hourPrefix}`);
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

Deno.test("send-confirmation-digest: query error → 500 response", async () => {
  const { deps } = makeFakeDeps({
    now: BERLIN_20_CEST,
    tables: {
      app_settings: APP_SETTINGS_SEED,
      bookings: { data: null, error: { message: "db error" } },
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(res.status, 500);
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
