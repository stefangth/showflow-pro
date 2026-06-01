import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const BERLIN_19 = new Date("2026-06-01T17:00:00.000Z"); // 19:00 Berlin (CEST)
const cronOK = { "X-Cron-Secret": "s" };

function baseDeps(extraTables = {}, now = BERLIN_19) {
  return makeFakeDeps({
    now,
    tables: { app_settings: { data: { value: "s" }, error: null }, ...extraTables },
  });
}

Deno.test("send-offer-digest: skips when Berlin hour != target", async () => {
  const { deps } = baseDeps({}, new Date("2026-06-01T12:00:00.000Z")); // 14:00 Berlin
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.skipped, true);
});

Deno.test("send-offer-digest: wrong cron secret → 401", async () => {
  const { deps } = makeFakeDeps({ tables: { app_settings: { data: { value: "s" }, error: null } } });
  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "nope" } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("send-offer-digest: no pending offers → digests_sent 0", async () => {
  const { deps } = baseDeps({ bookings: { data: [], error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(await res.json(), { digests_sent: 0 });
});

Deno.test("send-offer-digest: sends email AND stamps digest_sent_at+offer_expires_at together", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, calls, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(await res.json(), { digests_sent: 1 });
  assertEquals(invokeCalls.some((c) => c.name === "send-transactional-email"), true);
  const update = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertEquals(!!update, true);
  const payload = update!.args[0] as Record<string, unknown>;
  assertEquals("digest_sent_at" in payload && "offer_expires_at" in payload, true);
});
