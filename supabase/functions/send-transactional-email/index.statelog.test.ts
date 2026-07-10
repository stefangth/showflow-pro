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

Deno.test("suppression-check DB error transitions the pending row to 'failed' (not left orphaned)", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: env,
    tables: { suppressed_emails: { data: null, error: { message: "boom" } } },
  });
  const req = makeRequest({ headers: authHeaders, body: { templateName: "artist-offer-digest", recipientEmail: "c@t.test" } });
  const res = await handle(req, deps);
  assertEquals(res.status, 500);

  const logWrites = calls.filter((c) => c.table === "email_send_log");
  assertEquals(logWrites.filter((c) => c.method === "insert").length, 1);
  const updates = logWrites.filter((c) => c.method === "update");
  assertEquals(updates.length, 1);
  assertEquals((updates[0].args[0] as Record<string, unknown>).status, "failed");
  // The update must be keyed by the same message_id the row was inserted with.
  const insertedMessageId = (logWrites.find((c) => c.method === "insert")!.args[0] as Record<string, unknown>).message_id;
  const eqCall = calls.find((c) => c.table === "email_send_log" && c.method === "eq");
  assertEquals(eqCall!.args, ["message_id", insertedMessageId]);
});

Deno.test("unsubscribe token already used but not suppressed transitions the pending row to 'suppressed'", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: env,
    tables: {
      suppressed_emails: { data: null, error: null },
      email_unsubscribe_tokens: { data: { token: "tok", used_at: "2026-01-01T00:00:00.000Z" }, error: null },
    },
  });
  const req = makeRequest({ headers: authHeaders, body: { templateName: "artist-offer-digest", recipientEmail: "d@t.test" } });
  const res = await handle(req, deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body, { success: false, reason: "email_suppressed" });

  const logWrites = calls.filter((c) => c.table === "email_send_log");
  assertEquals(logWrites.filter((c) => c.method === "insert").length, 1);
  const update = logWrites.find((c) => c.method === "update");
  assertEquals((update!.args[0] as Record<string, unknown>).status, "suppressed");
});
