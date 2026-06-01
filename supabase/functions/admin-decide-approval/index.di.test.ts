/**
 * Deep DI contract tests for admin-decide-approval.
 *
 * Covers every documented contract clause:
 *  - auth: no auth → 401, non-admin → 403
 *  - approved path: correct RPC args, email sent, returns { ok: true }
 *  - rejected path: correct RPC args, rejection email sent
 *  - non-blocking email: email failure does not affect response
 *  - validation: missing/invalid fields → 400
 *  - approval not found → 404
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import type { Deps } from "../_shared/deps.ts";
import { handle } from "./index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = "admin-u1";
const APPROVAL_ID = "ap-abc123";
const APPROVAL_ROW = {
  id: APPROVAL_ID,
  user_id: "artist-u2",
  email: "artist@example.com",
  display_name: "Test Artist",
  status: "pending",
};

/** Build deps pre-seeded for an admin caller + a pending approval. */
function makeAdminDeps(overrides: Partial<Parameters<typeof makeFakeDeps>[0]> = {}) {
  return makeFakeDeps({
    authUser: { id: ADMIN_USER_ID },
    tables: {
      user_roles: { data: [{ user_id: ADMIN_USER_ID, role: "admin" }], error: null },
      user_approvals: { data: APPROVAL_ROW, error: null },
    },
    rpcs: { decide_user_approval: { data: null, error: null } },
    ...overrides,
  });
}

function adminReq(body: Record<string, unknown>) {
  return makeRequest({
    headers: { Authorization: "Bearer jwt" },
    body,
  });
}

// ---------------------------------------------------------------------------
// Auth / authorization
// ---------------------------------------------------------------------------

Deno.test("no auth header → 401", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(
    makeRequest({ headers: {}, body: { approval_id: APPROVAL_ID, decision: "approved", role: "artist" } }),
    deps,
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("malformed auth header (no Bearer prefix) → 401", async () => {
  const { deps } = makeFakeDeps({ authUser: { id: ADMIN_USER_ID } });
  const res = await handle(
    makeRequest({
      headers: { Authorization: "jwt-without-bearer" },
      body: { approval_id: APPROVAL_ID, decision: "approved", role: "artist" },
    }),
    deps,
  );
  assertEquals(res.status, 401);
});

Deno.test("valid auth but no role row → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "notrole-user" },
    tables: {
      // Empty user_roles — no row for this user
      user_roles: { data: null, error: null },
      user_approvals: { data: APPROVAL_ROW, error: null },
    },
    rpcs: { decide_user_approval: { data: null, error: null } },
  });
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer jwt" },
      body: { approval_id: APPROVAL_ID, decision: "approved", role: "artist" },
    }),
    deps,
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("producer role (not admin) → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "prod-u1" },
    tables: {
      user_roles: { data: [{ user_id: "prod-u1", role: "producer" }], error: null },
      user_approvals: { data: APPROVAL_ROW, error: null },
    },
    rpcs: { decide_user_approval: { data: null, error: null } },
  });
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer jwt" },
      body: { approval_id: APPROVAL_ID, decision: "approved", role: "artist" },
    }),
    deps,
  );
  assertEquals(res.status, 403);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

Deno.test("missing approval_id → 400", async () => {
  const { deps } = makeAdminDeps();
  const res = await handle(adminReq({ decision: "approved", role: "artist" }), deps);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("invalid decision value → 400", async () => {
  const { deps } = makeAdminDeps();
  const res = await handle(adminReq({ approval_id: APPROVAL_ID, decision: "maybe", role: "artist" }), deps);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("approved with invalid role → 400", async () => {
  const { deps } = makeAdminDeps();
  const res = await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved", role: "superuser" }),
    deps,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("empty body → 400", async () => {
  const { deps } = makeAdminDeps();
  const res = await handle(adminReq({}), deps);
  assertEquals(res.status, 400);
});

Deno.test("approval_id present but decision missing → 400", async () => {
  const { deps } = makeAdminDeps();
  const res = await handle(adminReq({ approval_id: APPROVAL_ID, role: "artist" }), deps);
  assertEquals(res.status, 400);
});

// ---------------------------------------------------------------------------
// Approval not found
// ---------------------------------------------------------------------------

Deno.test("approval not found in DB → 404", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: ADMIN_USER_ID },
    tables: {
      user_roles: { data: [{ user_id: ADMIN_USER_ID, role: "admin" }], error: null },
      user_approvals: { data: null, error: null }, // maybeSingle returns null data
    },
    rpcs: { decide_user_approval: { data: null, error: null } },
  });
  const res = await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved", role: "artist" }),
    deps,
  );
  assertEquals(res.status, 404);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("approval query returns error → 404", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: ADMIN_USER_ID },
    tables: {
      user_roles: { data: [{ user_id: ADMIN_USER_ID, role: "admin" }], error: null },
      user_approvals: { data: null, error: { message: "db error" } },
    },
    rpcs: { decide_user_approval: { data: null, error: null } },
  });
  const res = await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved", role: "artist" }),
    deps,
  );
  assertEquals(res.status, 404);
});

// ---------------------------------------------------------------------------
// Approved path — response shape
// ---------------------------------------------------------------------------

Deno.test("approved path: returns { ok: true } with status 200", async () => {
  const { deps } = makeAdminDeps();
  const res = await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved", role: "artist" }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });
});

// ---------------------------------------------------------------------------
// Approved path — RPC args
// ---------------------------------------------------------------------------

Deno.test("approved path: RPC decide_user_approval called with correct args", async () => {
  const { deps, calls } = makeAdminDeps();
  await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved", role: "artist" }),
    deps,
  );

  const rpcCall = calls.find((c) => c.table === "rpc:decide_user_approval");
  assertExists(rpcCall, "RPC call not recorded");
  const params = rpcCall!.args[0] as Record<string, unknown>;
  assertEquals(params.p_approval_id, APPROVAL_ID);
  assertEquals(params.p_decision, "approved");
  assertEquals(params.p_role, "artist");
  assertEquals(params.p_rejection_reason, null);
  assertEquals(params.p_decided_by, ADMIN_USER_ID, "p_decided_by must be the caller's user id");
});

Deno.test("approved path: RPC called exactly once", async () => {
  const { deps, calls } = makeAdminDeps();
  await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved", role: "artist" }),
    deps,
  );
  const rpcCalls = calls.filter((c) => c.table === "rpc:decide_user_approval");
  assertEquals(rpcCalls.length, 1);
});

Deno.test("approved path: role defaults to 'artist' when omitted", async () => {
  const { deps, calls } = makeAdminDeps();
  await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved" }), // no role
    deps,
  );
  const rpcCall = calls.find((c) => c.table === "rpc:decide_user_approval");
  assertExists(rpcCall);
  const params = rpcCall!.args[0] as Record<string, unknown>;
  assertEquals(params.p_role, "artist");
});

Deno.test("approved path: producer role forwarded correctly", async () => {
  const { deps, calls } = makeAdminDeps();
  await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved", role: "producer" }),
    deps,
  );
  const rpcCall = calls.find((c) => c.table === "rpc:decide_user_approval");
  assertExists(rpcCall);
  const params = rpcCall!.args[0] as Record<string, unknown>;
  assertEquals(params.p_role, "producer");
});

Deno.test("approved path: admin role forwarded correctly", async () => {
  const { deps, calls } = makeAdminDeps();
  await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved", role: "admin" }),
    deps,
  );
  const rpcCall = calls.find((c) => c.table === "rpc:decide_user_approval");
  assertExists(rpcCall);
  const params = rpcCall!.args[0] as Record<string, unknown>;
  assertEquals(params.p_role, "admin");
});

// ---------------------------------------------------------------------------
// Approved path — email
// ---------------------------------------------------------------------------

Deno.test("approved path: signup-decision email sent via sendEmail", async () => {
  const { deps, invokeCalls } = makeAdminDeps();
  await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved", role: "artist" }),
    deps,
  );

  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall, "sendEmail must invoke send-transactional-email");
  const body = emailCall!.body as Record<string, unknown>;
  assertEquals(body.template_name, "signup-decision");
  assertEquals(body.recipient_email, APPROVAL_ROW.email);
  assertExists(body.idempotency_key, "idempotency_key must be present");
  const tData = body.templateData as Record<string, unknown>;
  assertEquals(tData.decision, "approved");
  assertEquals(tData.role, "artist", "approved email must include the assigned role");
  assertEquals(tData.displayName, APPROVAL_ROW.display_name);
});

Deno.test("approved path: idempotency_key encodes approval id and decision", async () => {
  const { deps, invokeCalls } = makeAdminDeps();
  await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved", role: "artist" }),
    deps,
  );
  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const body = emailCall!.body as Record<string, unknown>;
  const key = String(body.idempotency_key);
  assertEquals(key.includes(APPROVAL_ID), true, "idempotency_key must contain approval id");
  assertEquals(key.includes("approved"), true, "idempotency_key must contain decision");
});

// ---------------------------------------------------------------------------
// Rejected path — RPC args
// ---------------------------------------------------------------------------

Deno.test("rejected path: RPC called with decision=rejected and reason", async () => {
  const { deps, calls } = makeAdminDeps();
  await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "rejected", rejection_reason: "Not a real artist" }),
    deps,
  );
  const rpcCall = calls.find((c) => c.table === "rpc:decide_user_approval");
  assertExists(rpcCall);
  const params = rpcCall!.args[0] as Record<string, unknown>;
  assertEquals(params.p_decision, "rejected");
  assertEquals(params.p_rejection_reason, "Not a real artist");
  assertEquals(params.p_decided_by, ADMIN_USER_ID);
});

Deno.test("rejected path: returns { ok: true } with status 200", async () => {
  const { deps } = makeAdminDeps();
  const res = await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "rejected", rejection_reason: "Not eligible" }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });
});

Deno.test("rejected path: rejection email sent with decision=rejected", async () => {
  const { deps, invokeCalls } = makeAdminDeps();
  await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "rejected", rejection_reason: "Spam account" }),
    deps,
  );
  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall, "rejection email must be sent");
  const body = emailCall!.body as Record<string, unknown>;
  assertEquals(body.template_name, "signup-decision");
  const tData = body.templateData as Record<string, unknown>;
  assertEquals(tData.decision, "rejected");
  assertEquals(tData.reason, "Spam account", "rejection reason must be forwarded in templateData");
});

Deno.test("rejected path: role is undefined in email templateData", async () => {
  const { deps, invokeCalls } = makeAdminDeps();
  await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "rejected" }),
    deps,
  );
  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const tData = (emailCall!.body as Record<string, unknown>).templateData as Record<string, unknown>;
  // characterization: role is undefined (not null) in rejected email templateData
  assertEquals(tData.role, undefined, "rejected email must not include a role");
});

Deno.test("rejected path: rejection_reason null when not provided", async () => {
  const { deps, calls } = makeAdminDeps();
  await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "rejected" }),
    deps,
  );
  const rpcCall = calls.find((c) => c.table === "rpc:decide_user_approval");
  assertExists(rpcCall);
  const params = rpcCall!.args[0] as Record<string, unknown>;
  assertEquals(params.p_rejection_reason, null);
});

// ---------------------------------------------------------------------------
// Non-blocking email failure
// ---------------------------------------------------------------------------

Deno.test("email failure is non-blocking: still returns 200 { ok: true }", async () => {
  const { deps: baseDeps } = makeAdminDeps();

  // Override sendEmail to throw
  const deps: Deps = {
    ...baseDeps,
    sendEmail: (_msg) => Promise.reject(new Error("SMTP connection refused")),
  };

  const res = await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved", role: "artist" }),
    deps,
  );
  assertEquals(res.status, 200, "email failure must not affect the response status");
  const body = await res.json();
  assertEquals(body, { ok: true }, "email failure must not affect the response body");
});

Deno.test("email failure is non-blocking: RPC was still called before email threw", async () => {
  const { deps: baseDeps, calls } = makeAdminDeps();

  const deps: Deps = {
    ...baseDeps,
    sendEmail: (_msg) => Promise.reject(new Error("SMTP down")),
  };

  await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved", role: "artist" }),
    deps,
  );

  const rpcCall = calls.find((c) => c.table === "rpc:decide_user_approval");
  assertExists(rpcCall, "RPC must still have been called even when email throws");
});

// ---------------------------------------------------------------------------
// RPC error propagates as 500
// ---------------------------------------------------------------------------

Deno.test("RPC error → 500 (not silently swallowed)", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: ADMIN_USER_ID },
    tables: {
      user_roles: { data: [{ user_id: ADMIN_USER_ID, role: "admin" }], error: null },
      user_approvals: { data: APPROVAL_ROW, error: null },
    },
    rpcs: {
      decide_user_approval: { data: null, error: { message: "constraint violation" } },
    },
  });
  const res = await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved", role: "artist" }),
    deps,
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertExists(body.error, "error field must be present on 500");
});

// ---------------------------------------------------------------------------
// OPTIONS preflight
// ---------------------------------------------------------------------------

Deno.test("OPTIONS → 200 or 204 (CORS preflight)", async () => {
  const { deps } = makeAdminDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

// ---------------------------------------------------------------------------
// display_name fallback
// ---------------------------------------------------------------------------

Deno.test("email uses email as displayName when display_name is null", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: ADMIN_USER_ID },
    tables: {
      user_roles: { data: [{ user_id: ADMIN_USER_ID, role: "admin" }], error: null },
      user_approvals: {
        data: { ...APPROVAL_ROW, display_name: null },
        error: null,
      },
    },
    rpcs: { decide_user_approval: { data: null, error: null } },
  });
  await handle(
    adminReq({ approval_id: APPROVAL_ID, decision: "approved", role: "artist" }),
    deps,
  );
  const emailCall = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(emailCall);
  const tData = (emailCall!.body as Record<string, unknown>).templateData as Record<string, unknown>;
  assertEquals(
    tData.displayName,
    APPROVAL_ROW.email,
    "when display_name is null, email address must be used as displayName",
  );
});
