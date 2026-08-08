/**
 * Deep DI tests for tier-at-risk-watcher — exercises the real handle() function.
 *
 * Coverage:
 *  - Auth: cron-secret, admin/producer JWT, invalid auth → 401/403
 *  - Response shape: { at_risk_count, cleared }
 *  - No open tiers → 0/0 shape
 *  - DB error on tier fetch → 500
 *  - Unconfigured slots (no slotDefaults entry) → tier skipped, no notification
 *  - requiredSlots == 0 (main_cast + understudies = 0) → tier skipped
 *  - Healthy tier (pending+accepted >= required) → no notification
 *  - At-risk tier → notification inserted per recipient, correct fields
 *  - Idempotency: existing notification for (tier, user) → no duplicate insert
 *  - Partial idempotency: one user has existing notif, another does not → only new one inserted
 *  - Dedupe: duplicate producer_user_id from RPC → one notification per unique user
 *  - Admin fallback: empty producers → falls back to the org's org_memberships admins
 *  - Recovery: existing tier_at_risk notification for no-longer-at-risk tier → deleted
 *  - Recovery precision: at-risk tier's notification NOT deleted; only recovered tier's deleted
 *  - Lifecycle: at-risk → created; recovered → deleted; re-at-risk → re-created
 *  - Multiple tiers: mixed at-risk + healthy, counts correct
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { bindFakeFrom, makeFakeDeps, makeRequest, setFakeFrom } from "../_shared/testing.ts";
import { handle } from "./index.ts";

// ── Shared helpers ────────────────────────────────────────────────────────────

const CRON_OK = { "X-Cron-Secret": "secret-val" };
const CRON_WRONG = { "X-Cron-Secret": "bad" };

/**
 * The handler reads app_settings for the cron_secret check only.
 * Slot capacity lives on shows.main_cast_slots / shows.understudy_slots.
 */
function makeBaseSettings() {
  return [
    { when: { key: "cron_secret" }, data: { value: "secret-val" } },
  ];
}

/** A minimal open tier row. */
function makeTier(id: string, showDateId: string, tier = 1) {
  return { id, show_date_id: showDateId, tier };
}

/**
 * A show_date row with nested show.
 * mainCastSlots / understudySlots default to 2/1 so most tests have 3 required slots.
 * Pass null to simulate an unconfigured show.
 */
function makeShowDate(
  id: string,
  program: string,
  subProgram: string,
  date = "2026-07-01",
  orgId = "00000000-0000-0000-0000-000000000001",
  mainCastSlots: number | null = 2,
  understudySlots: number | null = 1,
) {
  return {
    id,
    date,
    city_id: "city-1",
    org_id: orgId,
    show: { program, sub_program: subProgram, main_cast_slots: mainCastSlots, understudy_slots: understudySlots },
  };
}

// ── Auth tests ────────────────────────────────────────────────────────────────

Deno.test("tier-at-risk-watcher DI: wrong cron-secret → 401", async () => {
  const { deps } = makeFakeDeps({
    tables: { app_settings: makeBaseSettings() },
  });
  const res = await handle(makeRequest({ headers: CRON_WRONG }), deps);
  assertEquals(res.status, 401);
});

Deno.test("tier-at-risk-watcher DI: missing auth header → 401", async () => {
  const { deps } = makeFakeDeps({
    tables: { app_settings: makeBaseSettings() },
  });
  const res = await handle(makeRequest({}), deps);
  assertEquals(res.status, 401);
});

Deno.test("tier-at-risk-watcher DI: producer JWT with valid role → 200", async () => {
  // Seed org_memberships so requireRole finds the producer role for user "prod-1"
  const { deps } = makeFakeDeps({
    authUser: { id: "prod-1" },
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [], error: null },
      // requireRole calls .from('org_memberships').select('role').eq('user_id', ...).in(...).maybeSingle()
      org_memberships: { data: { role: "producer" }, error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer valid-jwt" } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0);
});

Deno.test("tier-at-risk-watcher DI: admin JWT with valid role → 200", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "admin-1" },
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [], error: null },
      org_memberships: { data: { role: "admin" }, error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer valid-jwt" } }),
    deps,
  );
  assertEquals(res.status, 200);
});

Deno.test("tier-at-risk-watcher DI: JWT user with no matching role → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "artist-1" },
    tables: {
      app_settings: makeBaseSettings(),
      // org_memberships returns null (no matching admin/producer role)
      org_memberships: { data: null, error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer artist-jwt" } }),
    deps,
  );
  assertEquals(res.status, 403);
});

// ── Response shape ────────────────────────────────────────────────────────────

Deno.test("tier-at-risk-watcher DI: no open tiers and no stale notifs → { at_risk_count:0, cleared:0 } shape", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [], error: null },
      notifications: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  // After fix: full shape is returned even on the fast path
  assertEquals(body.at_risk_count, 0);
  assertEquals(body.cleared, 0, "cleared must be 0 when nothing to delete");
});

Deno.test("tier-at-risk-watcher DI: at-risk tier → response includes at_risk_count:1 and cleared:0", async () => {
  // makeShowDate defaults: main_cast_slots=2, understudy_slots=1 → need 3 slots
  const tierId = "tier-abc";
  const sdId = "sd-abc";

  const { deps } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null }, // no existing notifs
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow"), error: null },
      bookings: { data: [{ status: "suggested" }], error: null }, // 1 pending, need 3 → at-risk
    },
    rpcs: {
      resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null },
    },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.at_risk_count, 1);
  assertEquals(body.cleared, 0);
});

// ── DB error handling ─────────────────────────────────────────────────────────

Deno.test("tier-at-risk-watcher DI: DB error fetching tiers → 500", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: null, error: { message: "connection timeout" } },
    },
  });
  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(typeof body.error, "string");
});

// ── Slot configuration edge cases ─────────────────────────────────────────────

Deno.test("tier-at-risk-watcher DI: unconfigured slot (null main_cast_slots) → tier skipped, no notification", async () => {
  // NULL slot columns = show not configured; handler must skip the tier.
  const tierId = "tier-unconf";
  const sdId = "sd-unconf";

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      // null slot columns → unconfigured
      show_dates: { data: makeShowDate(sdId, "MusicalA", "SubProg", "2026-07-01", "00000000-0000-0000-0000-000000000001", null, null), error: null },
      bookings: { data: [], error: null },
    },
    rpcs: { resolve_show_assignments: { data: [], error: null } },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0, "unconfigured tier must be skipped");

  // No insert should have been called on notifications
  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 0, "no notification inserted for unconfigured tier");
});

Deno.test("tier-at-risk-watcher DI: requiredSlots = 0 (main_cast_slots:0 + understudy_slots:0) → tier skipped", async () => {
  // 0+0=0 → skip (configured but zero capacity)
  const tierId = "tier-zero";
  const sdId = "sd-zero";

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow", "2026-07-01", "00000000-0000-0000-0000-000000000001", 0, 0), error: null },
      bookings: { data: [], error: null },
    },
    rpcs: { resolve_show_assignments: { data: [], error: null } },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0, "zero-slot tier must be skipped");

  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 0, "no notification inserted when requiredSlots=0");
});

// ── At-risk detection ─────────────────────────────────────────────────────────

Deno.test("tier-at-risk-watcher DI: healthy tier (pending+accepted >= required) → no notification", async () => {
  // makeShowDate defaults: main_cast_slots=2, understudy_slots=1 → need 3
  const tierId = "tier-healthy";
  const sdId = "sd-healthy";

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow"), error: null },
      // 2 suggested + 1 confirmed = 3 >= 3 required → healthy
      bookings: {
        data: [
          { status: "suggested" },
          { status: "suggested" },
          { status: "confirmed" },
          { status: "cancelled" }, // does not count
        ],
        error: null,
      },
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0, "healthy tier must not be counted as at-risk");

  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 0, "no notification inserted for healthy tier");
});

Deno.test("tier-at-risk-watcher DI: at-risk — only 'suggested' statuses count as pending", async () => {
  // main_cast_slots=2, understudy_slots=0 → need 2
  const tierId = "tier-pend";
  const sdId = "sd-pend";

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow", "2026-07-01", "00000000-0000-0000-0000-000000000001", 2, 0), error: null },
      // Only 'cancelled' bookings — pending=0, accepted=0, need 2 → at-risk
      bookings: { data: [{ status: "cancelled" }, { status: "cancelled" }], error: null },
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();
  assertEquals(body.at_risk_count, 1);

  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 1);
});

Deno.test("tier-at-risk-watcher DI: 'soft_booked' and 'confirmed' both count as accepted", async () => {
  // main_cast_slots=0, understudy_slots=2 → need 2
  const tierId = "tier-accepted";
  const sdId = "sd-accepted";

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow", "2026-07-01", "00000000-0000-0000-0000-000000000001", 0, 2), error: null },
      // 1 soft_booked + 1 confirmed = 2 >= 2 required → healthy
      bookings: {
        data: [{ status: "soft_booked" }, { status: "confirmed" }],
        error: null,
      },
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0, "soft_booked+confirmed should count as accepted → healthy");

  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 0);
});

// ── Notification insertion fields ─────────────────────────────────────────────

Deno.test("tier-at-risk-watcher DI: at-risk notification has correct fields", async () => {
  // main_cast_slots=3, understudy_slots=0 → need 3
  const tierId = "tier-fields";
  const sdId = "sd-fields";

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId, 2)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow", "2026-08-15", "00000000-0000-0000-0000-000000000001", 3, 0), error: null },
      bookings: { data: [{ status: "suggested" }], error: null }, // 1 < 3 → at-risk
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-x" }], error: null } },
  });

  await handle(makeRequest({ headers: CRON_OK }), deps);

  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 1);

  // The insert args[0] is the rows array passed to .insert()
  const insertedRows = insertCalls[0].args[0] as Array<Record<string, unknown>>;
  assertEquals(Array.isArray(insertedRows), true);
  assertEquals(insertedRows.length, 1);

  const row = insertedRows[0];
  assertEquals(row.user_id, "prod-x");
  assertEquals(row.type, "tier_at_risk");
  assertEquals(row.title, "Tier at risk");
  assertEquals(row.related_entity_type, "show_date_offer_tier");
  assertEquals(row.related_entity_id, tierId);
  // Message should contain tier number, program, date, counts
  assertEquals(typeof row.message, "string");
  const msg = row.message as string;
  assertEquals(msg.includes("2"), true, "message should include tier number 2");
  assertEquals(msg.includes("MusicalA"), true, "message should include program name");
  assertEquals(msg.includes("2026-08-15"), true, "message should include show date");
  assertEquals(msg.includes("3"), true, "message should include requiredSlots count");
});

// ── Idempotency ───────────────────────────────────────────────────────────────

Deno.test("tier-at-risk-watcher DI: idempotency — existing (tier, user) notif → no duplicate insert", async () => {
  // makeShowDate defaults: main_cast_slots=2, understudy_slots=1 → need 3
  const tierId = "tier-idem";
  const sdId = "sd-idem";

  // Pre-seed an existing notification for this tier+user
  const existingNotif = {
    id: "notif-existing",
    user_id: "prod-1",
    related_entity_id: tierId,
  };

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [existingNotif], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow"), error: null },
      bookings: { data: [{ status: "suggested" }], error: null }, // 1 < 3 → still at-risk
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();

  // Still counted as at-risk
  assertEquals(body.at_risk_count, 1);

  // But no new insert — existing notification preserved (preserves read state)
  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 0, "must not insert duplicate notification for same (tier, user)");
});

Deno.test("tier-at-risk-watcher DI: partial idempotency — one user has existing notif, one does not → only new one inserted", async () => {
  // makeShowDate defaults: main_cast_slots=2, understudy_slots=1 → need 3
  const tierId = "tier-partial";
  const sdId = "sd-partial";

  // prod-1 already has a notification; prod-2 does not
  const existingNotif = {
    id: "notif-prod1",
    user_id: "prod-1",
    related_entity_id: tierId,
  };

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [existingNotif], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow"), error: null },
      bookings: { data: [{ status: "suggested" }], error: null }, // still at-risk
    },
    rpcs: {
      resolve_show_assignments: {
        data: [{ producer_user_id: "prod-1" }, { producer_user_id: "prod-2" }],
        error: null,
      },
    },
  });

  await handle(makeRequest({ headers: CRON_OK }), deps);

  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 1, "exactly one insert for the new user");

  const insertedRows = insertCalls[0].args[0] as Array<Record<string, unknown>>;
  assertEquals(insertedRows.length, 1, "only prod-2 row inserted");
  assertEquals(insertedRows[0].user_id, "prod-2");
});

// ── Deduplication of producer IDs ─────────────────────────────────────────────

Deno.test("tier-at-risk-watcher DI: duplicate producer_user_id from RPC → one notification per unique user", async () => {
  // makeShowDate defaults: main_cast_slots=2, understudy_slots=1 → need 3
  const tierId = "tier-dedup";
  const sdId = "sd-dedup";

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow"), error: null },
      bookings: { data: [{ status: "suggested" }], error: null },
    },
    rpcs: {
      resolve_show_assignments: {
        // RPC returns prod-1 twice, prod-2 once
        data: [
          { producer_user_id: "prod-1" },
          { producer_user_id: "prod-1" },
          { producer_user_id: "prod-2" },
        ],
        error: null,
      },
    },
  });

  await handle(makeRequest({ headers: CRON_OK }), deps);

  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 1);

  const insertedRows = insertCalls[0].args[0] as Array<Record<string, unknown>>;
  assertEquals(insertedRows.length, 2, "exactly 2 unique users notified, not 3");

  const userIds = insertedRows.map((r) => r.user_id);
  assertEquals(userIds.includes("prod-1"), true);
  assertEquals(userIds.includes("prod-2"), true);
});

// ── Admin fallback ────────────────────────────────────────────────────────────

Deno.test("tier-at-risk-watcher DI: empty producers from RPC → falls back to admin users", async () => {
  // makeShowDate defaults: main_cast_slots=2, understudy_slots=1 → need 3
  const tierId = "tier-fallback";
  const sdId = "sd-fallback";

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow"), error: null },
      bookings: { data: [{ status: "suggested" }], error: null },
      // Admin fallback: org_memberships returns the org's admin users
      org_memberships: { data: [{ user_id: "admin-1" }, { user_id: "admin-2" }], error: null },
    },
    rpcs: {
      // Empty producers → triggers admin fallback
      resolve_show_assignments: { data: [], error: null },
    },
  });

  await handle(makeRequest({ headers: CRON_OK }), deps);

  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 1, "one insert batch for admin fallback");

  const insertedRows = insertCalls[0].args[0] as Array<Record<string, unknown>>;
  assertEquals(insertedRows.length, 2, "both admins notified");

  const userIds = insertedRows.map((r) => r.user_id);
  assertEquals(userIds.includes("admin-1"), true);
  assertEquals(userIds.includes("admin-2"), true);
});

Deno.test("tier-at-risk-watcher DI: null producers from RPC → falls back to admin users", async () => {
  // makeShowDate defaults: main_cast_slots=2, understudy_slots=1 → need 3
  const tierId = "tier-null-prod";
  const sdId = "sd-null-prod";

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow"), error: null },
      bookings: { data: [{ status: "suggested" }], error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      resolve_show_assignments: { data: null, error: null }, // null data
    },
  });

  await handle(makeRequest({ headers: CRON_OK }), deps);

  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 1);
  const insertedRows = insertCalls[0].args[0] as Array<Record<string, unknown>>;
  assertEquals(insertedRows[0].user_id, "admin-1");
});

// ── Recovery (delete cleared notifications) ───────────────────────────────────

Deno.test("tier-at-risk-watcher DI: recovered tier → its notification is deleted", async () => {
  // main_cast_slots=2, understudy_slots=0 → need 2
  const tierId = "tier-recovered";
  const sdId = "sd-recovered";

  // Tier has a pre-existing at-risk notification
  const existingNotif = {
    id: "notif-old",
    user_id: "prod-1",
    related_entity_id: tierId,
  };

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [existingNotif], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow", "2026-07-01", "00000000-0000-0000-0000-000000000001", 2, 0), error: null },
      // Now healthy: 2 accepted >= 2 required → tier is recovered
      bookings: { data: [{ status: "soft_booked" }, { status: "confirmed" }], error: null },
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();

  assertEquals(body.at_risk_count, 0, "tier is no longer at-risk");
  assertEquals(body.cleared, 1, "one notification cleared");

  // Verify delete was called with the right notification id
  const deleteCalls = calls.filter((c) => c.table === "notifications" && c.method === "delete");
  assertEquals(deleteCalls.length > 0, true, "delete must be called");

  // The .in('id', idsToDelete) call records the ids in args
  const inCalls = calls.filter(
    (c) => c.table === "notifications" && c.method === "in",
  );
  assertEquals(inCalls.length > 0, true, ".in() must be called to target specific ids");
  const inArgs = inCalls[inCalls.length - 1].args as [string, string[]];
  assertEquals(inArgs[0], "id");
  assertEquals(inArgs[1].includes("notif-old"), true, "old notification id must be in delete list");
});

Deno.test("tier-at-risk-watcher DI: still-at-risk tier's notification is NOT deleted", async () => {
  // makeShowDate defaults: main_cast_slots=2, understudy_slots=1 → need 3
  const tierId = "tier-still-at-risk";
  const sdId = "sd-still";

  const existingNotif = {
    id: "notif-still",
    user_id: "prod-1",
    related_entity_id: tierId,
  };

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [existingNotif], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow"), error: null },
      // Still at-risk: 1 < 3
      bookings: { data: [{ status: "suggested" }], error: null },
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();

  assertEquals(body.cleared, 0, "no notification should be cleared for still-at-risk tier");

  // No delete call at all (or if called, it's with an empty array — but handler guards with length > 0)
  const deleteCalls = calls.filter((c) => c.table === "notifications" && c.method === "delete");
  assertEquals(deleteCalls.length, 0, "delete must not be called when tier is still at-risk");
});

Deno.test("tier-at-risk-watcher DI: recovery precision — at-risk tier preserved, recovered tier deleted", async () => {
  // main_cast_slots=2, understudy_slots=0 → need 2

  const atRiskTierId = "tier-still-risk";
  const recoveredTierId = "tier-now-ok";
  const sdIdRisk = "sd-risk";
  const sdIdOk = "sd-ok";

  // Both tiers have existing notifications
  const existingNotifs = [
    { id: "notif-risk", user_id: "prod-1", related_entity_id: atRiskTierId },
    { id: "notif-recovered", user_id: "prod-1", related_entity_id: recoveredTierId },
  ];

  // We need per-tier data — use array seeds for show_dates and bookings
  // But the fake client only supports a single seed per table (match on eq).
  // For show_dates: eq('id', sd-risk) and eq('id', sd-ok)
  // For bookings: eq('show_date_id', sd-risk) and eq('show_date_id', sd-ok)
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: {
        data: [
          makeTier(atRiskTierId, sdIdRisk, 1),
          makeTier(recoveredTierId, sdIdOk, 1),
        ],
        error: null,
      },
      notifications: { data: existingNotifs, error: null },
      show_dates: [
        { when: { id: sdIdRisk }, data: makeShowDate(sdIdRisk, "MusicalA", "MainShow", "2026-07-01", "00000000-0000-0000-0000-000000000001", 2, 0) },
        { when: { id: sdIdOk }, data: makeShowDate(sdIdOk, "MusicalA", "MainShow", "2026-07-01", "00000000-0000-0000-0000-000000000001", 2, 0) },
      ],
      bookings: [
        // at-risk: show_date_id matches sdIdRisk → 0 bookings
        { when: { show_date_id: sdIdRisk }, data: [] },
        // recovered: show_date_id matches sdIdOk → 2 bookings (healthy)
        { when: { show_date_id: sdIdOk }, data: [{ status: "confirmed" }, { status: "confirmed" }] },
      ],
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();

  assertEquals(body.at_risk_count, 1, "one tier still at-risk");
  assertEquals(body.cleared, 1, "one tier recovered → one notification cleared");

  // The delete should have targeted notif-recovered but NOT notif-risk
  const inCalls = calls.filter(
    (c) => c.table === "notifications" && c.method === "in",
  );
  assertEquals(inCalls.length > 0, true);
  const inArgs = inCalls[inCalls.length - 1].args as [string, string[]];
  assertEquals(inArgs[1].includes("notif-recovered"), true, "recovered notif must be deleted");
  assertEquals(inArgs[1].includes("notif-risk"), false, "at-risk notif must NOT be deleted");
});

// ── Lifecycle test ────────────────────────────────────────────────────────────

Deno.test("tier-at-risk-watcher DI: lifecycle — at-risk creates notif, recovered deletes it, re-at-risk recreates it", async () => {
  // main_cast_slots=2, understudy_slots=0 → need 2
  const tierId = "tier-lifecycle";
  const sdId = "sd-lifecycle";
  const sdRow = makeShowDate(sdId, "MusicalA", "MainShow", "2026-07-01", "00000000-0000-0000-0000-000000000001", 2, 0);

  // Phase 1: at-risk, no existing notification
  {
    const { deps, calls } = makeFakeDeps({
      tables: {
        app_settings: makeBaseSettings(),
        show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
        notifications: { data: [], error: null },
        show_dates: { data: sdRow, error: null },
        bookings: { data: [{ status: "suggested" }], error: null }, // 1 < 2 → at-risk
      },
      rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
    });

    const res = await handle(makeRequest({ headers: CRON_OK }), deps);
    const body = await res.json();
    assertEquals(body.at_risk_count, 1, "phase1: at-risk");
    assertEquals(body.cleared, 0);
    const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
    assertEquals(insertCalls.length, 1, "phase1: notification created");
  }

  // Phase 2: recovered, existing notification present
  {
    const existingNotif = { id: "notif-1", user_id: "prod-1", related_entity_id: tierId };
    const { deps, calls } = makeFakeDeps({
      tables: {
        app_settings: makeBaseSettings(),
        show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
        notifications: { data: [existingNotif], error: null },
        show_dates: { data: sdRow, error: null },
        bookings: { data: [{ status: "confirmed" }, { status: "confirmed" }], error: null }, // 2 >= 2 → healthy
      },
      rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
    });

    const res = await handle(makeRequest({ headers: CRON_OK }), deps);
    const body = await res.json();
    assertEquals(body.at_risk_count, 0, "phase2: recovered");
    assertEquals(body.cleared, 1, "phase2: notification deleted");
    const deleteCalls = calls.filter((c) => c.table === "notifications" && c.method === "delete");
    assertEquals(deleteCalls.length > 0, true, "phase2: delete called");
  }

  // Phase 3: at-risk again, no existing notification (was deleted in phase 2)
  {
    const { deps, calls } = makeFakeDeps({
      tables: {
        app_settings: makeBaseSettings(),
        show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
        notifications: { data: [], error: null }, // notification was deleted
        show_dates: { data: sdRow, error: null },
        bookings: { data: [{ status: "suggested" }], error: null }, // 1 < 2 → at-risk again
      },
      rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
    });

    const res = await handle(makeRequest({ headers: CRON_OK }), deps);
    const body = await res.json();
    assertEquals(body.at_risk_count, 1, "phase3: at-risk again");
    const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
    assertEquals(insertCalls.length, 1, "phase3: notification re-created");
  }
});

// ── Multiple tiers ────────────────────────────────────────────────────────────

Deno.test("tier-at-risk-watcher DI: multiple tiers — mixed at-risk + healthy, counts are correct", async () => {
  // main_cast_slots=2, understudy_slots=0 → need 2

  const tier1Id = "tier-multi-1";
  const tier2Id = "tier-multi-2";
  const tier3Id = "tier-multi-3";
  const sd1 = "sd-multi-1";
  const sd2 = "sd-multi-2";
  const sd3 = "sd-multi-3";
  const org = "00000000-0000-0000-0000-000000000001";

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: {
        data: [
          makeTier(tier1Id, sd1, 1), // at-risk
          makeTier(tier2Id, sd2, 1), // healthy
          makeTier(tier3Id, sd3, 1), // at-risk
        ],
        error: null,
      },
      notifications: { data: [], error: null },
      show_dates: [
        { when: { id: sd1 }, data: makeShowDate(sd1, "MusicalA", "MainShow", "2026-07-01", org, 2, 0) },
        { when: { id: sd2 }, data: makeShowDate(sd2, "MusicalA", "MainShow", "2026-07-01", org, 2, 0) },
        { when: { id: sd3 }, data: makeShowDate(sd3, "MusicalA", "MainShow", "2026-07-01", org, 2, 0) },
      ],
      bookings: [
        { when: { show_date_id: sd1 }, data: [{ status: "suggested" }] }, // 1 < 2 → at-risk
        { when: { show_date_id: sd2 }, data: [{ status: "confirmed" }, { status: "confirmed" }] }, // 2 >= 2 → healthy
        { when: { show_date_id: sd3 }, data: [] }, // 0 < 2 → at-risk
      ],
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();

  assertEquals(body.at_risk_count, 2, "exactly 2 at-risk tiers");
  assertEquals(body.cleared, 0, "no pre-existing notifications to clear");

  // 2 separate insert batches, one per at-risk tier
  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 2, "two insert calls for two at-risk tiers");
});

// ── Recovery does not over-delete (unrelated type) ────────────────────────────

Deno.test("tier-at-risk-watcher DI: recovery only deletes tier_at_risk type notifications by id", async () => {
  // The handler reads all tier_at_risk notifications and only computes which to delete
  // based on their related_entity_id. The filter is on the type at query time;
  // all records returned from the notification query are tier_at_risk type.
  // This test verifies that a recovered tier's notification gets exactly the right id deleted.
  // main_cast_slots=2, understudy_slots=0 → need 2
  const recoveredTierId = "tier-recovery-exact";
  const sdId = "sd-recovery-exact";

  const existingNotifs = [
    { id: "notif-recovery-1", user_id: "prod-a", related_entity_id: recoveredTierId },
    { id: "notif-recovery-2", user_id: "prod-b", related_entity_id: recoveredTierId },
  ];

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(recoveredTierId, sdId)], error: null },
      notifications: { data: existingNotifs, error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow", "2026-07-01", "00000000-0000-0000-0000-000000000001", 2, 0), error: null },
      // Recovered: 2 confirmed >= 2 required
      bookings: { data: [{ status: "confirmed" }, { status: "confirmed" }], error: null },
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-a" }], error: null } },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();

  assertEquals(body.cleared, 2, "both notifications for recovered tier cleared");

  const inCalls = calls.filter(
    (c) => c.table === "notifications" && c.method === "in",
  );
  const inArgs = inCalls[inCalls.length - 1].args as [string, string[]];
  assertEquals(inArgs[1].sort(), ["notif-recovery-1", "notif-recovery-2"].sort());
});

// ── FIXED BUG: stale notifications cleared when all tiers close ───────────────
// Previously the handler early-returned from:
//   if (!openTiers || openTiers.length === 0) return json({ at_risk_count: 0 })
// before reaching the notification cleanup logic. Pre-existing tier_at_risk
// notifications were NEVER deleted in this path — they would linger forever.
//
// Fix (index.ts): notifications are now loaded BEFORE the early-exit decision,
// and stale ones are deleted even when all tiers have closed.
// This regression test ensures the fix stays in place.
Deno.test("tier-at-risk-watcher DI: stale notifications for closed tiers ARE cleared (regression: was a bug)", async () => {
  // All tiers are closed (none returned by the query, which filters closed_at IS NULL).
  // But there are stale tier_at_risk notifications from when tiers were open.
  const staleNotif = {
    id: "stale-notif-1",
    user_id: "prod-1",
    related_entity_id: "tier-now-closed",
  };

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [], error: null }, // all tiers closed
      notifications: { data: [staleNotif], error: null }, // stale notification exists
    },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();

  // After fix: stale notification is cleared
  assertEquals(body.at_risk_count, 0);
  assertEquals(body.cleared, 1, "stale notification for closed tier must be deleted");

  const deleteCalls = calls.filter((c) => c.table === "notifications" && c.method === "delete");
  assertEquals(deleteCalls.length > 0, true, "delete must be called for stale notifications");

  const inCalls = calls.filter(
    (c) => c.table === "notifications" && c.method === "in",
  );
  assertEquals(inCalls.length > 0, true);
  const inArgs = inCalls[inCalls.length - 1].args as [string, string[]];
  assertEquals(inArgs[1].includes("stale-notif-1"), true, "stale notification id must be deleted");
});

// ── Missing show_date row (show_date deleted after tier opened) ───────────────

Deno.test("tier-at-risk-watcher DI: show_date not found → tier skipped gracefully", async () => {
  const tierId = "tier-orphan";
  const sdId = "sd-orphan";

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      // show_date not found (deleted or orphaned)
      show_dates: { data: null, error: null },
    },
    rpcs: { resolve_show_assignments: { data: [], error: null } },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  assertEquals(res.status, 200, "must not crash on missing show_date");
  const body = await res.json();
  assertEquals(body.at_risk_count, 0, "orphaned tier must be skipped");

  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 0, "no notification for orphaned tier");
});

// ── Part 7: slot columns from shows + notification org_id ─────────────────────

Deno.test("tier-at-risk-watcher DI: reads slot capacity from shows columns and stamps notification org_id", async () => {
  const ORG = "00000000-0000-0000-0000-0000000000b7";
  const tierId = "tier-org";
  const sdId = "sd-org";

  const { deps } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      // show_date belongs to ORG; main_cast_slots=2, understudy_slots=0 → need 2
      show_dates: { data: makeShowDate(sdId, "P", "S", "2026-07-01", ORG, 2, 0), error: null },
      // one suggested booking; requiredSlots=2, pending=1 → at risk
      bookings: { data: [{ status: "suggested" }], error: null },
      // admin fallback (resolve_show_assignments returns empty)
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: { resolve_show_assignments: { data: [], error: null } },
  });

  // Capture the notifications insert payload.
  const notifInserts: Array<Array<Record<string, unknown>>> = [];
  const originalFrom = bindFakeFrom(deps.admin);
  setFakeFrom(deps.admin, (t: string) => {
    const chain = originalFrom(t);
    if (t === "notifications") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { notifInserts.push(p as Array<Record<string, unknown>>); return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.at_risk_count, 1, "tier is at-risk");
  assertExists(notifInserts[0], "notification must be inserted");
  assertEquals(notifInserts[0][0].org_id, ORG, "notification must carry the show_date's org_id");
});

// ── Part 8: M2 slot-math corrections ──────────────────────────────────────────
// Default fake clock is 2026-06-01 (Berlin), so 2026-07-01 is future, 2026-05-01 is past.

Deno.test("tier-at-risk-watcher DI M2: required = main_cast_slots only — understudy_slots does NOT inflate the requirement", async () => {
  // main_cast_slots=1, understudy_slots=5. Old math: need 6 → 1 accepted looks at-risk.
  // New math: need 1 (main only) → 1 accepted is HEALTHY, no alert.
  const tierId = "tier-m2-under";
  const sdId = "sd-m2-under";
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow", "2026-07-01", "00000000-0000-0000-0000-000000000001", 1, 5), error: null },
      bookings: { data: [{ status: "soft_booked" }], error: null }, // 1 accepted >= main(1) → healthy
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
  });
  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0, "understudy slots must not inflate the requirement");
  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 0, "no false at-risk notification");
});

Deno.test("tier-at-risk-watcher DI M2: manual booking (offer_tier NULL) counts toward filled → not at-risk", async () => {
  // main_cast_slots=2. A manual booking (offer_tier NULL) + one accepted offer = 2 → healthy.
  // Old per-tier count (.eq('offer_tier', tier)) would miss the manual row and false-alarm.
  const tierId = "tier-m2-manual";
  const sdId = "sd-m2-manual";
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow", "2026-07-01", "00000000-0000-0000-0000-000000000001", 2, 0), error: null },
      bookings: {
        data: [
          { status: "confirmed", offer_tier: null }, // manual booking — must count
          { status: "soft_booked", offer_tier: 1 },  // this tier's accepted offer
        ],
        error: null,
      },
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
  });
  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0, "manual (offer_tier NULL) booking must count toward filled");
  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 0);
});

Deno.test("tier-at-risk-watcher DI: an already-expired suggested offer does NOT count as pending → at-risk", async () => {
  // Fix D: a suggested offer whose offer_expires_at is in the past (relative to the
  // 2026-06-01 fake clock) is effectively lapsed and must not read as healthy pending —
  // otherwise the alert is suppressed until expire-offers sweeps it (~1h later).
  // main_cast_slots=2, understudy_slots=0 → need 2.
  const tierId = "tier-expired";
  const sdId = "sd-expired";
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow", "2026-07-01", "00000000-0000-0000-0000-000000000001", 2, 0), error: null },
      bookings: {
        data: [
          // Suggested but expired in the past → NOT counted → pending 0, need 2 → at-risk.
          { status: "suggested", offer_expires_at: "2026-05-30T00:00:00.000Z" },
        ],
        error: null,
      },
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
  });
  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();
  assertEquals(body.at_risk_count, 1, "an expired suggested offer must not count as live pending");
  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 1, "at-risk notification inserted when the only offer has expired");
});

Deno.test("tier-at-risk-watcher DI: a still-live suggested offer (future expiry) counts as pending → healthy", async () => {
  // Complement to the expired case: a suggested offer whose expiry is in the future
  // still counts. main_cast_slots=1 → need 1; one live suggested offer → healthy.
  const tierId = "tier-live";
  const sdId = "sd-live";
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow", "2026-07-01", "00000000-0000-0000-0000-000000000001", 1, 0), error: null },
      bookings: {
        data: [{ status: "suggested", offer_expires_at: "2026-06-05T00:00:00.000Z" }], // future → live
        error: null,
      },
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
  });
  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0, "a live (future-expiry) suggested offer must count as pending");
  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 0);
});

// ── Milestone C — Task 13: gate on booking_flow (at_risk_alerts / artist_acceptance) ──
//
// resolveBookingFlow reads app_settings.key='booking_flow' — array-seed matched by the
// recorded `.eq('key', …)` arg, same disambiguation idiom as Task 11/12's expire-offers
// tests. Gated per (sd.org_id), cached in a flowByOrg Map identical to Task 12's pattern.
// A gated tier is simply `continue`d before it's added to stillAtRiskTierIds — the
// existing recovery/cleanup pass at the end of handle() then treats it exactly like any
// other skipped tier (unconfigured slots, healthy, orphaned show_date, …) and deletes any
// pre-existing tier_at_risk notification for it. So turning at_risk_alerts off for an org
// automatically clears its stale notifications on the very next run, with no special-case
// code needed — verified by the second test below.

Deno.test("tier-at-risk-watcher: org with at_risk_alerts=false produces no notifications", async () => {
  // Clone of "at-risk tier → response includes at_risk_count:1 and cleared:0", plus a
  // booking_flow override that disables at_risk_alerts for the show_date's org.
  const ORG_ID = "00000000-0000-0000-0000-000000000001"; // makeShowDate's default org
  const tierId = "tier-gated";
  const sdId = "sd-gated";

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret-val" } },
        { when: { key: "booking_flow" }, data: [{ org_id: ORG_ID, value: { at_risk_alerts: false } }] },
      ],
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow"), error: null },
      // Would be at-risk (1 pending < 3 required) if the org hadn't turned alerts off.
      bookings: { data: [{ status: "suggested" }], error: null },
    },
    rpcs: {
      resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null },
    },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0, "org with at_risk_alerts=false must not be counted at-risk");

  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 0, "no notification inserted when at_risk_alerts is off");
});

Deno.test("tier-at-risk-watcher: disabling at_risk_alerts clears the org's existing tier_at_risk notification", async () => {
  // An org that previously had alerts on (and thus an existing notification for a
  // still-mathematically-at-risk tier) turns at_risk_alerts off. The gate must not
  // strand the stale notification — the existing stillAtRiskTierIds/cleanup pass should
  // pick it up and delete it, exactly as it would for any other skipped tier.
  const ORG_ID = "00000000-0000-0000-0000-000000000001";
  const tierId = "tier-gated-stale";
  const sdId = "sd-gated-stale";

  const existingNotif = { id: "notif-stale", user_id: "prod-1", related_entity_id: tierId };

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret-val" } },
        { when: { key: "booking_flow" }, data: [{ org_id: ORG_ID, value: { at_risk_alerts: false } }] },
      ],
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [existingNotif], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow"), error: null },
      // Still mathematically at-risk — but the org has alerts off, so it's gated out.
      bookings: { data: [{ status: "suggested" }], error: null },
    },
    rpcs: {
      resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null },
    },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0);
  assertEquals(body.cleared, 1, "stale notification must be cleared once alerts are turned off");

  const deleteCalls = calls.filter((c) => c.table === "notifications" && c.method === "delete");
  assertEquals(deleteCalls.length > 0, true, "delete must be called for the stale notification");
  const inCalls = calls.filter((c) => c.table === "notifications" && c.method === "in");
  const inArgs = inCalls[inCalls.length - 1].args as [string, string[]];
  assertEquals(inArgs[1].includes("notif-stale"), true);
});

Deno.test("tier-at-risk-watcher: org with booking_flow.active=false produces no notifications", async () => {
  // Same shape as the at_risk_alerts=false test above, but this time only the
  // top-level `active` flag is off (at_risk_alerts and artist_acceptance are both
  // true) — proving the `!flow.active` arm of the gate on its own, independent of
  // the other two conditions in `if (!flow.active || !flow.at_risk_alerts || !flow.artist_acceptance) continue`.
  const ORG_ID = "00000000-0000-0000-0000-000000000001"; // makeShowDate's default org
  const tierId = "tier-inactive";
  const sdId = "sd-inactive";

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret-val" } },
        {
          when: { key: "booking_flow" },
          data: [{ org_id: ORG_ID, value: { active: false, at_risk_alerts: true, artist_acceptance: true } }],
        },
      ],
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow"), error: null },
      // Would be at-risk (1 pending < 3 required) if the org's booking flow were active.
      bookings: { data: [{ status: "suggested" }], error: null },
    },
    rpcs: {
      resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null },
    },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0, "org with booking_flow.active=false must not be counted at-risk");

  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 0, "no notification inserted when the org's booking flow is inactive");
});

// ── Task 6: module gate — per-org booking_flow entitlement (checkFeature) ─────
//
// Unlike the other cron callers, this handler never calls getActiveOrgs — it
// scans open tiers directly and derives the org from show_dates.org_id, so it
// is gated with a per-org checkFeature call cached in entitledByOrg (mirrors
// flowByOrg). Placed before resolveBookingFlow: resolveBookingFlow itself
// fails open to permissive defaults on an entitlement-check failure, so
// flow.at_risk_alerts alone would NOT be a safe gate for an unentitled org.

Deno.test("tier-at-risk-watcher: unentitled org (booking_flow off) produces no notifications", async () => {
  const tierId = "tier-unentitled";
  const sdId = "sd-unentitled";

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow"), error: null },
      // Would be at-risk (1 pending < 3 required) if the org were entitled.
      bookings: { data: [{ status: "suggested" }], error: null },
    },
    rpcs: {
      resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null },
      is_feature_enabled: { data: false, error: null },
    },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0, "unentitled org must not be counted at-risk");

  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 0, "no notification inserted for an unentitled org");
});

Deno.test("tier-at-risk-watcher: disabling the entitlement clears the org's existing tier_at_risk notification", async () => {
  // A gated-out tier is simply never added to stillAtRiskTierIds, so the existing
  // recovery pass clears any stale notification for it — same mechanism as the
  // at_risk_alerts=false case above it in the file.
  const tierId = "tier-unentitled-stale";
  const sdId = "sd-unentitled-stale";
  const existingNotif = { id: "notif-unent-stale", user_id: "prod-1", related_entity_id: tierId };

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [existingNotif], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow"), error: null },
      bookings: { data: [{ status: "suggested" }], error: null },
    },
    rpcs: {
      resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null },
      is_feature_enabled: { data: false, error: null },
    },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0);
  assertEquals(body.cleared, 1, "stale notification must be cleared once the org is unentitled");

  const deleteCalls = calls.filter((c) => c.table === "notifications" && c.method === "delete");
  assertEquals(deleteCalls.length > 0, true);
});

// Pin the fail-OPEN contract for booking_flow: a transient is_feature_enabled RPC
// error must never silently disable live production booking traffic.
Deno.test("tier-at-risk-watcher: keeps alerting when the entitlement RPC errors (booking_flow fails open)", async () => {
  const tierId = "tier-entfail";
  const sdId = "sd-entfail";

  const { deps } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow"), error: null },
      bookings: { data: [{ status: "suggested" }], error: null },
    },
    rpcs: {
      resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null },
      is_feature_enabled: { data: null, error: { message: "boom" } },
    },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.at_risk_count, 1, "booking_flow fails open on an is_feature_enabled RPC error");
});

// ── Fix B (PR #161 round 3): booking_flow read error must not abort the scan ──
//
// A throw from resolveBookingFlow inside the loop would abort the whole handler,
// skipping the post-loop stale-clear pass, leaving orphaned tier_at_risk
// notifications stranded. The per-tier try/catch isolates it (log + continue): the
// skipped tier is never added to stillAtRiskTierIds, so the recovery pass still
// deletes its stale notification, exactly as any other skipped tier.
//
// Harness note: the fake resolves one seed per table, so a booking_flow error applies
// to every org (the read filters org via `.or()`, which the fake doesn't match on).
// The test uses two orgs to prove the loop reaches the SECOND tier after the first
// errors AND the stale-clear runs for both. Pre-fix the handler REJECTED on the first
// tier and the deletes below never happened.
Deno.test("tier-at-risk-watcher: booking_flow read error is isolated, scan continues and stale-clear still runs", async () => {
  const ORG_A = "00000000-0000-0000-0000-0000000000a1";
  const ORG_B = "00000000-0000-0000-0000-0000000000b2";
  const tierA = "tier-bf-a";
  const tierB = "tier-bf-b";
  const sdA = "sd-bf-a";
  const sdB = "sd-bf-b";

  // Both tiers have a pre-existing stale tier_at_risk notification.
  const notifs = [
    { id: "notif-bf-a", user_id: "prod-1", related_entity_id: tierA },
    { id: "notif-bf-b", user_id: "prod-1", related_entity_id: tierB },
  ];

  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret-val" } },
        // booking_flow read throws for every org (resolveOrgSetting rethrows the error).
        { when: { key: "booking_flow" }, error: { message: "booking_flow read failed" } },
      ],
      show_date_offer_tiers: { data: [makeTier(tierA, sdA), makeTier(tierB, sdB)], error: null },
      notifications: { data: notifs, error: null },
      show_dates: [
        { when: { id: sdA }, data: makeShowDate(sdA, "MusicalA", "MainShow", "2026-07-01", ORG_A, 2, 0) },
        { when: { id: sdB }, data: makeShowDate(sdB, "MusicalB", "MainShow", "2026-07-01", ORG_B, 2, 0) },
      ],
      bookings: { data: [], error: null },
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
  });

  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  // Pre-fix: `await resolveBookingFlow` rejects → handle() rejects → this line throws.
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0, "both tiers skipped due to booking_flow read error");
  assertEquals(body.cleared, 2, "stale-clear still runs for both skipped tiers");

  const inCalls = calls.filter((c) => c.table === "notifications" && c.method === "in");
  assertEquals(inCalls.length > 0, true, "stale-clear delete must target notification ids");
  const inArgs = inCalls[inCalls.length - 1].args as [string, string[]];
  assertEquals(inArgs[1].includes("notif-bf-a"), true, "first org's stale notif cleared");
  assertEquals(inArgs[1].includes("notif-bf-b"), true, "second org's stale notif cleared (loop reached it)");
});

Deno.test("tier-at-risk-watcher DI M2: past date is never flagged at-risk", async () => {
  // Same unfillable setup as a normal at-risk case, but the date is in the past
  // (before the 2026-06-01 fake clock). The watcher must skip it, not re-alert forever.
  const tierId = "tier-m2-past";
  const sdId = "sd-m2-past";
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: makeBaseSettings(),
      show_date_offer_tiers: { data: [makeTier(tierId, sdId)], error: null },
      notifications: { data: [], error: null },
      show_dates: { data: makeShowDate(sdId, "MusicalA", "MainShow", "2026-05-01", "00000000-0000-0000-0000-000000000001", 2, 0), error: null },
      bookings: { data: [], error: null }, // 0 filled, need 2 → would be at-risk if future
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null } },
  });
  const res = await handle(makeRequest({ headers: CRON_OK }), deps);
  const body = await res.json();
  assertEquals(body.at_risk_count, 0, "past dates must never alert");
  const insertCalls = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(insertCalls.length, 0);
});
