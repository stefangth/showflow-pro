/**
 * Deep DI tests for notify-signup handler.
 *
 * Exercises the documented contract:
 *   - Payload shape: { record } with fallback to payload itself
 *   - Missing record → 400
 *   - record.status !== 'pending' → 200 { skipped: 'not pending' }
 *   - Pending record → sends 'new-signup-admin-notification' to every admin
 *   - Correct templateData (signupName / signupEmail / requestedRole)
 *   - Admin with no email → skipped for email, count unaffected
 *   - sendEmail failure is non-blocking (still 200, count reflects only successes)
 *   - No admins in DB → 200 { ok: true, notified: 0 }
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import type { EmailMessage } from "../_shared/deps.ts";
import { handle } from "./index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ap-001",
    email: "new@example.com",
    display_name: "New User",
    status: "pending",
    requested_role: "artist",
    ...overrides,
  };
}

function twoAdminSetup() {
  return makeFakeDeps({
    usersById: {
      "admin-1": { email: "admin1@example.com" },
      "admin-2": { email: "admin2@example.com" },
    },
    tables: {
      user_roles: {
        data: [
          { user_id: "admin-1", role: "admin" },
          { user_id: "admin-2", role: "admin" },
        ],
        error: null,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// 1. Missing record → 400
// ---------------------------------------------------------------------------

Deno.test("notify-signup/DI: empty body → 400 with error", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ body: {} }), deps);
  assertEquals(res.status, 400);
  const body = await res.json() as Record<string, unknown>;
  assertExists(body.error, "response body should contain 'error' key");
});

Deno.test("notify-signup/DI: record without id → 400", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(
    makeRequest({ body: { record: { email: "x@y.com" } } }),
    deps,
  );
  assertEquals(res.status, 400);
});

Deno.test("notify-signup/DI: record without email → 400", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(
    makeRequest({ body: { record: { id: "ap-001" } } }),
    deps,
  );
  assertEquals(res.status, 400);
});

// ---------------------------------------------------------------------------
// 2. Flat payload fallback (payload.record || payload)
// ---------------------------------------------------------------------------

Deno.test("notify-signup/DI: flat payload (no .record wrapper) is accepted", async () => {
  // Sends the record fields at the top level of the payload — the handler
  // should fall back to `payload` itself when `payload.record` is absent.
  const { deps } = twoAdminSetup();
  const res = await handle(
    makeRequest({ body: makeRecord() }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  // Should have processed normally, not returned 400
  assertExists(body.ok, "flat-payload path should still reach the notify logic");
});

// ---------------------------------------------------------------------------
// 3. Non-pending status → skipped
// ---------------------------------------------------------------------------

Deno.test("notify-signup/DI: status='approved' → 200 { skipped: 'not pending' }", async () => {
  const { deps, invokeCalls } = makeFakeDeps();
  const res = await handle(
    makeRequest({ body: { record: makeRecord({ status: "approved" }) } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  // Confirm exact response shape
  assertEquals(body, { skipped: "not pending" });
  // No emails must have been sent
  assertEquals(invokeCalls.length, 0);
});

Deno.test("notify-signup/DI: status='rejected' → 200 { skipped: 'not pending' }, no emails", async () => {
  const { deps, invokeCalls } = makeFakeDeps();
  const res = await handle(
    makeRequest({ body: { record: makeRecord({ status: "rejected" }) } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body, { skipped: "not pending" });
  assertEquals(invokeCalls.length, 0);
});

// Note: when `status` is absent the handler treats the record as pending
// (the condition is `record.status && record.status !== 'pending'`).
Deno.test("notify-signup/DI: record with no status field is treated as pending", async () => {
  const { deps } = twoAdminSetup();
  const recordNoStatus = makeRecord();
  delete (recordNoStatus as Record<string, unknown>).status;
  const res = await handle(
    makeRequest({ body: { record: recordNoStatus } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body, { ok: true, notified: 2 });
});

// ---------------------------------------------------------------------------
// 4. Pending record: correct template name, templateData, one email per admin
// ---------------------------------------------------------------------------

Deno.test("notify-signup/DI: 2 admins → 2 sendEmail calls with template 'new-signup-admin-notification'", async () => {
  const { deps, invokeCalls } = twoAdminSetup();

  const res = await handle(
    makeRequest({
      body: {
        record: makeRecord({
          id: "ap-001",
          email: "signup@example.com",
          display_name: "Alice",
          status: "pending",
          requested_role: "producer",
        }),
      },
    }),
    deps,
  );

  assertEquals(res.status, 200);
  const responseBody = await res.json() as Record<string, unknown>;
  assertEquals(responseBody, { ok: true, notified: 2 });

  // Two sendEmail calls must have been made (routed via invokeFunction)
  assertEquals(invokeCalls.length, 2);

  // Both calls must target the email function
  for (const call of invokeCalls) {
    assertEquals(call.name, "send-transactional-email");
  }

  // Collect the email messages
  const messages = invokeCalls.map((c) => c.body as EmailMessage);

  // Confirm template name for both
  for (const msg of messages) {
    assertEquals(msg.template_name, "new-signup-admin-notification");
  }

  // Recipients must be the two admin emails (order may vary)
  const recipients = messages.map((m) => m.recipient_email).sort();
  assertEquals(recipients, ["admin1@example.com", "admin2@example.com"]);

  // Confirm templateData for each message
  for (const msg of messages) {
    assertExists(msg.templateData, "templateData must be present");
    assertEquals(msg.templateData!.signupEmail, "signup@example.com");
    assertEquals(msg.templateData!.signupName, "Alice");
    assertEquals(msg.templateData!.requestedRole, "producer");
  }
});

Deno.test("notify-signup/DI: display_name absent → signupName falls back to email", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    usersById: { "admin-1": { email: "admin@example.com" } },
    tables: {
      user_roles: { data: [{ user_id: "admin-1", role: "admin" }], error: null },
    },
  });

  const record = makeRecord({ display_name: undefined, email: "fallback@example.com" });
  delete (record as Record<string, unknown>).display_name;

  await handle(makeRequest({ body: { record } }), deps);

  assertEquals(invokeCalls.length, 1);
  const msg = invokeCalls[0].body as EmailMessage;
  // signupName should be the email when display_name is absent
  assertEquals(msg.templateData!.signupName, "fallback@example.com");
});

Deno.test("notify-signup/DI: requested_role absent → defaults to 'artist' in templateData", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    usersById: { "admin-1": { email: "admin@example.com" } },
    tables: {
      user_roles: { data: [{ user_id: "admin-1", role: "admin" }], error: null },
    },
  });

  const record = makeRecord({ requested_role: undefined });
  delete (record as Record<string, unknown>).requested_role;

  await handle(makeRequest({ body: { record } }), deps);

  assertEquals(invokeCalls.length, 1);
  const msg = invokeCalls[0].body as EmailMessage;
  assertEquals(msg.templateData!.requestedRole, "artist");
});

Deno.test("notify-signup/DI: idempotency_key is signup-<record.id>-<admin.id>", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    usersById: { "admin-abc": { email: "admin@example.com" } },
    tables: {
      user_roles: { data: [{ user_id: "admin-abc", role: "admin" }], error: null },
    },
  });

  await handle(
    makeRequest({ body: { record: makeRecord({ id: "ap-xyz" }) } }),
    deps,
  );

  assertEquals(invokeCalls.length, 1);
  const msg = invokeCalls[0].body as EmailMessage;
  assertEquals(msg.idempotency_key, "signup-ap-xyz-admin-abc");
});

// ---------------------------------------------------------------------------
// 5. Admin with no email → skipped for email, notified count reflects only
//    admins that actually have an email address
// ---------------------------------------------------------------------------

Deno.test("notify-signup/DI: admin without email → skipped, notified count = 1 (not 2)", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    usersById: {
      "admin-1": { email: "admin1@example.com" },
      "admin-2": {}, // no email
    },
    tables: {
      user_roles: {
        data: [
          { user_id: "admin-1", role: "admin" },
          { user_id: "admin-2", role: "admin" },
        ],
        error: null,
      },
    },
  });

  const res = await handle(
    makeRequest({ body: { record: makeRecord() } }),
    deps,
  );

  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  // Only 1 admin had an email; notified should reflect that
  assertEquals(body, { ok: true, notified: 1 });
  assertEquals(invokeCalls.length, 1);
  const msg = invokeCalls[0].body as EmailMessage;
  assertEquals(msg.recipient_email, "admin1@example.com");
});

// ---------------------------------------------------------------------------
// 6. sendEmail failure is non-blocking
// ---------------------------------------------------------------------------

Deno.test("notify-signup/DI: sendEmail throws for one admin → still 200, notified = 1 (other succeeded)", async () => {
  // Build deps manually so we can override sendEmail to throw for the first admin.
  const base = twoAdminSetup();

  let callCount = 0;
  const invokeCalls: Array<{ name: string; body: unknown }> = [];

  const throwingDeps = {
    ...base.deps,
    sendEmail: async (msg: EmailMessage) => {
      callCount++;
      invokeCalls.push({ name: "send-transactional-email", body: msg });
      if (callCount === 1) {
        throw new Error("SMTP timeout");
      }
      return { data: null, error: null };
    },
  };

  const res = await handle(
    makeRequest({ body: { record: makeRecord() } }),
    throwingDeps,
  );

  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  // Both admins were attempted; only the second succeeded
  assertEquals(body, { ok: true, notified: 1 });
  // Both calls were still attempted
  assertEquals(callCount, 2);
});

Deno.test("notify-signup/DI: all sendEmail calls throw → 200 { ok: true, notified: 0 }", async () => {
  const base = twoAdminSetup();

  const throwingDeps = {
    ...base.deps,
    sendEmail: async (_msg: EmailMessage) => {
      throw new Error("email service down");
    },
  };

  const res = await handle(
    makeRequest({ body: { record: makeRecord() } }),
    throwingDeps,
  );

  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body, { ok: true, notified: 0 });
});

// ---------------------------------------------------------------------------
// 7. No admins in DB → 200 { ok: true, notified: 0 }
// ---------------------------------------------------------------------------

Deno.test("notify-signup/DI: no admins in user_roles → 200 { ok: true, notified: 0 }", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    usersById: {},
    tables: { user_roles: { data: [], error: null } },
  });

  const res = await handle(
    makeRequest({ body: { record: makeRecord() } }),
    deps,
  );

  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body, { ok: true, notified: 0 });
  assertEquals(invokeCalls.length, 0);
});

// ---------------------------------------------------------------------------
// 8. OPTIONS → preflight (already in smoke test, included for completeness)
// ---------------------------------------------------------------------------

Deno.test("notify-signup/DI: OPTIONS → 200 or 204", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});
