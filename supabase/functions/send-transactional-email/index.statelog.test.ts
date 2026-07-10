import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const svc = "svc-key";
const authHeaders = { Authorization: `Bearer ${svc}` };
const env = { SUPABASE_URL: "http://sb.test", SUPABASE_SERVICE_ROLE_KEY: svc, RESEND_API_KEY: "re_test" };

Deno.test("logs one row transitioning pending → sent with resend_id", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: env,
    tables: {
      suppressed_emails: { data: null, error: null },
      email_unsubscribe_tokens: { data: { token: "tok", used_at: null }, error: null },
      app_settings: { data: [], error: null },
    },
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ id: "resend_123" }), { status: 200 })),
  });
  const req = makeRequest({ headers: authHeaders, body: { templateName: "artist-offer-digest", recipientEmail: "a@t.test" } });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);

  const logWrites = calls.filter((c) => c.table === "email_send_log");
  // one insert (pending) + one update (sent) — never two inserts.
  assertEquals(logWrites.filter((c) => c.method === "insert").length, 1);
  const update = logWrites.find((c) => c.method === "update");
  assertEquals((update!.args[0] as Record<string, unknown>).status, "sent");
  assertEquals((update!.args[0] as Record<string, unknown>).resend_id, "resend_123");
});

Deno.test("suppressed address updates the pending row to 'suppressed' (no second insert)", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: env,
    tables: { suppressed_emails: { data: { id: "x" }, error: null } },
  });
  const req = makeRequest({ headers: authHeaders, body: { templateName: "artist-offer-digest", recipientEmail: "b@t.test" } });
  await handle(req, deps);
  const logWrites = calls.filter((c) => c.table === "email_send_log");
  assertEquals(logWrites.filter((c) => c.method === "insert").length, 1);
  assertEquals((logWrites.find((c) => c.method === "update")!.args[0] as Record<string, unknown>).status, "suppressed");
});
