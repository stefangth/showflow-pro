import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
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
  assertEquals(await res.json(), { expired: true, escalations: 0 });
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

Deno.test("expire-offers: tier with only one slot column null → no escalation", async () => {
  // Even if main_cast_slots is set, null understudy_slots = unconfigured → skip.
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

// ─── requiredSlots calculation ────────────────────────────────────────────────

Deno.test("expire-offers: requiredSlots = main_cast_slots + understudy_slots from shows columns", async () => {
  // SHOW_DATE has main_cast_slots=2, understudy_slots=1 → requiredSlots=3
  // With 0 accepted and 0 pending → should escalate
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
  // Verify the notification message contains slot numbers
  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  const rows = notifInsert?.args[0] as Array<{ message: string }>;
  assertStringIncludes(rows[0].message, "0/3");
});

// ─── Escalation condition: pendingNotExpired > 0 → no escalation ─────────────

Deno.test("expire-offers: pending (non-expired) suggested booking → no escalation", async () => {
  const futureExpiry = new Date(FIXED_NOW.getTime() + 60_000).toISOString(); // 1 min in the future
  const bookings = [
    { status: "suggested", offer_expires_at: futureExpiry },
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
  const bookings = [{ status: "suggested", offer_expires_at: null }];
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
  const bookings = [{ status: "suggested", offer_expires_at: oneMillisLater }];
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
  const originalFrom = deps.admin.from.bind(deps.admin);
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
