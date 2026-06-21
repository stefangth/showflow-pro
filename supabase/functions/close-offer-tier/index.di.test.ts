import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const SVC = { Authorization: "Bearer svc" };
const envVars = { SUPABASE_SERVICE_ROLE_KEY: "svc" };
const NOW = new Date("2026-07-01T10:00:00.000Z");

Deno.test("close-offer-tier: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("close-offer-tier: no auth → 401", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: { show_dates: { data: { id: "d1", org_id: "org-1" }, error: null } },
  });
  const res = await handle(makeRequest({ headers: {}, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("close-offer-tier: authenticated but not a member of the date's org → 403 (no writes)", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    authUser: { id: "u1" },
    tables: {
      show_dates: { data: { id: "d1", org_id: "org-B" }, error: null },
      org_memberships: { data: null, error: null },
      platform_admins: { data: null, error: null },
    },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer user" }, body: { show_date_id: "d1", tier: 1, withdraw: true } }), deps);
  assertEquals(res.status, 403);
  // org gate used the date's org_id; nothing was mutated
  assertEquals(calls.some((c) => c.table === "org_memberships" && c.method === "eq" && c.args[0] === "org_id" && c.args[1] === "org-B"), true);
  assertEquals(calls.some((c) => c.table === "show_date_offer_tiers" && c.method === "update"), false);
  assertEquals(calls.some((c) => c.table === "bookings" && c.method === "update"), false);
});

Deno.test("close-offer-tier: admin/producer of the date's org → closes", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    authUser: { id: "u1" },
    tables: {
      show_dates: { data: { id: "d1", org_id: "org-A" }, error: null },
      org_memberships: { data: { role: "producer" }, error: null },
      show_date_offer_tiers: { data: [{ id: "t1" }], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer user" }, body: { show_date_id: "d1", tier: 1, withdraw: false } }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { closed: true, withdrawn: 0 });
});

Deno.test("close-offer-tier: missing fields → 400", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ headers: SVC, body: { tier: 0 } }), deps);
  assertEquals(res.status, 400);
});

Deno.test("close-offer-tier: invalid JSON → 400", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const req = new Request("http://localhost/fn", {
    method: "POST",
    headers: { ...SVC, "Content-Type": "application/json" },
    body: "not json",
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 400);
});

Deno.test("close-offer-tier: withdraw:false closes tier, withdraws nothing", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    now: NOW,
    tables: { show_date_offer_tiers: { data: [{ id: "t1" }], error: null } },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, withdraw: false } }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { closed: true, withdrawn: 0 });

  const bookingsUpdate = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertEquals(bookingsUpdate, undefined, "no bookings update when withdraw:false");

  const tierUpdate = calls.find((c) => c.table === "show_date_offer_tiers" && c.method === "update");
  assertExists(tierUpdate);
  assertEquals((tierUpdate!.args[0] as Record<string, unknown>).closed_at, NOW.toISOString());
});

Deno.test("close-offer-tier: withdraw:true cancels suggested rows (payload + count + filters)", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    now: NOW,
    tables: {
      bookings: { data: [{ id: "b1" }, { id: "b2" }], error: null },
      show_date_offer_tiers: { data: [{ id: "t1" }], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 2, withdraw: true } }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { closed: true, withdrawn: 2 });

  const bookingsUpdate = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertExists(bookingsUpdate);
  const payload = bookingsUpdate!.args[0] as Record<string, unknown>;
  assertEquals(payload.status, "cancelled");
  assertEquals(payload.cancellation_reason, "tier_closed");
  assertEquals(payload.cancelled_at, NOW.toISOString());

  const eqArgs = calls.filter((c) => c.table === "bookings" && c.method === "eq").map((c) => c.args);
  assertEquals(eqArgs.some((a) => a[0] === "show_date_id" && a[1] === "d1"), true);
  assertEquals(eqArgs.some((a) => a[0] === "offer_tier" && a[1] === 2), true);
  assertEquals(eqArgs.some((a) => a[0] === "status" && a[1] === "suggested"), true);
});

Deno.test("close-offer-tier: tier not open + no withdraw → benign closed:false", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: { show_date_offer_tiers: { data: [], error: null } },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, withdraw: false } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.closed, false);
  assertEquals(body.withdrawn, 0);
  assertExists(body.message);
});

Deno.test("close-offer-tier: close-tier DB error → 500", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: { show_date_offer_tiers: { data: null, error: { message: "boom" } } },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, withdraw: false } }), deps);
  assertEquals(res.status, 500);
  assertExists((await res.json()).error);
});

Deno.test("close-offer-tier: withdraw DB error → 500", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: { bookings: { data: null, error: { message: "boom" } } },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, withdraw: true } }), deps);
  assertEquals(res.status, 500);
  assertExists((await res.json()).error);
});

// Partial-failure path (safe ordering): the tier is closed FIRST, then the
// withdraw write fails. We're left with a closed tier whose suggested offers
// survive — benign, since the watchers skip closed tiers. The request still
// returns 500; the tier close was committed before the withdraw was attempted.
Deno.test("close-offer-tier: tier closed but withdraw fails → 500 (tier already closed, safe state)", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_date_offer_tiers: { data: [{ id: "t1" }], error: null }, // close succeeds
      bookings: { data: null, error: { message: "withdraw failed" } }, // withdraw fails
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, withdraw: true } }), deps);
  assertEquals(res.status, 500);
  assertExists((await res.json()).error);
  // The tier close ran (and succeeded) before the withdraw was attempted.
  const tierUpdate = calls.find((c) => c.table === "show_date_offer_tiers" && c.method === "update");
  assertExists(tierUpdate, "tier must be closed before attempting the withdraw");
});
