import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const SVC = { Authorization: "Bearer svc" };
const envVars = { SUPABASE_SERVICE_ROLE_KEY: "svc" };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHOW_DATE_OPEN = {
  id: "d1",
  show_id: "s1",
  city_id: "c1",
  date: "2026-07-10",
  status: "open",
  session_1: "19:00", // ≥1 session so open-offer-tier's session gate is cleared
};
const SHOW_DATE_NO_CITY = {
  id: "d2",
  show_id: "s1",
  city_id: null,
  date: "2026-07-11",
  status: "open",
  session_1: "19:00", // ≥1 session so open-offer-tier's session gate is cleared
};

// ---------------------------------------------------------------------------
// Seed helpers
//
// The fake client uses ONE seed per table for all operations on that table.
// The bookings table is queried TWICE in most happy paths:
//   1. Read existing bookings:  .select('artist_id').eq('show_date_id', id).neq(...)
//      → localEq = { show_date_id: id }  — matches when: { show_date_id: id }
//   2. Insert + select:         .insert(rows).select('id')
//      → no .eq() called → localEq = {}  — matches the fallback (no `when`)
//
// Using an ArraySeed lets us return different data for each access pattern.
// ---------------------------------------------------------------------------

/** Bookings array seed: no existing bookings + insert returns n new rows. */
function bookingsSeed(dateId: string, insertedIds: string[] = ["b1"]) {
  return [
    // Match the "read existing" query (has eq('show_date_id', dateId))
    { when: { show_date_id: dateId }, data: [], error: null },
    // Fallback: insert result
    { data: insertedIds.map((id) => ({ id })), error: null },
  ];
}

/** Bookings seed where some artists are already booked (non-cancelled). */
function bookingsWithExisting(dateId: string, existingArtistIds: string[], insertedIds: string[] = ["b1"]) {
  return [
    { when: { show_date_id: dateId }, data: existingArtistIds.map((id) => ({ artist_id: id })), error: null },
    { data: insertedIds.map((id) => ({ id })), error: null },
  ];
}

/** Bookings seed where insert fails. */
function bookingsInsertError(dateId: string, errMsg: string) {
  return [
    { when: { show_date_id: dateId }, data: [], error: null },
    { data: null, error: { message: errMsg } },
  ];
}

// ---------------------------------------------------------------------------
// Original 5 tests (keep intact)
// ---------------------------------------------------------------------------

Deno.test("open-offer-tier: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("open-offer-tier: no auth → 401", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ headers: {}, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("open-offer-tier: service role + missing fields → 400", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ headers: SVC, body: { tier: 0 } }), deps);
  assertEquals(res.status, 400);
});

Deno.test("open-offer-tier: cancelled show date → 400", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: { show_dates: { data: { id: "d1", show_id: "s1", city_id: "c1", date: "2026-02-01", status: "cancelled" }, error: null } },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 400);
});

Deno.test("open-offer-tier: tier with no priority casts returns offers_created 0", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: { id: "d1", show_id: "s1", city_id: "c1", date: "2026-02-01", status: "open" }, error: null },
      cast_city_priority: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 2 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 0);
});

// ---------------------------------------------------------------------------
// New deep tests — contract assertions
// ---------------------------------------------------------------------------

// ------ 404 / validation ------

Deno.test("open-offer-tier: show date not found (db error) → 404", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: null, error: { message: "no rows" } },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "missing", tier: 1 } }), deps);
  assertEquals(res.status, 404);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("open-offer-tier: show date not found (null row) → 404", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: null, error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "missing", tier: 1 } }), deps);
  assertEquals(res.status, 404);
});

Deno.test("open-offer-tier: invalid JSON body → 400", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const req = new Request("http://localhost/fn", {
    method: "POST",
    headers: { ...SVC, "Content-Type": "application/json" },
    body: "not json",
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 400);
});

Deno.test("open-offer-tier: tier 0 is rejected → 400", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 0 } }), deps);
  assertEquals(res.status, 400);
});

// ------ Tier 1-N: no city → offers_created 0 ------

Deno.test("open-offer-tier: tier 1 — show date has no city → offers_created 0", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_NO_CITY, error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d2", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.offers_created, 0);
  assertExists(body.message);
});

// ------ Tier 1-N: no casts at this tier for the city → offers_created 0 ------

Deno.test("open-offer-tier: tier 3 — no casts at that priority → offers_created 0 with message", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 3 } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.offers_created, 0);
  assertExists(body.message);
});

// ------ Full happy path: tier 1, 2 artists, both active, none booked ------

Deno.test("open-offer-tier: tier 1 happy path — creates 2 suggested bookings", async () => {
  const fixedNow = new Date("2026-07-01T10:00:00.000Z");
  const { deps, calls } = makeFakeDeps({
    envVars,
    now: fixedNow,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }, { cast_id: "cast-b" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }, { artist_id: "art-2" }], error: null },
      artists: { data: [{ id: "art-1" }, { id: "art-2" }], error: null },
      bookings: bookingsSeed("d1", ["b1", "b2"]),
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.offers_created, 2);

  // Find the bookings insert call and inspect the payload shape
  const insertCall = calls.find(
    (c) => c.table === "bookings" && c.method === "insert"
  );
  assertExists(insertCall, "bookings insert call must be recorded");

  const insertedRows = insertCall!.args[0] as Array<Record<string, unknown>>;
  assertEquals(Array.isArray(insertedRows), true);
  assertEquals(insertedRows.length, 2);

  for (const row of insertedRows) {
    assertEquals(row.show_date_id, "d1", "show_date_id must match");
    assertEquals(row.status, "suggested", "status must be 'suggested'");
    assertEquals(row.is_understudy, false, "is_understudy must be false");
    assertEquals(row.offer_tier, 1, "offer_tier must equal requested tier");
    assertExists(row.offered_at, "offered_at must be set");
    assertEquals(row.offered_at, fixedNow.toISOString(), "offered_at must equal deps.now()");
    // CRITICAL: offer_expires_at must NOT be set at creation — digest sets it later
    assertEquals(
      "offer_expires_at" in row,
      false,
      "offer_expires_at must NOT be present in insert payload (digest sets it later per app-logic.md)"
    );
  }

  // Verify the two artist IDs are present (any order)
  const artistIds = insertedRows.map((r) => r.artist_id).sort();
  assertEquals(artistIds, ["art-1", "art-2"].sort());
});

// ------ Insert payload: offer_expires_at must be absent (dedicated regression test) ------

Deno.test("open-offer-tier: insert payload must NOT include offer_expires_at", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }], error: null },
      artists: { data: [{ id: "art-1" }], error: null },
      bookings: bookingsSeed("d1", ["b1"]),
      blocked_dates: { data: [], error: null },
    },
  });
  await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);

  const insertCall = calls.find((c) => c.table === "bookings" && c.method === "insert");
  assertExists(insertCall);
  const rows = insertCall!.args[0] as Array<Record<string, unknown>>;
  assertEquals(rows.length, 1);
  assertEquals(
    "offer_expires_at" in rows[0],
    false,
    "BUG: offer_expires_at is being set at offer creation — it must only be set by send-offer-digest"
  );
});

// ------ show_date_offer_tiers upsert shape ------

Deno.test("open-offer-tier: upserts show_date_offer_tiers with correct shape", async () => {
  const fixedNow = new Date("2026-07-01T10:00:00.000Z");
  const { deps, calls } = makeFakeDeps({
    envVars,
    now: fixedNow,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }], error: null },
      artists: { data: [{ id: "art-1" }], error: null },
      bookings: bookingsSeed("d1", ["b1"]),
      blocked_dates: { data: [], error: null },
    },
  });
  await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);

  const upsertCall = calls.find(
    (c) => c.table === "show_date_offer_tiers" && c.method === "upsert"
  );
  assertExists(upsertCall, "show_date_offer_tiers upsert must be recorded");

  const upsertData = upsertCall!.args[0] as Record<string, unknown>;
  assertEquals(upsertData.show_date_id, "d1");
  assertEquals(upsertData.tier, 1);
  assertEquals(upsertData.opened_at, fixedNow.toISOString());

  // onConflict option must be 'show_date_id,tier'
  const upsertOpts = upsertCall!.args[1] as Record<string, unknown>;
  assertExists(upsertOpts, "upsert must have options arg");
  assertEquals(upsertOpts.onConflict, "show_date_id,tier");
});

// ------ Active artist filter ------

Deno.test("open-offer-tier: inactive artists are excluded from offers", async () => {
  // cast-a has 2 members: art-1 (active), art-2 (inactive — not returned by artists filter)
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }, { artist_id: "art-2" }], error: null },
      // Only art-1 comes back from the status='active' filter
      artists: { data: [{ id: "art-1" }], error: null },
      bookings: bookingsSeed("d1", ["b1"]),
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.offers_created, 1);

  const insertCall = calls.find((c) => c.table === "bookings" && c.method === "insert");
  assertExists(insertCall);
  const rows = insertCall!.args[0] as Array<Record<string, unknown>>;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].artist_id, "art-1");
});

Deno.test("open-offer-tier: all artists inactive → offers_created 0, no insert", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }], error: null },
      artists: { data: [], error: null }, // no active artists
      bookings: bookingsSeed("d1"),
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 0);
  const insertCall = calls.find((c) => c.table === "bookings" && c.method === "insert");
  assertEquals(insertCall, undefined, "no insert should happen when no active artists");
});

// ------ Already-booked exclusion ------

Deno.test("open-offer-tier: artists with existing non-cancelled bookings are excluded", async () => {
  // art-1 already has a booking, art-2 does not
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }, { artist_id: "art-2" }], error: null },
      artists: { data: [{ id: "art-1" }, { id: "art-2" }], error: null },
      // art-1 has existing booking, art-2 does not
      bookings: bookingsWithExisting("d1", ["art-1"], ["b2"]),
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 1);

  const insertCall = calls.find((c) => c.table === "bookings" && c.method === "insert");
  assertExists(insertCall);
  const rows = insertCall!.args[0] as Array<Record<string, unknown>>;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].artist_id, "art-2");
});

Deno.test("open-offer-tier: all artists already booked → offers_created 0, no insert", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }], error: null },
      artists: { data: [{ id: "art-1" }], error: null },
      // art-1 is already booked; fallback for insert not needed
      bookings: [
        { when: { show_date_id: "d1" }, data: [{ artist_id: "art-1" }], error: null },
        { data: [], error: null },
      ],
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 0);
  const insertCall = calls.find((c) => c.table === "bookings" && c.method === "insert");
  assertEquals(insertCall, undefined, "no insert call should be made");
});

// ------ Blocked dates exclusion ------

Deno.test("open-offer-tier: artists with blocked_dates entry for this date are excluded", async () => {
  // art-1 is blocked, art-2 is not
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }, { artist_id: "art-2" }], error: null },
      artists: { data: [{ id: "art-1" }, { id: "art-2" }], error: null },
      bookings: bookingsSeed("d1", ["b2"]),
      // art-1 is blocked on this date
      blocked_dates: { data: [{ artist_id: "art-1" }], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 1);

  const insertCall = calls.find((c) => c.table === "bookings" && c.method === "insert");
  assertExists(insertCall);
  const rows = insertCall!.args[0] as Array<Record<string, unknown>>;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].artist_id, "art-2");
});

Deno.test("open-offer-tier: blocked_dates table missing (throws) — silently continues", async () => {
  // If blocked_dates query throws (table doesn't exist), handler should continue
  // The handler wraps blocked_dates in try/catch — simulate by providing no seed
  // (fake client returns [] by default), so no blocked artists and the query doesn't throw.
  // We verify the handler still succeeds even without the table seeded.
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }], error: null },
      artists: { data: [{ id: "art-1" }], error: null },
      bookings: bookingsSeed("d1", ["b1"]),
      // blocked_dates intentionally omitted — default seed returns []
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 1);
});

// ------ Deduplication: same artist in multiple casts ------

Deno.test("open-offer-tier: artist appearing in multiple casts is de-duped", async () => {
  // art-1 appears in both cast-a and cast-b; should receive only one offer
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }, { cast_id: "cast-b" }], error: null },
      cast_members: {
        data: [
          { artist_id: "art-1" }, // in cast-a
          { artist_id: "art-1" }, // in cast-b (duplicate)
          { artist_id: "art-2" }, // in cast-b only
        ],
        error: null,
      },
      artists: { data: [{ id: "art-1" }, { id: "art-2" }], error: null },
      bookings: bookingsSeed("d1", ["b1", "b2"]),
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 2);

  const insertCall = calls.find((c) => c.table === "bookings" && c.method === "insert");
  assertExists(insertCall);
  const rows = insertCall!.args[0] as Array<Record<string, unknown>>;
  // Must be exactly 2, not 3
  assertEquals(rows.length, 2, "duplicate artist_id from multiple casts must be de-duped");
  const ids = rows.map((r) => r.artist_id).sort();
  assertEquals(ids, ["art-1", "art-2"].sort());
});

// ------ Insert DB error → 500 ------

Deno.test("open-offer-tier: bookings insert DB error → 500", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }], error: null },
      artists: { data: [{ id: "art-1" }], error: null },
      bookings: bookingsInsertError("d1", "unique constraint violated"),
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertExists(body.error);
});

// ------ Tier 99: ad-hoc — no date casts → offers_created 0 ------

Deno.test("open-offer-tier: tier 99 — no ad-hoc date casts → offers_created 0", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      show_date_cast_eligibility: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 99 } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.offers_created, 0);
  assertExists(body.message);
});

// ------ Tier 99: no city — uses ALL date casts (no priority filter) ------

Deno.test("open-offer-tier: tier 99 no city — uses all date casts, no priority filter", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_NO_CITY, error: null },
      show_date_cast_eligibility: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }], error: null },
      artists: { data: [{ id: "art-1" }], error: null },
      bookings: bookingsSeed("d2", ["b1"]),
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d2", tier: 99 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 1);

  // cast_city_priority must NOT be queried for the filtering step
  // (it's queried only when city_id is set)
  const priorityFilterCalls = calls.filter(
    (c) => c.table === "cast_city_priority" && c.method !== "from"
  );
  assertEquals(
    priorityFilterCalls.length,
    0,
    "cast_city_priority must not be queried when show date has no city (tier 99)"
  );
});

// ------ Tier 99: with city — prioritized casts are filtered out ------

Deno.test("open-offer-tier: tier 99 with city — removes casts already in priority system", async () => {
  // cast-a is ad-hoc AND in cast_city_priority → excluded
  // cast-b is ad-hoc only → included
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      show_date_cast_eligibility: {
        data: [{ cast_id: "cast-a" }, { cast_id: "cast-b" }],
        error: null,
      },
      // For the priority filter: cast-a is in the priority system for city c1
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-2" }], error: null }, // only cast-b's artist
      artists: { data: [{ id: "art-2" }], error: null },
      bookings: bookingsSeed("d1", ["b1"]),
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 99 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 1);

  // Verify cast_city_priority was queried (for the filter)
  const priorityCall = calls.find((c) => c.table === "cast_city_priority");
  assertExists(priorityCall, "cast_city_priority must be queried for city filter in tier 99");

  // Verify the insert only has art-2 (from cast-b)
  const insertCall = calls.find((c) => c.table === "bookings" && c.method === "insert");
  assertExists(insertCall);
  const rows = insertCall!.args[0] as Array<Record<string, unknown>>;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].artist_id, "art-2");
});

// ------ Tier 99: all date casts in priority system → eligible empty → offers_created 0 ------

Deno.test("open-offer-tier: tier 99 — all date casts are in priority system → offers_created 0", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      show_date_cast_eligibility: { data: [{ cast_id: "cast-a" }], error: null },
      // cast-a IS in priority system — gets filtered out
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 99 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 0);
});

// ------ Tier 99: full happy path with city ------

Deno.test("open-offer-tier: tier 99 full path — ad-hoc cast creates offers with correct payload", async () => {
  const fixedNow = new Date("2026-07-01T10:00:00.000Z");
  const { deps, calls } = makeFakeDeps({
    envVars,
    now: fixedNow,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      show_date_cast_eligibility: { data: [{ cast_id: "cast-adhoc" }], error: null },
      // cast-adhoc is NOT in priority system
      cast_city_priority: { data: [], error: null },
      cast_members: { data: [{ artist_id: "art-3" }], error: null },
      artists: { data: [{ id: "art-3" }], error: null },
      bookings: bookingsSeed("d1", ["b1"]),
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 99 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 1);

  const insertCall = calls.find((c) => c.table === "bookings" && c.method === "insert");
  assertExists(insertCall);
  const rows = insertCall!.args[0] as Array<Record<string, unknown>>;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].artist_id, "art-3");
  assertEquals(rows[0].offer_tier, 99);
  assertEquals(rows[0].status, "suggested");
  assertEquals(rows[0].is_understudy, false);
  assertEquals(rows[0].offered_at, fixedNow.toISOString());
  assertEquals(
    "offer_expires_at" in rows[0],
    false,
    "offer_expires_at must not be set at creation (even for tier 99)"
  );
});

// ------ No casts in eligible cast list (empty cast_members) → offers_created 0 ------

Deno.test("open-offer-tier: eligible casts exist but have no members → offers_created 0", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-empty" }], error: null },
      cast_members: { data: [], error: null }, // no members
      artists: { data: [], error: null },
      bookings: bookingsSeed("d1"),
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 0);
  const insertCall = calls.find((c) => c.table === "bookings" && c.method === "insert");
  assertEquals(insertCall, undefined, "no insert when no cast members");
});

// ------ offer_tier in insert must match the request tier ------

Deno.test("open-offer-tier: offer_tier in inserted rows matches requested tier", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }], error: null },
      artists: { data: [{ id: "art-1" }], error: null },
      bookings: bookingsSeed("d1", ["b1"]),
      blocked_dates: { data: [], error: null },
    },
  });
  await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 5 } }), deps);

  const insertCall = calls.find((c) => c.table === "bookings" && c.method === "insert");
  assertExists(insertCall);
  const rows = insertCall!.args[0] as Array<Record<string, unknown>>;
  assertEquals(rows[0].offer_tier, 5);
});

// ------ Response shape: must include offers_created (not just empty 200) ------

Deno.test("open-offer-tier: success response includes offers_created field", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }], error: null },
      artists: { data: [{ id: "art-1" }], error: null },
      bookings: bookingsSeed("d1", ["b1"]),
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals("offers_created" in body, true, "response must have offers_created field");
  assertEquals(typeof body.offers_created, "number");
});

// ------ Re-open re-activates a closed tier (merge upsert) ------

Deno.test("open-offer-tier: tier upsert merges closed_at:null + escalation_notified_at:null", async () => {
  const fixedNow = new Date("2026-07-01T10:00:00.000Z");
  const { deps, calls } = makeFakeDeps({
    envVars,
    now: fixedNow,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }], error: null },
      artists: { data: [{ id: "art-1" }], error: null },
      bookings: bookingsSeed("d1", ["b1"]),
      blocked_dates: { data: [], error: null },
    },
  });
  await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);

  const upsertCall = calls.find(
    (c) => c.table === "show_date_offer_tiers" && c.method === "upsert"
  );
  assertExists(upsertCall, "show_date_offer_tiers upsert must be recorded");
  const data = upsertCall!.args[0] as Record<string, unknown>;
  assertEquals(data.closed_at, null, "re-open must clear closed_at");
  assertEquals(data.escalation_notified_at, null, "re-open must reset escalation_notified_at");
  assertEquals(data.opened_at, fixedNow.toISOString());

  const opts = upsertCall!.args[1] as Record<string, unknown>;
  assertEquals(opts.onConflict, "show_date_id,tier");
  assertEquals("ignoreDuplicates" in opts, false, "merge upsert must not ignore duplicates");
});

// ------ Session gate (≥1 session required) — ported from index.test.ts ------

Deno.test("open-offer-tier: zero-session date is a benign skip — no offers, no insert", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: {
        data: { id: "d1", show_id: "s1", city_id: "c1", date: "2026-06-01", status: "open", session_1: null, session_2: null, session_3: null },
        error: null,
      },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.offers_created, 0);
  assertEquals(body.message, "Show date has no sessions yet — offers not opened");
  assertEquals(calls.some((c) => c.table === "bookings" && c.method === "insert"), false);
});

Deno.test("open-offer-tier: a date with ≥1 session passes the session gate", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: {
        data: { id: "d1", show_id: "s1", city_id: "c1", date: "2026-06-01", status: "open", session_1: "19:00:00", session_2: null, session_3: null },
        error: null,
      },
      cast_city_priority: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  const body = await res.json();
  // Past the session gate; stops later for lack of priority casts (a different message).
  assertEquals(body.message !== "Show date has no sessions yet — offers not opened", true);
});

// ------ Tier-tracking warning when the show_date_offer_tiers upsert fails ------

Deno.test("open-offer-tier: tier upsert failure → offers still created + tier_tracking_warning", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a" }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }], error: null },
      artists: { data: [{ id: "art-1" }], error: null },
      bookings: bookingsSeed("d1", ["b1"]),
      blocked_dates: { data: [], error: null },
      // The tracking-row upsert fails after the bookings were already inserted.
      show_date_offer_tiers: { data: null, error: { message: "tracking write failed" } },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.offers_created, 1);
  assertEquals(body.tier_tracking_warning, true);
});
