/**
 * Deep DI tests for handle-email-unsubscribe.
 *
 * Contract under test:
 *   - Token sources: GET ?token=<t>, POST form-encoded token=<t>, POST JSON { token }
 *   - Missing token → 400
 *   - Unknown token → 404
 *   - GET valid token → { valid: true }, NO update to email_unsubscribe_tokens
 *   - POST valid unused token → { success: true }, atomic update (.is('used_at', null)),
 *     used_at set to deps.now().toISOString(), artist email added to suppressed_emails
 *   - POST already-used token → { success: false, reason: 'already_unsubscribed' },
 *     NO update to suppressed_emails (no double-unsubscribe)
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps } from "../_shared/testing.ts";
import { handle } from "./index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
};

const FIXED_NOW = new Date("2026-06-01T12:00:00.000Z");
const FIXED_NOW_ISO = FIXED_NOW.toISOString();

/** A valid, unused token row (as stored in email_unsubscribe_tokens). */
const VALID_TOKEN_ROW = {
  id: "tok-1",
  token: "abc123",
  email: "artist@example.com",
  artist_id: "artist-1",
  used_at: null,
  created_at: "2026-05-30T10:00:00.000Z",
};

/** An already-used token row. */
const USED_TOKEN_ROW = { ...VALID_TOKEN_ROW, used_at: "2026-05-31T09:00:00.000Z" };

// Build deps for the "happy path" – valid unused token, atomic update succeeds.
function makeHappyDeps() {
  return makeFakeDeps({
    envVars: BASE_ENV,
    now: FIXED_NOW,
    tables: {
      // First query (maybeSingle lookup) returns the valid row.
      // Second call (update → maybeSingle) returns the row to signal success.
      // Because the fake client shares a single seed per table name, we need a
      // seed that works for both the SELECT and the UPDATE.  The real handler
      // does: select → maybeSingle (returns row), then update → maybeSingle
      // (returns updated row to confirm success).  We use the same data object
      // for both — sufficient to test the control-flow assertions.
      email_unsubscribe_tokens: { data: VALID_TOKEN_ROW, error: null },
      suppressed_emails: { data: { email: "artist@example.com", reason: "unsubscribe" }, error: null },
    },
  });
}

// ---------------------------------------------------------------------------
// 1. Token sources — all three resolve and reach the DB lookup phase
// ---------------------------------------------------------------------------

Deno.test("token source: GET ?token=<t> is parsed correctly", async () => {
  const { deps, calls } = makeHappyDeps();
  const res = await handle(
    new Request("http://localhost/fn?token=abc123", { method: "GET" }),
    deps,
  );
  // Should reach the DB and return 200 valid
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { valid: true });
  // DB lookup must have been called with the token value
  const eqCall = calls.find(
    (c) => c.table === "email_unsubscribe_tokens" && c.method === "eq",
  );
  assertExists(eqCall, "Expected an eq() call on email_unsubscribe_tokens");
  assertEquals(eqCall.args[0], "token");
  assertEquals(eqCall.args[1], "abc123");
});

Deno.test("token source: POST form-encoded token=<t> is parsed correctly", async () => {
  const { deps, calls } = makeHappyDeps();
  const body = new URLSearchParams({ token: "abc123" }).toString();
  const res = await handle(
    new Request("http://localhost/fn", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.success, true);
  const eqCall = calls.find(
    (c) => c.table === "email_unsubscribe_tokens" && c.method === "eq",
  );
  assertExists(eqCall);
  assertEquals(eqCall.args[1], "abc123");
});

Deno.test("token source: POST JSON { token } is parsed correctly", async () => {
  const { deps, calls } = makeHappyDeps();
  const res = await handle(
    new Request("http://localhost/fn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "abc123" }),
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.success, true);
  const eqCall = calls.find(
    (c) => c.table === "email_unsubscribe_tokens" && c.method === "eq",
  );
  assertExists(eqCall);
  assertEquals(eqCall.args[1], "abc123");
});

// ---------------------------------------------------------------------------
// 2. Missing token → 400
// ---------------------------------------------------------------------------

Deno.test("missing token: GET without ?token → 400", async () => {
  const { deps } = makeFakeDeps({ envVars: BASE_ENV });
  const res = await handle(
    new Request("http://localhost/fn", { method: "GET" }),
    deps,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("missing token: POST JSON body without token field → 400", async () => {
  const { deps } = makeFakeDeps({ envVars: BASE_ENV });
  const res = await handle(
    new Request("http://localhost/fn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ other: "value" }),
    }),
    deps,
  );
  assertEquals(res.status, 400);
});

Deno.test("missing token: POST form-encoded body without token field → 400", async () => {
  const { deps } = makeFakeDeps({ envVars: BASE_ENV });
  const res = await handle(
    new Request("http://localhost/fn", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "other=value",
    }),
    deps,
  );
  assertEquals(res.status, 400);
});

// ---------------------------------------------------------------------------
// 3. Unknown / expired token → 404
// ---------------------------------------------------------------------------

Deno.test("unknown token: token not in DB → 404", async () => {
  const { deps } = makeFakeDeps({
    envVars: BASE_ENV,
    tables: {
      email_unsubscribe_tokens: { data: null, error: null },
    },
  });
  const res = await handle(
    new Request("http://localhost/fn?token=nonexistent", { method: "GET" }),
    deps,
  );
  assertEquals(res.status, 404);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("unknown token: DB returns lookup error → 404", async () => {
  const { deps } = makeFakeDeps({
    envVars: BASE_ENV,
    tables: {
      email_unsubscribe_tokens: { data: null, error: { message: "db error" } },
    },
  });
  const res = await handle(
    new Request("http://localhost/fn?token=badtoken", { method: "GET" }),
    deps,
  );
  assertEquals(res.status, 404);
});

// ---------------------------------------------------------------------------
// 4. GET with valid token → { valid: true }, does NOT consume the token
// ---------------------------------------------------------------------------

Deno.test("GET valid token → { valid: true } (validation-only response)", async () => {
  const { deps } = makeFakeDeps({
    envVars: BASE_ENV,
    now: FIXED_NOW,
    tables: {
      email_unsubscribe_tokens: { data: VALID_TOKEN_ROW, error: null },
    },
  });
  const res = await handle(
    new Request("http://localhost/fn?token=abc123", { method: "GET" }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { valid: true });
});

Deno.test("GET valid token → NO update issued (token not consumed)", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: BASE_ENV,
    now: FIXED_NOW,
    tables: {
      email_unsubscribe_tokens: { data: VALID_TOKEN_ROW, error: null },
    },
  });
  await handle(
    new Request("http://localhost/fn?token=abc123", { method: "GET" }),
    deps,
  );
  // There must be NO update() call on email_unsubscribe_tokens
  const updateCall = calls.find(
    (c) => c.table === "email_unsubscribe_tokens" && c.method === "update",
  );
  assertEquals(
    updateCall,
    undefined,
    "GET must not issue an update() on email_unsubscribe_tokens",
  );
});

Deno.test("GET valid token → suppressed_emails table NOT touched", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: BASE_ENV,
    now: FIXED_NOW,
    tables: {
      email_unsubscribe_tokens: { data: VALID_TOKEN_ROW, error: null },
    },
  });
  await handle(
    new Request("http://localhost/fn?token=abc123", { method: "GET" }),
    deps,
  );
  const suppressCall = calls.find((c) => c.table === "suppressed_emails");
  assertEquals(suppressCall, undefined, "GET must not touch suppressed_emails");
});

// ---------------------------------------------------------------------------
// 5. POST valid unused token — happy path
// ---------------------------------------------------------------------------

Deno.test("POST valid token → { success: true }", async () => {
  const { deps } = makeHappyDeps();
  const res = await handle(
    new Request("http://localhost/fn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "abc123" }),
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { success: true });
});

Deno.test("POST valid token → update sets used_at to deps.now().toISOString()", async () => {
  const { deps, calls } = makeHappyDeps();
  await handle(
    new Request("http://localhost/fn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "abc123" }),
    }),
    deps,
  );
  const updateCall = calls.find(
    (c) => c.table === "email_unsubscribe_tokens" && c.method === "update",
  );
  assertExists(updateCall, "Expected update() call on email_unsubscribe_tokens");
  // args[0] is the payload object
  const payload = updateCall.args[0] as Record<string, unknown>;
  assertEquals(
    payload.used_at,
    FIXED_NOW_ISO,
    "used_at must equal deps.now().toISOString()",
  );
});

Deno.test("POST valid token → update is atomic: .is('used_at', null) filter present", async () => {
  const { deps, calls } = makeHappyDeps();
  await handle(
    new Request("http://localhost/fn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "abc123" }),
    }),
    deps,
  );
  // After the update() call there must be a .is('used_at', null) guard
  const isCall = calls.find(
    (c) => c.table === "email_unsubscribe_tokens" && c.method === "is",
  );
  assertExists(isCall, "Expected .is() call on email_unsubscribe_tokens for atomicity");
  assertEquals(isCall.args[0], "used_at");
  assertEquals(isCall.args[1], null);
});

Deno.test("POST valid token → suppressed_emails upserted with email + reason='unsubscribe'", async () => {
  const { deps, calls } = makeHappyDeps();
  await handle(
    new Request("http://localhost/fn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "abc123" }),
    }),
    deps,
  );
  const upsertCall = calls.find(
    (c) => c.table === "suppressed_emails" && c.method === "upsert",
  );
  assertExists(upsertCall, "Expected upsert() call on suppressed_emails");
  const upsertPayload = upsertCall.args[0] as Record<string, unknown>;
  assertEquals(upsertPayload.email, VALID_TOKEN_ROW.email.toLowerCase());
  assertEquals(upsertPayload.reason, "unsubscribe");
});

// ---------------------------------------------------------------------------
// 6. POST already-used token
// ---------------------------------------------------------------------------

Deno.test("POST already-used token → { success: false, reason: 'already_unsubscribed' }", async () => {
  // Seed: lookup returns a token with used_at set (pre-check in handler)
  const { deps } = makeFakeDeps({
    envVars: BASE_ENV,
    now: FIXED_NOW,
    tables: {
      email_unsubscribe_tokens: { data: USED_TOKEN_ROW, error: null },
    },
  });
  const res = await handle(
    new Request("http://localhost/fn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "abc123" }),
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { success: false, reason: "already_unsubscribed" });
});

Deno.test("POST already-used token → NO update issued (short-circuits before atomic update)", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: BASE_ENV,
    now: FIXED_NOW,
    tables: {
      email_unsubscribe_tokens: { data: USED_TOKEN_ROW, error: null },
    },
  });
  await handle(
    new Request("http://localhost/fn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "abc123" }),
    }),
    deps,
  );
  const updateCall = calls.find(
    (c) => c.table === "email_unsubscribe_tokens" && c.method === "update",
  );
  assertEquals(
    updateCall,
    undefined,
    "Already-used token must NOT trigger an update() — handler short-circuits",
  );
});

Deno.test("POST already-used token → suppressed_emails NOT touched (no double-unsubscribe)", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: BASE_ENV,
    now: FIXED_NOW,
    tables: {
      email_unsubscribe_tokens: { data: USED_TOKEN_ROW, error: null },
    },
  });
  await handle(
    new Request("http://localhost/fn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "abc123" }),
    }),
    deps,
  );
  const suppressCall = calls.find((c) => c.table === "suppressed_emails");
  assertEquals(
    suppressCall,
    undefined,
    "Already-used token must NOT upsert into suppressed_emails",
  );
});

// ---------------------------------------------------------------------------
// 7. RFC 8058 one-click: POST form-encoded with List-Unsubscribe=One-Click
//    uses token from the query param, NOT from the form body
// ---------------------------------------------------------------------------

Deno.test("RFC 8058 one-click POST: token from query param, List-Unsubscribe in body → { success: true }", async () => {
  const { deps } = makeHappyDeps();
  const formBody = new URLSearchParams({
    "List-Unsubscribe": "One-Click",
  }).toString();
  const res = await handle(
    new Request("http://localhost/fn?token=abc123", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody,
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { success: true });
});

Deno.test("RFC 8058 one-click POST: List-Unsubscribe in body but NO query token → 400", async () => {
  const { deps } = makeFakeDeps({ envVars: BASE_ENV });
  const formBody = new URLSearchParams({
    "List-Unsubscribe": "One-Click",
  }).toString();
  const res = await handle(
    new Request("http://localhost/fn", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody,
    }),
    deps,
  );
  assertEquals(res.status, 400);
});

// ---------------------------------------------------------------------------
// 8. Edge cases
// ---------------------------------------------------------------------------

Deno.test("unsupported method (PUT) → 405", async () => {
  const { deps } = makeFakeDeps({ envVars: BASE_ENV });
  const res = await handle(
    new Request("http://localhost/fn?token=abc123", { method: "PUT" }),
    deps,
  );
  assertEquals(res.status, 405);
});

Deno.test("missing env vars → 500", async () => {
  const { deps } = makeFakeDeps({ envVars: {} });
  const res = await handle(
    new Request("http://localhost/fn?token=abc123", { method: "GET" }),
    deps,
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertExists(body.error);
});
