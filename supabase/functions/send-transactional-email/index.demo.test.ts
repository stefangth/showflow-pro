/**
 * Demo-mode divert tests for send-transactional-email/index.ts.
 *
 * When the target org is a demo org (`organizations.is_demo = true`), the handler must:
 *  - NOT call Resend (no outbound delivery for demo orgs, ever)
 *  - write exactly one `demo_captured_sends` row capturing the rendered artifact
 *  - transition the pending `email_send_log` row to 'sent'
 *  - return the same `{ success: true, message_id }` 200 shape a real send returns,
 *    so every caller's `emailWasSent(...)` behaves exactly as for a real send.
 *
 * A non-demo org (or no org_id at all) must be completely unaffected — this is
 * asserted alongside the demo-diverting test so a regression in either direction
 * fails loudly.
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

// send-transactional-email requires the service-role bearer (isServiceRole gate).
const authedReq = (o: Parameters<typeof makeRequest>[0] = {}) =>
  makeRequest({ ...o, headers: { Authorization: "Bearer service_role_svc", ...(o.headers ?? {}) } });

const ENV = {
  RESEND_API_KEY: "re_test_key",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_role_svc",
};

// A real registered template name (from registry.ts).
const KNOWN_TEMPLATE = "artist-offer-digest";

function baseTables(overrides: Record<string, unknown> = {}) {
  return {
    suppressed_emails: { data: null, error: null },
    email_unsubscribe_tokens: { data: { token: "existing_token_abc123", used_at: null }, error: null },
    app_settings: { data: null, error: null },
    email_send_log: { data: null, error: null },
    ...overrides,
  };
}

function recordingFetch(): { fetchImpl: typeof fetch; resendCalled: () => boolean } {
  let resendCalled = false;
  const fetchImpl = ((...args: Parameters<typeof fetch>) => {
    const [url] = args;
    if (String(url).includes("api.resend.com")) resendCalled = true;
    return Promise.resolve(new Response(JSON.stringify({ id: "re_should_not_happen" }), { status: 200 }));
  }) as typeof fetch;
  return { fetchImpl, resendCalled: () => resendCalled };
}

Deno.test("send-transactional-email: demo org diverts to capture, no Resend", async () => {
  const { fetchImpl, resendCalled } = recordingFetch();
  const { deps, calls } = makeFakeDeps({
    envVars: ENV,
    fetchImpl,
    tables: baseTables({
      organizations: { data: { is_demo: true }, error: null },
    }),
  });

  const res = await handle(
    authedReq({
      body: {
        template_name: KNOWN_TEMPLATE,
        recipient_email: "artist@demo.invalid",
        org_id: "org-demo-1",
        templateData: {},
      },
    }),
    deps,
  );

  assertEquals(resendCalled(), false, "Resend must not be called for a demo org");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true, "response must still report success");
  assertExists(body.message_id, "response must still carry a message_id");

  const captured = calls.filter((c) => c.table === "demo_captured_sends" && c.method === "insert");
  assertEquals(captured.length, 1, "expected exactly one demo_captured_sends insert");

  const capturedRow = captured[0].args[0] as {
    org_id?: string;
    kind?: string;
    to_label?: string;
    subject?: string;
    preview_html?: string;
  };
  assertEquals(capturedRow.org_id, "org-demo-1");
  assertEquals(capturedRow.kind, "email", "no attachments on this request -> kind 'email'");
  assertEquals(capturedRow.to_label, "artist@demo.invalid");
  assertExists(capturedRow.subject);
  assertExists(capturedRow.preview_html);

  // The pending email_send_log row must still be transitioned to 'sent', exactly
  // like the real-send path, so monitoring never sees a stuck 'pending' row.
  const logUpdates = calls.filter((c) => c.table === "email_send_log" && c.method === "update");
  const sentUpdate = logUpdates.find((c) => (c.args[0] as { status?: string })?.status === "sent");
  assertExists(sentUpdate, "expected email_send_log to be transitioned to 'sent'");
});

Deno.test("send-transactional-email: demo org with attachments captures kind 'pdf'", async () => {
  const { fetchImpl, resendCalled } = recordingFetch();
  const { deps, calls } = makeFakeDeps({
    envVars: ENV,
    fetchImpl,
    tables: baseTables({
      organizations: { data: { is_demo: true }, error: null },
    }),
  });

  const res = await handle(
    authedReq({
      body: {
        template_name: KNOWN_TEMPLATE,
        recipient_email: "artist@demo.invalid",
        org_id: "org-demo-1",
        templateData: {},
        attachments: [{ filename: "order.pdf", content_base64: "AAAA" }],
      },
    }),
    deps,
  );

  assertEquals(resendCalled(), false, "Resend must not be called for a demo org");
  assertEquals(res.status, 200);

  const captured = calls.filter((c) => c.table === "demo_captured_sends" && c.method === "insert");
  assertEquals(captured.length, 1);
  const capturedRow = captured[0].args[0] as { kind?: string };
  assertEquals(capturedRow.kind, "pdf", "attachment present -> kind 'pdf'");
});

Deno.test("send-transactional-email: non-demo org sends via Resend as normal, no capture", async () => {
  const { fetchImpl, resendCalled } = recordingFetch();
  const { deps, calls } = makeFakeDeps({
    envVars: ENV,
    fetchImpl,
    tables: baseTables({
      organizations: { data: { is_demo: false }, error: null },
    }),
  });

  const res = await handle(
    authedReq({
      body: {
        template_name: KNOWN_TEMPLATE,
        recipient_email: "artist@real.test",
        org_id: "org-real-1",
        templateData: {},
      },
    }),
    deps,
  );

  assertEquals(resendCalled(), true, "Resend must still be called for a non-demo org");
  assertEquals(res.status, 200);

  const captured = calls.filter((c) => c.table === "demo_captured_sends");
  assertEquals(captured.length, 0, "no capture rows for a non-demo org");
});

Deno.test("send-transactional-email: no org_id sends via Resend as normal (unaffected)", async () => {
  const { fetchImpl, resendCalled } = recordingFetch();
  const { deps, calls } = makeFakeDeps({
    envVars: ENV,
    fetchImpl,
    tables: baseTables(),
  });

  const res = await handle(
    authedReq({
      body: {
        template_name: KNOWN_TEMPLATE,
        recipient_email: "artist@real.test",
        templateData: {},
      },
    }),
    deps,
  );

  assertEquals(resendCalled(), true, "Resend must still be called when there is no org_id");
  assertEquals(res.status, 200);

  const captured = calls.filter((c) => c.table === "demo_captured_sends");
  assertEquals(captured.length, 0, "no capture rows without an org_id");
});
