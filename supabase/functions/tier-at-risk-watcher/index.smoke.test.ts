import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const cronOK = { "X-Cron-Secret": "s" };

Deno.test("tier-at-risk-watcher: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("tier-at-risk-watcher: wrong cron secret → 401", async () => {
  const { deps } = makeFakeDeps({ tables: { app_settings: { data: { value: "s" }, error: null } } });
  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "nope" } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("tier-at-risk-watcher: no open tiers → 200", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: "s" }, error: null },
      show_date_offer_tiers: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(res.status, 200);
});
