import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const ENV = {
  SUPABASE_URL: "http://localhost",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  RESEND_API_KEY: "re_test",
};

Deno.test("skips send when the recipient disabled the template's category", async () => {
  const { deps } = makeFakeDeps({
    envVars: ENV,
    usersById: { "u1": { email: "artist@x.com" } },
    tables: {
      suppressed_emails: { data: null, error: null },
      profiles: { data: { user_id: "u1" }, error: null },
      email_send_log: { data: null, error: null },
    },
    rpcs: { should_notify: { data: false, error: null } },
  });
  const req = makeRequest({
    headers: { "content-type": "application/json" },
    body: { templateName: "artist-offer-digest", recipientEmail: "artist@x.com" },
  });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).reason, "pref_disabled");
});

Deno.test("critical template (no category) always proceeds past the gate", async () => {
  const { deps } = makeFakeDeps({
    envVars: ENV,
    tables: {
      suppressed_emails: { data: null, error: null },
      email_unsubscribe_tokens: { data: { token: "tok", used_at: null }, error: null },
      email_send_log: { data: null, error: null },
    },
    rpcs: { should_notify: { data: false, error: null } },
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ id: "re_1" }), { status: 200 })),
  });
  const req = makeRequest({
    headers: { "content-type": "application/json" },
    body: { templateName: "org-invitation", recipientEmail: "x@x.com", templateData: { inviteUrl: "https://x", orgName: "X" } },
  });
  const res = await handle(req, deps);
  const body = await res.json();
  assertEquals(body.reason === "pref_disabled", false);
});
