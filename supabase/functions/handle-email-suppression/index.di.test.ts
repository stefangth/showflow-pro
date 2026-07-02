/**
 * Deep DI tests for handle-email-suppression edge function.
 *
 * These tests construct VALID HMAC-SHA256 signatures that the handler
 * actually accepts — end-to-end security path verification.
 *
 * Handler signing scheme (from verifyResendWebhook):
 *   - Headers: webhook-id, webhook-timestamp, webhook-signature
 *   - Signed message: `${webhookId}.${webhookTimestamp}.${rawBody}`
 *   - Secret: the env var value is a bare base64 string; handler does atob(secret) directly
 *   - HMAC-SHA256 over the message using the decoded secret bytes
 *   - Signature format: `v1,<base64(hmac)>` (multiple space-separated are also accepted)
 *   - Timestamp tolerance: |Math.floor(nowMs/1000) - ts| <= 300
 */
import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps } from "../_shared/testing.ts";
import { handle } from "./index.ts";

// ---------------------------------------------------------------------------
// Signing helper — reproduces verifyResendWebhook exactly
// ---------------------------------------------------------------------------

/**
 * Signs a webhook request body using the same scheme as the handler.
 *
 * @param secret    The bare base64 secret string (what goes into RESEND_WEBHOOK_SECRET env var).
 * @param id        The webhook-id header value.
 * @param tsSeconds The webhook-timestamp (integer seconds since epoch).
 * @param body      The raw request body string (exactly what the handler will read).
 * @returns         The value for the webhook-signature header: `v1,<base64sig>`
 */
async function signWebhook(
  secret: string,
  id: string,
  tsSeconds: number,
  body: string,
): Promise<string> {
  const toSign = `${id}.${tsSeconds}.${body}`;
  const secretBytes = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(toSign),
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  return `v1,${computed}`;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// A valid base64 secret (32 random bytes → base64).
// We use a predictable value so tests are reproducible.
const TEST_SECRET = btoa("super-secret-webhook-key-for-tests");

const BASE_ENV_VARS = {
  RESEND_WEBHOOK_SECRET: TEST_SECRET,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
};

// Fixed "now" from makeFakeDeps default: 2026-06-01T12:00:00.000Z → 1748779200 seconds
const FIXED_NOW_DATE = new Date("2026-06-01T12:00:00.000Z");
const FIXED_NOW_TS = Math.floor(FIXED_NOW_DATE.getTime() / 1000); // 1748779200

const WEBHOOK_ID = "msg_test_001";

/**
 * Build a signed Request for handle() tests.
 * Uses deps.now() timestamp so the timestamp check always passes.
 */
async function makeSignedRequest(
  bodyObj: unknown,
  overrides: {
    secret?: string;
    id?: string;
    ts?: number;
    signatureOverride?: string;
    extraHeaders?: Record<string, string>;
  } = {},
): Promise<Request> {
  const rawBody = JSON.stringify(bodyObj);
  const id = overrides.id ?? WEBHOOK_ID;
  const ts = overrides.ts ?? FIXED_NOW_TS;
  const secret = overrides.secret ?? TEST_SECRET;

  const signature =
    overrides.signatureOverride ??
    (await signWebhook(secret, id, ts, rawBody));

  return new Request("http://localhost/fn", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": signature,
      ...(overrides.extraHeaders ?? {}),
    },
    body: rawBody,
  });
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

// --- 1. Non-POST → 405 ---

Deno.test("non-POST → 405", async () => {
  const { deps } = makeFakeDeps({ envVars: BASE_ENV_VARS, now: FIXED_NOW_DATE });
  const req = new Request("http://localhost/fn", { method: "GET" });
  const res = await handle(req, deps);
  assertEquals(res.status, 405);
});

// --- 2. Missing signature headers → 401 ---

Deno.test("missing signature headers → 401", async () => {
  const { deps } = makeFakeDeps({ envVars: BASE_ENV_VARS, now: FIXED_NOW_DATE });
  const req = new Request("http://localhost/fn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "email.bounced" }),
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 401);
});

// --- 3. Invalid (tampered) signature → 401 ---

Deno.test("invalid/tampered signature → 401", async () => {
  const { deps } = makeFakeDeps({ envVars: BASE_ENV_VARS, now: FIXED_NOW_DATE });
  const req = await makeSignedRequest(
    { type: "email.bounced", created_at: "2026-06-01T12:00:00Z", data: { to: ["test@example.com"] } },
    { signatureOverride: "v1,dGhpcyBpcyBub3QgYSB2YWxpZCBzaWduYXR1cmU=" },
  );
  const res = await handle(req, deps);
  assertEquals(res.status, 401);
});

// --- 4. Stale timestamp (>300s before now) → 401 ---

Deno.test("stale timestamp (>300s in the past) → 401", async () => {
  const { deps } = makeFakeDeps({ envVars: BASE_ENV_VARS, now: FIXED_NOW_DATE });
  // 301 seconds before fixed now
  const staleTs = FIXED_NOW_TS - 301;
  const body = { type: "email.bounced", created_at: "2026-06-01T11:54:59Z", data: { to: ["test@example.com"] } };
  // Sign with the stale timestamp (signature must match what the handler would compute)
  const req = await makeSignedRequest(body, { ts: staleTs });
  const res = await handle(req, deps);
  assertEquals(res.status, 401);
  const responseBody = await res.json();
  assertEquals(responseBody.error, "Stale timestamp");
});

// --- 5. Stale timestamp (>300s in the future) → 401 ---

Deno.test("stale timestamp (>300s in the future) → 401", async () => {
  const { deps } = makeFakeDeps({ envVars: BASE_ENV_VARS, now: FIXED_NOW_DATE });
  const futureTs = FIXED_NOW_TS + 301;
  const body = { type: "email.bounced", created_at: "2026-06-01T12:05:01Z", data: { to: ["test@example.com"] } };
  const req = await makeSignedRequest(body, { ts: futureTs });
  const res = await handle(req, deps);
  assertEquals(res.status, 401);
  const responseBody = await res.json();
  assertEquals(responseBody.error, "Stale timestamp");
});

// --- 6. Timestamp exactly at boundary (±300s) is accepted ---

Deno.test("timestamp at exactly +300s boundary → accepted (valid sig)", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: BASE_ENV_VARS,
    now: FIXED_NOW_DATE,
    tables: {
      suppressed_emails: { data: null, error: null },
      email_send_log: { data: null, error: null },
    },
  });
  const borderTs = FIXED_NOW_TS + 300; // exactly ±300 → Math.abs == 300, NOT > 300 → passes
  const body = {
    type: "email.bounced",
    created_at: "2026-06-01T12:05:00Z",
    data: { email_id: "em_boundary", to: ["boundary@example.com"] },
  };
  const req = await makeSignedRequest(body, { ts: borderTs });
  const res = await handle(req, deps);
  // Should NOT be 401 — boundary is inclusive
  assertEquals(res.status, 200);
  // Confirm upsert was called
  const upsertCall = calls.find((c) => c.table === "suppressed_emails" && c.method === "upsert");
  assertExists(upsertCall);
});

// --- 7. VALID signature + email.bounced → suppressed_emails upsert with reason "bounce" ---

Deno.test("VALID signature + email.bounced → suppression row with reason 'bounce'", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: BASE_ENV_VARS,
    now: FIXED_NOW_DATE,
    tables: {
      suppressed_emails: { data: null, error: null },
      email_send_log: { data: null, error: null },
    },
  });

  const bouncedPayload = {
    type: "email.bounced",
    created_at: "2026-06-01T12:00:00Z",
    data: {
      email_id: "em_bounce_001",
      to: ["bounced@example.com"],
      from: "sender@showflowpro.com",
      subject: "Test",
    },
  };

  const req = await makeSignedRequest(bouncedPayload);
  const res = await handle(req, deps);

  // 1. HTTP 200 success
  assertEquals(res.status, 200);
  const resBody = await res.json();
  assertEquals(resBody.success, true);

  // 2. upsert was called on suppressed_emails
  const upsertCall = calls.find(
    (c) => c.table === "suppressed_emails" && c.method === "upsert",
  );
  assertExists(upsertCall, "suppressed_emails upsert must be called");

  // 3. Upsert payload has correct reason and email
  const [upsertRow, upsertOpts] = upsertCall!.args as [
    { email: string; reason: string; metadata: { resend_email_id?: string } },
    { onConflict: string },
  ];
  assertEquals(upsertRow.email, "bounced@example.com");
  assertEquals(upsertRow.reason, "bounce");
  assertEquals(upsertRow.metadata.resend_email_id, "em_bounce_001");
  assertEquals(upsertOpts.onConflict, "email");

  // 4. email_send_log insert was called with status 'bounced'
  const logInsert = calls.find(
    (c) => c.table === "email_send_log" && c.method === "insert",
  );
  assertExists(logInsert, "email_send_log insert must be called");
  const [logRow] = logInsert!.args as [
    { recipient_email: string; status: string; template_name: string },
  ];
  assertEquals(logRow.recipient_email, "bounced@example.com");
  assertEquals(logRow.status, "bounced");
  assertEquals(logRow.template_name, "system");
});

// --- 8. VALID signature + email.complained → suppression row with reason "complaint" ---

Deno.test("VALID signature + email.complained → suppression row with reason 'complaint'", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: BASE_ENV_VARS,
    now: FIXED_NOW_DATE,
    tables: {
      suppressed_emails: { data: null, error: null },
      email_send_log: { data: null, error: null },
    },
  });

  const complainedPayload = {
    type: "email.complained",
    created_at: "2026-06-01T12:00:00Z",
    data: {
      email_id: "em_complaint_001",
      to: ["Complained@Example.COM"], // mixed-case to verify normalization
      from: "sender@showflowpro.com",
      subject: "Test",
    },
  };

  const req = await makeSignedRequest(complainedPayload);
  const res = await handle(req, deps);

  assertEquals(res.status, 200);
  const resBody = await res.json();
  assertEquals(resBody.success, true);

  // Upsert should be called with reason "complaint"
  const upsertCall = calls.find(
    (c) => c.table === "suppressed_emails" && c.method === "upsert",
  );
  assertExists(upsertCall, "suppressed_emails upsert must be called");

  const [upsertRow] = upsertCall!.args as [
    { email: string; reason: string; metadata: { resend_email_id?: string } },
    ...unknown[]
  ];
  assertEquals(upsertRow.reason, "complaint");
  assertEquals(upsertRow.metadata.resend_email_id, "em_complaint_001");

  // Email should be normalized to lowercase
  assertEquals(upsertRow.email, "complained@example.com");

  // email_send_log should record status "complained"
  const logInsert = calls.find(
    (c) => c.table === "email_send_log" && c.method === "insert",
  );
  assertExists(logInsert);
  const [logRow] = logInsert!.args as [{ status: string; recipient_email: string }, ...unknown[]];
  assertEquals(logRow.status, "complained");
  assertEquals(logRow.recipient_email, "complained@example.com");
});

// --- 9. VALID signature + email.delivered (non-suppression) → ignored, NO upsert ---

Deno.test("VALID signature + email.delivered → ignored (2xx, { success: true, ignored: true }), no suppression insert", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: BASE_ENV_VARS,
    now: FIXED_NOW_DATE,
  });

  const deliveredPayload = {
    type: "email.delivered",
    created_at: "2026-06-01T12:00:00Z",
    data: {
      email_id: "em_delivered_001",
      to: ["recipient@example.com"],
    },
  };

  const req = await makeSignedRequest(deliveredPayload);
  const res = await handle(req, deps);

  // Must be 2xx
  assertEquals(res.status, 200);
  const resBody = await res.json();

  // Response shape: { success: true, ignored: true }
  assertEquals(resBody.success, true);
  assertEquals(resBody.ignored, true);

  // No suppressed_emails upsert must have been called
  const upsertCall = calls.find((c) => c.table === "suppressed_emails");
  assertEquals(
    upsertCall,
    undefined,
    "suppressed_emails must NOT be touched for non-suppression events",
  );
});

// --- 10. VALID signature + email.opened (non-suppression) → ignored ---

Deno.test("VALID signature + email.opened → ignored, no suppression insert", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: BASE_ENV_VARS,
    now: FIXED_NOW_DATE,
  });

  const openedPayload = {
    type: "email.opened",
    created_at: "2026-06-01T12:00:00Z",
    data: { email_id: "em_opened_001", to: ["user@example.com"] },
  };

  const req = await makeSignedRequest(openedPayload);
  const res = await handle(req, deps);

  assertEquals(res.status, 200);
  const resBody = await res.json();
  assertEquals(resBody.ignored, true);

  const upsertCall = calls.find((c) => c.table === "suppressed_emails");
  assertEquals(upsertCall, undefined);
});

// --- 11. Email address is parsed from data.to[0] ---

Deno.test("email address is parsed from data.to[0], not from envelope", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: BASE_ENV_VARS,
    now: FIXED_NOW_DATE,
    tables: {
      suppressed_emails: { data: null, error: null },
      email_send_log: { data: null, error: null },
    },
  });

  // Multiple recipients in array — only first is read
  const payload = {
    type: "email.bounced",
    created_at: "2026-06-01T12:00:00Z",
    data: {
      email_id: "em_multi_001",
      to: ["first@example.com", "second@example.com"],
    },
  };

  const req = await makeSignedRequest(payload);
  const res = await handle(req, deps);
  assertEquals(res.status, 200);

  const upsertCall = calls.find(
    (c) => c.table === "suppressed_emails" && c.method === "upsert",
  );
  assertExists(upsertCall);
  const [upsertRow] = upsertCall!.args as [{ email: string }, ...unknown[]];
  assertEquals(upsertRow.email, "first@example.com");
});

// --- 12. Missing recipient (no data.to) → 400 ---

Deno.test("VALID signature + missing data.to → 400", async () => {
  const { deps } = makeFakeDeps({
    envVars: BASE_ENV_VARS,
    now: FIXED_NOW_DATE,
  });

  const payload = {
    type: "email.bounced",
    created_at: "2026-06-01T12:00:00Z",
    data: { email_id: "em_norecip_001" }, // no `to` field
  };

  const req = await makeSignedRequest(payload);
  const res = await handle(req, deps);
  assertEquals(res.status, 400);
  const resBody = await res.json();
  assertEquals(resBody.error, "Missing recipient");
});

// --- 13. Wrong secret → 401 (HMAC mismatch) ---

Deno.test("signature generated with different secret → 401", async () => {
  const { deps } = makeFakeDeps({ envVars: BASE_ENV_VARS, now: FIXED_NOW_DATE });

  const wrongSecret = btoa("a-completely-different-secret-key");
  const payload = {
    type: "email.bounced",
    created_at: "2026-06-01T12:00:00Z",
    data: { to: ["victim@example.com"] },
  };

  // Sign with wrong secret
  const req = await makeSignedRequest(payload, { secret: wrongSecret });
  const res = await handle(req, deps);
  assertEquals(res.status, 401);
});

// --- 13b. Forged signature of the SAME length → 401 (constant-time compare) ---

Deno.test("forged signature with the same byte length as the real one → 401", async () => {
  const { deps } = makeFakeDeps({ envVars: BASE_ENV_VARS, now: FIXED_NOW_DATE });

  const payload = {
    type: "email.bounced",
    created_at: "2026-06-01T12:00:00Z",
    data: { to: ["victim@example.com"] },
  };
  const rawBody = JSON.stringify(payload);

  // Compute the real signature, then flip its first base64 char so the forgery has the
  // exact same length — this exercises the equal-length branch of constantTimeEqual.
  const real = await signWebhook(TEST_SECRET, WEBHOOK_ID, FIXED_NOW_TS, rawBody);
  const [, realSig] = real.split(",");
  const flipped = (realSig[0] === "A" ? "B" : "A") + realSig.slice(1);
  const forged = `v1,${flipped}`;
  assertEquals(forged.length, real.length, "forged signature must be the same length as the real one");

  const req = await makeSignedRequest(payload, { signatureOverride: forged });
  const res = await handle(req, deps);
  assertEquals(res.status, 401);
});

// --- 14. Multiple v1, signatures — at least one matches → accepted ---

Deno.test("webhook-signature with multiple v1 sigs, one valid → accepted (key rotation)", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: BASE_ENV_VARS,
    now: FIXED_NOW_DATE,
    tables: {
      suppressed_emails: { data: null, error: null },
      email_send_log: { data: null, error: null },
    },
  });

  const payload = {
    type: "email.bounced",
    created_at: "2026-06-01T12:00:00Z",
    data: { email_id: "em_multi_sig_001", to: ["user@example.com"] },
  };
  const rawBody = JSON.stringify(payload);

  // Build two signatures: one wrong, one correct
  const wrongSig = "v1,aW52YWxpZHNpZ25hdHVyZQ==";
  const correctSig = await signWebhook(TEST_SECRET, WEBHOOK_ID, FIXED_NOW_TS, rawBody);

  const req = new Request("http://localhost/fn", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": WEBHOOK_ID,
      "webhook-timestamp": String(FIXED_NOW_TS),
      "webhook-signature": `${wrongSig} ${correctSig}`,
    },
    body: rawBody,
  });

  const res = await handle(req, deps);
  assertEquals(res.status, 200);

  const upsertCall = calls.find(
    (c) => c.table === "suppressed_emails" && c.method === "upsert",
  );
  assertExists(upsertCall);
});

// --- 15. Suppression DB error → 500 ---

Deno.test("VALID signature + DB upsert error → 500", async () => {
  const { deps } = makeFakeDeps({
    envVars: BASE_ENV_VARS,
    now: FIXED_NOW_DATE,
    tables: {
      suppressed_emails: { data: null, error: { message: "DB constraint violation", code: "23505" } },
      email_send_log: { data: null, error: null },
    },
  });

  const payload = {
    type: "email.bounced",
    created_at: "2026-06-01T12:00:00Z",
    data: { email_id: "em_dberr_001", to: ["fail@example.com"] },
  };

  const req = await makeSignedRequest(payload);
  const res = await handle(req, deps);
  assertEquals(res.status, 500);
  const resBody = await res.json();
  assertEquals(resBody.error, "Failed to write suppression");
});

// --- 16. Missing env vars → 500 (before signature check) ---

Deno.test("missing SUPABASE_URL env var → 500 (config error)", async () => {
  const { deps } = makeFakeDeps({
    envVars: { RESEND_WEBHOOK_SECRET: TEST_SECRET }, // missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
    now: FIXED_NOW_DATE,
  });

  const req = new Request("http://localhost/fn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "email.bounced" }),
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 500);
  const resBody = await res.json();
  assertEquals(resBody.error, "Server configuration error");
});

// --- 17. Invalid JSON body (but valid signature) → 400 ---

Deno.test("valid signature over invalid JSON body → 400", async () => {
  const { deps } = makeFakeDeps({ envVars: BASE_ENV_VARS, now: FIXED_NOW_DATE });

  const rawBody = "not-valid-json{{{{";
  const signature = await signWebhook(TEST_SECRET, WEBHOOK_ID, FIXED_NOW_TS, rawBody);

  const req = new Request("http://localhost/fn", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": WEBHOOK_ID,
      "webhook-timestamp": String(FIXED_NOW_TS),
      "webhook-signature": signature,
    },
    body: rawBody,
  });

  const res = await handle(req, deps);
  assertEquals(res.status, 400);
  const resBody = await res.json();
  assertEquals(resBody.error, "Invalid JSON payload");
});
