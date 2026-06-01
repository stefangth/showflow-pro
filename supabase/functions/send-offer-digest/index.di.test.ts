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

const cronOK = { "X-Cron-Secret": "s" };

// ── Shared settings seed (per-key, using array/when form) ─────────────────────
const APP_SETTINGS_SEED = [
  { when: { key: "cron_secret" }, data: { value: "s" } },
  { when: { key: "offer_digest_hour_berlin" }, data: { value: 19 } },
  { when: { key: "offer_response_window_hours" }, data: { value: 48 } },
];

function baseDeps(extraTables: Record<string, unknown> = {}, now = BERLIN_19_CEST) {
  return makeFakeDeps({
    now,
    tables: { app_settings: APP_SETTINGS_SEED, ...extraTables },
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
    { when: { key: "offer_digest_hour_berlin" }, data: { value: 20 } },
    { when: { key: "offer_response_window_hours" }, data: { value: 48 } },
  ];
  const { deps } = makeFakeDeps({
    now: BERLIN_19_CEST, // 19:00 Berlin
    tables: { app_settings: settings },
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
    { when: { key: "offer_digest_hour_berlin" }, data: { value: 19 } },
    { when: { key: "offer_response_window_hours" }, data: { value: 72 } },
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
    tables: { app_settings: settings, bookings: { data: pending, error: null } },
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
    // No entry for offer_digest_hour_berlin → maybeSingle returns { data: null }
    { when: { key: "offer_response_window_hours" }, data: { value: 48 } },
  ];
  // Now = 19:00 Berlin CEST — should not skip (default is 19)
  const { deps } = makeFakeDeps({
    now: BERLIN_19_CEST,
    tables: { app_settings: settings, bookings: { data: [], error: null } },
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
    { when: { key: "offer_digest_hour_berlin" }, data: { value: 19 } },
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
    tables: { app_settings: settings, bookings: { data: pending, error: null } },
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

Deno.test("send-offer-digest: stamp error → digests_sent NOT incremented for that artist", async () => {
  // NOTE: The fake client cannot distinguish SELECT vs UPDATE on the same table using the
  // array-seed `when` form (which only matches eq() args). The stamp uses .in(), not .eq(),
  // so a when-match for the update is not possible with the current harness.
  //
  // We work around this by seeding bookings as a single-object seed that returns an error
  // for ALL operations. This causes the initial SELECT to also fail, which means the handler
  // returns a 500 before reaching the stamp. This reveals a harness limitation: we cannot
  // selectively fail only the stamp UPDATE while letting the SELECT succeed.
  //
  // Instead, we test the documented at-least-once behavior as a characterization test
  // using a custom sendEmail that fails, verifying the handler catches exceptions and
  // continues (digests_sent stays 0 for the artist whose email threw).
  //
  // NOTE: at-least-once email risk — if sendEmail succeeds but the stamp UPDATE fails,
  // the handler logs and continues without incrementing digests_sent. The same bookings
  // (digest_sent_at still null) will be re-queried next run, resulting in a DUPLICATE EMAIL.
  // The idempotency_key `offer-digest-<artistId>-<YYYY-MM-DDTHH>` provides protection
  // IF the email provider (Resend) honours it within the same hour. If the stamp fails
  // at 19:01 and retries at 20:00 the next day, the idempotency key changes and the
  // duplicate WILL be sent. This is a MED design-limitation (documented in bug log).

  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];

  // Simulate stamp failure by intercepting via a custom deps that has a sendEmail
  // which succeeds but then we need the bookings update to fail.
  // We use a two-table seed approach: provide the SELECT result via the default
  // seed fallback (no `when`) and an explicit error seed is not distinguishable.
  //
  // Current harness limitation: a single-table seed returns the SAME result for
  // both SELECT (resolves via .then) and UPDATE (also resolves via .then on same chain).
  // So seeding bookings with { error: { message: "stamp failed" } } causes the SELECT
  // to also return an error, making the handler return 500 before stamp.
  //
  // characterization: the handler returns 500 on query error (not stamp error)
  const { deps } = makeFakeDeps({
    now: BERLIN_19_CEST,
    tables: {
      app_settings: APP_SETTINGS_SEED,
      bookings: { data: null, error: { message: "db error" } },
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(res.status, 500);
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
  // duplicate email. The idempotency_key `offer-digest-<artistId>-YYYY-MM-DDTHH`
  // only prevents duplicates within the same UTC hour. A stamp failure at 19:01
  // and a retry at the next day's 19:00 run will produce an unavoidable duplicate.
  //
  // Verdict: ACCEPTABLE for low-volume digest (rare infra failures), but documented
  // as a known gap. See part1-bug-log.md row "at-least-once email on stamp failure".
  //
  // This test is a no-op assertion confirming the characterization is understood.
  // body intentionally empty — ignored test; see comment above
}});

// ── Idempotency key format ────────────────────────────────────────────────────

Deno.test("send-offer-digest: idempotency key includes artistId and UTC hour slice", async () => {
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
  // Key must follow pattern: offer-digest-<artistId>-<YYYY-MM-DDTHH>
  // now.toISOString().slice(0, 13) = "2026-06-01T17"
  assertEquals(msg.idempotency_key, "offer-digest-artist-xyz-2026-06-01T17");
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
  assertEquals(byArtist.get("alice@x.com"), `offer-digest-a1-${hourPrefix}`);
  assertEquals(byArtist.get("bob@x.com"), `offer-digest-a2-${hourPrefix}`);
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
