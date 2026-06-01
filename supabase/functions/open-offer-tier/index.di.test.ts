import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const SVC = { Authorization: "Bearer svc" };
const envVars = { SUPABASE_SERVICE_ROLE_KEY: "svc" };

Deno.test("open-offer-tier: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("open-offer-tier: no auth → 401", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ headers: {}, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("open-offer-tier: service role + missing fields → 400", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ headers: SVC, body: { tier: 0 } }), deps);
  assertEquals(res.status, 400);
});

Deno.test("open-offer-tier: cancelled show date → 400", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: { show_dates: { data: { id: "d1", show_id: "s1", city_id: "c1", date: "2026-02-01", status: "cancelled" }, error: null } },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 400);
});

Deno.test("open-offer-tier: tier with no priority casts returns offers_created 0", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: { id: "d1", show_id: "s1", city_id: "c1", date: "2026-02-01", status: "open" }, error: null },
      cast_city_priority: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 2 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 0);
});
