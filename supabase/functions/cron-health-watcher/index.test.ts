import { assertEquals } from "../_shared/test-asserts.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const SECRET = "cron-secret";
const NOW = new Date("2026-06-23T10:00:00.000Z");
const recent = "2026-06-23T09:58:00.000Z"; // 2 min before NOW — within every maxSilence window
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
      cron_health_state: { data: [{ job_name: "offer-digest", status: "healthy", alerted_at: null, last_ok_at: "2026-06-22T19:00:00Z" }] },
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
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertEquals((email?.body as { template_name?: string })?.template_name, "cron-health-alert");
  assertEquals((email?.body as { recipient_email?: string })?.recipient_email, "ops@test.com");
});

Deno.test("cron-health-watcher: does not re-alert a job already failing", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "offer-digest", status: "failing", alerted_at: "2026-06-23T09:00:00Z", last_ok_at: null }] },
    },
    rpcs: { cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 2, dispatched_at: recent, status_code: 404, timed_out: false, error_msg: null, responded_at: recent }] } },
    now: NOW,
  });
  await handle(cronReq(), deps);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 0);
});

Deno.test("cron-health-watcher: a 2xx for a failing job clears the alert (recovery)", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: SECRET } },
      platform_admins: { data: [{ user_id: "super-1" }] },
      cron_health_state: { data: [{ job_name: "offer-digest", status: "failing", alerted_at: "2026-06-23T09:00:00Z", last_ok_at: null }] },
    },
    rpcs: { cron_health_scan: { data: [{ job_name: "offer-digest", request_id: 3, dispatched_at: recent, status_code: 200, timed_out: false, error_msg: null, responded_at: recent }] } },
    now: NOW,
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const upsert = calls.find((c) => c.table === "cron_health_state" && c.method === "upsert");
  assertEquals(!!upsert, true);
  const payload = (upsert?.args?.[0] ?? {}) as { status?: string; alerted_at?: string | null };
  assertEquals(payload.status, "healthy");
  assertEquals(payload.alerted_at, null);
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
