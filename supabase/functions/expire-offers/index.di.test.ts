import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

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
