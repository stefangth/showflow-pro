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

Deno.test("cron-health-watcher: a single non-2xx for a healthy job does not alert yet (debounce)", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "offer-digest", status: "healthy", alerted_at: null, last_ok_at: "2026-06-22T19:00:00Z", consecutive_failures: 0, last_observation_key: "req:0" }] },
    },
    rpcs: {
      cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 1, dispatched_at: recent, status_code: 404, timed_out: false, error_msg: null, responded_at: recent }] },
      resolve_user_contacts: { data: [{ user_id: "super-1", email: "ops@test.com", display_name: "Ops" }] },
    },
    now: NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  // First failed observation is recorded (status failing, consecutive_failures 1) but NOT announced:
  // a lone self-healing 500/503/401 must not email every super-admin. alerted_at stays null.
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  const payload = (upsert?.args?.[0] ?? {}) as { status?: string; consecutive_failures?: number; alerted_at?: string | null };
  assertEquals(payload.status, "failing");
  assertEquals(payload.consecutive_failures, 1);
  assertEquals(payload.alerted_at, null);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0);
  assertEquals(calls.some((c) => c.table === "notifications" && c.method === "insert"), false);
  assertEquals(calls.some((c) => c.table === "cron_health_log" && c.method === "insert"), false);
  assertEquals((await res.json()).newly_failing, 0);
});

Deno.test("cron-health-watcher: a second consecutive non-2xx alerts once (in-app + email)", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      // Already failed once (consecutive 1), not yet alerted. A NEW failed dispatch (req:2) is the 2nd in a row.
      cron_health_state: { data: [{ job_name: "offer-digest", status: "failing", alerted_at: null, last_ok_at: "2026-06-22T19:00:00Z", consecutive_failures: 1, last_observation_key: "req:1" }] },
    },
    rpcs: {
      cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 2, dispatched_at: recent, status_code: 404, timed_out: false, error_msg: null, responded_at: recent }] },
      resolve_user_contacts: { data: [{ user_id: "super-1", email: "ops@test.com", display_name: "Ops" }] },
    },
    now: NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  const payload = (upsert?.args?.[0] ?? {}) as { consecutive_failures?: number; alerted_at?: string | null };
  assertEquals(payload.consecutive_failures, 2);
  assertEquals(payload.alerted_at, NOW.toISOString());
  // related_entity_id is a uuid column and org_id is nullable — both MUST be null for a platform
  // alert, else Postgres rejects the insert (uuid-cast error / not-null violation) and the alert
  // silently never reaches super-admins.
  const notif = calls.find((c) => c.table === "notifications" && c.method === "insert");
  const rows = (notif?.args?.[0] ?? []) as Array<Record<string, unknown>>;
  assertEquals(rows[0]?.related_entity_id, null);
  assertEquals(rows[0]?.org_id, null);
  assertEquals(calls.some((c) => c.table === "cron_health_log" && c.method === "insert"), true);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertEquals((email?.body as { template_name?: string })?.template_name, "cron-health-alert");
  assertEquals((email?.body as { recipient_email?: string })?.recipient_email, "ops@test.com");
  assertEquals((await res.json()).newly_failing, 1);
});

Deno.test("cron-health-watcher: a healthy run after a single un-alerted blip recovers silently", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      // Failed once, never alerted (alerted_at null) — the debounce means no incident was ever announced,
      // so its recovery must be silent (no "recovered" notification, no email).
      cron_health_state: { data: [{ job_name: "offer-digest", status: "failing", alerted_at: null, last_ok_at: "2026-06-22T19:00:00Z", consecutive_failures: 1, last_observation_key: "req:1" }] },
    },
    rpcs: { cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 2, dispatched_at: recent, status_code: 200, timed_out: false, error_msg: null, responded_at: recent }] } },
    now: NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  const payload = (upsert?.args?.[0] ?? {}) as { status?: string; consecutive_failures?: number };
  assertEquals(payload.status, "healthy");
  assertEquals(payload.consecutive_failures, 0);
  assertEquals(calls.some((c) => c.table === "notifications" && c.method === "insert"), false);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0);
  assertEquals((await res.json()).recovered, 0);
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
      // last_observation_key names an EARLIER dispatch than the scan's request_id, so this run is a
      // genuinely new observation and must increment. Without the key the fixture's undefined would
      // compare unequal to "req:4" anyway, and the test would pass without exercising the gate.
      cron_health_state: { data: [{ job_name: "offer-digest", status: "failing", alerted_at: "2026-06-23T09:00:00Z", last_ok_at: null, consecutive_failures: 3, last_observation_key: "req:3" }] },
    },
    rpcs: { cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 4, dispatched_at: recent, answered_at: recent, status_code: 500, timed_out: false, error_msg: null, responded_at: recent }] } },
    now: NOW,
  });
  await handle(cronReq(), deps);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  assertEquals(((upsert?.args?.[0]) as { consecutive_failures?: number }).consecutive_failures, 4);
  // An ongoing failure (wasFailing) logs nothing new — cron_health_log records one row per incident, not per run.
  assertEquals(calls.filter((c) => c.table === "cron_health_log" && c.method === "insert").length, 0);
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

Deno.test("cron-health-watcher: in-flight dispatches (no response yet) are not counted as checked", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [] },
    },
    rpcs: {
      cron_health_scan: { data: [
        { job_name: "offer-digest", request_id: 1, dispatched_at: recent, status_code: null, timed_out: null, error_msg: null, responded_at: null },
        { job_name: "airtable-poll", request_id: 2, dispatched_at: recent, status_code: null, timed_out: null, error_msg: null, responded_at: null },
      ] },
    },
    now: NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  // Both dispatched recently with no response yet → skipped, so `checked` must be 0, not 2 (byJob.size).
  assertEquals((await res.json()).checked, 0);
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

Deno.test("cron-health-watcher: re-reading the SAME dispatch does not re-increment consecutive_failures", async () => {
  // An hourly job scanned by a */15 watcher re-reads one dispatch row up to 4 times. Counting
  // watcher passes turned a single timeout into "3 consecutive failures" on the prod dashboard.
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "expire-offers-hourly", status: "failing", alerted_at: "2026-06-23T09:00:00Z", last_ok_at: null, consecutive_failures: 1, last_observation_key: "req:42" }] },
    },
    rpcs: {
      cron_health_scan: { data: [{ job_name: "expire-offers-hourly", request_id: 42, dispatched_at: recent, answered_at: recent, status_code: null, timed_out: true, error_msg: null, responded_at: recent }] },
    },
    now: NOW,
  });
  await handle(cronReq(), deps);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  const payload = (upsert?.args?.[0] ?? {}) as { consecutive_failures?: number; last_observation_key?: string };
  assertEquals(payload.consecutive_failures, 1);
  assertEquals(payload.last_observation_key, "req:42");
});

Deno.test("cron-health-watcher: a NEW failed dispatch does increment consecutive_failures", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "expire-offers-hourly", status: "failing", alerted_at: "2026-06-23T09:00:00Z", last_ok_at: null, consecutive_failures: 1, last_observation_key: "req:42" }] },
    },
    rpcs: {
      cron_health_scan: { data: [{ job_name: "expire-offers-hourly", request_id: 43, dispatched_at: recent, answered_at: recent, status_code: null, timed_out: true, error_msg: null, responded_at: recent }] },
    },
    now: NOW,
  });
  await handle(cronReq(), deps);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  const payload = (upsert?.args?.[0] ?? {}) as { consecutive_failures?: number; last_observation_key?: string };
  assertEquals(payload.consecutive_failures, 2);
  assertEquals(payload.last_observation_key, "req:43");
});

Deno.test("cron-health-watcher: recovers itself from a previous answered dispatch while its own is in flight", async () => {
  // The watcher's own dispatch is in flight for its whole run, so the scan reports a newer
  // dispatched_at than answered_at. It must still classify from the answered 200 and recover,
  // rather than skipping itself forever (prod last_ok_at was stuck at 2026-06-24).
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "cron-health-watcher", status: "failing", alerted_at: "2026-06-23T09:00:00Z", last_ok_at: null, consecutive_failures: 5, last_observation_key: "req:98" }] },
    },
    rpcs: {
      cron_health_scan: { data: [{ job_name: "cron-health-watcher", request_id: 99, dispatched_at: recent, answered_at: "2026-06-23T09:45:00.000Z", status_code: 200, timed_out: false, error_msg: null, responded_at: "2026-06-23T09:45:10.000Z" }] },
    },
    now: NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  const payload = (upsert?.args?.[0] ?? {}) as { status?: string; consecutive_failures?: number; alerted_at?: string | null };
  assertEquals(payload.status, "healthy");
  assertEquals(payload.consecutive_failures, 0);
  assertEquals(payload.alerted_at, null);
  assertEquals((await res.json()).recovered, 1);
});

Deno.test("cron-health-watcher: a repeated STALE observation does not re-increment either", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "offer-digest", status: "stale", alerted_at: "2026-06-23T09:00:00Z", last_ok_at: null, consecutive_failures: 2, last_observation_key: `stale:${stale}` }] },
    },
    rpcs: {
      cron_health_scan: { data: [{ job_name: "offer-digest", request_id: null, dispatched_at: stale, answered_at: null, status_code: null, timed_out: null, error_msg: null, responded_at: null }] },
    },
    now: NOW,
  });
  await handle(cronReq(), deps);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  assertEquals(((upsert?.args?.[0]) as { consecutive_failures?: number }).consecutive_failures, 2);
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
