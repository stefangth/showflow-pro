import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const SUPER = "11111111-1111-1111-1111-111111111111";

/** Canned Analytics rows: 3 airtable-poll invocations (one 500), 1 fast send-offer-digest. */
function analyticsRows() {
  return {
    result: [
      { function_name: "airtable-poll", status_code: 200, execution_time_ms: 4000, timestamp: "2026-06-24T09:00:00Z" },
      { function_name: "airtable-poll", status_code: 200, execution_time_ms: 9000, timestamp: "2026-06-24T09:05:00Z" },
      { function_name: "airtable-poll", status_code: 500, execution_time_ms: 1200, timestamp: "2026-06-24T09:10:00Z" },
      { function_name: "send-offer-digest", status_code: 200, execution_time_ms: 3000, timestamp: "2026-06-24T09:00:00Z" },
    ],
  };
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
  const fetchImpl = ((url: string, init?: RequestInit) => {
    seenUrl = String(url);
    seenAuth = String((init?.headers as Record<string, string>)?.["Authorization"] ?? "");
    return Promise.resolve(new Response(JSON.stringify(analyticsRows()), { status: 200 }));
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
