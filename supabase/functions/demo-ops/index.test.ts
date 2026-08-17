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
 *  - `link_create` / `link_revoke`: org-admin (or super-admin); re-asserts `is_demo`.
 *    `link_create` inserts a `demo_sandbox_links` row and returns its token +
 *    expires_at; `link_revoke` stamps `revoked_at` scoped to org+token (idempotent).
 *  - missing action/org_id → 400 bad_request.
 */

import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest, type TableSeed } from "../_shared/testing.ts";
import type { InvokeResult } from "../_shared/deps.ts";
import { handle } from "./index.ts";

function authedReq(body: Record<string, unknown>) {
  return makeRequest({ headers: { Authorization: "Bearer jwt" }, body });
}

function adminDeps(opts: {
  isDemo: boolean;
  rpcs?: Record<string, { data?: unknown; error?: unknown }>;
  tables?: Record<string, TableSeed>;
  emailResult?: InvokeResult;
}) {
  return makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      organizations: { data: { is_demo: opts.isDemo }, error: null },
      org_memberships: { data: { role: "admin" }, error: null },
      ...opts.tables,
    },
    rpcs: opts.rpcs,
    emailResult: opts.emailResult,
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

Deno.test("demo-ops: reset with reset_state clears scene/clock/label on demo_state", async () => {
  const { deps, calls } = adminDeps({
    isDemo: true,
    rpcs: { wipe_demo_org: { data: null, error: null }, seed_demo_org: { data: null, error: null } },
  });
  const res = await handle(authedReq({ action: "reset", org_id: "o1", reset_state: true }), deps);
  assertEquals(res.status, 200);
  const stateUpdate = calls.find((c) => c.table === "demo_state" && c.method === "update");
  assertEquals(stateUpdate?.args[0], { current_scene_id: null, sim_now: null, prospect_label: null });
});

Deno.test("demo-ops: reset without reset_state leaves demo_state untouched", async () => {
  const { deps, calls } = adminDeps({
    isDemo: true,
    rpcs: { wipe_demo_org: { data: null, error: null }, seed_demo_org: { data: null, error: null } },
  });
  const res = await handle(authedReq({ action: "reset", org_id: "o1" }), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.some((c) => c.table === "demo_state" && c.method === "update"), false);
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

Deno.test("demo-ops: cue drop_notifications on a demo org calls run_demo_cue with p_actor = caller", async () => {
  const { deps, calls } = adminDeps({
    isDemo: true,
    rpcs: { run_demo_cue: { data: null, error: null } },
  });
  const res = await handle(authedReq({ action: "cue", org_id: "o1", cue_id: "drop_notifications" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean };
  assertEquals(body.ok, true);

  const cueCall = calls.find((c) => c.table === "rpc:run_demo_cue");
  assertEquals(cueCall !== undefined, true);
  assertEquals(cueCall?.args[0], { p_org: "o1", p_cue: "drop_notifications", p_actor: "u1" });
});

Deno.test("demo-ops: cue refuses a non-demo org", async () => {
  const { deps } = adminDeps({ isDemo: false });
  const res = await handle(authedReq({ action: "cue", org_id: "o1", cue_id: "drop_notifications" }), deps);
  assertEquals(res.status, 400);
  const body = await res.json() as { error: string };
  assertEquals(body.error, "not_a_demo_org");
});

Deno.test("demo-ops: cue with an unknown cue_id → 400 unknown_cue", async () => {
  const { deps } = adminDeps({ isDemo: true });
  const res = await handle(authedReq({ action: "cue", org_id: "o1", cue_id: "not_a_real_cue" }), deps);
  assertEquals(res.status, 400);
  const body = await res.json() as { error: string };
  assertEquals(body.error, "unknown_cue");
});

Deno.test("demo-ops: cue issue_hire_order issues an existing linked draft with a non-empty order_ids", async () => {
  const { deps, invokeCalls } = adminDeps({
    isDemo: true,
    tables: {
      // A linked (artist_id set) draft — the seed's HO-DEMO-0001 is unlinked and
      // would never be picked; this models a real fill_date-drafted order.
      hire_orders: { data: [{ id: "ho1", artist_id: "artist-1" }], error: null },
    },
    // generate-hire-orders' issue action responds {issued:[...], failed:[...]}.
    emailResult: { data: { issued: ["ho1"], failed: [] }, error: null },
  });
  const res = await handle(authedReq({ action: "cue", org_id: "o1", cue_id: "issue_hire_order" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean; issued: boolean; order_id: string };
  assertEquals(body.ok, true);
  assertEquals(body.issued, true);
  assertEquals(body.order_id, "ho1");

  // No draft call needed — a linked draft already existed.
  assertEquals(invokeCalls.some((c) => c.name === "generate-hire-orders" && (c.body as { action?: string }).action === "draft"), false);

  const issueCall = invokeCalls.find((c) => c.name === "generate-hire-orders" && (c.body as { action?: string }).action === "issue");
  assertEquals(issueCall !== undefined, true);
  assertEquals(issueCall?.body, { action: "issue", org_id: "o1", order_ids: ["ho1"] });
  // The caller's OWN Bearer JWT is forwarded (generate-hire-orders has no
  // service-role bypass on draft/issue — a bare service-role bearer 401s).
  assertEquals(issueCall?.headers, { Authorization: "Bearer jwt" });
});

Deno.test("demo-ops: cue issue_hire_order drafts synchronously when no linked draft exists yet", async () => {
  const { deps, invokeCalls } = adminDeps({
    isDemo: true,
    tables: {
      // No linked draft (only the unlinked seed row, or none at all).
      hire_orders: { data: [], error: null },
      show_dates: { data: { id: "sd1" }, error: null },
    },
  });
  const res = await handle(authedReq({ action: "cue", org_id: "o1", cue_id: "issue_hire_order" }), deps);
  assertEquals(res.status, 200);

  const draftCall = invokeCalls.find((c) => c.name === "generate-hire-orders" && (c.body as { action?: string }).action === "draft");
  assertEquals(draftCall !== undefined, true);
  assertEquals(draftCall?.body, { action: "draft", org_id: "o1", show_date_id: "sd1", notify: true });
  assertEquals(draftCall?.headers, { Authorization: "Bearer jwt" });

  // The fake client's read of hire_orders never changes after the (faked) draft
  // invoke, so the re-query still finds nothing — a correct, honest reflection of
  // "drafted, but nothing came back yet" rather than a fabricated success.
  const body = await res.json() as { ok: boolean; issued: boolean };
  assertEquals(body.ok, true);
  assertEquals(body.issued, false);
  assertEquals(invokeCalls.some((c) => c.name === "generate-hire-orders" && (c.body as { action?: string }).action === "issue"), false);
});

Deno.test("demo-ops: cue issue_hire_order is a no-op when nothing is fully_filled yet", async () => {
  const { deps, invokeCalls } = adminDeps({
    isDemo: true,
    tables: {
      hire_orders: { data: [], error: null },
      show_dates: { data: null, error: null },
    },
  });
  const res = await handle(authedReq({ action: "cue", org_id: "o1", cue_id: "issue_hire_order" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean; issued: boolean; reason: string };
  assertEquals(body.ok, true);
  assertEquals(body.issued, false);
  assertEquals(body.reason, "no_issuable_draft");
  assertEquals(invokeCalls.some((c) => c.name === "generate-hire-orders"), false);
});

Deno.test("demo-ops: link_create rejects a non-admin", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u2" },
    tables: {
      organizations: { data: { is_demo: true }, error: null },
      org_memberships: { data: { role: "artist" }, error: null },
    },
  });
  const res = await handle(authedReq({ action: "link_create", org_id: "o1" }), deps);
  assertEquals(res.status, 403);
});

Deno.test("demo-ops: link_create rejects a non-demo org", async () => {
  const { deps } = adminDeps({ isDemo: false });
  const res = await handle(authedReq({ action: "link_create", org_id: "o1" }), deps);
  assertEquals(res.status, 400);
  const body = await res.json() as { error: string };
  assertEquals(body.error, "not_a_demo_org");
});

Deno.test("demo-ops: link_create inserts a link and returns token + expires_at", async () => {
  const { deps, calls } = adminDeps({
    isDemo: true,
    tables: {
      demo_sandbox_links: {
        data: { token: "a".repeat(64), expires_at: "2026-08-31T00:00:00.000Z" },
        error: null,
      },
    },
  });
  const res = await handle(authedReq({ action: "link_create", org_id: "o1" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean; token: string; expires_at: string };
  assertEquals(body.ok, true);
  assertEquals(body.token, "a".repeat(64));
  assertEquals(body.expires_at, "2026-08-31T00:00:00.000Z");

  const insertCall = calls.find((c) => c.table === "demo_sandbox_links" && c.method === "insert");
  assertEquals(insertCall?.args[0], { org_id: "o1", created_by: "u1" });
});

Deno.test("demo-ops: link_revoke stamps revoked_at scoped to org+token and returns ok", async () => {
  const { deps, calls } = adminDeps({
    isDemo: true,
    tables: {
      demo_sandbox_links: { data: null, error: null },
    },
  });
  const res = await handle(authedReq({ action: "link_revoke", org_id: "o1", token: "tok123" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean };
  assertEquals(body.ok, true);

  const updateCall = calls.find((c) => c.table === "demo_sandbox_links" && c.method === "update");
  assertEquals(updateCall !== undefined, true);
  const eqCalls = calls.filter((c) => c.table === "demo_sandbox_links" && c.method === "eq");
  assertEquals(eqCalls.some((c) => c.args[0] === "org_id" && c.args[1] === "o1"), true);
  assertEquals(eqCalls.some((c) => c.args[0] === "token" && c.args[1] === "tok123"), true);
});

Deno.test("demo-ops: link_revoke is idempotent for an already-revoked/unknown token", async () => {
  const { deps } = adminDeps({
    isDemo: true,
    tables: {
      demo_sandbox_links: { data: null, error: null },
    },
  });
  const res = await handle(authedReq({ action: "link_revoke", org_id: "o1", token: "unknown-tok" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { ok: boolean };
  assertEquals(body.ok, true);
});

Deno.test("demo-ops: cue issue_hire_order surfaces a readiness failure as an error", async () => {
  const { deps } = adminDeps({
    isDemo: true,
    tables: {
      hire_orders: { data: [{ id: "ho1", artist_id: "artist-1" }], error: null },
    },
    emailResult: { data: { issued: [], failed: [{ order_id: "ho1", issues: ["missing_letterhead"] }] }, error: null },
  });
  const res = await handle(authedReq({ action: "cue", org_id: "o1", cue_id: "issue_hire_order" }), deps);
  assertEquals(res.status, 500);
  const body = await res.json() as { error: string };
  assertEquals(body.error, "missing_letterhead");
});
