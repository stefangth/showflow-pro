/**
 * Tests for demo-ops — the callable surface for demo-org operations.
 *
 * Contract:
 *  - OPTIONS → preflight
 *  - `reset` / `wipe`: org-admin (or super-admin) via requireOrgRole; re-asserts
 *    `is_demo` at the edge on top of the RPC's own guard. `reset` = wipe then seed,
 *    `wipe` = wipe only. There is no bare seed-only action (non-idempotent seed).
 *  - `flag_and_seed`: super-admin only. Stamps `is_demo`, upserts the `hire_orders`
 *    entitlement on, then seeds.
 *  - missing action/org_id → 400 bad_request.
 */

import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

function authedReq(body: Record<string, unknown>) {
  return makeRequest({ headers: { Authorization: "Bearer jwt" }, body });
}

function adminDeps(opts: { isDemo: boolean; rpcs?: Record<string, { data?: unknown; error?: unknown }> }) {
  return makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      organizations: { data: { is_demo: opts.isDemo }, error: null },
      org_memberships: { data: { role: "admin" }, error: null },
    },
    rpcs: opts.rpcs,
  });
}

Deno.test("demo-ops: OPTIONS → preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("demo-ops: missing action or org_id → 400 bad_request", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(authedReq({ org_id: "o1" }), deps);
  assertEquals(res.status, 400);
  const body = await res.json() as { error: string };
  assertEquals(body.error, "bad_request");
});

Deno.test("demo-ops: unknown action → 400 bad_request", async () => {
  const { deps } = adminDeps({ isDemo: true });
  const res = await handle(authedReq({ action: "not_a_real_action", org_id: "o1" }), deps);
  assertEquals(res.status, 400);
  const body = await res.json() as { error: string };
  assertEquals(body.error, "bad_request");
});

Deno.test("demo-ops: no Bearer → 401", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ body: { action: "reset", org_id: "o1" } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("demo-ops: artist-role caller on reset → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u2" },
    tables: {
      organizations: { data: { is_demo: true }, error: null },
      org_memberships: { data: { role: "artist" }, error: null },
    },
  });
  const res = await handle(authedReq({ action: "reset", org_id: "o1" }), deps);
  assertEquals(res.status, 403);
});

Deno.test("demo-ops: reset refuses a non-demo org", async () => {
  const { deps } = adminDeps({ isDemo: false });
  const res = await handle(authedReq({ action: "reset", org_id: "o1" }), deps);
  assertEquals(res.status, 400);
  const body = await res.json() as { error: string };
  assertEquals(body.error, "not_a_demo_org");
});

Deno.test("demo-ops: reset on a demo org calls wipe then seed", async () => {
  const { deps, calls } = adminDeps({
    isDemo: true,
    rpcs: { wipe_demo_org: { data: null, error: null }, seed_demo_org: { data: null, error: null } },
  });
  const res = await handle(authedReq({ action: "reset", org_id: "o1", volume: "full" }), deps);
  assertEquals(res.status, 200);
  const rpcNames = calls.filter((c) => c.method === "rpc").map((c) => c.table);
  assertEquals(rpcNames.includes("rpc:wipe_demo_org"), true);
  assertEquals(rpcNames.includes("rpc:seed_demo_org"), true);
});

Deno.test("demo-ops: reset passes the caller as p_actor to seed_demo_org", async () => {
  const { deps, calls } = adminDeps({
    isDemo: true,
    rpcs: { wipe_demo_org: { data: null, error: null }, seed_demo_org: { data: null, error: null } },
  });
  await handle(authedReq({ action: "reset", org_id: "o1" }), deps);
  const seedCall = calls.find((c) => c.table === "rpc:seed_demo_org");
  assertEquals((seedCall?.args[0] as { p_actor?: string } | undefined)?.p_actor, "u1");
});

Deno.test("demo-ops: wipe on a demo org calls wipe only, not seed", async () => {
  const { deps, calls } = adminDeps({
    isDemo: true,
    rpcs: { wipe_demo_org: { data: null, error: null }, seed_demo_org: { data: null, error: null } },
  });
  const res = await handle(authedReq({ action: "wipe", org_id: "o1" }), deps);
  assertEquals(res.status, 200);
  const rpcNames = calls.filter((c) => c.method === "rpc").map((c) => c.table);
  assertEquals(rpcNames.includes("rpc:wipe_demo_org"), true);
  assertEquals(rpcNames.includes("rpc:seed_demo_org"), false);
});

Deno.test("demo-ops: reseed is not a valid action (seed-only would duplicate non-idempotent seed)", async () => {
  const { deps } = adminDeps({ isDemo: true });
  const res = await handle(authedReq({ action: "reseed", org_id: "o1" }), deps);
  assertEquals(res.status, 400);
  const body = await res.json() as { error: string };
  assertEquals(body.error, "bad_request");
});

Deno.test("demo-ops: wipe_demo_org RPC error → 500", async () => {
  const { deps } = adminDeps({
    isDemo: true,
    rpcs: { wipe_demo_org: { data: null, error: { message: "boom" } } },
  });
  const res = await handle(authedReq({ action: "wipe", org_id: "o1" }), deps);
  assertEquals(res.status, 500);
});

Deno.test("demo-ops: flag_and_seed by a non-super-admin → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { platform_admins: { data: null, error: null } },
  });
  const res = await handle(authedReq({ action: "flag_and_seed", org_id: "o1" }), deps);
  assertEquals(res.status, 403);
});

Deno.test("demo-ops: flag_and_seed happy path — flags, enables hire_orders, wipes starter catalog, seeds", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "super1" },
    tables: { platform_admins: { data: { user_id: "super1" }, error: null } },
    rpcs: { wipe_demo_org: { data: null, error: null }, seed_demo_org: { data: null, error: null } },
  });
  const res = await handle(authedReq({ action: "flag_and_seed", org_id: "o1", volume: "small" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean };
  assertEquals(body.ok, true);

  const orgUpdate = calls.find((c) => c.table === "organizations" && c.method === "update");
  assertEquals(orgUpdate?.args[0], { is_demo: true });

  const entitlementUpsert = calls.find((c) => c.table === "org_entitlements" && c.method === "upsert");
  assertEquals(entitlementUpsert !== undefined, true);
  assertEquals(entitlementUpsert?.args[0], [{ org_id: "o1", feature: "hire_orders", enabled: true }]);

  // provision-org's starter catalog is cleared BEFORE seeding the curated dataset.
  const rpcOrder = calls.filter((c) => c.method === "rpc").map((c) => c.table);
  assertEquals(rpcOrder.indexOf("rpc:wipe_demo_org") < rpcOrder.indexOf("rpc:seed_demo_org"), true);

  const seedCall = calls.find((c) => c.table === "rpc:seed_demo_org");
  assertEquals(seedCall?.args[0], { p_org: "o1", p_volume: "small", p_actor: "super1" });
});

Deno.test("demo-ops: flag_and_seed refuses an org that already has bookings → 409", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "super1" },
    tables: {
      platform_admins: { data: { user_id: "super1" }, error: null },
      // A non-empty org (real or already-seeded): flag_and_seed must not layer demo data on it.
      bookings: { data: [{ id: "b1" }], error: null },
    },
    rpcs: { seed_demo_org: { data: null, error: null } },
  });
  const res = await handle(authedReq({ action: "flag_and_seed", org_id: "o1" }), deps);
  assertEquals(res.status, 409);
  const body = await res.json() as { error: string };
  assertEquals(body.error, "org_not_empty");
  // Must not have flagged, entitled, or seeded the org.
  assertEquals(calls.find((c) => c.table === "rpc:seed_demo_org"), undefined);
  assertEquals(calls.find((c) => c.table === "organizations" && c.method === "update"), undefined);
});

Deno.test("demo-ops: flag_and_seed surfaces a seed_demo_org RPC error → 500", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "super1" },
    tables: { platform_admins: { data: { user_id: "super1" }, error: null } },
    rpcs: { seed_demo_org: { data: null, error: { message: "seed failed" } } },
  });
  const res = await handle(authedReq({ action: "flag_and_seed", org_id: "o1" }), deps);
  assertEquals(res.status, 500);
});
