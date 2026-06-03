import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const cronOK = { "X-Cron-Secret": "s" };

Deno.test("send-confirmation-digest: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("send-confirmation-digest: wrong cron secret → 401", async () => {
  const { deps } = makeFakeDeps({ tables: { app_settings: { data: { value: "s" }, error: null } } });
  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "nope" } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("send-confirmation-digest: authorized run returns 200", async () => {
  // now = 12:00 UTC = 14:00 Berlin, which is not the 20:00 target → handler returns 200 (skipped),
  // and even if it proceeded, seeded bookings [] → digests_sent 0 (also 200).
  const { deps } = makeFakeDeps({
    now: new Date("2026-06-01T12:00:00.000Z"),
    tables: { app_settings: { data: { value: "s" }, error: null }, bookings: { data: [], error: null } },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(res.status, 200);
});
