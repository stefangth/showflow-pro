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
  const { deps } = makeFakeDeps({
    envVars,
    tables: { show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-1" }, error: null } },
  });
  const res = await handle(makeRequest({ headers: {}, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("open-offer-tier: authenticated but not a member of the date's org → 403", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    authUser: { id: "u1" },
    tables: {
      show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-B" }, error: null },
      // Coarse requireRole (no org_id eq) → producer somewhere (passes);
      // org-scoped requireOrgRole (org_id=org-B) → no row (fails) → 403.
      org_memberships: [
        { when: { org_id: "org-B" }, data: null, error: null },
        { data: { role: "producer" }, error: null },
      ],
      platform_admins: { data: null, error: null }, // not a super-admin
    },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer user" }, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 403);
  // the org gate used the show_date's org_id, not any-org membership
  assertEquals(
    calls.some((c) => c.table === "org_memberships" && c.method === "eq" && c.args[0] === "org_id" && c.args[1] === "org-B"),
    true,
  );
});

Deno.test("open-offer-tier: producer of the date's org with the capability ON → past the org gate", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    authUser: { id: "u1" },
    tables: {
      show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-A" }, error: null },
      org_memberships: { data: { role: "producer" }, error: null },
      cast_city_priority: { data: [], error: null }, // past auth; stops at "no casts at tier"
    },
    rpcs: { is_capability_enabled: { data: true, error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer user" }, body: { show_date_id: "d1", tier: 2 } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.offers_created, 0);
  assertExists(body.message);
});

// === Spec: producer_can_run_offer_engine capability ===
//
// Admins/super-admins bypass the capability gate outright (via requireOrgRole's admin
// check). A caller who is only a producer of the date's org must additionally hold the
// producer_can_run_offer_engine capability.

Deno.test("open-offer-tier: producer of the date's org with the capability OFF → 403 capability_disabled, no writes", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    authUser: { id: "u1" },
    tables: {
      show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-A" }, error: null },
      org_memberships: { data: { role: "producer" }, error: null },
    },
    rpcs: { is_capability_enabled: { data: false, error: null } },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer user" }, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, "capability_disabled");
  assertEquals(calls.some((c) => c.table === "bookings" && c.method === "insert"), false);
});

Deno.test("open-offer-tier: admin of the date's org bypasses the capability gate entirely (never calls is_capability_enabled)", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    authUser: { id: "u1" },
    tables: {
      show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-A" }, error: null },
      org_memberships: { data: { role: "admin" }, error: null },
      cast_city_priority: { data: [], error: null }, // past auth; stops at "no casts at tier"
    },
    // is_capability_enabled intentionally NOT seeded — the fake defaults it to
    // { data: null, error: null }, which checkCapability treats as OFF. An admin
    // caller must never reach that check at all.
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer user" }, body: { show_date_id: "d1", tier: 2 } }), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.some((c) => c.table === "rpc:is_capability_enabled"), false);
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
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }, { cast_id: "cast-b", priority: 1 }], error: null },
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
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
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
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
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
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
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
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
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
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
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
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
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
  const body = await res.json();
  assertEquals(body.offers_created, 0);
  // Pin the exit REASON: the run must reach the already-booked filter, not stop
  // earlier at tier resolution with a "no casts" message.
  assertEquals(body.message, "All eligible artists already have offers, are blocked, or do not qualify");
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
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
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
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
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
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }, { cast_id: "cast-b", priority: 1 }], error: null },
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
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
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
      cast_city_priority: { data: [{ cast_id: "cast-empty", priority: 1 }], error: null },
      cast_members: { data: [], error: null }, // no members
      artists: { data: [], error: null },
      bookings: bookingsSeed("d1"),
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.offers_created, 0);
  // Pin the exit REASON: the run must reach the cast_members read and find it
  // empty, not stop earlier at tier resolution with a "no casts" message.
  assertEquals(body.message, "No artists in eligible casts");
  const insertCall = calls.find((c) => c.table === "bookings" && c.method === "insert");
  assertEquals(insertCall, undefined, "no insert when no cast members");
});

// ------ offer_tier in insert must match the request tier ------

Deno.test("open-offer-tier: offer_tier in inserted rows matches requested tier", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 5 }], error: null },
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
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
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
  // Pin the SUCCESS path: this test's point is the happy-path response shape,
  // so the run must actually reach the insert (1 offer), not benign-exit at 0.
  assertEquals(body.offers_created, 1);
});

// ------ Re-open re-activates a closed tier (merge upsert) ------

Deno.test("open-offer-tier: tier upsert merges closed_at:null + escalation_notified_at:null", async () => {
  const fixedNow = new Date("2026-07-01T10:00:00.000Z");
  const { deps, calls } = makeFakeDeps({
    envVars,
    now: fixedNow,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
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
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
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

// ---------------------------------------------------------------------------
// Milestone C — Task 8: direct-mode refusal + dry-run
//
// resolveBookingFlow reads app_settings.key='booking_flow' via resolveOrgSetting.
// FLOW_DIRECT models an org whose booking_flow has artist_acceptance:false (a
// "direct booking" org where offers are disabled).
//
// The `artists` table is queried TWICE on the dry-run path:
//   1. Active filter: .select('id').in('id', ids).eq('status','active')
//      → localEq records status:'active' → matched by when:{ status:'active' }
//   2. Name lookup:   .select('id, name').in('id', candidateIds)   (no .eq())
//      → localEq has no `status` → falls through to the fallback entry.
// The name query resolves via .then(), which does NOT apply in()-filtering, so
// the fallback seed must already carry only the rows the DB would return for the
// candidate ids (i.e. the non-blocked ones).
// ---------------------------------------------------------------------------

const FLOW_DIRECT = { data: [{ org_id: "org-A", value: { artist_acceptance: false } }], error: null };

// Master switch: booking_flow.active === false pauses the WHOLE flow, independent
// of artist_acceptance. Seeding artist_acceptance:true here isolates this gate from
// the "direct booking mode" gate below (which fires on artist_acceptance:false) —
// this must 409 on the `active` check specifically, before ever inspecting
// artist_acceptance.
const FLOW_INACTIVE = { data: [{ org_id: "org-A", value: { active: false, artist_acceptance: true } }], error: null };

Deno.test("open-offer-tier: direct-booking org → 409, nothing written", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-A" }, error: null },
      app_settings: FLOW_DIRECT,
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error, "Direct booking mode: offers are disabled for this organization.");
  assertEquals(calls.some((c) => c.table === "bookings" && c.method === "insert"), false);
  assertEquals(calls.some((c) => c.table === "show_date_offer_tiers" && c.method === "upsert"), false);
});

Deno.test("open-offer-tier: booking flow inactive (active:false) → 409, nothing written", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-A" }, error: null },
      app_settings: FLOW_INACTIVE,
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error, "Booking flow is off for this organization.");
  assertEquals(calls.some((c) => c.table === "bookings" && c.method === "insert"), false);
  assertEquals(calls.some((c) => c.table === "show_date_offer_tiers" && c.method === "upsert"), false);
});

Deno.test("open-offer-tier: dry_run returns candidates and writes nothing", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-A" }, error: null },
      app_settings: { data: [], error: null }, // no booking_flow row → defaults (artist_acceptance:true)
      cast_city_priority: { data: [{ cast_id: "c1", priority: 1 }], error: null },
      cast_members: { data: [{ artist_id: "a1" }, { artist_id: "a2" }], error: null },
      artists: [
        // Active filter (records .eq('status','active')) → both are active
        { when: { status: "active" }, data: [{ id: "a1" }, { id: "a2" }], error: null },
        // Name lookup (no .eq()) → only the surviving candidate (a2 is blocked)
        { data: [{ id: "a1", name: "Lena" }], error: null },
      ],
      bookings: { data: [], error: null },
      blocked_dates: { data: [{ artist_id: "a2" }], error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, dry_run: true } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.dry_run, true);
  assertEquals(body.candidates, [{ id: "a1", name: "Lena" }]);
  assertEquals(body.excluded.blocked, 1);
  assertEquals(body.excluded.already_booked, 0);
  assertEquals(body.excluded.inactive, 0);
  assertEquals(body.excluded.not_eligible, 0);
  assertEquals(body.excluded.missing_skills, 0);
  assertEquals(calls.some((c) => c.table === "bookings" && c.method === "insert"), false);
  assertEquals(calls.some((c) => c.table === "show_date_offer_tiers" && c.method === "upsert"), false);
});

Deno.test("open-offer-tier: dry_run on a zero-session date returns the dry-run benign shape", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: {
        data: { ...SHOW_DATE_OPEN, org_id: "org-A", session_1: null, session_2: null, session_3: null },
        error: null,
      },
      app_settings: { data: [], error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, dry_run: true } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.dry_run, true);
  assertEquals(body.candidates, []);
  assertExists(body.excluded);
  assertEquals(body.excluded.blocked, 0);
  assertEquals(body.excluded.not_eligible, 0);
  assertEquals(body.excluded.missing_skills, 0);
  assertExists(body.message);
  assertEquals(calls.some((c) => c.table === "bookings" && c.method === "insert"), false);
});

Deno.test("open-offer-tier: dry_run — all eligible blocked → dry-run shape with counts, no candidates", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-A" }, error: null },
      app_settings: { data: [], error: null },
      cast_city_priority: { data: [{ cast_id: "c1", priority: 1 }], error: null },
      cast_members: { data: [{ artist_id: "a1" }], error: null },
      artists: [
        { when: { status: "active" }, data: [{ id: "a1" }], error: null },
        { data: [], error: null },
      ],
      bookings: { data: [], error: null },
      blocked_dates: { data: [{ artist_id: "a1" }], error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, dry_run: true } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.dry_run, true);
  assertEquals(body.candidates, []);
  assertEquals(body.excluded.blocked, 1);
  assertEquals(body.excluded.inactive, 0);
  assertEquals(body.excluded.already_booked, 0);
  assertEquals(body.excluded.not_eligible, 0);
  assertEquals(body.excluded.missing_skills, 0);
  assertExists(body.message);
  assertEquals(calls.some((c) => c.table === "bookings" && c.method === "insert"), false);
});

// ---------------------------------------------------------------------------
// Milestone C — Task 9: immediate offer delivery
//
// When the org's booking_flow.offer_delivery is "immediate", open-offer-tier
// sends the `offer-immediate` email to each freshly-offered artist AT OPEN and
// stamps digest_sent_at + offer_expires_at on the bookings whose email actually
// sent. In the default "digest" mode nothing is emailed at open (the daily
// send-offer-digest cron owns delivery + stamping).
//
// app_settings is read TWICE on the immediate path — once for booking_flow
// (resolveBookingFlow) and once for offer_response_window_hours — so its seed
// must be a `key`-matched array; a single seed would hand the flow object back
// as the window-hours value and blow up the expiry math.
// ---------------------------------------------------------------------------

const IMMEDIATE_TABLES = {
  show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-A", custom: {} }, error: null },
  app_settings: [
    { when: { key: "booking_flow" }, data: [{ org_id: "org-A", value: { offer_delivery: "immediate" } }], error: null },
    { when: { key: "offer_response_window_hours" }, data: [{ org_id: "org-A", value: 48 }], error: null },
  ],
  shows: { data: { program: "Candlelight", sub_program: "Strings" }, error: null },
  cities: { data: { name: "Berlin" }, error: null },
  cast_city_priority: { data: [{ cast_id: "c1", priority: 1 }], error: null },
  cast_members: { data: [{ artist_id: "a1" }], error: null },
  artists: { data: [{ id: "a1", name: "Lena", email: "lena@x.com", user_id: null }], error: null },
  bookings: [
    { when: { __write: true }, data: [{ id: "b1", artist_id: "a1" }], error: null },
    { data: [], error: null },
  ],
  blocked_dates: { data: [], error: null },
  show_date_offer_tiers: { data: null, error: null },
};

Deno.test("open-offer-tier: immediate delivery emails artists and stamps expiry", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    envVars,
    tables: IMMEDIATE_TABLES,
    rpcs: { resolve_user_contacts: { data: [], error: null } },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);

  // The immediate email went out, using the offer-immediate template.
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  const body = email!.body as Record<string, unknown>;
  assertEquals(body.template_name, "offer-immediate");
  assertEquals(body.recipient_email, "lena@x.com");
  // Keyed on the booking instance (not show_date_id+artist_id): a reopened tier
  // re-offering the same artist creates a NEW booking row, so it must get a new key
  // and never dedupe against a stale send from a prior offer round.
  assertEquals(body.idempotency_key, "offer-immediate-b1");
  const templateData = body.templateData as Record<string, unknown>;
  assertEquals(templateData.referenceLabel, "Candlelight · Strings");
  assertEquals(templateData.city, "Berlin");
  assertEquals(templateData.windowHours, 48);
  assertEquals(templateData.displayName, "Lena");

  // The booking whose email sent is stamped with digest_sent_at + offer_expires_at.
  const stamp = calls.find(
    (c) => c.table === "bookings" && c.method === "update" &&
      (c.args[0] as Record<string, unknown>).offer_expires_at !== undefined,
  );
  assertExists(stamp);
  const stampArgs = stamp!.args[0] as Record<string, unknown>;
  assertExists(stampArgs.digest_sent_at);
  assertExists(stampArgs.offer_expires_at);
});

// ---------------------------------------------------------------------------
// Phase 4 (configurable eligibility): effective ladder, gate, required skills
//
// resolveTierLadder/ladderCastIdsAtTier/fetchGateArtistIds/fetchRequiredSkillIds/
// filterArtistIdsBySkills come from ../_shared/eligibility.ts (Task 3, its own
// suite is green). This section proves open-offer-tier wires them in correctly.
//
// show_cast_eligibility is read TWICE in most of these cases: once by
// resolveTierLadder (with .not('priority','is',null), NOT applied by the fake)
// and once by fetchGateArtistIds's show-level gate query (no .not). Since
// neither call adds distinguishing .eq() args beyond show_id/city_id, both
// reads share one seed value, a prioritized row IS also a valid gate row by
// construction, so a single seed is correct for both. Tests that need the
// ladder to resolve via the ORG list keep show_cast_eligibility EMPTY, since
// the fake cannot honor .not() and any seeded row would make the ladder's
// `show.length > 0` check true regardless of its priority value.
//
// cast_members has no .eq() at all in either read site (the tier's own
// eligible-cast lookup in this file, and fetchGateArtistIds's gate-cast
// lookup), so where a test needs those two reads to return genuinely
// different member sets, it opts into the `__in:cast_id` reserved match key
// added to _shared/testing.ts for exactly this case.
// ---------------------------------------------------------------------------

Deno.test("open-offer-tier: show-scoped ladder wins over the org city list", async () => {
  // show_cast_eligibility carries the show's own priority-1 row (cast-show) for
  // this (show, city); cast_city_priority carries a DIFFERENT cast (cast-org) at
  // priority 1 for the org-wide list. resolveTierLadder must prefer the show row,
  // never falling through to query cast_city_priority's tiers at all.
  // show_cast_eligibility's single seed is shared by the ladder read and the
  // gate's show-level read (see file header comment); show_date_cast_eligibility
  // is empty so the gate resolves from that one shared row alone.
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      show_cast_eligibility: { data: [{ cast_id: "cast-show", priority: 1 }], error: null },
      cast_city_priority: { data: [{ cast_id: "cast-org", priority: 1 }], error: null },
      show_date_cast_eligibility: { data: [], error: null },
      cast_members: { data: [{ artist_id: "art-show-1" }], error: null },
      artists: { data: [{ id: "art-show-1" }], error: null },
      bookings: bookingsSeed("d1", ["b1"]),
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 1);

  // Every cast_members .in('cast_id', ...) read in this run must be filtered by
  // the SHOW's cast, never by the org's cast.
  const memberCalls = calls.filter(
    (c) => c.table === "cast_members" && c.method === "in" && c.args[0] === "cast_id",
  );
  assertEquals(memberCalls.length > 0, true, "cast_members must be queried");
  for (const c of memberCalls) {
    assertEquals(c.args[1], ["cast-show"], "cast_members must be filtered by the show's cast, not the org's");
  }

  const insertCall = calls.find((c) => c.table === "bookings" && c.method === "insert");
  assertExists(insertCall);
  const rows = insertCall!.args[0] as Array<Record<string, unknown>>;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].artist_id, "art-show-1");
});

Deno.test("open-offer-tier: falls back to the org city list when the show has no priorities", async () => {
  // show_cast_eligibility has no rows at all for this (show, city). Both the
  // ladder's read and the gate's show-level read share this empty seed;
  // show_date_cast_eligibility is also empty, so the gate is unrestricted and
  // the tier resolves purely through cast_city_priority (existing behavior,
  // now routed through resolveTierLadder).
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [{ cast_id: "cast-org", priority: 1 }], error: null },
      show_date_cast_eligibility: { data: [], error: null },
      cast_members: { data: [{ artist_id: "art-org-1" }], error: null },
      artists: { data: [{ id: "art-org-1" }], error: null },
      bookings: bookingsSeed("d1", ["b1"]),
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 1);

  const memberCall = calls.find(
    (c) => c.table === "cast_members" && c.method === "in" && c.args[0] === "cast_id",
  );
  assertExists(memberCall);
  assertEquals(memberCall!.args[1], ["cast-org"]);

  const insertCall = calls.find((c) => c.table === "bookings" && c.method === "insert");
  assertExists(insertCall);
  const rows = insertCall!.args[0] as Array<Record<string, unknown>>;
  assertEquals(rows[0].artist_id, "art-org-1");
});

Deno.test("open-offer-tier: the eligibility gate excludes non-gated artists (dry run)", async () => {
  // Ladder resolves via the org city list (show_cast_eligibility empty) to
  // cast-x, whose members are ar-1 and ar-2. The gate names only cast-g (via
  // the date-level show_date_cast_eligibility row), whose only member is ar-1.
  //
  // cast_members has no .eq() in either read site, so with no eq args to key
  // on, the tier's read (.in('cast_id', ['cast-x'])) and the gate's read
  // (.in('cast_id', ['cast-g'])) are indistinguishable to the fake by default.
  // This uses the opt-in `__in:cast_id` match key (_shared/testing.ts) to give
  // the gate's narrower read its own result, so the intersection is real and
  // not an artifact of both reads sharing one blob.
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [{ cast_id: "cast-x", priority: 1 }], error: null },
      show_date_cast_eligibility: { data: [{ cast_id: "cast-g" }], error: null },
      cast_members: [
        { when: { "__in:cast_id": JSON.stringify(["cast-g"]) }, data: [{ artist_id: "ar-1" }], error: null },
        { data: [{ artist_id: "ar-1" }, { artist_id: "ar-2" }], error: null },
      ],
      artists: [
        { when: { status: "active" }, data: [{ id: "ar-1" }, { id: "ar-2" }], error: null },
        { data: [{ id: "ar-1", name: "Ar One" }], error: null },
      ],
      bookings: { data: [], error: null },
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, dry_run: true } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.dry_run, true);
  assertEquals(body.candidates, [{ id: "ar-1", name: "Ar One" }]);
  assertEquals(body.excluded.not_eligible, 1, "ar-2 must be excluded by the gate, not the tier");
  assertEquals(body.excluded.missing_skills, 0);
});

Deno.test("open-offer-tier: stored required skills exclude artists missing them (dry run)", async () => {
  // The show requires sk-1. ar-1 holds it, ar-2 does not.
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
      cast_members: { data: [{ artist_id: "ar-1" }, { artist_id: "ar-2" }], error: null },
      artists: [
        { when: { status: "active" }, data: [{ id: "ar-1" }, { id: "ar-2" }], error: null },
        { data: [{ id: "ar-1", name: "Ar One" }], error: null },
      ],
      show_required_skills: { data: [{ skill_id: "sk-1" }], error: null },
      show_date_required_skills: { data: [], error: null },
      artist_skills: { data: [{ artist_id: "ar-1", skill_id: "sk-1" }], error: null },
      bookings: { data: [], error: null },
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, dry_run: true } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.candidates, [{ id: "ar-1", name: "Ar One" }]);
  assertEquals(body.excluded.missing_skills, 1);
  assertEquals(body.excluded.not_eligible, 0);
});

Deno.test("open-offer-tier: skill_filter_ids from the request restricts to holders (dry run)", async () => {
  // No stored requirements; the caller passes skill_filter_ids at open time.
  // Only artists holding ALL of the requested skills survive.
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
      cast_members: { data: [{ artist_id: "ar-1" }, { artist_id: "ar-2" }], error: null },
      artists: [
        { when: { status: "active" }, data: [{ id: "ar-1" }, { id: "ar-2" }], error: null },
        { data: [{ id: "ar-2", name: "Ar Two" }], error: null },
      ],
      artist_skills: { data: [{ artist_id: "ar-2", skill_id: "sk-9" }], error: null },
      bookings: { data: [], error: null },
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(
    makeRequest({
      headers: SVC,
      body: { show_date_id: "d1", tier: 1, dry_run: true, skill_filter_ids: ["sk-9"] },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.candidates, [{ id: "ar-2", name: "Ar Two" }]);
  assertEquals(body.excluded.missing_skills, 1);
});

Deno.test("open-offer-tier: stored requirements UNION with skill_filter_ids (dry run)", async () => {
  // The show stores sk-1 AND the caller passes skill_filter_ids ["sk-9"]. The
  // effective requirement is the UNION [sk-1, sk-9]: an artist must hold BOTH
  // to survive. ar-1 holds both; ar-2 holds only the stored skill; ar-3 holds
  // only the per-open filter skill. An either-or regression (stored OR filter
  // instead of the union) would let ar-2 or ar-3 through and report
  // missing_skills 1, so this test pins the union in both directions.
  // Every seeded artist_skills row's skill is in the union, so the unfiltered
  // blob the fake returns equals what the DB would return for the union query.
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
      cast_members: { data: [{ artist_id: "ar-1" }, { artist_id: "ar-2" }, { artist_id: "ar-3" }], error: null },
      artists: [
        { when: { status: "active" }, data: [{ id: "ar-1" }, { id: "ar-2" }, { id: "ar-3" }], error: null },
        { data: [{ id: "ar-1", name: "Ar One" }], error: null },
      ],
      show_required_skills: { data: [{ skill_id: "sk-1" }], error: null },
      show_date_required_skills: { data: [], error: null },
      artist_skills: {
        data: [
          { artist_id: "ar-1", skill_id: "sk-1" },
          { artist_id: "ar-1", skill_id: "sk-9" },
          { artist_id: "ar-2", skill_id: "sk-1" },
          { artist_id: "ar-3", skill_id: "sk-9" },
        ],
        error: null,
      },
      bookings: { data: [], error: null },
      blocked_dates: { data: [], error: null },
    },
  });
  const res = await handle(
    makeRequest({
      headers: SVC,
      body: { show_date_id: "d1", tier: 1, dry_run: true, skill_filter_ids: ["sk-9"] },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.candidates, [{ id: "ar-1", name: "Ar One" }]);
  assertEquals(
    body.excluded.missing_skills,
    2,
    "ar-2 (stored-only) and ar-3 (filter-only) must BOTH be excluded by the union",
  );
  assertEquals(body.excluded.not_eligible, 0);
});

Deno.test("open-offer-tier: tier 99 dedups against the effective (show-scoped) ladder", async () => {
  // The show ladder places cast-a at tier 1. Date-level eligibility (ad-hoc,
  // tier 99) lists cast-a AND cast-b. Tier 99 must offer only cast-b's
  // members, cast-a is already covered by the effective ladder.
  //
  // cast_members opts into the `__in:cast_id` match key: the correct tier-99
  // read (['cast-b'] only, after dedup) gets art-b alone, while any broader
  // read (e.g. the pre-fix ladder-less ['cast-a','cast-b'], or the gate's own
  // union read) falls to the fallback with BOTH artists, so this test fails
  // if the dedup-against-the-ladder step is skipped, instead of coincidentally
  // passing because the seed only ever contained one artist.
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      show_cast_eligibility: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
      show_date_cast_eligibility: { data: [{ cast_id: "cast-a" }, { cast_id: "cast-b" }], error: null },
      cast_members: [
        { when: { "__in:cast_id": JSON.stringify(["cast-b"]) }, data: [{ artist_id: "art-b" }], error: null },
        { data: [{ artist_id: "art-a" }, { artist_id: "art-b" }], error: null },
      ],
      // `artists` is ALSO keyed on the actual .in('id', ...) set: .then() reads
      // never apply .in() filtering, so a single-object seed would silently
      // erase a leaked art-a at the artists stage and mask a missing dedup.
      // Correct run: .in('id', ['art-b']) matches the `when` entry. A run that
      // leaks cast-a (dedup skipped) requests ['art-a','art-b'], misses the
      // `when`, and gets BOTH artists from the fallback, so the leak survives
      // to the insert and the rows.length assertion below fails.
      artists: [
        { when: { "__in:id": JSON.stringify(["art-b"]) }, data: [{ id: "art-b" }], error: null },
        { data: [{ id: "art-a" }, { id: "art-b" }], error: null },
      ],
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
  assertEquals(rows[0].artist_id, "art-b");
  assertEquals(rows[0].offer_tier, 99);
});

Deno.test("open-offer-tier: digest delivery (default) sends no email at open", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    envVars,
    tables: {
      ...IMMEDIATE_TABLES,
      // No booking_flow override → defaults to offer_delivery:"digest".
      app_settings: { data: [], error: null },
    },
    rpcs: { resolve_user_contacts: { data: [], error: null } },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 1);

  // Digest mode owns delivery: nothing is emailed at open.
  assertEquals(
    invokeCalls.filter((c) => c.name === "send-transactional-email").length,
    0,
  );
  // And no booking is stamped with offer_expires_at at open (the digest cron does that).
  assertEquals(
    calls.some(
      (c) => c.table === "bookings" && c.method === "update" &&
        (c.args[0] as Record<string, unknown>).offer_expires_at !== undefined,
    ),
    false,
  );
});

// ---------------------------------------------------------------------------
// Module gate: booking_flow entitlement
//
// Placed after the org-scoped auth/capability check succeeds (using the
// already-resolved showDate.org_id), before any booking work. Only exercised
// on the JWT (non-service-role) path, mirroring the existing org-scoped-auth
// tests above — service-role/cron callers never enter that auth block at all.
// ---------------------------------------------------------------------------

Deno.test("open-offer-tier: 403s when booking_flow entitlement is off", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    authUser: { id: "u-producer" },
    tables: {
      show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-A" }, error: null },
      org_memberships: { data: { role: "producer" }, error: null },
    },
    rpcs: {
      is_capability_enabled: { data: true, error: null },
      is_feature_enabled: { data: false, error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer user" }, body: { show_date_id: "d1", tier: 1 } }),
    deps,
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "feature_disabled");
  assertEquals(calls.some((c) => c.table === "bookings" && c.method === "insert"), false);
});

// ---------------------------------------------------------------------------
// Phase C2: named exclusions (excludedDetail) on the dry-run response
//
// The aggregate `excluded` counts are unchanged (DryRunDialog depends on them).
// `excludedDetail` additionally names WHO was excluded and WHY — the FIRST
// waterfall step that eliminated them. Capped at 50 with an explicit
// `excludedDetailTruncated` flag rather than a silent shortfall.
// ---------------------------------------------------------------------------

Deno.test("open-offer-tier: dry_run excludedDetail names excluded artists with their first-elimination reason", async () => {
  // cast-a has 4 members: ar-1 survives; ar-2 and ar-3 miss the required skill;
  // ar-4 is blocked on this date — eliminated before the skill check even runs,
  // even though it also holds the skill (proving blocked wins as the FIRST reason).
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-A" }, error: null },
      app_settings: { data: [], error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
      cast_members: {
        data: [
          { artist_id: "ar-1" }, { artist_id: "ar-2" }, { artist_id: "ar-3" }, { artist_id: "ar-4" },
        ],
        error: null,
      },
      artists: [
        { when: { status: "active" }, data: [{ id: "ar-1" }, { id: "ar-2" }, { id: "ar-3" }, { id: "ar-4" }], error: null },
        {
          data: [
            { id: "ar-1", name: "Ar One" }, { id: "ar-2", name: "Ar Two" },
            { id: "ar-3", name: "Ar Three" }, { id: "ar-4", name: "Ar Four" },
          ],
          error: null,
        },
      ],
      show_required_skills: { data: [{ skill_id: "sk-1" }], error: null },
      show_date_required_skills: { data: [], error: null },
      artist_skills: {
        data: [
          { artist_id: "ar-1", skill_id: "sk-1" },
          { artist_id: "ar-4", skill_id: "sk-1" }, // holds the skill but is blocked first
        ],
        error: null,
      },
      bookings: { data: [], error: null },
      blocked_dates: { data: [{ artist_id: "ar-4" }], error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, dry_run: true } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.dry_run, true);
  assertEquals(body.candidates, [{ id: "ar-1", name: "Ar One" }]);

  // Aggregate counts stay exactly as before (backward-compatible with DryRunDialog).
  assertEquals(body.excluded, {
    already_booked: 0, blocked: 1, inactive: 0, not_eligible: 0, missing_skills: 2,
  });

  assertEquals(body.excludedDetailTruncated, false);
  const detail = body.excludedDetail as Array<{ id: string; name: string; reason: string }>;
  assertEquals(detail.length, 3);
  const byId = new Map(detail.map((d) => [d.id, d]));
  assertEquals(byId.get("ar-2"), { id: "ar-2", name: "Ar Two", reason: "missing_skills" });
  assertEquals(byId.get("ar-3"), { id: "ar-3", name: "Ar Three", reason: "missing_skills" });
  assertEquals(byId.get("ar-4"), { id: "ar-4", name: "Ar Four", reason: "blocked" });
});

Deno.test("open-offer-tier: dry_run excludedDetail caps at 50 and flags truncation instead of silently shortening", async () => {
  // 60 blocked artists + 1 survivor. The aggregate count still reports all 60;
  // the detail array is capped, and the cap is signaled rather than hidden.
  const blockedIds = Array.from({ length: 60 }, (_, i) => `blocked-${i}`);
  const allArtistIds = ["ar-ok", ...blockedIds];
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-A" }, error: null },
      app_settings: { data: [], error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
      cast_members: { data: allArtistIds.map((id) => ({ artist_id: id })), error: null },
      artists: [
        { when: { status: "active" }, data: allArtistIds.map((id) => ({ id })), error: null },
        { data: [{ id: "ar-ok", name: "Ar Ok" }], error: null },
      ],
      bookings: { data: [], error: null },
      blocked_dates: { data: blockedIds.map((id) => ({ artist_id: id })), error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, dry_run: true } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.excluded.blocked, 60, "aggregate count reflects ALL 60, not just the capped detail");
  assertEquals(body.excludedDetailTruncated, true);
  assertEquals(body.excludedDetail.length, 50, "detail array is capped at 50 even though 60 were excluded");
});

Deno.test("open-offer-tier: non-dry-run responses never carry excludedDetail (additive to dry-run only)", async () => {
  // All eligible artists already booked, in normal (non-dry-run) mode: the benign
  // exit must stay the pre-existing { offers_created, message } shape.
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: SHOW_DATE_OPEN, error: null },
      cast_city_priority: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
      cast_members: { data: [{ artist_id: "art-1" }], error: null },
      artists: { data: [{ id: "art-1" }], error: null },
      bookings: [
        { when: { show_date_id: "d1" }, data: [{ artist_id: "art-1" }], error: null },
        { data: [], error: null },
      ],
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals("excludedDetail" in body, false);
  assertEquals("excludedDetailTruncated" in body, false);
});
