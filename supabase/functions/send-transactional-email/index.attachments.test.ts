/**
 * Task 10: attachment forwarding to Resend.
 *
 * Contract (see task-10-brief.md):
 *  - Present `attachments` ({ filename, content_base64 }[]) are forwarded to Resend
 *    mapped to { filename, content } (Resend's field is `content`, base64).
 *  - Absent `attachments` → the key is omitted entirely from the Resend body (must
 *    not break any pre-Task-10 send — no `attachments: undefined` leaking through
 *    either, since that would still change the JSON shape).
 *  - >2 attachments → 400 { error: "attachment_too_large" }, no Resend call.
 *  - Any single decoded attachment payload >5MB → 400 { error: "attachment_too_large" },
 *    no Resend call.
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const authedReq = (o: Parameters<typeof makeRequest>[0] = {}) =>
  makeRequest({ ...o, headers: { Authorization: "Bearer service_role_svc", ...(o.headers ?? {}) } });

const ENV = {
  RESEND_API_KEY: "re_test_key",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_role_svc",
};

const KNOWN_TEMPLATE = "artist-offer-digest";

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

function happyPathTables() {
  return {
    suppressed_emails: { data: null, error: null },
    email_unsubscribe_tokens: { data: { token: "existing_token_abc123", used_at: null }, error: null },
    app_settings: { data: null, error: null },
    email_send_log: { data: null, error: null },
  };
}

/** A base64 string that decodes to exactly `bytes` bytes. Full 3-byte groups need no
 * padding (4 chars each); a trailing 1- or 2-byte remainder is encoded with the real
 * padding pattern ("AAA=" / "AA==") so a length-based byte-size calculation that
 * accounts for padding gets the exact right answer, same as a real base64 payload. */
function fakeBase64OfSize(bytes: number): string {
  const fullGroups = Math.floor(bytes / 3);
  const remainder = bytes % 3;
  const head = "A".repeat(fullGroups * 4);
  const tail = remainder === 1 ? "AA==" : remainder === 2 ? "AAA=" : "";
  return head + tail;
}

// ===========================================================================
// Forwarding: present attachments are mapped and sent to Resend
// ===========================================================================

Deno.test("attachments: forwarded to Resend body as [{ filename, content }]", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  const res = await handle(
    authedReq({
      body: {
        templateName: KNOWN_TEMPLATE,
        recipientEmail: "attach@test.com",
        attachments: [{ filename: "order.pdf", content_base64: "aGVsbG8=" }],
      },
    }),
    deps,
  );
  assertEquals(res.status, 200, `Expected 200; got ${res.status}: ${JSON.stringify(await res.clone().json())}`);
  const resendCall = fetchCalls.find((c) => c.url.includes("resend.com"));
  assertExists(resendCall, "Expected a fetch call to api.resend.com");
  const init = resendCall!.init as RequestInit & { body?: string };
  const sentBody = JSON.parse(init.body ?? "{}");
  assertEquals(
    sentBody.attachments,
    [{ filename: "order.pdf", content: "aGVsbG8=" }],
    "Resend body.attachments must be [{ filename, content }] with content_base64 mapped to content",
  );
});

Deno.test("attachments: two attachments are both forwarded, order preserved", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  const res = await handle(
    authedReq({
      body: {
        templateName: KNOWN_TEMPLATE,
        recipientEmail: "attach2@test.com",
        attachments: [
          { filename: "order.pdf", content_base64: "aGVsbG8=" },
          { filename: "terms.pdf", content_base64: "d29ybGQ=" },
        ],
      },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const resendCall = fetchCalls.find((c) => c.url.includes("resend.com"));
  const init = resendCall!.init as RequestInit & { body?: string };
  const sentBody = JSON.parse(init.body ?? "{}");
  assertEquals(sentBody.attachments, [
    { filename: "order.pdf", content: "aGVsbG8=" },
    { filename: "terms.pdf", content: "d29ybGQ=" },
  ]);
});

// ===========================================================================
// Omission: no attachments field at all when absent (existing behavior preserved)
// ===========================================================================

Deno.test("attachments: key is omitted entirely from Resend body when absent", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "noattach@test.com" },
    }),
    deps,
  );
  const resendCall = fetchCalls.find((c) => c.url.includes("resend.com"));
  assertExists(resendCall, "Expected a fetch call to api.resend.com");
  const init = resendCall!.init as RequestInit & { body?: string };
  const sentBody = JSON.parse(init.body ?? "{}");
  assertEquals("attachments" in sentBody, false, "attachments key must not be present when no attachments were sent");
});

// ===========================================================================
// Rejection: >2 attachments
// ===========================================================================

Deno.test("attachments: more than 2 attachments → 400 attachment_too_large, no Resend call", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  const res = await handle(
    authedReq({
      body: {
        templateName: KNOWN_TEMPLATE,
        recipientEmail: "toomany@test.com",
        attachments: [
          { filename: "a.pdf", content_base64: "aGVsbG8=" },
          { filename: "b.pdf", content_base64: "aGVsbG8=" },
          { filename: "c.pdf", content_base64: "aGVsbG8=" },
        ],
      },
    }),
    deps,
  );
  assertEquals(res.status, 400, `Expected 400; got ${res.status}`);
  const body = await res.json();
  assertEquals(body.error, "attachment_too_large");
  assertEquals(fetchCalls.length, 0, "Resend must NOT be called when the attachment count is rejected");
});

Deno.test("attachments: exactly 2 attachments (boundary) is allowed", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  const res = await handle(
    authedReq({
      body: {
        templateName: KNOWN_TEMPLATE,
        recipientEmail: "twoattach@test.com",
        attachments: [
          { filename: "a.pdf", content_base64: "aGVsbG8=" },
          { filename: "b.pdf", content_base64: "aGVsbG8=" },
        ],
      },
    }),
    deps,
  );
  assertEquals(res.status, 200, `Expected 200 for exactly 2 attachments; got ${res.status}`);
  assertEquals(fetchCalls.length, 1);
});

// ===========================================================================
// Rejection: any single decoded payload >5MB
// ===========================================================================

Deno.test("attachments: a single attachment decoding to >5MB → 400 attachment_too_large, no Resend call", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  const oversized = fakeBase64OfSize(6 * 1024 * 1024); // 6MB decoded, well over the 5MB cap
  const res = await handle(
    authedReq({
      body: {
        templateName: KNOWN_TEMPLATE,
        recipientEmail: "huge@test.com",
        attachments: [{ filename: "huge.pdf", content_base64: oversized }],
      },
    }),
    deps,
  );
  assertEquals(res.status, 400, `Expected 400; got ${res.status}`);
  const body = await res.json();
  assertEquals(body.error, "attachment_too_large");
  assertEquals(fetchCalls.length, 0, "Resend must NOT be called when an attachment is rejected for size");
});

Deno.test("attachments: a single attachment at exactly 5MB (boundary) is allowed", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  const atLimit = fakeBase64OfSize(5 * 1024 * 1024); // exactly 5MB decoded (has a real padded tail)
  const res = await handle(
    authedReq({
      body: {
        templateName: KNOWN_TEMPLATE,
        recipientEmail: "atlimit@test.com",
        attachments: [{ filename: "atlimit.pdf", content_base64: atLimit }],
      },
    }),
    deps,
  );
  assertEquals(res.status, 200, `Expected 200 for an attachment at exactly the 5MB boundary; got ${res.status}`);
  assertEquals(fetchCalls.length, 1);
});

// ===========================================================================
// Rejection: malformed attachment (missing/non-string content_base64 or filename)
// ===========================================================================

Deno.test("attachments: a malformed attachment (missing content_base64) → 400 attachment_invalid, no Resend call", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  const res = await handle(
    authedReq({
      body: {
        templateName: KNOWN_TEMPLATE,
        recipientEmail: "malformed@test.com",
        attachments: [{ filename: "order.pdf" }],
      },
    }),
    deps,
  );
  assertEquals(res.status, 400, `Expected 400; got ${res.status}`);
  const body = await res.json();
  assertEquals(body.error, "attachment_invalid");
  assertEquals(fetchCalls.length, 0, "Resend must NOT be called when an attachment is malformed");
});

Deno.test("attachments: an attachment with a non-string content_base64 → 400 attachment_invalid, no Resend call", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  const res = await handle(
    authedReq({
      body: {
        templateName: KNOWN_TEMPLATE,
        recipientEmail: "wrongtype@test.com",
        attachments: [{ filename: "order.pdf", content_base64: 12345 }],
      },
    }),
    deps,
  );
  assertEquals(res.status, 400, `Expected 400; got ${res.status}`);
  const body = await res.json();
  assertEquals(body.error, "attachment_invalid");
  assertEquals(fetchCalls.length, 0);
});

Deno.test("attachments: an attachment with an empty filename → 400 attachment_invalid, no Resend call", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  const res = await handle(
    authedReq({
      body: {
        templateName: KNOWN_TEMPLATE,
        recipientEmail: "emptyname@test.com",
        attachments: [{ filename: "", content_base64: "aGVsbG8=" }],
      },
    }),
    deps,
  );
  assertEquals(res.status, 400, `Expected 400; got ${res.status}`);
  const body = await res.json();
  assertEquals(body.error, "attachment_invalid");
  assertEquals(fetchCalls.length, 0);
});

Deno.test("attachments: rejection happens before email_send_log is touched (no pending row written)", async () => {
  const { fetchImpl } = recordingFetch();
  const { deps, calls } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  await handle(
    authedReq({
      body: {
        templateName: KNOWN_TEMPLATE,
        recipientEmail: "prevalidate@test.com",
        attachments: [
          { filename: "a.pdf", content_base64: "aGVsbG8=" },
          { filename: "b.pdf", content_base64: "aGVsbG8=" },
          { filename: "c.pdf", content_base64: "aGVsbG8=" },
        ],
      },
    }),
    deps,
  );
  const logInserts = calls.filter((c) => c.table === "email_send_log" && c.method === "insert");
  assertEquals(logInserts.length, 0, "Expected no email_send_log insert for a request rejected on attachment validation");
});
