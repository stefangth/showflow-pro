import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const cronHeaders = { "X-Cron-Secret": "sekret" };
const withSecret = { rpcs: { get_cron_secret: { data: "sekret", error: null } } };

Deno.test("alerts super-admins on operational → degraded transition", async () => {
  const snapshot = { attempted: 100, sent: 100, delivered: 94, bounced: 6, delayed: 0, complained: 0,
    failed: 0, suppressed: 0, delivery_rate: 0.94, bounce_rate: 0.06, complaint_rate: 0, failure_count: 0 };
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
  assertEquals(Array.isArray(notif!.args[0]) ? (notif!.args[0] as unknown[]).length : 1, 1);
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
