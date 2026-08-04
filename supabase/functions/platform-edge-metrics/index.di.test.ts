import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const SUPER = "11111111-1111-1111-1111-111111111111";

// The live function_edge_logs schema keys rows by function_id (a UUID), NOT function_name.
const POLL_ID = "140e6080-44a3-43b9-ab15-37b65ac56fd1";
const DIGEST_ID = "42692e78-2ad2-443f-8430-49137c88706a";
// GET /v1/projects/{ref}/functions returns a bare array of { id, slug, name, ... }.
const FN_LIST = [
  { id: POLL_ID, slug: "airtable-poll", name: "airtable-poll" },
  { id: DIGEST_ID, slug: "send-offer-digest", name: "send-offer-digest" },
];

/** Canned Analytics rows: 3 airtable-poll invocations (one 500), 1 fast send-offer-digest. */
function analyticsRows() {
  return {
    result: [
      { function_id: POLL_ID, status_code: 200, execution_time_ms: 4000, timestamp: "2026-06-24T09:00:00Z" },
      { function_id: POLL_ID, status_code: 200, execution_time_ms: 9000, timestamp: "2026-06-24T09:05:00Z" },
      { function_id: POLL_ID, status_code: 500, execution_time_ms: 1200, timestamp: "2026-06-24T09:10:00Z" },
      { function_id: DIGEST_ID, status_code: 200, execution_time_ms: 3000, timestamp: "2026-06-24T09:00:00Z" },
    ],
  };
}

/** Routes the two upstream calls the handler makes: the Analytics query and the functions-list
 *  lookup. Any URL containing "/analytics/" gets `analytics`; everything else gets `fnList`. */
function routeFetch(analytics: unknown, fnList: unknown = FN_LIST): typeof fetch {
  return ((url: string) => {
    const payload = String(url).includes("/analytics/") ? analytics : fnList;
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
  }) as unknown as typeof fetch;
}

function superDeps(fetchImpl?: typeof fetch) {
  return makeFakeDeps({
    authUser: { id: SUPER },
    tables: { platform_admins: { data: { user_id: SUPER }, error: null } },
    envVars: { ANALYTICS: "sbp_test_token", SUPABASE_URL: "https://proj.supabase.co" },
    fetchImpl,
  });
}
const superReq = (body: Record<string, unknown> = {}) =>
  makeRequest({ method: "POST", headers: { Authorization: "Bearer super-jwt" }, body });

Deno.test("OPTIONS preflight returns 204", async () => {
  const { deps } = superDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status, 204);
});

Deno.test("missing Bearer -> 401", async () => {
  const { deps } = superDeps();
  const res = await handle(makeRequest({ method: "POST", body: {} }), deps);
  assertEquals(res.status, 401);
});

Deno.test("non-super-admin -> 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "plain" },
    tables: { platform_admins: { data: null, error: null } },
    envVars: { ANALYTICS: "sbp_test_token", SUPABASE_URL: "https://proj.supabase.co" },
  });
  const res = await handle(superReq(), deps);
  assertEquals(res.status, 403);
});

Deno.test("aggregates per function and authenticates with the ANALYTICS PAT", async () => {
  let seenUrl = "";
  let seenAuth = "";
  // Capture the Analytics call specifically (a second call fetches the functions list).
  const fetchImpl = ((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/analytics/")) {
      seenUrl = u;
      seenAuth = String((init?.headers as Record<string, string>)?.["Authorization"] ?? "");
      return Promise.resolve(new Response(JSON.stringify(analyticsRows()), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(FN_LIST), { status: 200 }));
  }) as unknown as typeof fetch;

  const { deps } = superDeps(fetchImpl);
  const res = await handle(superReq({ window_minutes: 60 }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { functions: Array<Record<string, unknown>> };

  const poll = body.functions.find((f) => f.fn === "airtable-poll")!;
  assertExists(poll);
  assertEquals(poll.invocations, 3);
  assertEquals(poll.errors, 1);
  assertEquals(poll.p95Ms, 9000);
  assertEquals(seenUrl.startsWith("https://api.supabase.com/v1/projects/proj/analytics"), true);
  assertEquals(seenAuth, "Bearer sbp_test_token");
});

Deno.test("resolves real function_id UUIDs to slugs via the functions-list API", async () => {
  // The live Analytics API returns function_edge_logs rows keyed by function_id (a UUID) —
  // there is NO function_name column. The proxy must resolve those ids to slugs so the panel
  // shows names, not UUIDs. Regression for the empty "Edge functions" panel.
  const { deps } = superDeps(routeFetch(analyticsRows()));
  const res = await handle(superReq({ window_minutes: 60 }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { functions: Array<Record<string, unknown>> };

  const poll = body.functions.find((f) => f.fn === "airtable-poll");
  assertExists(poll);
  assertEquals(poll!.invocations, 3);
  const digest = body.functions.find((f) => f.fn === "send-offer-digest");
  assertExists(digest);
  // No row should collapse into a raw UUID or "unknown".
  assertEquals(body.functions.some((f) => f.fn === "unknown" || f.fn === POLL_ID), false);
});

Deno.test("degrades to id labels (still 200) when the functions-list API fails", async () => {
  const analytics = { result: [{ function_id: POLL_ID, status_code: 200, execution_time_ms: 4000, timestamp: "2026-06-24T09:00:00Z" }] };
  const fetchImpl = ((url: string) => {
    if (String(url).includes("/analytics/")) return Promise.resolve(new Response(JSON.stringify(analytics), { status: 200 }));
    return Promise.resolve(new Response("nope", { status: 500 })); // functions-list unavailable
  }) as unknown as typeof fetch;
  const { deps } = superDeps(fetchImpl);
  const res = await handle(superReq({ window_minutes: 60 }), deps);
  assertEquals(res.status, 200); // name resolution failing must NOT blank the panel
  const body = await res.json() as { functions: Array<Record<string, unknown>> };
  assertEquals(body.functions.length, 1);
  assertEquals(body.functions[0].fn, POLL_ID); // falls back to the id as label
});

Deno.test("analytics non-200 -> 502", async () => {
  const fetchImpl = (() => Promise.resolve(new Response("nope", { status: 500 }))) as unknown as typeof fetch;
  const { deps } = superDeps(fetchImpl);
  const res = await handle(superReq(), deps);
  assertEquals(res.status, 502);
});

Deno.test("window is clamped to <= 24h", async () => {
  let seenUrl = "";
  const fetchImpl = ((url: string) => {
    seenUrl = String(url);
    return Promise.resolve(new Response(JSON.stringify({ result: [] }), { status: 200 }));
  }) as unknown as typeof fetch;
  const { deps } = superDeps(fetchImpl);
  await handle(superReq({ window_minutes: 99999 }), deps);
  const u = new URL(seenUrl);
  const start = new Date(u.searchParams.get("iso_timestamp_start")!);
  const end = new Date(u.searchParams.get("iso_timestamp_end")!);
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  assertEquals(hours <= 24.0001, true);
});

Deno.test("p95 uses nearest-rank, not the max, when N is a multiple of 20", async () => {
  // 20 invocations with latencies 1000..20000ms. p95 nearest-rank = ceil(0.95*20)-1 = index 18 = 19000,
  // NOT the max (20000) that a plain Math.floor would pick.
  const rows = Array.from({ length: 20 }, (_, i) => ({
    function_id: POLL_ID, status_code: 200, execution_time_ms: (i + 1) * 1000,
    timestamp: `2026-06-24T09:${String(i).padStart(2, "0")}:00Z`,
  }));
  const { deps } = superDeps(routeFetch({ result: rows }));
  const res = await handle(superReq({ window_minutes: 60 }), deps);
  const body = await res.json() as { functions: Array<Record<string, unknown>> };
  const poll = body.functions.find((f) => f.fn === "airtable-poll")!;
  assertEquals(poll.p95Ms, 19000);
  assertEquals(poll.p50Ms, 10000);
});

const TIER_ID = "af3fd77d-cba2-4026-b5db-34d04de20ef5";

Deno.test("counts 4xx as rejected, 5xx as errors, and breaks down by status", async () => {
  const rows = {
    result: [
      { function_id: TIER_ID, status_code: 401, execution_time_ms: 300, timestamp: "2026-07-21T09:00:00Z" },
      { function_id: TIER_ID, status_code: 401, execution_time_ms: 310, timestamp: "2026-07-21T09:05:00Z" },
      { function_id: TIER_ID, status_code: 500, execution_time_ms: 900, timestamp: "2026-07-21T09:10:00Z" },
      { function_id: TIER_ID, status_code: 200, execution_time_ms: 400, timestamp: "2026-07-21T09:15:00Z" },
    ],
  };
  const fnList = [{ id: TIER_ID, slug: "open-offer-tier", name: "open-offer-tier" }];
  const { deps } = superDeps(routeFetch(rows, fnList));
  const res = await handle(superReq(), deps);
  assertEquals(res.status, 200);

  const body = await res.json() as { functions: Array<Record<string, unknown>> };
  const fn = body.functions[0];
  assertEquals(fn.fn, "open-offer-tier");
  assertEquals(fn.invocations, 4);
  assertEquals(fn.rejected, 2);
  assertEquals(fn.errors, 1);
  assertEquals(fn.byStatus, { "200": 1, "401": 2, "500": 1 });
});

Deno.test("lastFailure reports the most recent non-2xx, not the most recent call", async () => {
  const rows = {
    result: [
      { function_id: TIER_ID, status_code: 401, execution_time_ms: 300, timestamp: "2026-07-21T09:00:00Z" },
      { function_id: TIER_ID, status_code: 200, execution_time_ms: 400, timestamp: "2026-07-21T09:20:00Z" },
    ],
  };
  const fnList = [{ id: TIER_ID, slug: "open-offer-tier", name: "open-offer-tier" }];
  const { deps } = superDeps(routeFetch(rows, fnList));
  const res = await handle(superReq(), deps);

  const body = await res.json() as { functions: Array<Record<string, unknown>> };
  // Normalised to a full ISO instant, whatever units the row arrived in.
  assertEquals(body.functions[0].lastFailure, { status: 401, at: "2026-07-21T09:00:00.000Z" });
});

Deno.test("lastFailure is null when every call succeeded", async () => {
  const rows = {
    result: [
      { function_id: TIER_ID, status_code: 200, execution_time_ms: 400, timestamp: "2026-07-21T09:00:00Z" },
    ],
  };
  const fnList = [{ id: TIER_ID, slug: "open-offer-tier", name: "open-offer-tier" }];
  const { deps } = superDeps(routeFetch(rows, fnList));
  const res = await handle(superReq(), deps);

  const body = await res.json() as { functions: Array<Record<string, unknown>> };
  assertEquals(body.functions[0].lastFailure, null);
});

Deno.test("logs action returns recent log lines for one function", async () => {
  const logRows = {
    result: [
      { timestamp: "2026-07-21T09:10:00Z", level: "error", event_message: "airtable-poll: open-offer-tier failed" },
      { timestamp: "2026-07-21T09:09:00Z", level: "error", event_message: "Unauthorized" },
    ],
  };
  const fnList = [{ id: TIER_ID, slug: "open-offer-tier", name: "open-offer-tier" }];
  const { deps } = superDeps(routeFetch(logRows, fnList));
  const res = await handle(superReq({ action: "logs", fn: "open-offer-tier" }), deps);
  assertEquals(res.status, 200);

  const body = await res.json() as { lines: Array<Record<string, unknown>> };
  assertEquals(body.lines.length, 2);
  assertEquals(body.lines[0].message, "airtable-poll: open-offer-tier failed");
  assertEquals(body.lines[0].level, "error");
});

Deno.test("logs action still requires super-admin", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "plain" },
    tables: { platform_admins: { data: null, error: null } },
    envVars: { ANALYTICS: "sbp_test_token", SUPABASE_URL: "https://proj.supabase.co" },
  });
  const res = await handle(superReq({ action: "logs", fn: "open-offer-tier" }), deps);
  assertEquals(res.status, 403);
});

Deno.test("logs action rejects a missing fn", async () => {
  const { deps } = superDeps(routeFetch({ result: [] }));
  const res = await handle(superReq({ action: "logs" }), deps);
  assertEquals(res.status, 400);
});

Deno.test("reads the microsecond epoch timestamps the live Analytics API returns", async () => {
  // The API returns `timestamp` as a microsecond epoch integer, NOT an ISO string (verified
  // 2026-08-04). Passing it to `new Date()` unconverted yields the year 58,000 silently, which
  // is what made health-rollup aggregate nothing and rendered "Last failure Invalid Date" here.
  const rows = {
    result: [
      { function_id: TIER_ID, status_code: 502, execution_time_ms: 4200, timestamp: 1785867796145000 },
      { function_id: TIER_ID, status_code: 200, execution_time_ms: 400, timestamp: 1785867700000000 },
    ],
  };
  const fnList = [{ id: TIER_ID, slug: "open-offer-tier", name: "open-offer-tier" }];
  const { deps } = superDeps(routeFetch(rows, fnList));
  const res = await handle(superReq(), deps);

  const body = await res.json() as { functions: Array<Record<string, unknown>> };
  const fn = body.functions[0];
  assertEquals(fn.lastFailure, { status: 502, at: "2026-08-04T18:23:16.145Z" });
  assertEquals(fn.lastInvokedAt, "2026-08-04T18:23:16.145Z");
  assertEquals((fn.recent as Array<{ at?: string }>)[0].at, "2026-08-04T18:23:16.145Z");
});
