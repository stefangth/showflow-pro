import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const SECRET = "s3cret";

/** The rollup makes two different GETs; route them by URL. */
function fakeFetch(slug: string, rows: unknown[]): typeof fetch {
  return ((url: string) =>
    Promise.resolve(
      String(url).includes("/functions")
        ? new Response(JSON.stringify([{ id: "id-1", slug }]), { status: 200 })
        : new Response(JSON.stringify({ result: rows }), { status: 200 }),
    )) as unknown as typeof fetch;
}

function depsFor(slug: string, rows: unknown[], fetchImpl?: typeof fetch) {
  return makeFakeDeps({
    rpcs: { get_cron_secret: { data: SECRET } },
    envVars: { ANALYTICS: "pat", SUPABASE_PROJECT_REF: "ref" },
    now: new Date("2026-08-04T12:00:00Z"),
    fetchImpl: fetchImpl ?? fakeFetch(slug, rows),
  });
}

const cronReq = () => makeRequest({ headers: { "X-Cron-Secret": SECRET }, body: {} });

/** The rows the handler sent to upsert_health_daily, as recorded by the fake client.
 *  The write goes through the RPC, not a plain .upsert(), so that a truncated re-read of an
 *  older day can never shrink its stored counts (the monotonic guard lives in SQL). */
function upserted(calls: Array<{ table: string; method: string; args: unknown[] }>) {
  const call = calls.find((c) => c.table === "rpc:upsert_health_daily");
  const args = call?.args[0] as { p_rows?: unknown } | undefined;
  return (args?.p_rows ?? []) as Record<string, unknown>[];
}

Deno.test("aggregates a day into runs, failures and worst status", async () => {
  const { deps, calls } = depsFor("airtable-poll", [
    { function_id: "id-1", status_code: 200, execution_time_ms: 900, timestamp: "2026-08-04T09:00:00Z" },
    { function_id: "id-1", status_code: 502, execution_time_ms: 4200, timestamp: "2026-08-04T09:24:00Z" },
  ]);

  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);

  const row = upserted(calls).find((r) => r.day === "2026-08-04" && r.fn === "airtable-poll");
  assertEquals(row?.runs, 2);
  assertEquals(row?.failures, 1);
  assertEquals(row?.rejected, 0);
  assertEquals(row?.worst_status, 502);
});

Deno.test("counts a 4xx as rejected, not as a failure", async () => {
  const { deps, calls } = depsFor("expire-offers", [
    { function_id: "id-1", status_code: 401, execution_time_ms: 100, timestamp: "2026-08-04T09:00:00Z" },
  ]);

  await handle(cronReq(), deps);

  const row = upserted(calls).find((r) => r.fn === "expire-offers");
  assertEquals(row?.failures, 0);
  assertEquals(row?.rejected, 1);
  assertEquals(row?.unauthorized, 1); // a 401 is also counted as unauthorized (a subset of rejected)
});

Deno.test("counts a 401 as unauthorized but a non-401 4xx only as rejected", async () => {
  const { deps, calls } = depsFor("expire-offers", [
    { function_id: "id-1", status_code: 401, execution_time_ms: 100, timestamp: "2026-08-04T09:00:00Z" },
    { function_id: "id-1", status_code: 403, execution_time_ms: 100, timestamp: "2026-08-04T09:05:00Z" },
  ]);

  await handle(cronReq(), deps);

  const row = upserted(calls).find((r) => r.fn === "expire-offers");
  assertEquals(row?.rejected, 2);     // both 4xx
  assertEquals(row?.unauthorized, 1); // only the 401 (the 403 is a genuine rejection)
});

Deno.test("a run with no status code at all counts as a failure", async () => {
  const { deps, calls } = depsFor("airtable-poll", [
    { function_id: "id-1", execution_time_ms: 0, timestamp: "2026-08-04T09:00:00Z" },
  ]);

  await handle(cronReq(), deps);

  assertEquals(upserted(calls).find((r) => r.fn === "airtable-poll")?.failures, 1);
});

Deno.test("splits rows across today and yesterday", async () => {
  const { deps, calls } = depsFor("airtable-poll", [
    { function_id: "id-1", status_code: 200, execution_time_ms: 900, timestamp: "2026-08-04T09:00:00Z" },
    { function_id: "id-1", status_code: 500, execution_time_ms: 900, timestamp: "2026-08-03T22:00:00Z" },
  ]);

  await handle(cronReq(), deps);

  const rows = upserted(calls);
  assertEquals(rows.find((r) => r.day === "2026-08-04")?.failures, 0);
  assertEquals(rows.find((r) => r.day === "2026-08-03")?.failures, 1);
});

Deno.test("ignores rows outside the two days it rewrites", async () => {
  // A wider Analytics response must not create rows for days this pass did not recompute:
  // a partial older day would overwrite a complete one.
  const { deps, calls } = depsFor("airtable-poll", [
    { function_id: "id-1", status_code: 500, execution_time_ms: 900, timestamp: "2026-08-01T09:00:00Z" },
  ]);

  await handle(cronReq(), deps);

  assertEquals(upserted(calls).length, 0);
});

Deno.test("rejects a caller without the cron secret", async () => {
  const { deps } = depsFor("airtable-poll", []);
  const res = await handle(makeRequest({ body: {} }), deps);
  assertEquals(res.status === 401 || res.status === 403, true);
});

Deno.test("returns 502 without writing when Analytics is unavailable", async () => {
  const failing = (() => Promise.resolve(new Response("nope", { status: 500 }))) as unknown as typeof fetch;
  const { deps, calls } = depsFor("airtable-poll", [], failing);

  const res = await handle(cronReq(), deps);

  assertEquals(res.status, 502);
  // A partial rollup written over a real day would turn a metrics outage into a permanent hole.
  assertEquals(calls.some((c) => c.table === "rpc:upsert_health_daily"), false);
});
