import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

// suppressed_emails is keyed by `email` and has NO `id` column
// (see 20260710231816_email_delivery_tables.sql).
const SUPPRESSED_EMAILS_COLUMNS = ["email", "reason", "metadata", "created_at"];

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

Deno.test("pending insert failure fails closed — refuses to send unlogged (no Resend call)", async () => {
  let fetchCalls = 0;
  const { deps, calls } = makeFakeDeps({
    envVars: env,
    tables: {
      email_send_log: { data: null, error: { message: "boom" } },
      suppressed_emails: { data: null, error: null },
      email_unsubscribe_tokens: { data: { token: "tok", used_at: null }, error: null },
      app_settings: { data: [], error: null },
    },
    fetchImpl: () => {
      fetchCalls++;
      return Promise.resolve(new Response(JSON.stringify({ id: "resend_123" }), { status: 200 }));
    },
  });
  const req = makeRequest({ headers: authHeaders, body: { templateName: "artist-offer-digest", recipientEmail: "e@t.test" } });
  const res = await handle(req, deps);
  assertEquals(res.status, 500);

  // Never sent via Resend — the pending row never landed, so a send would be unlogged.
  assertEquals(fetchCalls, 0);
  // Only the failed pending insert — no update ever reaches email_send_log (nothing to key it by).
  const logWrites = calls.filter((c) => c.table === "email_send_log");
  assertEquals(logWrites.filter((c) => c.method === "insert").length, 1);
  assertEquals(logWrites.filter((c) => c.method === "update").length, 0);
});

Deno.test("suppressed address updates the pending row to 'suppressed' (no second insert)", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: env,
    tables: { suppressed_emails: { data: { email: "b@t.test" }, error: null } },
  });
  const req = makeRequest({ headers: authHeaders, body: { templateName: "artist-offer-digest", recipientEmail: "b@t.test" } });
  await handle(req, deps);
  const logWrites = calls.filter((c) => c.table === "email_send_log");
  assertEquals(logWrites.filter((c) => c.method === "insert").length, 1);
  assertEquals((logWrites.find((c) => c.method === "update")!.args[0] as Record<string, unknown>).status, "suppressed");
});

Deno.test("suppression check selects only columns that exist in suppressed_emails (regression: no 'id' column)", async () => {
  // Regression for "column suppressed_emails.id does not exist": the fail-closed
  // suppression check selected a non-existent `id` column, so every send errored out.
  const { deps, calls } = makeFakeDeps({
    envVars: env,
    tables: { suppressed_emails: { data: null, error: null } },
  });
  const req = makeRequest({ headers: authHeaders, body: { templateName: "artist-offer-digest", recipientEmail: "d@t.test" } });
  await handle(req, deps);

  const select = calls.find((c) => c.table === "suppressed_emails" && c.method === "select");
  assertExists(select, "suppression check must SELECT from suppressed_emails");
  const requested = String(select!.args[0]).split(",").map((s) => s.trim());
  for (const col of requested) {
    assertEquals(
      SUPPRESSED_EMAILS_COLUMNS.includes(col),
      true,
      `select('${col}') references a column not in suppressed_emails`,
    );
  }
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
