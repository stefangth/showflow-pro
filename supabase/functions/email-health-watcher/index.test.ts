import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const cronHeaders = { "X-Cron-Secret": "sekret" };
const withSecret = { rpcs: { get_cron_secret: { data: "sekret", error: null } } };

Deno.test("alerts super-admins on operational → degraded transition", async () => {
  // bounce_rate 0.03 sits between bounceWarn (0.02) and bounceDown (0.05) → derives "degraded".
  const snapshot = { attempted: 100, sent: 100, delivered: 97, bounced: 3, delayed: 0, complained: 0,
    failed: 0, suppressed: 0, delivery_rate: 0.97, bounce_rate: 0.03, complaint_rate: 0, failure_count: 0 };
  const { deps, calls } = makeFakeDeps({
    ...withSecret,
    rpcs: { ...withSecret.rpcs, email_health_snapshot: { data: snapshot, error: null } },
    tables: {
      email_health_state: { data: { last_state: "operational" }, error: null },
      platform_admins: { data: [{ user_id: "super-1" }], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: cronHeaders }), deps);
  assertEquals(res.status, 200);
  const notif = calls.find((c) => c.table === "notifications" && c.method === "insert");
  assertEquals((notif!.args[0] as unknown[]).length, 1);

  // Fresh transition into a bad state must stamp last_alerted_at (alert-storm/lost-alert guard).
  const up = calls.find((c) => c.table === "email_health_state" && c.method === "upsert");
  assert((up!.args[0] as { last_alerted_at?: unknown }).last_alerted_at);
});

Deno.test("keeps prior state when the alert fails on a fresh transition (retry next run)", async () => {
  // Same degraded-deriving snapshot as above; the notifications insert errors out.
  const snapshot = { attempted: 100, sent: 100, delivered: 97, bounced: 3, delayed: 0, complained: 0,
    failed: 0, suppressed: 0, delivery_rate: 0.97, bounce_rate: 0.03, complaint_rate: 0, failure_count: 0 };
  const { deps, calls } = makeFakeDeps({
    ...withSecret,
    rpcs: { ...withSecret.rpcs, email_health_snapshot: { data: snapshot, error: null } },
    tables: {
      notifications: { data: null, error: { message: "insert boom" } },
      email_health_state: { data: { last_state: "operational" }, error: null },
      platform_admins: { data: [{ user_id: "super-1" }], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: cronHeaders }), deps);
  assertEquals(res.status, 200);
  const upsert = calls.find((c) => c.table === "email_health_state" && c.method === "upsert");
  assertEquals((upsert!.args[0] as { last_state: string }).last_state, "operational");
});

Deno.test("no re-alert when already degraded (idempotent)", async () => {
  const snapshot = { attempted: 100, sent: 100, delivered: 94, bounced: 6, delayed: 0, complained: 0,
    failed: 0, suppressed: 0, delivery_rate: 0.94, bounce_rate: 0.06, complaint_rate: 0, failure_count: 0 };
  const { deps, calls } = makeFakeDeps({
    ...withSecret,
    rpcs: { ...withSecret.rpcs, email_health_snapshot: { data: snapshot, error: null } },
    tables: {
      email_health_state: { data: { last_state: "down" }, error: null },
      platform_admins: { data: [{ user_id: "super-1" }], error: null },
    },
  });
  await handle(makeRequest({ headers: cronHeaders }), deps);
  assertEquals(calls.some((c) => c.table === "notifications" && c.method === "insert"), false);
});

Deno.test("rejects without cron secret", async () => {
  const { deps } = makeFakeDeps(withSecret);
  const res = await handle(makeRequest({ headers: {} }), deps);
  assertEquals(res.status, 401);
});

Deno.test("alert title interpolates the actual state ('down'), not a hardcoded 'degraded'", async () => {
  // bounce_rate 0.10 > bounceDown (0.05) → derives "down" (not "degraded").
  const snapshot = { attempted: 100, sent: 100, delivered: 90, bounced: 10, delayed: 0, complained: 0,
    failed: 0, suppressed: 0, delivery_rate: 0.9, bounce_rate: 0.10, complaint_rate: 0, failure_count: 0 };
  const { deps, calls } = makeFakeDeps({
    ...withSecret,
    rpcs: { ...withSecret.rpcs, email_health_snapshot: { data: snapshot, error: null } },
    tables: {
      email_health_state: { data: { last_state: "operational" }, error: null },
      platform_admins: { data: [{ user_id: "super-1" }], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: cronHeaders }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.state, "down");

  const notif = calls.find((c) => c.table === "notifications" && c.method === "insert");
  const rows = notif!.args[0] as Array<{ title: string }>;
  assertEquals(rows[0].title, "Email delivery down");
});

Deno.test("recovery (down → operational) clears last_alerted_at to null", async () => {
  // Clean snapshot: well within every threshold → derives "operational".
  const snapshot = { attempted: 100, sent: 100, delivered: 99, bounced: 1, delayed: 0, complained: 0,
    failed: 0, suppressed: 0, delivery_rate: 0.99, bounce_rate: 0.01, complaint_rate: 0, failure_count: 0 };
  const { deps, calls } = makeFakeDeps({
    ...withSecret,
    rpcs: { ...withSecret.rpcs, email_health_snapshot: { data: snapshot, error: null } },
    tables: {
      email_health_state: { data: { last_state: "down" }, error: null },
      platform_admins: { data: [{ user_id: "super-1" }], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: cronHeaders }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.state, "operational");

  // Recovery is not a "bad" state, so last_alerted_at must be cleared regardless of the
  // prior alert — it is not the alert channel (recovery sends no notification/email here).
  const up = calls.find((c) => c.table === "email_health_state" && c.method === "upsert");
  assertEquals((up!.args[0] as { last_alerted_at: unknown }).last_alerted_at, null);
  // No alert on recovery (single-channel, in-app-on-bad-transition only).
  assertEquals(calls.some((c) => c.table === "notifications" && c.method === "insert"), false);
});
