/**
 * Deep DI tests for send-transactional-email/index.ts
 *
 * Encodes every documented contract clause:
 *  1. Env guard — missing env vars → 500
 *  2. camelCase vs snake_case body keys (booking engine sends snake_case)
 *  3. Unknown template → 404
 *  4. FAIL-CLOSED SUPPRESSION — suppressed recipient: no fetch call, correct response shape
 *  5. Suppression DB error → FAIL CLOSED (no send)
 *  6. Happy path: correct Resend fetch call (URL, method, auth header), response shape
 *  7. Resend non-2xx → 500 error response
 *  8. email_send_log is written; a pending-insert error FAILS CLOSED (no unlogged send)
 *  9. email_unsubscribe_tokens interaction exists (upsert/read-back)
 * 10. OPTIONS → CORS preflight
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { bindFakeFrom, makeFakeDeps, makeRequest, setFakeFrom } from "../_shared/testing.ts";
import { handle } from "./index.ts";

// send-transactional-email now requires the service-role bearer (isServiceRole gate).
const authedReq = (o: Parameters<typeof makeRequest>[0] = {}) =>
  makeRequest({ ...o, headers: { Authorization: "Bearer service_role_svc", ...(o.headers ?? {}) } });

// ---------------------------------------------------------------------------
// Shared env — every real test seeds all three required vars.
// ---------------------------------------------------------------------------
const ENV = {
  RESEND_API_KEY: "re_test_key",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_role_svc",
};

// A real registered template name (from registry.ts) used for happy-path tests.
const KNOWN_TEMPLATE = "artist-offer-digest";

// ---------------------------------------------------------------------------
// Helper: a fetchImpl that records calls and returns a canned success response.
// ---------------------------------------------------------------------------
function recordingFetch(
  overrideStatus = 200,
  overrideBody: unknown = { id: "re_123" },
): { fetchImpl: typeof fetch; fetchCalls: Array<{ url: string; init: RequestInit }> } {
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = ((...args: Parameters<typeof fetch>) => {
    const [url, init] = args;
    fetchCalls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(
      new Response(JSON.stringify(overrideBody), { status: overrideStatus }),
    );
  }) as typeof fetch;
  return { fetchImpl, fetchCalls };
}

// ---------------------------------------------------------------------------
// Helper: minimal table seed for a non-suppressed recipient.
// Uses the "existing non-used token" path so only ONE query to
// email_unsubscribe_tokens is needed (no upsert/read-back cycle).
// The fake client resolves each from() call with the same seed, so we avoid
// the two-result problem by picking the simpler single-query code path.
// ---------------------------------------------------------------------------
function happyPathTables(_email = "artist@example.com") {
  return {
    suppressed_emails: { data: null, error: null },
    email_unsubscribe_tokens: { data: { token: "existing_token_abc123", used_at: null }, error: null },
    app_settings: { data: null, error: null },
    email_send_log: { data: null, error: null },
  };
}

// ===========================================================================
// 1. Env guard
// ===========================================================================

Deno.test("env guard: missing RESEND_API_KEY → 500", async () => {
  const { deps } = makeFakeDeps({
    envVars: { SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: "svc" },
  });
  const res = await handle(
    authedReq({ body: { templateName: KNOWN_TEMPLATE, recipientEmail: "a@b.com" } }),
    deps,
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("env guard: missing SUPABASE_URL → 500", async () => {
  const { deps } = makeFakeDeps({
    envVars: { RESEND_API_KEY: "re_x", SUPABASE_SERVICE_ROLE_KEY: "svc" },
  });
  const res = await handle(
    authedReq({ body: { templateName: KNOWN_TEMPLATE, recipientEmail: "a@b.com" } }),
    deps,
  );
  assertEquals(res.status, 500);
});

Deno.test("env guard: missing SUPABASE_SERVICE_ROLE_KEY → 500", async () => {
  const { deps } = makeFakeDeps({
    envVars: { RESEND_API_KEY: "re_x", SUPABASE_URL: "https://x" },
  });
  const res = await handle(
    authedReq({ body: { templateName: KNOWN_TEMPLATE, recipientEmail: "a@b.com" } }),
    deps,
  );
  assertEquals(res.status, 500);
});

Deno.test("env guard: all three env vars present — does not fail at env check", async () => {
  // Minimal: unknown template so we can stop early, just confirming it passes the guard.
  const { deps } = makeFakeDeps({ envVars: ENV });
  const res = await handle(
    authedReq({ body: { templateName: "nope", recipientEmail: "a@b.com" } }),
    deps,
  );
  // 404 means it passed env check and reached template lookup.
  assertEquals(res.status, 404);
});

// ===========================================================================
// 2. Body key casing — camelCase AND snake_case
// ===========================================================================

Deno.test("body: camelCase keys are accepted (templateName, recipientEmail)", async () => {
  const { deps } = makeFakeDeps({ envVars: ENV });
  const res = await handle(
    authedReq({ body: { templateName: KNOWN_TEMPLATE, recipientEmail: "a@b.com" } }),
    deps,
  );
  // Unknown template gives 404; known template should not give 400 on field parsing.
  // This asserts field parsing worked (not a 400 missing-field error).
  assertEquals(res.status !== 400, true, `Expected non-400 for camelCase; got ${res.status}`);
});

Deno.test("body: snake_case keys work (template_name, recipient_email) — booking engine contract", async () => {
  // The booking engine (send-offer-digest, send-confirmation-digest) calls with snake_case keys.
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: happyPathTables("snake@test.com"),
    fetchImpl,
  });
  const res = await handle(
    authedReq({
      body: {
        template_name: KNOWN_TEMPLATE,
        recipient_email: "snake@test.com",
        idempotency_key: "idem-001",
      },
    }),
    deps,
  );
  // Should reach Resend, not fail with 400 "templateName is required".
  const body = await res.json();
  assertEquals(res.status, 200, `Expected 200 for snake_case input; got ${res.status}: ${JSON.stringify(body)}`);
  assertEquals(fetchCalls.length >= 1, true, "Expected at least one fetch call for snake_case input");
});

Deno.test("body: idempotency_key snake_case is accepted", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: happyPathTables("idem@test.com"),
    fetchImpl,
  });
  const res = await handle(
    authedReq({
      body: {
        template_name: KNOWN_TEMPLATE,
        recipient_email: "idem@test.com",
        idempotency_key: "my-idempotency-key-xyz",
      },
    }),
    deps,
  );
  assertEquals(res.status, 200, `Expected 200; got ${res.status}`);
  // Idempotency-Key header should be the provided value.
  const sentInit = fetchCalls[0]?.init as RequestInit & { headers?: Record<string, string> };
  const sentHeaders = sentInit?.headers as Record<string, string> | undefined;
  assertEquals(
    sentHeaders?.["Idempotency-Key"],
    "my-idempotency-key-xyz",
    "Idempotency-Key header should match provided idempotency_key",
  );
});

// ===========================================================================
// 3. Unknown template → 404
// ===========================================================================

Deno.test("unknown template → 404 with error field", async () => {
  const { deps } = makeFakeDeps({ envVars: ENV });
  const res = await handle(
    authedReq({ body: { templateName: "does-not-exist", recipientEmail: "a@b.com" } }),
    deps,
  );
  assertEquals(res.status, 404);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("missing templateName → 400", async () => {
  const { deps } = makeFakeDeps({ envVars: ENV });
  const res = await handle(
    authedReq({ body: { recipientEmail: "a@b.com" } }),
    deps,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error);
});

// ===========================================================================
// 4. FAIL-CLOSED SUPPRESSION (headline test)
//    Suppressed recipient: NO fetch call to Resend; response shape { success: false, reason: 'email_suppressed' }
// ===========================================================================

Deno.test("FAIL-CLOSED SUPPRESSION: suppressed recipient must NOT call Resend", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: {
      suppressed_emails: [
        // The suppressed row is returned
        { when: { email: "suppressed@test.com" }, data: { id: "sup_001" }, error: null },
        { data: { id: "sup_001" }, error: null },
      ],
      email_send_log: [{ data: null, error: null }],
    },
    fetchImpl,
  });
  const res = await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "suppressed@test.com" },
    }),
    deps,
  );
  // CRITICAL SECURITY/COMPLIANCE ASSERTION: no network call to Resend must have been made.
  assertEquals(
    fetchCalls.length,
    0,
    `FAIL-CLOSED BREACH: Resend was called ${fetchCalls.length} time(s) for a suppressed recipient!`,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, false, "Expected { success: false } for suppressed recipient");
  assertEquals(
    body.reason,
    "email_suppressed",
    `Expected reason 'email_suppressed', got '${body.reason}'`,
  );
});

Deno.test("FAIL-CLOSED SUPPRESSION: suppression check is case-insensitive (uppercase input)", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: {
      suppressed_emails: [
        // Stored lowercased, matched via .eq('email', lower)
        { when: { email: "upper@test.com" }, data: { id: "sup_002" }, error: null },
        { data: { id: "sup_002" }, error: null },
      ],
      email_send_log: [{ data: null, error: null }],
    },
    fetchImpl,
  });
  // Input is uppercase; handler normalizes via .toLowerCase() before the DB eq check.
  const res = await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "UPPER@TEST.COM" },
    }),
    deps,
  );
  assertEquals(fetchCalls.length, 0, "Resend must NOT be called for a suppressed address regardless of casing");
  const body = await res.json();
  assertEquals(body.success, false);
  assertEquals(body.reason, "email_suppressed");
});

Deno.test("FAIL-CLOSED SUPPRESSION: suppressed recipient is logged with status=suppressed", async () => {
  const { fetchImpl } = recordingFetch();
  const { deps, calls } = makeFakeDeps({
    envVars: ENV,
    tables: {
      suppressed_emails: [
        { when: { email: "sup2@test.com" }, data: { id: "sup_x" }, error: null },
        { data: { id: "sup_x" }, error: null },
      ],
      email_send_log: [{ data: null, error: null }],
    },
    fetchImpl,
  });
  await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "sup2@test.com" },
    }),
    deps,
  );
  const logInserts = calls.filter((c) => c.table === "email_send_log" && c.method === "insert");
  assertEquals(logInserts.length >= 1, true, "Expected at least one email_send_log insert for suppressed send");
});

// ===========================================================================
// 5. Suppression DB error → FAIL CLOSED (no send, 500 returned)
//    If the suppression check query itself errors, the function must refuse to send.
//    A suppression DB error that ALLOWS the send through would be a CRITICAL BUG.
// ===========================================================================

Deno.test("SUPPRESSION DB ERROR — FAIL CLOSED: query error must block the send (not allow it)", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: {
      suppressed_emails: [
        // Simulate a DB error on the suppression query.
        { data: null, error: { message: "connection timeout", code: "PGRST500" } },
      ],
    },
    fetchImpl,
  });
  const res = await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "artist@test.com" },
    }),
    deps,
  );
  // CRITICAL: if fetchCalls.length > 0, the function sent despite a suppression check error (FAIL OPEN).
  assertEquals(
    fetchCalls.length,
    0,
    `CRITICAL BUG — FAIL OPEN: Resend was called ${fetchCalls.length} time(s) even though the suppression check errored! Email may reach a suppressed recipient.`,
  );
  // The function should return a 5xx to signal failure, not a 2xx success.
  assertEquals(
    res.status >= 500,
    true,
    `Expected 5xx when suppression check errors (fail-closed); got ${res.status}`,
  );
});

// ===========================================================================
// 6. Happy path: correct Resend fetch call + response shape
// ===========================================================================

Deno.test("happy path: calls Resend POST https://api.resend.com/emails with Bearer auth", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch(200, { id: "re_abc789" });
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: happyPathTables("happy@test.com"),
    fetchImpl,
  });
  await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "happy@test.com" },
    }),
    deps,
  );
  assertEquals(fetchCalls.length >= 1, true, "Expected at least one fetch call");
  const resendCall = fetchCalls.find((c) => c.url.includes("resend.com"));
  assertExists(resendCall, "Expected a fetch call to api.resend.com");
  assertEquals(resendCall!.url, "https://api.resend.com/emails");
  const init = resendCall!.init as RequestInit & { headers?: Record<string, string> };
  assertEquals(
    (init.method ?? "").toUpperCase(),
    "POST",
    "Resend call must use POST method",
  );
  const headers = init.headers as Record<string, string> | undefined;
  assertExists(headers, "Expected headers on Resend fetch");
  assertEquals(
    headers["Authorization"],
    `Bearer ${ENV.RESEND_API_KEY}`,
    "Authorization header must be Bearer + RESEND_API_KEY",
  );
});

Deno.test("happy path: response body is { success: true, message_id: <resend_id> }", async () => {
  const { fetchImpl } = recordingFetch(200, { id: "re_xyz999" });
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: happyPathTables("resp@test.com"),
    fetchImpl,
  });
  const res = await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "resp@test.com" },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true, "Expected success: true in happy-path response");
  assertEquals(body.message_id, "re_xyz999", "Expected message_id to equal the Resend response id");
});

Deno.test("happy path: Resend request body contains correct 'to' and content-type header", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch(200, { id: "re_tocheck" });
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: happyPathTables("tofield@test.com"),
    fetchImpl,
  });
  await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "tofield@test.com" },
    }),
    deps,
  );
  const resendCall = fetchCalls.find((c) => c.url.includes("resend.com"));
  assertExists(resendCall, "Expected fetch call to Resend");
  const init = resendCall!.init as RequestInit & { headers?: Record<string, string>; body?: string };
  const headers = init.headers as Record<string, string>;
  assertEquals(
    headers["Content-Type"],
    "application/json",
    "Resend request must have Content-Type: application/json",
  );
  const sentBody = JSON.parse(init.body ?? "{}");
  assertEquals(
    Array.isArray(sentBody.to),
    true,
    "Resend request body.to must be an array",
  );
  assertEquals(
    sentBody.to.includes("tofield@test.com"),
    true,
    "Resend request body.to must include the recipient email",
  );
});

Deno.test("happy path: Resend request body includes List-Unsubscribe header", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch(200, { id: "re_unsub" });
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: happyPathTables("unsub@test.com"),
    fetchImpl,
  });
  await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "unsub@test.com" },
    }),
    deps,
  );
  const resendCall = fetchCalls.find((c) => c.url.includes("resend.com"));
  assertExists(resendCall, "Expected fetch call to Resend");
  const init = resendCall!.init as RequestInit & { body?: string };
  const sentBody = JSON.parse(init.body ?? "{}");
  assertExists(sentBody.headers, "Resend body must contain email headers object");
  assertExists(
    sentBody.headers["List-Unsubscribe"],
    "Resend email headers must include List-Unsubscribe",
  );
  assertExists(
    sentBody.headers["List-Unsubscribe-Post"],
    "Resend email headers must include List-Unsubscribe-Post",
  );
});

// ===========================================================================
// 7. Resend non-2xx → 500 error response
// ===========================================================================

Deno.test("Resend 422 → function returns 500 with error field", async () => {
  const { fetchImpl } = recordingFetch(422, { name: "validation_error", message: "invalid email" });
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: happyPathTables("fail@test.com"),
    fetchImpl,
  });
  const res = await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "fail@test.com" },
    }),
    deps,
  );
  assertEquals(res.status, 500, `Expected 500 for Resend 422; got ${res.status}`);
  const body = await res.json();
  assertExists(body.error, "Expected error field in body when Resend returns 4xx");
});

Deno.test("Resend 500 → function returns 500 with error field", async () => {
  const { fetchImpl } = recordingFetch(500, { message: "internal server error" });
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: happyPathTables("resend500@test.com"),
    fetchImpl,
  });
  const res = await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "resend500@test.com" },
    }),
    deps,
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertExists(body.error);
});

Deno.test("Resend 503 → function returns 500, failure is logged to email_send_log", async () => {
  const { fetchImpl } = recordingFetch(503, "Service Unavailable");
  const { deps, calls } = makeFakeDeps({
    envVars: ENV,
    tables: happyPathTables("log503@test.com"),
    fetchImpl,
  });
  const res = await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "log503@test.com" },
    }),
    deps,
  );
  assertEquals(res.status, 500);
  const logInserts = calls.filter((c) => c.table === "email_send_log" && c.method === "insert");
  // We expect at least a 'failed' log entry after the send attempt
  assertEquals(
    logInserts.length >= 1,
    true,
    "Expected at least one email_send_log insert on Resend failure",
  );
});

// ===========================================================================
// 8. email_send_log writes — fail closed: a pending-insert error must refuse to send unlogged
// ===========================================================================

Deno.test("email_send_log: written on successful send", async () => {
  const { fetchImpl } = recordingFetch(200, { id: "re_logged" });
  const { deps, calls } = makeFakeDeps({
    envVars: ENV,
    tables: happyPathTables("logged@test.com"),
    fetchImpl,
  });
  await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "logged@test.com" },
    }),
    deps,
  );
  const logInserts = calls.filter((c) => c.table === "email_send_log" && c.method === "insert");
  assertEquals(logInserts.length >= 1, true, "Expected email_send_log insert on send");
});

Deno.test("email_send_log: pending insert error must FAIL CLOSED (no unlogged send)", async () => {
  // Every later status transition is `.update(...).eq('message_id', messageId)`, which is a
  // silent 0-row no-op if the pending row never landed. If the handler sent anyway, that send
  // would be completely invisible to monitoring. So a pending-insert error must abort before
  // any Resend call, not be swallowed as non-blocking.
  const { fetchImpl, fetchCalls } = recordingFetch(200, { id: "re_nolog" });
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: {
      // Use existing non-used token path to avoid multi-result seed complexity
      suppressed_emails: { data: null, error: null },
      email_unsubscribe_tokens: { data: { token: "tok_abc", used_at: null }, error: null },
      app_settings: { data: null, error: null },
      email_send_log: { data: null, error: { message: "disk full", code: "DB_ERR" } },
    },
    fetchImpl,
  });
  const res = await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "nolog@test.com" },
    }),
    deps,
  );
  assertEquals(
    res.status,
    500,
    `Expected 500 when email_send_log pending insert errors; got ${res.status}`,
  );
  const body = await res.json();
  assertEquals(body.error, "Failed to record email send");
  assertEquals(fetchCalls.length, 0, "Expected no Resend call when the pending row never landed");
});

// ===========================================================================
// 9. email_unsubscribe_tokens interaction exists
// ===========================================================================

Deno.test("email_unsubscribe_tokens: queried before send (token lookup happens)", async () => {
  const { fetchImpl } = recordingFetch(200, { id: "re_tok" });
  const { deps, calls } = makeFakeDeps({
    envVars: ENV,
    tables: happyPathTables("tokencheck@test.com"),
    fetchImpl,
  });
  await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "tokencheck@test.com" },
    }),
    deps,
  );
  const tokenInteractions = calls.filter((c) => c.table === "email_unsubscribe_tokens");
  assertEquals(
    tokenInteractions.length >= 1,
    true,
    "Expected at least one interaction with email_unsubscribe_tokens",
  );
});

Deno.test("email_unsubscribe_tokens: upsert happens when no existing token", async () => {
  // The fake client resolves the same seed for every call to a table, so we cannot
  // simulate a null-on-first-call / token-on-second-call sequence purely through seeds.
  // Instead: we use a stateful counter inside a custom fetchImpl-shaped override via
  // a hand-rolled Deps that wraps the fake admin with a call-counting token table.
  const { fetchImpl } = recordingFetch(200, { id: "re_upsert" });
  const allCalls: Array<{ table: string; method: string; args: unknown[] }> = [];

  // Stateful token responses: call 0 → null (no existing token), call 1 → null (upsert ignored),
  // call 2 → token (read-back). We count `maybeSingle` calls to email_unsubscribe_tokens.
  let tokenCallCount = 0;
  const tokenResponses = [
    { data: null, error: null },               // initial lookup — no existing token
    { data: { token: "upserted_token" }, error: null }, // read-back after upsert
  ];

  const { deps: baseDeps } = makeFakeDeps({
    envVars: ENV,
    tables: {
      suppressed_emails: { data: null, error: null },
      // email_unsubscribe_tokens overridden below via monkey-patched admin
      email_unsubscribe_tokens: { data: null, error: null },
      app_settings: { data: null, error: null },
      email_send_log: { data: null, error: null },
    },
    fetchImpl,
  });

  // Override the admin.from for email_unsubscribe_tokens to return stateful results
  const origFrom = bindFakeFrom(baseDeps.admin);
  setFakeFrom(baseDeps.admin, (table: string) => {
    if (table !== "email_unsubscribe_tokens") return origFrom(table);
    allCalls.push({ table, method: "from", args: [] });
    const CHAIN_METHODS = [
      "select", "insert", "update", "upsert", "delete",
      "eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "or", "not", "match",
      "order", "limit", "range", "filter",
    ];
    const chain: Record<string, unknown> = {};
    for (const m of CHAIN_METHODS) {
      chain[m] = (...args: unknown[]) => {
        allCalls.push({ table, method: m, args });
        return chain;
      };
    }
    chain.maybeSingle = () => {
      allCalls.push({ table, method: "maybeSingle", args: [] });
      const response = tokenResponses[tokenCallCount] ?? { data: null, error: null };
      tokenCallCount++;
      return Promise.resolve(response);
    };
    chain.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => {
      allCalls.push({ table, method: "then", args: [] });
      return Promise.resolve({ data: null, error: null }).then(f, r);
    };
    return chain;
  });

  await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "upsert@test.com" },
    }),
    baseDeps,
  );
  const upsertCalls = allCalls.filter(
    (c) => c.table === "email_unsubscribe_tokens" && c.method === "upsert",
  );
  assertEquals(
    upsertCalls.length >= 1,
    true,
    "Expected at least one upsert into email_unsubscribe_tokens when no token exists",
  );
});

Deno.test("email_unsubscribe_tokens: existing non-used token is reused (no new upsert)", async () => {
  const { fetchImpl } = recordingFetch(200, { id: "re_reuse" });
  const { deps, calls } = makeFakeDeps({
    envVars: ENV,
    tables: {
      suppressed_emails: { data: null, error: null },
      // Single-object seed: existing token, not used
      email_unsubscribe_tokens: { data: { token: "existing_token_999", used_at: null }, error: null },
      app_settings: { data: null, error: null },
      email_send_log: { data: null, error: null },
    },
    fetchImpl,
  });
  await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "reuse@test.com" },
    }),
    deps,
  );
  const upsertCalls = calls.filter(
    (c) => c.table === "email_unsubscribe_tokens" && c.method === "upsert",
  );
  assertEquals(
    upsertCalls.length,
    0,
    "Expected NO upsert when an existing non-used token exists — it should be reused",
  );
});

Deno.test("email_unsubscribe_tokens: token lookup error → 500 (fail-closed)", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch(200, { id: "re_tokerr" });
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: {
      suppressed_emails: { data: null, error: null },
      email_unsubscribe_tokens: { data: null, error: { message: "query failed", code: "DB_ERR" } },
    },
    fetchImpl,
  });
  const res = await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "tokerr@test.com" },
    }),
    deps,
  );
  assertEquals(
    fetchCalls.length,
    0,
    "Resend must NOT be called when the token lookup errors",
  );
  assertEquals(res.status, 500, `Expected 500 when token lookup errors; got ${res.status}`);
});

// ===========================================================================
// 10. OPTIONS → CORS preflight (already in smoke test, duplicated here for completeness)
// ===========================================================================

Deno.test("OPTIONS: returns CORS preflight (204 or 200)", async () => {
  const { deps } = makeFakeDeps({ envVars: ENV });
  const res = await handle(authedReq({ method: "OPTIONS" }), deps);
  assertEquals(
    res.status === 204 || res.status === 200,
    true,
    `Expected 204 or 200 for OPTIONS preflight; got ${res.status}`,
  );
});

// ===========================================================================
// 11. Invalid JSON body → 400
// ===========================================================================

Deno.test("invalid JSON body → 400", async () => {
  const { deps } = makeFakeDeps({ envVars: ENV });
  const req = new Request("http://localhost/fn", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer service_role_svc" },
    body: "not valid json {{{",
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error);
});

// ===========================================================================
// 12. Subject rendered correctly (functional subject vs string subject)
// ===========================================================================

Deno.test("happy path: Resend body includes a non-empty subject", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch(200, { id: "re_subj" });
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: happyPathTables("subj@test.com"),
    fetchImpl,
  });
  await handle(
    authedReq({
      body: {
        templateName: KNOWN_TEMPLATE,
        recipientEmail: "subj@test.com",
        templateData: { offers: [{ show: "A Show", date: "2026-07-01", city: "Berlin", expires: "2026-06-30" }] },
      },
    }),
    deps,
  );
  const resendCall = fetchCalls.find((c) => c.url.includes("resend.com"));
  assertExists(resendCall, "Expected Resend fetch call");
  const init = resendCall!.init as RequestInit & { body?: string };
  const sentBody = JSON.parse(init.body ?? "{}");
  assertExists(sentBody.subject, "Expected a subject in Resend request body");
  assertEquals(typeof sentBody.subject, "string", "Subject must be a string");
  assertEquals(sentBody.subject.length > 0, true, "Subject must not be empty");
});

// ===========================================================================
// 13. CHARACTERIZATION: used token + email not suppressed → treated as suppressed
//     (safety fallback in handler — documents the actual behavior)
// ===========================================================================

// ===========================================================================
// 14. Per-org from-address override
// ===========================================================================

Deno.test("send-transactional-email: uses the org's resend_from_address override", async () => {
  const ORG = "00000000-0000-0000-0000-0000000000a1";
  const { deps } = makeFakeDeps({
    envVars: {
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service_role_svc",
      RESEND_API_KEY: "re_key",
    },
    tables: {
      suppressed_emails: { data: null, error: null },
      email_unsubscribe_tokens: { data: { token: "tok", used_at: null }, error: null },
      email_send_log: { data: null, error: null },
      app_settings: [
        { when: { key: "resend_from_address" }, data: [{ org_id: ORG, value: "Org A <a@org-a.com>" }, { org_id: null, value: "ShowFlow <noreply@showflow.pro>" }] },
        { when: { key: "email_template_overrides" }, data: [{ org_id: null, value: {} }] },
      ],
    },
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ id: "re_1" }), { status: 200 })),
  });

  let sentFrom = "";
  const baseFetch = deps.fetch;
  deps.fetch = (url, init) => {
    if (String(url).includes("api.resend.com")) {
      sentFrom = JSON.parse(String((init as RequestInit).body)).from;
    }
    return baseFetch(url, init);
  };

  const res = await handle(authedReq({
    body: { template_name: "artist-offer-digest", recipient_email: "jo@x.com", org_id: ORG, templateData: { displayName: "Jo", offers: [] } },
  }), deps);
  assertEquals(res.status, 200);
  assertEquals(sentFrom, "Org A <a@org-a.com>");
});

Deno.test("send-transactional-email: applies new copy and theme settings to the rendered delivery", async () => {
  const ORG = "00000000-0000-0000-0000-0000000000b1";
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: {
      ...happyPathTables(),
      app_settings: [
        { when: { key: "email_copy" }, data: [{ org_id: ORG, value: {
          "org-invitation.subject": "Welcome {{orgName}}",
          "org-invitation.productIntro": "A custom invitation for {{orgName}}.",
        } }], error: null },
        { when: { key: "email_theme" }, data: [{ org_id: ORG, value: { base: { colors: { pageBg: "#010203" } } } }], error: null },
        { when: { key: "email_template_overrides" }, data: [], error: null },
      ],
    },
    fetchImpl,
  });

  const res = await handle(authedReq({
    body: {
      templateName: "org-invitation",
      recipientEmail: "invitee@example.com",
      org_id: ORG,
      templateData: { orgName: "Studio" },
    },
  }), deps);
  assertEquals(res.status, 200);
  const resend = fetchCalls.find((call) => call.url.includes("api.resend.com"));
  assertExists(resend);
  const sent = JSON.parse(String((resend!.init as RequestInit).body)) as { subject: string; html: string };
  assertEquals(sent.subject, "Welcome Studio");
  assertEquals(sent.html.includes("A custom invitation for Studio."), true);
  assertEquals(sent.html.includes("#010203"), true);
});

Deno.test("send-transactional-email: maps legacy copy only while new copy is absent", async () => {
  const ORG = "00000000-0000-0000-0000-0000000000b2";
  const legacy = { "org-invitation": { subject: "Legacy invitation" } };
  const sendWithCopy = async (copy: unknown) => {
    const { fetchImpl, fetchCalls } = recordingFetch();
    const { deps } = makeFakeDeps({
      envVars: ENV,
      tables: {
        ...happyPathTables(),
        app_settings: [
          { when: { key: "email_copy" }, data: copy === null ? [] : [{ org_id: ORG, value: copy }], error: null },
          { when: { key: "email_theme" }, data: [], error: null },
          { when: { key: "email_template_overrides" }, data: [{ org_id: ORG, value: legacy }], error: null },
        ],
      },
      fetchImpl,
    });
    const res = await handle(authedReq({
      body: { templateName: "org-invitation", recipientEmail: "invitee@example.com", org_id: ORG, templateData: { orgName: "Studio" } },
    }), deps);
    assertEquals(res.status, 200);
    const resend = fetchCalls.find((call) => call.url.includes("api.resend.com"));
    assertExists(resend);
    return JSON.parse(String((resend!.init as RequestInit).body)) as { subject: string };
  };

  assertEquals((await sendWithCopy(null)).subject, "Legacy invitation");
  assertEquals((await sendWithCopy({})).subject, "You're invited to join Studio on ShowFlow");
});

Deno.test("send-transactional-email: retains legacy generic subjects for conditional templates", async () => {
  const ORG = "00000000-0000-0000-0000-0000000000b3";
  const sendLegacySubject = async (templateName: string, templateData: Record<string, unknown>, subject: string) => {
    const { fetchImpl, fetchCalls } = recordingFetch();
    const { deps } = makeFakeDeps({
      envVars: ENV,
      tables: {
        ...happyPathTables(),
        app_settings: [
          { when: { key: "email_copy" }, data: [], error: null },
          { when: { key: "email_theme" }, data: [], error: null },
          { when: { key: "email_template_overrides" }, data: [{ org_id: ORG, value: { [templateName]: { subject } } }], error: null },
        ],
      },
      fetchImpl,
    });
    const response = await handle(authedReq({
      body: { templateName, recipientEmail: "artist@example.com", org_id: ORG, templateData },
    }), deps);
    assertEquals(response.status, 200);
    const resend = fetchCalls.find((call) => call.url.includes("api.resend.com"));
    assertExists(resend);
    return JSON.parse(String((resend!.init as RequestInit).body)) as { subject: string };
  };

  assertEquals(
    (await sendLegacySubject("offer-expiry-reminder", { offers: [{}] }, "Legacy expiry subject")).subject,
    "Legacy expiry subject",
  );
  assertEquals(
    (await sendLegacySubject("artist-confirmation-digest", { bookings: [{}] }, "Legacy confirmation subject")).subject,
    "Legacy confirmation subject",
  );
});

Deno.test("characterization: used token + not suppressed → returns { success: false, reason: 'email_suppressed' }", async () => {
  // characterization: when existingToken.used_at is set and the email is NOT suppressed,
  // the handler's safety fallback (line ~131-133 in index.ts) returns email_suppressed anyway.
  // This is intentional-but-undocumented behavior: a used unsubscribe token implies the user
  // unsubscribed but before suppression was properly recorded, so the send is blocked as a safeguard.
  const { fetchImpl, fetchCalls } = recordingFetch(200, { id: "re_used" });
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: {
      suppressed_emails: [{ data: null, error: null }], // NOT suppressed
      email_unsubscribe_tokens: [
        // Token exists but has been used (used_at is set)
        { data: { token: "used_token_xyz", used_at: "2026-05-01T10:00:00Z" }, error: null },
      ],
    },
    fetchImpl,
  });
  const res = await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "used@test.com" },
    }),
    deps,
  );
  // characterization: actual behavior is to block the send
  assertEquals(fetchCalls.length, 0, "Resend must NOT be called when token has been used");
  assertEquals(res.status, 200, "Expected 200 for used-token safety fallback");
  const body = await res.json();
  assertEquals(body.success, false);
  assertEquals(body.reason, "email_suppressed");
});

// ===========================================================================
// 15. FIX B — a THROWN send error (e.g. deps.fetch network failure) must not leave
//     the email_send_log row orphaned at 'pending' forever. It must transition to
//     'failed' and the handler must return 500, exactly like the handled
//     `!sendResponse.ok` case above.
// ===========================================================================

Deno.test("thrown send error (deps.fetch rejects): row transitions to 'failed', not left orphaned 'pending'", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: ENV,
    tables: happyPathTables("thrown@test.com"),
    fetchImpl: (() => Promise.reject(new Error("network unreachable"))) as typeof fetch,
  });
  const res = await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "thrown@test.com" },
    }),
    deps,
  );
  assertEquals(res.status, 500, `Expected 500 when deps.fetch throws; got ${res.status}`);
  const body = await res.json();
  assertExists(body.error);

  const failedUpdate = calls.find(
    (c) =>
      c.table === "email_send_log" &&
      c.method === "update" &&
      (c.args[0] as { status?: string } | undefined)?.status === "failed",
  );
  assertExists(
    failedUpdate,
    "Expected email_send_log to be updated to status 'failed' after a thrown send error (not left at 'pending')",
  );
});

Deno.test("thrown resolveOrgSetting error (app_settings read fails): 500 returned, row transitions to 'failed'", async () => {
  // resolveOrgSetting does `if (error) throw error` — a transient app_settings read
  // failure must be caught by the same try/catch that wraps renderAsync/fetch, not
  // escape uncaught and leave the row stuck at 'pending' forever.
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps, calls } = makeFakeDeps({
    envVars: ENV,
    tables: {
      suppressed_emails: { data: null, error: null },
      email_unsubscribe_tokens: { data: { token: "existing_token_abc123", used_at: null }, error: null },
      app_settings: { data: null, error: { message: "boom", code: "PGRST500" } },
      email_send_log: { data: null, error: null },
    },
    fetchImpl,
  });
  const res = await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "settingsfail@test.com" },
    }),
    deps,
  );
  assertEquals(res.status, 500, `Expected 500 when resolveOrgSetting throws; got ${res.status}`);
  const body = await res.json();
  assertExists(body.error);
  assertEquals(
    fetchCalls.length,
    0,
    "Resend must NOT be called when resolveOrgSetting throws before render/send",
  );

  const failedUpdate = calls.find(
    (c) =>
      c.table === "email_send_log" &&
      c.method === "update" &&
      (c.args[0] as { status?: string } | undefined)?.status === "failed",
  );
  assertExists(
    failedUpdate,
    "Expected email_send_log to be updated to status 'failed' after resolveOrgSetting throws (not left at 'pending')",
  );
});
