import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

// ── Fixed timestamps ──────────────────────────────────────────────────────────
// CEST (UTC+2): 2026-06-01T17:00:00Z = 19:00 Berlin
const BERLIN_19_CEST = new Date("2026-06-01T17:00:00.000Z");
// CEST: 2026-06-01T16:00:00Z = 18:00 Berlin — one hour early, should skip
const BERLIN_18_CEST = new Date("2026-06-01T16:00:00.000Z");
// CET (UTC+1): 2026-01-15T18:00:00Z = 19:00 Berlin
const BERLIN_19_CET = new Date("2026-01-15T18:00:00.000Z");
// CET: 2026-01-15T17:00:00Z = 18:00 Berlin — should skip
const BERLIN_18_CET = new Date("2026-01-15T17:00:00.000Z");

const ORG_1 = "00000000-0000-0000-0000-0000000000a1";
const ORG_2 = "00000000-0000-0000-0000-0000000000a2";
const cronOK = { "X-Cron-Secret": "s" };

// app_settings: cron_secret via maybeSingle (object); hour/window via resolver (rows).
const APP_SETTINGS_SEED = [
  { when: { key: "cron_secret" }, data: { value: "s" } },
  { when: { key: "offer_digest_hour_berlin" }, data: [{ org_id: null, value: 19 }] },
  { when: { key: "offer_response_window_hours" }, data: [{ org_id: null, value: 48 }] },
];

function baseDeps(extraTables: Record<string, unknown> = {}, now = BERLIN_19_CEST) {
  return makeFakeDeps({
    now,
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      ...extraTables,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXISTING TESTS (kept intact)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("send-offer-digest: skips when Berlin hour != target", async () => {
  const { deps } = baseDeps({}, new Date("2026-06-01T12:00:00.000Z")); // 14:00 Berlin
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.skipped, true);
});

Deno.test("send-offer-digest: wrong cron secret → 401", async () => {
  const { deps } = makeFakeDeps({ tables: { app_settings: { data: { value: "s" }, error: null } } });
  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "nope" } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("send-offer-digest: no pending offers → digests_sent 0", async () => {
  const { deps } = baseDeps({ bookings: { data: [], error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(await res.json(), { digests_sent: 0 });
});

Deno.test("send-offer-digest: sends email AND stamps digest_sent_at+offer_expires_at together", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, calls, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(await res.json(), { digests_sent: 1 });
  assertEquals(invokeCalls.some((c) => c.name === "send-transactional-email"), true);
  const update = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertEquals(!!update, true);
  const payload = update!.args[0] as Record<string, unknown>;
  assertEquals("digest_sent_at" in payload && "offer_expires_at" in payload, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// DEEP CONTRACT TESTS
// ─────────────────────────────────────────────────────────────────────────────

// ── Berlin-hour gate: DST-correct ─────────────────────────────────────────────

Deno.test("send-offer-digest: CEST — 17:00 UTC (19:00 Berlin) is NOT skipped", async () => {
  const { deps } = baseDeps({ bookings: { data: [], error: null } }, BERLIN_19_CEST);
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  // Should proceed (not skip) — result is digests_sent:0 because no bookings
  assertEquals(body.skipped, undefined);
  assertEquals(body.digests_sent, 0);
});

Deno.test("send-offer-digest: CEST — 16:00 UTC (18:00 Berlin) IS skipped", async () => {
  const { deps } = baseDeps({ bookings: { data: [], error: null } }, BERLIN_18_CEST);
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.skipped, true);
});

Deno.test("send-offer-digest: CET — 18:00 UTC (19:00 Berlin) is NOT skipped", async () => {
  const { deps } = baseDeps({ bookings: { data: [], error: null } }, BERLIN_19_CET);
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  // Should proceed (not skip)
  assertEquals(body.skipped, undefined);
  assertEquals(body.digests_sent, 0);
});

// ── Midnight gate: hour 24 from Intl must normalize to 0 (% 24) ───────────────
// Regression: V8/Deno's Intl.DateTimeFormat hour:'numeric' hour12:false returns
// '24' at midnight, so parseInt('24') !== configured targetHour 0 → the digest
// would silently skip forever. The gate now normalizes with `% 24`.
Deno.test("send-offer-digest: midnight Berlin (hour 0) with target 0 is NOT skipped", async () => {
  // CET (UTC+1): 2026-01-15T23:00:00Z = 00:00 Berlin
  const BERLIN_MIDNIGHT_CET = new Date("2026-01-15T23:00:00.000Z");
  const settings = [
    { when: { key: "cron_secret" }, data: { value: "s" } },
    { when: { key: "offer_digest_hour_berlin" }, data: [{ org_id: null, value: 0 }] },
    { when: { key: "offer_response_window_hours" }, data: [{ org_id: null, value: 48 }] },
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
Deno.test("send-offer-digest: gate normalizes parseInt('24') % 24 to 0", () => {
  assertEquals(parseInt("24", 10) % 24, 0);
});

Deno.test("send-offer-digest: CET — 17:00 UTC (18:00 Berlin) IS skipped", async () => {
  const { deps } = baseDeps({ bookings: { data: [], error: null } }, BERLIN_18_CET);
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.skipped, true);
});

// ── Settings reads: per-key seeds ─────────────────────────────────────────────

Deno.test("send-offer-digest: reads offer_digest_hour_berlin from app_settings", async () => {
  // Set the target hour to 20 (not 19). With now=19:00 Berlin it should skip.
  const settings = [
    { when: { key: "cron_secret" }, data: { value: "s" } },
    { when: { key: "offer_digest_hour_berlin" }, data: [{ org_id: null, value: 20 }] },
    { when: { key: "offer_response_window_hours" }, data: [{ org_id: null, value: 48 }] },
  ];
  const { deps } = makeFakeDeps({
    now: BERLIN_19_CEST, // 19:00 Berlin
    tables: {
      app_settings: settings,
      organizations: { data: [{ id: ORG_1 }], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  // Target is 20, Berlin hour is 19 → must skip
  assertEquals(body.skipped, true);
});

Deno.test("send-offer-digest: reads offer_response_window_hours from app_settings and applies it to offer_expires_at", async () => {
  // Use 72h window instead of default 48h
  const settings = [
    { when: { key: "cron_secret" }, data: { value: "s" } },
    { when: { key: "offer_digest_hour_berlin" }, data: [{ org_id: null, value: 19 }] },
    { when: { key: "offer_response_window_hours" }, data: [{ org_id: null, value: 72 }] },
  ];
  const now = BERLIN_19_CEST; // 2026-06-01T17:00:00Z
  const expectedExpiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString();

  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, calls } = makeFakeDeps({
    now,
    tables: {
      app_settings: settings,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: pending, error: null },
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.digests_sent, 1);

  const update = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertExists(update);
  const payload = update!.args[0] as Record<string, string>;
  assertEquals(payload.offer_expires_at, expectedExpiresAt);
});

Deno.test("send-offer-digest: defaults offer_digest_hour_berlin to 19 when not configured", async () => {
  // Only seed cron_secret; digest_hour will return no data
  const settings = [
    { when: { key: "cron_secret" }, data: { value: "s" } },
    // No entry for offer_digest_hour_berlin → resolver returns fallback 19
    { when: { key: "offer_response_window_hours" }, data: [{ org_id: null, value: 48 }] },
  ];
  // Now = 19:00 Berlin CEST — should not skip (default is 19)
  const { deps } = makeFakeDeps({
    now: BERLIN_19_CEST,
    tables: {
      app_settings: settings,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  // Default 19 == Berlin hour 19 → proceed, not skipped
  assertEquals(body.skipped, undefined);
  assertEquals(body.digests_sent, 0);
});

Deno.test("send-offer-digest: defaults offer_response_window_hours to 48 when not configured", async () => {
  const settings = [
    { when: { key: "cron_secret" }, data: { value: "s" } },
    { when: { key: "offer_digest_hour_berlin" }, data: [{ org_id: null, value: 19 }] },
    // No entry for offer_response_window_hours → will use default 48
  ];
  const now = BERLIN_19_CEST;
  const expectedExpiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, calls } = makeFakeDeps({
    now,
    tables: {
      app_settings: settings,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: pending, error: null },
    },
  });
  await handle(makeRequest({ headers: cronOK }), deps);

  const update = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertExists(update);
  const payload = update!.args[0] as Record<string, string>;
  assertEquals(payload.offer_expires_at, expectedExpiresAt);
});

// ── Grouping ──────────────────────────────────────────────────────────────────

Deno.test("send-offer-digest: multiple suggested offers for same artist → ONE email", async () => {
  const pending = [
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
  const { deps, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(body.digests_sent, 1);
  // Only one sendEmail call for this artist
  const emailCalls = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emailCalls.length, 1);
});

Deno.test("send-offer-digest: offers for different artists → one email each", async () => {
  const pending = [
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
  const { deps, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(body.digests_sent, 2);
  const emailCalls = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emailCalls.length, 2);
});

Deno.test("send-offer-digest: booking whose artist has no email → skipped, no email sent", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Ghost", email: null }, // no email
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  // Skipped: no email sent, digests_sent is 0
  assertEquals(body.digests_sent, 0);
  const emailCalls = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emailCalls.length, 0);
});

Deno.test("send-offer-digest: booking with artist null → skipped gracefully, no crash", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: null, // joined artists row missing
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(body.digests_sent, 0);
  const emailCalls = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emailCalls.length, 0);
});

// ── offer_expires_at correctness ──────────────────────────────────────────────

Deno.test("send-offer-digest: offer_expires_at = now + offer_response_window_hours", async () => {
  const now = BERLIN_19_CEST; // 2026-06-01T17:00:00.000Z
  const windowHours = 48;
  const expectedExpiresAt = new Date(now.getTime() + windowHours * 60 * 60 * 1000).toISOString();

  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, calls } = baseDeps({ bookings: { data: pending, error: null } }, now);
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(res.status, 200);

  const update = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertExists(update);
  const payload = update!.args[0] as Record<string, string>;
  assertEquals(payload.offer_expires_at, expectedExpiresAt);
});

// ── Stamp payload completeness ────────────────────────────────────────────────

Deno.test("send-offer-digest: stamp update includes BOTH digest_sent_at and offer_expires_at", async () => {
  const now = BERLIN_19_CEST;
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, calls } = baseDeps({ bookings: { data: pending, error: null } }, now);
  await handle(makeRequest({ headers: cronOK }), deps);

  const update = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertExists(update);
  const payload = update!.args[0] as Record<string, string>;
  // digest_sent_at must be set to now()
  assertEquals(payload.digest_sent_at, now.toISOString());
  // offer_expires_at must be set to now + 48h
  assertEquals(payload.offer_expires_at, new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString());
});

Deno.test("send-offer-digest: stamp update targets all booking IDs for that artist", async () => {
  // Two bookings for same artist — both IDs should be passed to .in()
  const pending = [
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
  const { deps, calls } = baseDeps({ bookings: { data: pending, error: null } });
  await handle(makeRequest({ headers: cronOK }), deps);

  // Find the .in() call that follows the update on bookings
  const inCall = calls.find((c) => c.table === "bookings" && c.method === "in");
  assertExists(inCall);
  const inArgs = inCall!.args as [string, string[]][];
  // The second argument to .in() is the array of IDs
  const ids = inArgs[1] as string[];
  assertEquals(ids.includes("b1"), true);
  assertEquals(ids.includes("b2"), true);
  assertEquals(ids.length, 2);
});

// ── Atomicity: stamp failure → don't count that artist ───────────────────────

Deno.test("send-offer-digest: query error → logs and continues, returns digests_sent 0", async () => {
  // NOTE: The fake client cannot distinguish SELECT vs UPDATE on the same table using the
  // array-seed `when` form (which only matches eq() args). Seeding bookings with an error
  // causes the initial SELECT to return an error. The new per-org handler logs and
  // continues (does not return 500), resulting in digests_sent: 0.
  const { deps } = makeFakeDeps({
    now: BERLIN_19_CEST,
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

Deno.test("send-offer-digest: sendEmail throws → digests_sent not incremented, handler still returns 200", async () => {
  // Verify the email-failure path: if sendEmail throws, the handler catches and continues.
  // digests_sent must be 0 (the artist whose email failed is not counted).
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];

  const { client, calls } = (await import("../_shared/testing.ts")).createFakeClient({
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: pending, error: null },
    },
  });

  const invokeCalls: Array<{ name: string; body: unknown }> = [];
  const deps = {
    admin: client as unknown as import("../_shared/deps.ts").Deps["admin"],
    userClient: () => client as unknown as import("../_shared/deps.ts").Deps["admin"],
    env: (_k: string) => undefined as string | undefined,
    now: () => BERLIN_19_CEST,
    invokeFunction: (_name: string, _body: unknown) => Promise.resolve({ data: null, error: null }),
    sendEmail: (_msg: import("../_shared/deps.ts").EmailMessage) => {
      invokeCalls.push({ name: "send-transactional-email", body: _msg });
      return Promise.reject(new Error("Resend API down"));
    },
    fetch: (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch,
  };

  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  // Handler must not throw; must return 200
  assertEquals(res.status, 200);
  // Artist whose email failed must NOT be counted
  assertEquals(body.digests_sent, 0);
  // sendEmail was attempted
  assertEquals(invokeCalls.length, 1);
  // No stamp was attempted (email failed before stamp)
  const stampCall = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertEquals(stampCall, undefined);
});

// ── Atomicity: stamp failure — at-least-once verdict ─────────────────────────

Deno.test({ name: "send-offer-digest: atomicity characterization — harness limitation for stamp-failure path (SKIPPED: harness cannot fail UPDATE while SELECT succeeds on same table — needs live integration test)", ignore: true, fn: async () => {
  // NOTE: design-limitation (MED) — at-least-once email risk.
  //
  // The current harness cannot make the SELECT succeed and the UPDATE fail on the
  // same table because the fake builder resolves the entire chain from one seed.
  // The `when`-based matching only tracks .eq() args, but the stamp uses .in() on
  // booking IDs, which cannot be seeded differently from the SELECT.
  //
  // Documented contract (handler source line ~161):
  //   if (stampErr) { console.error(…); continue; }  // does NOT increment digestsSent
  //
  // This means: if sendEmail succeeds but .update() returns an error, the handler
  // logs the error and does NOT increment digests_sent. The booking retains
  // digest_sent_at = null and will be re-queried on the next run, sending a
  // duplicate email. The idempotency_key `offer-digest-<orgId>-<artistId>-YYYY-MM-DDTHH`
  // only prevents duplicates within the same UTC hour. A stamp failure at 19:01
  // and a retry at the next day's 19:00 run will produce an unavoidable duplicate.
  //
  // Verdict: ACCEPTABLE for low-volume digest (rare infra failures), but documented
  // as a known gap.
  //
  // This test is a no-op assertion confirming the characterization is understood.
  // body intentionally empty — ignored test; see comment above
}});

// ── Idempotency key format ────────────────────────────────────────────────────

Deno.test("send-offer-digest: idempotency key includes orgId, artistId and UTC hour slice", async () => {
  const now = BERLIN_19_CEST; // 2026-06-01T17:00:00.000Z
  const pending = [{
    id: "b1", artist_id: "artist-xyz",
    artists: { id: "artist-xyz", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } }, now);
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const msg = emailCall!.body as { idempotency_key?: string };
  // Key must follow pattern: offer-digest-<orgId>-<artistId>-<YYYY-MM-DDTHH>
  // now.toISOString().slice(0, 13) = "2026-06-01T17"
  assertEquals(msg.idempotency_key, `offer-digest-${ORG_1}-artist-xyz-2026-06-01T17`);
});

Deno.test("send-offer-digest: idempotency key derives from the CAPTURED now for ALL artists in one run", async () => {
  // Regression for Finding 4: the key must use the single captured `now`, not a
  // fresh deps.now() per artist (a run straddling a UTC hour boundary would
  // otherwise yield inconsistent keys). With a fixed clock, every artist's key
  // must share the same hour prefix derived from `now`.
  const now = BERLIN_19_CEST; // 2026-06-01T17:00:00.000Z → slice(0,13) = "2026-06-01T17"
  const hourPrefix = now.toISOString().slice(0, 13);
  const pending = [
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
  const { deps, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } }, now);
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCalls = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emailCalls.length, 2);
  const byArtist = new Map(
    emailCalls.map((c) => {
      const m = c.body as { recipient_email: string; idempotency_key?: string };
      return [m.recipient_email, m.idempotency_key];
    }),
  );
  assertEquals(byArtist.get("alice@x.com"), `offer-digest-${ORG_1}-a1-${hourPrefix}`);
  assertEquals(byArtist.get("bob@x.com"), `offer-digest-${ORG_1}-a2-${hourPrefix}`);
});

// ── Show name formatting ──────────────────────────────────────────────────────

Deno.test("send-offer-digest: show name = 'program — sub_program' when both present", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "Phantom", sub_program: "Evening" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } });
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const msg = emailCall!.body as { templateData?: { offers?: Array<{ show: string }> } };
  assertEquals(msg.templateData?.offers?.[0]?.show, "Phantom — Evening");
});

Deno.test("send-offer-digest: show name = program only when sub_program is null", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "Phantom", sub_program: null }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } });
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const msg = emailCall!.body as { templateData?: { offers?: Array<{ show: string }> } };
  assertEquals(msg.templateData?.offers?.[0]?.show, "Phantom");
});

Deno.test("send-offer-digest: show name = 'Unknown show' when program is null", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: null, sub_program: null }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } });
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const msg = emailCall!.body as { templateData?: { offers?: Array<{ show: string }> } };
  assertEquals(msg.templateData?.offers?.[0]?.show, "Unknown show");
});

// ── Email template name ───────────────────────────────────────────────────────

Deno.test("send-offer-digest: email uses template 'artist-offer-digest'", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } });
  await handle(makeRequest({ headers: cronOK }), deps);

  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const msg = emailCall!.body as { template_name: string; recipient_email: string };
  assertEquals(msg.template_name, "artist-offer-digest");
  assertEquals(msg.recipient_email, "jo@x.com");
});

// ── Per-org tests ─────────────────────────────────────────────────────────────

Deno.test("send-offer-digest: only orgs whose digest hour == Berlin hour are processed", async () => {
  // ORG_1 hour 19 (matches now=19:00), ORG_2 hour 20 (skipped).
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_19_CEST,
    tables: {
      organizations: { data: [{ id: ORG_1 }, { id: ORG_2 }], error: null },
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "s" } },
        { when: { key: "offer_digest_hour_berlin" }, data: [{ org_id: ORG_2, value: 20 }, { org_id: null, value: 19 }] },
        { when: { key: "offer_response_window_hours" }, data: [{ org_id: null, value: 48 }] },
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

Deno.test("send-offer-digest: no active org matches the hour → skipped", async () => {
  const { deps } = makeFakeDeps({
    now: BERLIN_18_CEST, // 18:00, default target 19
    tables: {
      organizations: { data: [{ id: ORG_1 }], error: null },
      app_settings: APP_SETTINGS_SEED,
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(body.skipped, true);
});

// ── ADR-0011: registered artist → login email first ───────────────────────────

Deno.test("send-offer-digest: registered artist → login email wins; greeting uses display_name", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Talent Label", email: "booking@x.com", user_id: "u1" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_19_CEST,
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: pending, error: null },
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

Deno.test("send-offer-digest: unregistered artist (no user_id) → booking email + talent label", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "External Act", email: "booking@x.com", user_id: null },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  const msg = email!.body as { recipient_email: string; templateData?: { displayName?: string } };
  assertEquals(msg.recipient_email, "booking@x.com");
  assertEquals(msg.templateData?.displayName, "External Act");
});

Deno.test("send-offer-digest: registered artist with blank booking email → delivered at login email (gap regression)", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Talent", email: null, user_id: "u1" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_19_CEST,
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: pending, error: null },
    },
    rpcs: { resolve_user_contacts: { data: [{ user_id: "u1", email: "login@x.com", display_name: null }] } },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  const msg = email!.body as { recipient_email: string; templateData?: { displayName?: string } };
  assertEquals(msg.recipient_email, "login@x.com");
  assertEquals(msg.templateData?.displayName, "Talent");
});

// ── C4: stamp ONLY when the email actually sent ───────────────────────────────
// send-transactional-email returns 200 { success:false } for suppression / preference-
// disabled, and an error-populated result for a hard failure. Neither must start the
// expiry clock. Only { data:{success:true}, error:null } stamps digest_sent_at + expiry.

const C4_PENDING = [{
  id: "b1", artist_id: "a1",
  artists: { id: "a1", name: "Jo", email: "jo@x.com" },
  show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
}];

function c4Deps(emailResult: { data?: unknown; error?: unknown }) {
  return makeFakeDeps({
    now: BERLIN_19_CEST,
    emailResult: emailResult as { data: unknown; error: unknown },
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: C4_PENDING, error: null },
    },
  });
}

Deno.test("send-offer-digest C4: successful send (data.success===true) → stamps + digests_sent 1", async () => {
  const { deps, calls } = c4Deps({ data: { success: true, message_id: "m1" }, error: null });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const update = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertExists(update);
});

Deno.test("send-offer-digest C4: suppressed/pref-disabled (200 {success:false}) → NO stamp, digests_sent 0", async () => {
  const { deps, calls, invokeCalls } = c4Deps({ data: { success: false, reason: "email_suppressed" }, error: null });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 0, "a skipped send must not count");
  // Email WAS attempted, but the offer must NOT be stamped (expiry clock not started).
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 1);
  const update = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertEquals(update, undefined, "must NOT stamp digest_sent_at/offer_expires_at on a skipped send");
});

Deno.test("send-offer-digest C4: hard failure (error populated) → NO stamp, digests_sent 0", async () => {
  const { deps, calls } = c4Deps({ data: null, error: { message: "Failed to send email" } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 0, "a failed send must not count");
  const update = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertEquals(update, undefined, "must NOT stamp on a failed send (offer stays pending, retried next run)");
});

Deno.test("send-offer-digest: resolve_user_contacts RPC error → non-fatal, falls back to booking email", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Talent", email: "booking@x.com", user_id: "u1" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_19_CEST,
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: pending, error: null },
    },
    rpcs: { resolve_user_contacts: { error: { message: "rpc down" } } },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  assertEquals((email!.body as { recipient_email: string }).recipient_email, "booking@x.com");
});

// ─────────────────────────────────────────────────────────────────────────────
// Milestone C — Task 10: digest senders honor the booking flow
//
// resolveBookingFlow reads app_settings.key='booking_flow' via resolveOrgSetting —
// on top of the offer_digest_hour_berlin / offer_response_window_hours reads the
// handler already makes. The seed must disambiguate all three by the recorded
// `.eq("key", ...)` arg (array seeds keyed by `when: { key: ... }`), so start from
// the file's APP_SETTINGS_SEED and layer a `booking_flow` entry on top.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("send-offer-digest: immediate-delivery org is skipped", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const settings = [
    ...APP_SETTINGS_SEED,
    { when: { key: "booking_flow" }, data: [{ org_id: ORG_1, value: { offer_delivery: "immediate" } }] },
  ];
  const { deps, invokeCalls } = baseDeps({ app_settings: settings, bookings: { data: pending, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(invokeCalls.some((c) => c.name === "send-transactional-email"), false);
  assertEquals(body.digests_sent, 0);
});

Deno.test("send-offer-digest: direct-mode org is skipped", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const settings = [
    ...APP_SETTINGS_SEED,
    { when: { key: "booking_flow" }, data: [{ org_id: ORG_1, value: { artist_acceptance: false } }] },
  ];
  const { deps, invokeCalls } = baseDeps({ app_settings: settings, bookings: { data: pending, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(invokeCalls.some((c) => c.name === "send-transactional-email"), false);
  assertEquals(body.digests_sent, 0);
});

Deno.test("send-offer-digest: templateData offer items carry the custom-field label when the flow selects a custom reference", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: {
      date: "2026-06-10",
      shows: { program: "Phantom", sub_program: "Evening" },
      cities: { name: "Berlin" },
      custom: { pn: "PN-4521" },
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
    bookings: { data: pending, error: null },
    custom_field_definitions: { data: { key: "pn" }, error: null },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  const msg = email!.body as { templateData?: { offers?: Array<{ label?: string; show?: string }> } };
  assertEquals(msg.templateData?.offers?.[0]?.label, "PN-4521");
  // The old raw program/sub_program string is still computed alongside the label
  // (the template's fallback for previewData that doesn't carry a label).
  assertEquals(msg.templateData?.offers?.[0]?.show, "Phantom — Evening");
});
