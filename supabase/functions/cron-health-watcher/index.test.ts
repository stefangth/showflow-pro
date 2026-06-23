import { assertEquals } from "../_shared/test-asserts.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const SECRET = "cron-secret";
const NOW = new Date("2026-06-23T10:00:00.000Z");
const recent = "2026-06-23T09:58:00.000Z"; // 2 min before NOW — within every maxSilence window
const stale = "2026-06-21T10:00:00.000Z"; // 48h before NOW — older than every maxSilence window
const cronReq = () => makeRequest({ headers: { "X-Cron-Secret": SECRET } });

Deno.test("cron-health-watcher: wrong cron secret -> 401", async () => {
  const { deps } = makeFakeDeps({ tables: { app_settings: { data: { value: SECRET } } }, now: NOW });
  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "wrong" } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("cron-health-watcher: a non-2xx for a healthy job alerts once (in-app + email)", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "offer-digest", status: "healthy", alerted_at: null, last_ok_at: "2026-06-22T19:00:00Z", consecutive_failures: 0 }] },
    },
    rpcs: {
      cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 1, dispatched_at: recent, status_code: 404, timed_out: false, error_msg: null, responded_at: recent }] },
      resolve_user_contacts: { data: [{ user_id: "super-1", email: "ops@test.com", display_name: "Ops" }] },
    },
    now: NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.some((c) => c.table === "notifications" && c.method === "insert"), true);
  // related_entity_id is a uuid column and org_id is nullable — both MUST be null for a platform
  // alert, else Postgres rejects the insert (uuid-cast error / not-null violation) and the alert
  // silently never reaches super-admins.
  const notif = calls.find((c) => c.table === "notifications" && c.method === "insert");
  const rows = (notif?.args?.[0] ?? []) as Array<Record<string, unknown>>;
  assertEquals(rows[0]?.related_entity_id, null);
  assertEquals(rows[0]?.org_id, null);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertEquals((email?.body as { template_name?: string })?.template_name, "cron-health-alert");
  assertEquals((email?.body as { recipient_email?: string })?.recipient_email, "ops@test.com");
});

Deno.test("cron-health-watcher: does not re-alert a job already failing", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "offer-digest", status: "failing", alerted_at: "2026-06-23T09:00:00Z", last_ok_at: null, consecutive_failures: 2 }] },
    },
    rpcs: { cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 2, dispatched_at: recent, status_code: 404, timed_out: false, error_msg: null, responded_at: recent }] } },
    now: NOW,
  });
  await handle(cronReq(), deps);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0);
});

Deno.test("cron-health-watcher: consecutive_failures increments from the previous value", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "offer-digest", status: "failing", alerted_at: "2026-06-23T09:00:00Z", last_ok_at: null, consecutive_failures: 3 }] },
    },
    rpcs: { cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 4, dispatched_at: recent, status_code: 500, timed_out: false, error_msg: null, responded_at: recent }] } },
    now: NOW,
  });
  await handle(cronReq(), deps);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  assertEquals(((upsert?.args?.[0]) as { consecutive_failures?: number }).consecutive_failures, 4);
});

Deno.test("cron-health-watcher: a 2xx for a failing job clears the alert + notifies recovery (in-app, no email)", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "offer-digest", status: "failing", alerted_at: "2026-06-23T09:00:00Z", last_ok_at: null, consecutive_failures: 3 }] },
    },
    rpcs: { cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 3, dispatched_at: recent, status_code: 200, timed_out: false, error_msg: null, responded_at: recent }] } },
    now: NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  const payload = (upsert?.args?.[0] ?? {}) as { status?: string; alerted_at?: string | null; consecutive_failures?: number };
  assertEquals(payload.status, "healthy");
  assertEquals(payload.alerted_at, null);
  assertEquals(payload.consecutive_failures, 0);
  assertEquals(calls.some((c) => c.table === "notifications" && c.method === "insert"), true);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0);
});

Deno.test("cron-health-watcher: a stale latest dispatch (cron stopped firing) is flagged + alerts", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "offer-digest", status: "healthy", alerted_at: null, last_ok_at: "2026-06-21T19:00:00Z", consecutive_failures: 0 }] },
    },
    rpcs: {
      // Latest dispatch is 48h old with an OK response — the cron has stopped firing.
      cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 9, dispatched_at: stale, status_code: 200, timed_out: false, error_msg: null, responded_at: stale }] },
      resolve_user_contacts: { data: [{ user_id: "super-1", email: "ops@test.com" }] },
    },
    now: NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  assertEquals(((upsert?.args?.[0]) as { status?: string }).status, "stale");
  // The stale branch must NOT carry the last successful run's 200 — a red "stale (200)" badge
  // reads as a false alarm. Status code is null for staleness failures.
  assertEquals(((upsert?.args?.[0]) as { last_status_code?: number | null }).last_status_code, null);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 1);
});

Deno.test("cron-health-watcher: aborts 503 on a scan-RPC error (no false-healthy, no alert)", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    tables: { app_settings: { data: { value: SECRET } }, platform_admins: { data: [{ user_id: "super-1" }] } },
    rpcs: { cron_health_scan: { data: null, error: { message: "boom" } } },
    now: NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 503);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0);
  assertEquals(calls.some((c) => c.table === "notifications" && c.method === "insert"), false);
});

Deno.test("cron-health-watcher: aborts 503 on a state-read error (prevents alert storm)", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: null, error: { message: "boom" } },
    },
    rpcs: { cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 7, dispatched_at: recent, status_code: 404, timed_out: false, error_msg: null, responded_at: recent }] } },
    now: NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 503);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0);
});

Deno.test("cron-health-watcher: a job with no dispatch row is skipped (no false alert)", async () => {
  const { deps, invokeCalls, calls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [] },
    },
    rpcs: { cron_health_scan: { data: [] } }, // no dispatches at all
    now: NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0);
  assertEquals(calls.some((c) => c.table === "notifications" && c.method === "insert"), false);
});
