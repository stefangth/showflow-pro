import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { bindFakeFrom, makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

function assertStringIncludes(actual: string, expected: string, msg?: string): void {
  if (!actual.includes(expected)) {
    throw new Error(msg ?? `Expected "${actual}" to include "${expected}"`);
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const CRON_SECRET = "test-cron-secret";

/** Fixed clock used for boundary tests: 2026-06-01T12:00:00.000Z */
const FIXED_NOW = new Date("2026-06-01T12:00:00.000Z");

function cronReq() {
  return makeRequest({ headers: { "X-Cron-Secret": CRON_SECRET } });
}

/**
 * Standard match-based app_settings seed that answers the cron_secret read
 * the handler does. Slot capacity now lives on shows columns, not app_settings.
 */
function appSettingsSeed() {
  return [
    { when: { key: "cron_secret" }, data: { value: CRON_SECRET }, error: null },
  ];
}

/** Minimal show_date row — slot capacity lives on the nested show columns. */
const SHOW_DATE = {
  id: "sd-1",
  date: "2026-07-01",
  city_id: "city-1",
  org_id: "00000000-0000-0000-0000-000000000001",
  show: { program: "Ballet", sub_program: "Matinée", main_cast_slots: 2, understudy_slots: 1 },
};

/** Minimal open tier row */
const OPEN_TIER = { id: "tier-1", show_date_id: "sd-1", tier: 1 };

// ─── existing smoke tests (kept) ─────────────────────────────────────────────

Deno.test("expire-offers: OPTIONS returns CORS preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("expire-offers: wrong cron secret is rejected 401", async () => {
  const { deps } = makeFakeDeps({ tables: { app_settings: { data: { value: "right" }, error: null } } });
  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "wrong" } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("expire-offers: runs expiry RPC and reports zero escalations when no open tiers", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: "s" }, error: null },
      show_date_offer_tiers: { data: [], error: null },
    },
    rpcs: { expire_soft_bookings: { data: null, error: null } },
  });
  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "s" } }), deps);
  assertEquals(res.status, 200);
  // No `organizations` seed → getActiveOrgs() returns [] → the reminder pass is a no-op.
  assertEquals(await res.json(), { expired: true, escalations: 0, reminders_sent: 0 });
  assertEquals(calls.some((c) => c.table === "rpc:expire_soft_bookings"), true);
});

// ─── Auth contract ────────────────────────────────────────────────────────────

Deno.test("expire-offers: admin JWT is accepted", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [], error: null },
      org_memberships: { data: { role: "admin" }, error: null },
    },
    rpcs: { expire_soft_bookings: { data: null, error: null } },
    authUser: { id: "user-admin-1" },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer valid-token" } }),
    deps,
  );
  assertEquals(res.status, 200);
});

Deno.test("expire-offers: producer JWT is accepted", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [], error: null },
      org_memberships: { data: { role: "producer" }, error: null },
    },
    rpcs: { expire_soft_bookings: { data: null, error: null } },
    authUser: { id: "user-producer-1" },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer valid-token" } }),
    deps,
  );
  assertEquals(res.status, 200);
});

Deno.test("expire-offers: no auth credentials returns 401", async () => {
  const { deps } = makeFakeDeps({
    tables: { app_settings: appSettingsSeed() },
    rpcs: { expire_soft_bookings: { data: null, error: null } },
  });
  const res = await handle(makeRequest(), deps);
  assertEquals(res.status, 401);
});

// ─── RPC error propagation ────────────────────────────────────────────────────

Deno.test("expire-offers: expire_soft_bookings RPC error → 500 with message", async () => {
  const { deps } = makeFakeDeps({
    tables: { app_settings: appSettingsSeed() },
    rpcs: { expire_soft_bookings: { data: null, error: { message: "boom" } } },
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertStringIncludes(body.error, "boom");
});

// ─── No open tiers → zero escalations ────────────────────────────────────────

Deno.test("expire-offers: empty open tiers → escalations: 0", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [], error: null },
    },
    rpcs: { expire_soft_bookings: { data: null, error: null } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 0);
  // RPC must still have been called
  assertEquals(calls.some((c) => c.table === "rpc:expire_soft_bookings"), true);
});

// ─── Slot config absent → skip tier ──────────────────────────────────────────

Deno.test("expire-offers: tier with unconfigured show (null main_cast_slots) → no escalation", async () => {
  // NULL slot columns = show is not configured yet; handler skips the tier.
  const showDateUnconfigured = {
    ...SHOW_DATE,
    show: { program: "Ballet", sub_program: "Matinée", main_cast_slots: null, understudy_slots: null },
  };
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: showDateUnconfigured, error: null },
      bookings: { data: [], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 0);
});

Deno.test("expire-offers: M2 — null understudy_slots does NOT block escalation (understudy irrelevant to primary offers)", async () => {
  // M2: a primary offer tier fills main_cast_slots only. understudy_slots being null no
  // longer marks the show "unconfigured" — with main_cast_slots=2 configured and nothing
  // filled, the tier still escalates. (Only a null main_cast_slots skips — see the test
  // above at "tier with unconfigured show (null main_cast_slots) → no escalation".)
  const showDatePartial = {
    ...SHOW_DATE,
    show: { program: "Ballet", sub_program: "Matinée", main_cast_slots: 2, understudy_slots: null },
  };
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: showDatePartial, error: null },
      bookings: { data: [], error: null },
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 1);
});

// ─── requiredSlots calculation ────────────────────────────────────────────────

Deno.test("expire-offers: M2 — requiredSlots = main_cast_slots ONLY (understudy excluded)", async () => {
  // SHOW_DATE has main_cast_slots=2, understudy_slots=1 → requiredSlots=2 (main only).
  // With 0 accepted and 0 pending → should escalate; message reports 0/2, not 0/3.
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [], error: null },
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 1);
  // Verify the notification message reports main-only slots (0/2, not 0/3)
  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  const rows = notifInsert?.args[0] as Array<{ message: string }>;
  assertStringIncludes(rows[0].message, "0/2");
});

// ─── Escalation condition: pendingNotExpired > 0 → no escalation ─────────────

Deno.test("expire-offers: pending (non-expired) suggested booking → no escalation", async () => {
  const futureExpiry = new Date(FIXED_NOW.getTime() + 60_000).toISOString(); // 1 min in the future
  // offer_tier: 1 marks this as THIS tier's own live offer (the "window still open" signal).
  const bookings = [
    { status: "suggested", offer_tier: 1, offer_expires_at: futureExpiry },
  ];
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: bookings, error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 0);
});

Deno.test("expire-offers: suggested booking with null offer_expires_at → treated as pending → no escalation", async () => {
  const bookings = [{ status: "suggested", offer_tier: 1, offer_expires_at: null }];
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: bookings, error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 0);
});

// ─── Boundary: offer_expires_at exactly == now ────────────────────────────────

Deno.test("expire-offers: boundary — offer_expires_at exactly == now → NOT pending → escalation fires", async () => {
  // offer_expires_at === deps.now() → the check is > deps.now(), so == means EXPIRED
  const exactlyNow = FIXED_NOW.toISOString();
  const bookings = [{ status: "suggested", offer_expires_at: exactlyNow }];
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: bookings, error: null },
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  // Exactly at now is NOT > now → counts as expired → pendingNotExpired == 0 → escalation fires
  assertEquals((await res.json()).escalations, 1);
});

Deno.test("expire-offers: boundary — offer_expires_at 1ms in the future → still pending → no escalation", async () => {
  const oneMillisLater = new Date(FIXED_NOW.getTime() + 1).toISOString();
  const bookings = [{ status: "suggested", offer_tier: 1, offer_expires_at: oneMillisLater }];
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: bookings, error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 0);
});

// ─── Escalation condition: accepted >= requiredSlots → no escalation ──────────

Deno.test("expire-offers: accepted (soft_booked) meets requiredSlots → no escalation", async () => {
  // requiredSlots = 2+1=3; provide 3 soft_booked bookings
  const bookings = [
    { status: "soft_booked", offer_expires_at: null },
    { status: "soft_booked", offer_expires_at: null },
    { status: "soft_booked", offer_expires_at: null },
  ];
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: bookings, error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 0);
});

Deno.test("expire-offers: accepted (confirmed) meets requiredSlots → no escalation", async () => {
  // requiredSlots = 3; all confirmed
  const bookings = [
    { status: "confirmed", offer_expires_at: null },
    { status: "confirmed", offer_expires_at: null },
    { status: "confirmed", offer_expires_at: null },
  ];
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: bookings, error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 0);
});

Deno.test("expire-offers: mix of soft_booked + confirmed counts toward accepted", async () => {
  // 1 soft_booked + 2 confirmed = 3 = requiredSlots → no escalation
  const bookings = [
    { status: "soft_booked", offer_expires_at: null },
    { status: "confirmed", offer_expires_at: null },
    { status: "confirmed", offer_expires_at: null },
  ];
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: bookings, error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 0);
});

Deno.test("expire-offers: cancelled bookings do NOT count toward accepted", async () => {
  // 3 cancelled bookings → accepted=0 < 3 required, no pending → should escalate
  const bookings = [
    { status: "cancelled", offer_expires_at: null },
    { status: "cancelled", offer_expires_at: null },
    { status: "cancelled", offer_expires_at: null },
  ];
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: bookings, error: null },
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 1);
});

// ─── Recipients: resolve_show_assignments → fallback to admins ────────────────

Deno.test("expire-offers: producers resolved → notification sent to each producer", async () => {
  const producers = [
    { producer_user_id: "prod-1" },
    { producer_user_id: "prod-2" },
  ];
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: producers, error: null },
    },
    usersById: {
      "prod-1": { email: "prod1@example.com" },
      "prod-2": { email: "prod2@example.com" },
    },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 1);

  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  const rows = notifInsert?.args[0] as Array<{ user_id: string; type: string }>;
  assertEquals(rows.length, 2);
  const recipientIds = rows.map((r) => r.user_id).sort();
  assertEquals(recipientIds, ["prod-1", "prod-2"]);
  assertEquals(rows[0].type, "cast_escalation_requested");
});

Deno.test("expire-offers: empty producers → falls back to admin users", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [], error: null },
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }, { user_id: "admin-2" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: {
      "admin-1": { email: "admin1@example.com" },
      "admin-2": { email: "admin2@example.com" },
    },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 1);

  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  const rows = notifInsert?.args[0] as Array<{ user_id: string }>;
  const recipientIds = rows.map((r) => r.user_id).sort();
  assertEquals(recipientIds, ["admin-1", "admin-2"]);
});

Deno.test("expire-offers: dedupes duplicate producer ids → one notification + one email per user", async () => {
  // When resolve_show_assignments returns the same producer_user_id twice, the handler
  // dedupes via [...new Set(recipientIds)] so only ONE notification row and ONE email
  // are produced for that user — consistent with tier-at-risk-watcher.
  const producers = [
    { producer_user_id: "prod-1" },
    { producer_user_id: "prod-1" }, // duplicate
  ];
  const { deps, calls, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: producers, error: null },
    },
    usersById: { "prod-1": { email: "prod1@example.com" } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);

  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  const rows = notifInsert?.args[0] as Array<{ user_id: string }>;
  // After dedup: exactly 1 notification row for prod-1
  assertEquals(rows.length, 1, "deduped: only 1 notification row for the same user");
  assertEquals(rows[0].user_id, "prod-1");
  // After dedup: exactly 1 email for prod-1
  const emailCalls = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emailCalls.length, 1, "deduped: only 1 email sent for the same user");
  assertEquals((emailCalls[0].body as { recipient_email: string }).recipient_email, "prod1@example.com");
});

// ─── Notification payload shape ───────────────────────────────────────────────

Deno.test("expire-offers: notification row has correct fields", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [], error: null },
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
  });
  await handle(cronReq(), deps);

  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  const rows = notifInsert?.args[0] as Array<Record<string, unknown>>;
  assertEquals(rows.length, 1);
  const row = rows[0];
  assertEquals(row.user_id, "admin-1");
  assertEquals(row.type, "cast_escalation_requested");
  assertEquals(row.title, "Escalation needed");
  assertEquals(typeof row.message, "string");
  assertEquals(row.related_entity_type, "show_date_offer_tier");
  assertEquals(row.related_entity_id, "tier-1");
});

// ─── Email sending ────────────────────────────────────────────────────────────

Deno.test("expire-offers: sends an email per recipient via sendEmail", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null },
    },
    usersById: { "prod-1": { email: "prod1@example.com" } },
    now: FIXED_NOW,
  });
  await handle(cronReq(), deps);

  const emailCalls = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emailCalls.length, 1);
  const msg = emailCalls[0].body as { template_name: string; recipient_email: string };
  assertEquals(msg.template_name, "cast-escalation-requested");
  assertEquals(msg.recipient_email, "prod1@example.com");
});

Deno.test("expire-offers: email failure does not abort the loop (best-effort)", async () => {
  // Wrap sendEmail to throw
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null },
    },
    usersById: { "prod-1": { email: "prod1@example.com" } },
    now: FIXED_NOW,
  });

  // Override sendEmail to throw
  (deps as { sendEmail: unknown }).sendEmail = () => { throw new Error("SMTP down"); };

  const res = await handle(cronReq(), deps);
  // Should still return 200 and count the escalation
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 1);
  // Notification should still have been inserted
  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(notifInsert !== undefined, true);
});

Deno.test("expire-offers: recipient with no email in auth → skipped for email, not for notification", async () => {
  // usersById missing prod-1 → getUserById returns null user → email lookup skipped
  const { deps, calls, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [{ producer_user_id: "prod-1" }], error: null },
    },
    usersById: {}, // no email on file
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 1);

  // Notification was inserted (recipient included)
  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(notifInsert !== undefined, true);
  // No email was sent
  const emailCalls = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emailCalls.length, 0);
});

// ─── Idempotency stamp ────────────────────────────────────────────────────────

Deno.test("expire-offers: stamps escalation_notified_at on the tier (idempotency)", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [], error: null },
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
  });
  await handle(cronReq(), deps);

  // Find the update call on show_date_offer_tiers
  const updateCall = calls.find(
    (c) => c.table === "show_date_offer_tiers" && c.method === "update",
  );
  assertEquals(updateCall !== undefined, true, "should update show_date_offer_tiers");
  const updateArg = updateCall!.args[0] as { escalation_notified_at: string };
  assertEquals(updateArg.escalation_notified_at, FIXED_NOW.toISOString());
});

Deno.test("expire-offers: open tier query filters by escalation_notified_at IS NULL", async () => {
  // characterization: already-escalated tiers excluded via .is('escalation_notified_at', null) in the query
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [], error: null },
    },
    rpcs: { expire_soft_bookings: { data: null, error: null } },
    now: FIXED_NOW,
  });
  await handle(cronReq(), deps);

  // The chain on show_date_offer_tiers should include .is('escalation_notified_at', null)
  const isCalls = calls.filter(
    (c) => c.table === "show_date_offer_tiers" && c.method === "is",
  );
  const hasEscalationFilter = isCalls.some(
    (c) => c.args[0] === "escalation_notified_at" && c.args[1] === null,
  );
  assertEquals(hasEscalationFilter, true);
});

// ─── Response body ────────────────────────────────────────────────────────────

Deno.test("expire-offers: response body expired:true on success with escalations", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [], error: null },
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.expired, true);
  assertEquals(body.escalations, 1);
});

Deno.test("expire-offers: no notifications insert when no recipients", async () => {
  // resolve_show_assignments empty AND no admin rows → no notifications
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [], error: null },
      notifications: { data: null, error: null },
      org_memberships: { data: [], error: null }, // no admins
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  // The tier still counts as escalated (accepted < required and no pending)
  // but no notification insert since recipientIds is empty
  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(notifInsert, undefined);
  // Idempotency stamp still written
  const updateCall = calls.find(
    (c) => c.table === "show_date_offer_tiers" && c.method === "update",
  );
  assertEquals(updateCall !== undefined, true);
});

// ─── Slot columns from shows + notification org_id (Part 6) ──────────────────

Deno.test("expire-offers: reads slot capacity from shows columns and stamps notification org_id", async () => {
  const ORG = "00000000-0000-0000-0000-0000000000a1";
  const { deps } = makeFakeDeps({
    now: new Date("2026-06-01T12:00:00.000Z"),
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "s" } },
      ],
      show_date_offer_tiers: { data: [{ id: "t1", show_date_id: "sd1", tier: 1, escalation_notified_at: null }], error: null },
      // Slot capacity lives on the show row: main_cast_slots=1, understudy_slots=0 → requiredSlots=1
      show_dates: { data: { id: "sd1", date: "2026-06-10", city_id: "c1", org_id: ORG, show: { program: "P", sub_program: "S", main_cast_slots: 1, understudy_slots: 0 } }, error: null },
      bookings: { data: [{ status: "suggested", offer_expires_at: "2026-05-01T00:00:00Z" }], error: null }, // expired, 0 accepted
      org_memberships: { data: [{ user_id: "admin-1" }], error: null }, // admin fallback (resolve_show_assignments empty)
      notifications: { data: null, error: null },
    },
    rpcs: { expire_soft_bookings: { data: null, error: null }, resolve_show_assignments: { data: [], error: null } },
  });

  // Capture the notifications insert payload.
  let notifPayload: any = null;
  const originalFrom = bindFakeFrom(deps.admin);
  (deps.admin as any).from = (t: string) => {
    const chain = originalFrom(t);
    if (t === "notifications") {
      const orig = chain.insert.bind(chain);
      chain.insert = (p: unknown) => { notifPayload = p; return (orig as (x: unknown) => ReturnType<typeof orig>)(p); };
    }
    return chain;
  };

  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "s" } }), deps);
  assertEquals(res.status, 200);
  assertExists(notifPayload); // escalation fired
  assertEquals(notifPayload[0].org_id, ORG); // notification carries the show_date's org_id
});

// ─── M2 slot-math corrections ────────────────────────────────────────────────
// FIXED_NOW is 2026-06-01; 2026-07-01 is future, 2026-05-01 is past.

Deno.test("expire-offers: M2 — understudy_slots does NOT inflate required; accepted == main → no escalation", async () => {
  // main_cast_slots=1, understudy_slots=5. Old math: need 6 → 1 accepted escalates.
  // New math: need 1 (main only) → 1 accepted is filled, no escalation.
  const showDate = {
    ...SHOW_DATE,
    show: { program: "Ballet", sub_program: "Matinée", main_cast_slots: 1, understudy_slots: 5 },
  };
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: showDate, error: null },
      bookings: { data: [{ status: "soft_booked", offer_tier: 1, offer_expires_at: null }], error: null },
    },
    rpcs: { expire_soft_bookings: { data: null, error: null }, resolve_show_assignments: { data: [], error: null } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 0, "understudy slots must not inflate the requirement");
});

Deno.test("expire-offers: M2 — manual booking (offer_tier NULL) counts toward filled → no escalation", async () => {
  // main_cast_slots=2. A manual booking (offer_tier NULL) + one accepted offer = 2 → filled.
  // This tier's own offers have all expired, so old per-tier count would still escalate.
  const showDate = {
    ...SHOW_DATE,
    show: { program: "Ballet", sub_program: "Matinée", main_cast_slots: 2, understudy_slots: 0 },
  };
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: showDate, error: null },
      bookings: {
        data: [
          { status: "confirmed", offer_tier: null, offer_expires_at: null },     // manual — must count
          { status: "soft_booked", offer_tier: 1, offer_expires_at: null },       // this tier's accepted
          { status: "suggested", offer_tier: 1, offer_expires_at: "2026-05-01T00:00:00Z" }, // this tier, expired
        ],
        error: null,
      },
    },
    rpcs: { expire_soft_bookings: { data: null, error: null }, resolve_show_assignments: { data: [], error: null } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 0, "manual (offer_tier NULL) booking must count toward filled");
});

Deno.test("expire-offers: M2 — past date is never escalated", async () => {
  // Genuinely unfillable (0 accepted, need 2, no live pending) but the date is in the past.
  const showDate = {
    ...SHOW_DATE,
    date: "2026-05-01",
    show: { program: "Ballet", sub_program: "Matinée", main_cast_slots: 2, understudy_slots: 0 },
  };
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: appSettingsSeed(),
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: showDate, error: null },
      bookings: { data: [], error: null },
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: { expire_soft_bookings: { data: null, error: null }, resolve_show_assignments: { data: [], error: null } },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).escalations, 0, "past dates must never escalate");
});

// ─── Milestone C — Task 11: 24h offer expiry reminder pass ───────────────────
//
// Runs between the expire_soft_bookings RPC and the tier-escalation scan. Gated per
// org on `flow.artist_acceptance && flow.expiry_reminder` (resolveBookingFlow reads
// app_settings.key='booking_flow' — array-seed matched by the recorded `.eq('key', …)`
// arg, same disambiguation idiom as Task 10's send-offer-digest tests).

Deno.test("expire-offers: sends one reminder per artist inside the 24h window and stamps reminder_sent_at", async () => {
  const ORG_ID = "org-1";
  const dueBooking = {
    id: "booking-1",
    artist_id: "artist-1",
    offer_expires_at: new Date(FIXED_NOW.getTime() + 12 * 3600 * 1000).toISOString(),
    artists: { id: "artist-1", name: "Jo Performer", email: "jo@example.com", user_id: null },
    show_dates: {
      date: "2026-07-01",
      custom: null,
      show_id: "show-1",
      city_id: "city-1",
      shows: { program: "Ballet", sub_program: "Matinée" },
    },
  };
  const { deps, calls, invokeCalls } = makeFakeDeps({
    now: FIXED_NOW,
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: CRON_SECRET } },
        { when: { key: "booking_flow" }, data: [{ org_id: ORG_ID, value: { expiry_reminder: true } }] },
      ],
      organizations: { data: [{ id: ORG_ID }], error: null },
      show_date_offer_tiers: { data: [], error: null }, // empty tier scan — escalation loop stays quiet
      bookings: { data: [dueBooking], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_user_contacts: { data: [], error: null },
    },
  });

  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.reminders_sent, 1);

  const emailCalls = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emailCalls.length, 1);
  const msg = emailCalls[0].body as { template_name: string; recipient_email: string };
  assertEquals(msg.template_name, "offer-expiry-reminder");
  assertEquals(msg.recipient_email, "jo@example.com");

  const stampCall = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertExists(stampCall);
  const stampArg = stampCall!.args[0] as { reminder_sent_at?: string };
  assertEquals(stampArg.reminder_sent_at, FIXED_NOW.toISOString());
});

Deno.test("expire-offers: logs and continues when the reminder's notification insert fails", async () => {
  const ORG_ID = "org-1";
  const dueBooking = {
    id: "booking-1",
    artist_id: "artist-1",
    offer_expires_at: new Date(FIXED_NOW.getTime() + 12 * 3600 * 1000).toISOString(),
    // A registered user_id is required to reach the notifications insert at all.
    artists: { id: "artist-1", name: "Jo Performer", email: "jo@example.com", user_id: "user-1" },
    show_dates: {
      date: "2026-07-01",
      custom: null,
      show_id: "show-1",
      city_id: "city-1",
      shows: { program: "Ballet", sub_program: "Matinée" },
    },
  };
  const { deps } = makeFakeDeps({
    now: FIXED_NOW,
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: CRON_SECRET } },
        { when: { key: "booking_flow" }, data: [{ org_id: ORG_ID, value: { expiry_reminder: true } }] },
      ],
      organizations: { data: [{ id: ORG_ID }], error: null },
      show_date_offer_tiers: { data: [], error: null },
      bookings: { data: [dueBooking], error: null },
      notifications: { data: null, error: { message: "insert boom" } },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_user_contacts: { data: [], error: null },
    },
  });

  const errorLogs: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => { errorLogs.push(args); };
  let res: Response;
  try {
    res = await handle(cronReq(), deps);
  } finally {
    console.error = originalConsoleError;
  }

  assertEquals(res.status, 200);
  const body = await res.json();
  // A failed in-app notification must not undo the reminder: the email already sent
  // and the booking is already stamped by the time the insert is attempted.
  assertEquals(body.reminders_sent, 1);

  const loggedNotifFailure = errorLogs.some(
    (args) =>
      typeof args[0] === "string" &&
      args[0].includes("expire-offers") &&
      args[0].includes("notification insert failed"),
  );
  assertEquals(loggedNotifFailure, true);
});

Deno.test("expire-offers: no reminder when expiry_reminder is off or already stamped", async () => {
  const ORG_ID = "org-1";
  const dueBooking = {
    id: "booking-1",
    artist_id: "artist-1",
    offer_expires_at: new Date(FIXED_NOW.getTime() + 12 * 3600 * 1000).toISOString(),
    artists: { id: "artist-1", name: "Jo Performer", email: "jo@example.com", user_id: null },
    show_dates: {
      date: "2026-07-01",
      custom: null,
      show_id: "show-1",
      city_id: "city-1",
      shows: { program: "Ballet", sub_program: "Matinée" },
    },
  };

  // Variant 1: flow.expiry_reminder is off — the due booking would otherwise qualify,
  // but the org hasn't opted in, so the reminder query never runs for it.
  {
    const { deps, invokeCalls } = makeFakeDeps({
      now: FIXED_NOW,
      tables: {
        app_settings: [
          { when: { key: "cron_secret" }, data: { value: CRON_SECRET } },
          { when: { key: "booking_flow" }, data: [{ org_id: ORG_ID, value: { expiry_reminder: false } }] },
        ],
        organizations: { data: [{ id: ORG_ID }], error: null },
        show_date_offer_tiers: { data: [], error: null },
        bookings: { data: [dueBooking], error: null },
      },
      rpcs: { expire_soft_bookings: { data: null, error: null } },
    });
    const res = await handle(cronReq(), deps);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).reminders_sent, 0);
    assertEquals(invokeCalls.some((c) => c.name === "send-transactional-email"), false);
  }

  // Variant 2: flow is on, but the only matching booking already has reminder_sent_at
  // set. The real `.is('reminder_sent_at', null)` filter excludes it server-side — the
  // fake seed models that outcome as an empty result — while the handler must still have
  // issued the idempotency filter (characterization, mirrors the escalation scan's own
  // `.is('escalation_notified_at', null)` test above).
  {
    const { deps, calls, invokeCalls } = makeFakeDeps({
      now: FIXED_NOW,
      tables: {
        app_settings: [
          { when: { key: "cron_secret" }, data: { value: CRON_SECRET } },
          { when: { key: "booking_flow" }, data: [{ org_id: ORG_ID, value: { expiry_reminder: true } }] },
        ],
        organizations: { data: [{ id: ORG_ID }], error: null },
        show_date_offer_tiers: { data: [], error: null },
        bookings: { data: [], error: null },
      },
      rpcs: { expire_soft_bookings: { data: null, error: null } },
    });
    const res = await handle(cronReq(), deps);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).reminders_sent, 0);
    assertEquals(invokeCalls.some((c) => c.name === "send-transactional-email"), false);

    const isCalls = calls.filter((c) => c.table === "bookings" && c.method === "is");
    const hasReminderFilter = isCalls.some(
      (c) => c.args[0] === "reminder_sent_at" && c.args[1] === null,
    );
    assertEquals(hasReminderFilter, true);
  }
});

// The gate is `!flow.artist_acceptance || !flow.expiry_reminder`. The variants above
// only cover expiry_reminder off; this covers the other side of the OR, a
// direct-booking org (artist_acceptance: false) with expiry_reminder otherwise ON.
Deno.test("expire-offers: no reminder when artist_acceptance is false (even if expiry_reminder is on)", async () => {
  const ORG_ID = "org-1";
  const dueBooking = {
    id: "booking-1",
    artist_id: "artist-1",
    offer_expires_at: new Date(FIXED_NOW.getTime() + 12 * 3600 * 1000).toISOString(),
    artists: { id: "artist-1", name: "Jo Performer", email: "jo@example.com", user_id: null },
    show_dates: {
      date: "2026-07-01",
      custom: null,
      show_id: "show-1",
      city_id: "city-1",
      shows: { program: "Ballet", sub_program: "Matinée" },
    },
  };
  const { deps, invokeCalls } = makeFakeDeps({
    now: FIXED_NOW,
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: CRON_SECRET } },
        { when: { key: "booking_flow" }, data: [{ org_id: ORG_ID, value: { artist_acceptance: false, expiry_reminder: true } }] },
      ],
      organizations: { data: [{ id: ORG_ID }], error: null },
      show_date_offer_tiers: { data: [], error: null },
      bookings: { data: [dueBooking], error: null },
    },
    rpcs: { expire_soft_bookings: { data: null, error: null } },
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).reminders_sent, 0);
  assertEquals(invokeCalls.some((c) => c.name === "send-transactional-email"), false);
});

// ─── Milestone C — Task 12: auto-escalation of short tiers ───────────────────
//
// Runs inside the same per-tier scan as the manual escalation path, gated on
// `flow.auto_escalate` (booking_flow, resolved once per org via a flowByOrg
// cache). When on and a next `cast_city_priority` tier exists for the date's
// city, the short tier is closed and the next tier opened automatically —
// skipping the manual cast-escalation-requested email/notification for that
// row. No next tier → falls back to the existing manual path unchanged.

Deno.test("expire-offers: auto_escalate closes the short tier and opens the next", async () => {
  const bookings = [
    { status: "cancelled", offer_tier: 1, offer_expires_at: null },
    { status: "suggested", offer_tier: 1, offer_expires_at: "2026-05-01T00:00:00Z" }, // expired
  ];
  const { deps, calls, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: CRON_SECRET } },
        { when: { key: "booking_flow" }, data: [{ org_id: SHOW_DATE.org_id, value: { auto_escalate: true } }] },
      ],
      // The org must be ACTIVE for auto-escalation to fire (activeOrgIds gate).
      organizations: { data: [{ id: SHOW_DATE.org_id }], error: null },
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: bookings, error: null },
      cast_city_priority: { data: [{ priority: 2 }], error: null },
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.auto_escalated, 1);
  // The manual path never ran for this row.
  assertEquals(body.escalations, 0);

  const openCall = invokeCalls.find((c) => c.name === "open-offer-tier");
  assertExists(openCall);
  assertEquals(openCall!.body, { show_date_id: "sd-1", tier: 2 });

  const tierUpdate = calls.find((c) => c.table === "show_date_offer_tiers" && c.method === "update");
  assertExists(tierUpdate);
  const updateArg = tierUpdate!.args[0] as { closed_at?: string; escalation_notified_at?: string };
  assertEquals(typeof updateArg.closed_at, "string");
  assertEquals(typeof updateArg.escalation_notified_at, "string");

  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  assertExists(notifInsert);
  const rows = notifInsert!.args[0] as Array<{ type: string; user_id: string; title: string; message: string }>;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].type, "tier_escalated");
  assertEquals(rows[0].user_id, "admin-1");
  assertEquals(rows[0].title, "Tier escalated automatically");
  assertEquals(rows[0].message, "Tier 1 closed short · tier 2 opened automatically.");

  // No manual cast-escalation-requested email — the auto path skips it entirely.
  const escalationEmails = invokeCalls.filter(
    (c) => c.name === "send-transactional-email" &&
      (c.body as { template_name?: string }).template_name === "cast-escalation-requested",
  );
  assertEquals(escalationEmails.length, 0);
});

Deno.test("expire-offers: auto_escalate with no next tier falls back to the manual escalation path", async () => {
  const bookings = [
    { status: "cancelled", offer_tier: 1, offer_expires_at: null },
    { status: "suggested", offer_tier: 1, offer_expires_at: "2026-05-01T00:00:00Z" },
  ];
  const { deps, calls, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: CRON_SECRET } },
        { when: { key: "booking_flow" }, data: [{ org_id: SHOW_DATE.org_id, value: { auto_escalate: true } }] },
      ],
      // The org must be ACTIVE for auto-escalation to fire (activeOrgIds gate).
      organizations: { data: [{ id: SHOW_DATE.org_id }], error: null },
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: bookings, error: null },
      cast_city_priority: { data: [], error: null }, // no next tier configured
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.escalations, 1);
  assertEquals(body.auto_escalated, 0);

  // Identical to the existing manual-escalation behavior.
  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  assertExists(notifInsert);
  const rows = notifInsert!.args[0] as Array<{ type: string }>;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].type, "cast_escalation_requested");

  const tierUpdate = calls.find((c) => c.table === "show_date_offer_tiers" && c.method === "update");
  assertExists(tierUpdate);
  const updateArg = tierUpdate!.args[0] as { escalation_notified_at?: string; closed_at?: string };
  assertEquals(updateArg.escalation_notified_at, FIXED_NOW.toISOString());
  assertEquals(updateArg.closed_at, undefined);

  const openCall = invokeCalls.find((c) => c.name === "open-offer-tier");
  assertEquals(openCall, undefined);
});

Deno.test("expire-offers: auto_escalate invoke failure does not claim success and falls through to manual escalation", async () => {
  const bookings = [
    { status: "cancelled", offer_tier: 1, offer_expires_at: null },
    { status: "suggested", offer_tier: 1, offer_expires_at: "2026-05-01T00:00:00Z" }, // expired
  ];
  const { deps, calls, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: CRON_SECRET } },
        { when: { key: "booking_flow" }, data: [{ org_id: SHOW_DATE.org_id, value: { auto_escalate: true } }] },
      ],
      // The org must be ACTIVE for auto-escalation to fire (activeOrgIds gate).
      organizations: { data: [{ id: SHOW_DATE.org_id }], error: null },
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: bookings, error: null },
      cast_city_priority: { data: [{ priority: 2 }], error: null },
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
    // The open-offer-tier invoke fails. Note this also makes deps.sendEmail (which
    // shares the same fake invokeFunction) report failure — harmless here, since the
    // manual path's email send is best-effort and already tolerates failures.
    emailResult: { data: null, error: { message: "boom" } },
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();

  // A failed invoke must not be counted as an auto-escalation, and the row must fall
  // through to the manual path so a human still gets notified.
  assertEquals(body.auto_escalated, 0);
  assertEquals(body.escalations, 1);

  const openCall = invokeCalls.find((c) => c.name === "open-offer-tier");
  assertExists(openCall);
  assertEquals(openCall!.body, { show_date_id: "sd-1", tier: 2 });

  const notifInserts = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  const notifRows = notifInserts.flatMap((c) => c.args[0] as Array<{ type: string }>);
  assertEquals(notifRows.some((r) => r.type === "tier_escalated"), false);
  assertEquals(notifRows.some((r) => r.type === "cast_escalation_requested"), true);
});

// Round-2 review fix: auto-escalation must be scoped to ACTIVE orgs. A short tier owned by
// a SUSPENDED org (not in getActiveOrgs) with auto_escalate:true and a next tier available
// must NOT auto-open the next tier; it falls through to the manual escalation path,
// exactly as it behaved before auto-escalation existed (the manual path was never
// active-scoped).
Deno.test("expire-offers: auto_escalate on an INACTIVE org does not auto-open, falls through to manual", async () => {
  const OTHER_ACTIVE_ORG = "00000000-0000-0000-0000-0000000000ff";
  const bookings = [
    { status: "cancelled", offer_tier: 1, offer_expires_at: null },
    { status: "suggested", offer_tier: 1, offer_expires_at: "2026-05-01T00:00:00Z" }, // expired
  ];
  const { deps, calls, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: CRON_SECRET } },
        { when: { key: "booking_flow" }, data: [{ org_id: SHOW_DATE.org_id, value: { auto_escalate: true } }] },
      ],
      // Active set exists but does NOT contain SHOW_DATE.org_id → that org is suspended.
      organizations: { data: [{ id: OTHER_ACTIVE_ORG }], error: null },
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: bookings, error: null },
      cast_city_priority: { data: [{ priority: 2 }], error: null }, // a next tier IS available
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  // Auto-escalation gated off; manual path fires instead.
  assertEquals(body.auto_escalated, 0);
  assertEquals(body.escalations, 1);

  // No open-offer-tier invoke: the auto branch was skipped for the inactive org.
  const openCall = invokeCalls.find((c) => c.name === "open-offer-tier");
  assertEquals(openCall, undefined);

  // Manual escalation notification was produced (pre-PR behavior for this org).
  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  assertExists(notifInsert);
  const rows = notifInsert!.args[0] as Array<{ type: string }>;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].type, "cast_escalation_requested");

  // Manual idempotency stamp written; tier NOT closed (auto path never ran).
  const tierUpdate = calls.find((c) => c.table === "show_date_offer_tiers" && c.method === "update");
  assertExists(tierUpdate);
  const updateArg = tierUpdate!.args[0] as { escalation_notified_at?: string; closed_at?: string };
  assertEquals(updateArg.escalation_notified_at, FIXED_NOW.toISOString());
  assertEquals(updateArg.closed_at, undefined);
});

// ─── Task 5: ladder-aware auto-escalation next-tier lookup ───────────────────
//
// The auto-escalation branch above used to query cast_city_priority directly for the
// next tier. It now routes through resolveTierLadder/nextTierAfter (_shared/eligibility.ts,
// Task 3), the SAME effective ladder that open-offer-tier used to open this tier: a
// show-scoped priority list (show_cast_eligibility for this show+city) wins outright over
// the org-wide cast_city_priority list. Automation never applies a skill filter, so the
// open-offer-tier invoke body must never carry a skill_filter_ids key.

Deno.test("expire-offers: show ladder wins over the org city list for the next tier", async () => {
  // show_cast_eligibility carries the show's own ladder (priorities 1 and 3) for this
  // (show, city); cast_city_priority carries the org-wide list with priority 2 for the
  // SAME city. resolveTierLadder must prefer the show ladder outright: the next tier
  // after 1 is 3 (the show ladder's own next rung), never 2 (the org list's), proving the
  // lookup did not silently fall back to querying cast_city_priority directly.
  const showDate = { ...SHOW_DATE, show_id: "show-1" };
  const bookings = [
    { status: "cancelled", offer_tier: 1, offer_expires_at: null },
    { status: "suggested", offer_tier: 1, offer_expires_at: "2026-05-01T00:00:00Z" }, // expired
  ];
  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: CRON_SECRET } },
        { when: { key: "booking_flow" }, data: [{ org_id: SHOW_DATE.org_id, value: { auto_escalate: true } }] },
      ],
      organizations: { data: [{ id: SHOW_DATE.org_id }], error: null },
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: showDate, error: null },
      bookings: { data: bookings, error: null },
      show_cast_eligibility: {
        data: [{ cast_id: "cast-a", priority: 1 }, { cast_id: "cast-b", priority: 3 }],
        error: null,
      },
      cast_city_priority: { data: [{ cast_id: "cast-c", priority: 2 }], error: null },
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.auto_escalated, 1);
  assertEquals(body.escalations, 0);

  const openCall = invokeCalls.find((c) => c.name === "open-offer-tier");
  assertExists(openCall);
  assertEquals(openCall!.body, { show_date_id: "sd-1", tier: 3 });

  // Automation never applies a skill filter (spec rule): the invoke body must not
  // carry a skill_filter_ids key at all.
  assertEquals("skill_filter_ids" in (openCall!.body as Record<string, unknown>), false);
});

Deno.test("expire-offers: org city list still resolves the next tier when the show has no priorities", async () => {
  // show_cast_eligibility is empty for this show+city, so the ladder falls through to
  // the org-wide cast_city_priority list (source: 'org'), the same next-tier result the
  // direct cast_city_priority query used to produce, now reached through the ladder.
  const showDate = { ...SHOW_DATE, show_id: "show-1" };
  const bookings = [
    { status: "cancelled", offer_tier: 1, offer_expires_at: null },
    { status: "suggested", offer_tier: 1, offer_expires_at: "2026-05-01T00:00:00Z" },
  ];
  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: CRON_SECRET } },
        { when: { key: "booking_flow" }, data: [{ org_id: SHOW_DATE.org_id, value: { auto_escalate: true } }] },
      ],
      organizations: { data: [{ id: SHOW_DATE.org_id }], error: null },
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: showDate, error: null },
      bookings: { data: bookings, error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: {
        data: [{ cast_id: "cast-x", priority: 1 }, { cast_id: "cast-y", priority: 2 }],
        error: null,
      },
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.auto_escalated, 1);
  assertEquals(body.escalations, 0);

  const openCall = invokeCalls.find((c) => c.name === "open-offer-tier");
  assertExists(openCall);
  assertEquals(openCall!.body, { show_date_id: "sd-1", tier: 2 });
});

Deno.test("expire-offers: show ladder exhausted (only the current tier) falls through to manual escalation", async () => {
  // The show's ladder has ONLY tier 1 (the tier that's currently short), no higher rung
  // exists on the show list, so nextTierAfter returns null. cast_city_priority DOES have
  // a next tier (priority 2) here on purpose: since the show list is non-empty it must
  // win outright (source: 'show'), so that org row must never be consulted. A wrong
  // implementation that fell back to the org list on an exhausted show ladder would
  // wrongly auto-escalate to tier 2 instead of falling through to the manual path.
  const showDate = { ...SHOW_DATE, show_id: "show-1" };
  const bookings = [
    { status: "cancelled", offer_tier: 1, offer_expires_at: null },
    { status: "suggested", offer_tier: 1, offer_expires_at: "2026-05-01T00:00:00Z" },
  ];
  const { deps, calls, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: CRON_SECRET } },
        { when: { key: "booking_flow" }, data: [{ org_id: SHOW_DATE.org_id, value: { auto_escalate: true } }] },
      ],
      organizations: { data: [{ id: SHOW_DATE.org_id }], error: null },
      show_date_offer_tiers: { data: [OPEN_TIER], error: null },
      show_dates: { data: showDate, error: null },
      bookings: { data: bookings, error: null },
      show_cast_eligibility: { data: [{ cast_id: "cast-a", priority: 1 }], error: null },
      cast_city_priority: { data: [{ cast_id: "cast-c", priority: 2 }], error: null },
      notifications: { data: null, error: null },
      org_memberships: { data: [{ user_id: "admin-1" }], error: null },
    },
    rpcs: {
      expire_soft_bookings: { data: null, error: null },
      resolve_show_assignments: { data: [], error: null },
    },
    usersById: { "admin-1": { email: "admin@example.com" } },
    now: FIXED_NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.auto_escalated, 0);
  assertEquals(body.escalations, 1);

  const openCall = invokeCalls.find((c) => c.name === "open-offer-tier");
  assertEquals(openCall, undefined, "an exhausted show ladder must never fall back to the org city list");

  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  assertExists(notifInsert);
  const rows = notifInsert!.args[0] as Array<{ type: string }>;
  assertEquals(rows.length, 1);
  assertEquals(rows[0].type, "cast_escalation_requested");
});
