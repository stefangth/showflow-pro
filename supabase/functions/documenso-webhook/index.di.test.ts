import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

// ── fixtures ─────────────────────────────────────────────────────────────

const SECRET = "whsec_test_secret";
const ENVELOPE_ID = "env-abc123";

/** A hire_orders row shaped as the handler's select returns it (show_dates + shows embedded). */
function issuedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "ho-1",
    org_id: "org-1",
    status: "issued",
    order_no: "HO-2026-0101-001",
    show_date_id: "sd-1",
    show_dates: { city_id: "city-1", shows: { program: "Aida", sub_program: null } },
    ...overrides,
  };
}

function documentCompletedBody(envelopeId: string = ENVELOPE_ID) {
  return {
    event: "DOCUMENT_COMPLETED",
    payload: { id: 42, envelopeId, status: "COMPLETED" },
    createdAt: "2026-07-18T12:00:00.000Z",
    webhookEndpoint: "https://app.test/functions/v1/documenso-webhook",
  };
}

/** A document.completed payload with NO envelopeId key at all (not just falsy). */
function documentCompletedBodyMissingEnvelopeId() {
  return {
    event: "DOCUMENT_COMPLETED",
    payload: { id: 42, status: "COMPLETED" },
    createdAt: "2026-07-18T12:00:00.000Z",
    webhookEndpoint: "https://app.test/functions/v1/documenso-webhook",
  };
}

// ── secret gate ──────────────────────────────────────────────────────────

Deno.test("missing X-Documenso-Secret header -> 401 with zero db access", async () => {
  const { deps, calls } = makeFakeDeps({ envVars: { DOCUMENSO_WEBHOOK_SECRET: SECRET } });
  const res = await handle(makeRequest({ body: documentCompletedBody() }), deps);
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0, "handler must not touch the db before the secret check passes");
});

Deno.test("wrong X-Documenso-Secret header -> 401 with zero db access", async () => {
  const { deps, calls } = makeFakeDeps({ envVars: { DOCUMENSO_WEBHOOK_SECRET: SECRET } });
  const res = await handle(
    makeRequest({ headers: { "X-Documenso-Secret": "not-the-secret" }, body: documentCompletedBody() }),
    deps,
  );
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("secret not configured on the server -> 401 (fail closed) even with a header", async () => {
  const { deps, calls } = makeFakeDeps({ envVars: {} });
  const res = await handle(
    makeRequest({ headers: { "X-Documenso-Secret": "anything" }, body: documentCompletedBody() }),
    deps,
  );
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

// ── document.completed -> countersigned ─────────────────────────────────

Deno.test("document.completed for a known envelope id on an issued order countersigns it and notifies producers", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: { DOCUMENSO_WEBHOOK_SECRET: SECRET },
    now: new Date("2026-07-18T15:30:00.000Z"),
    tables: { hire_orders: { data: issuedOrder() } },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "p1" }] } },
  });

  const res = await handle(
    makeRequest({ headers: { "X-Documenso-Secret": SECRET }, body: documentCompletedBody() }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.countersigned, true);

  const update = calls.find((c) => c.table === "hire_orders" && c.method === "update");
  assert(update, "expected a hire_orders update");
  const patch = update!.args[0] as { status: string; countersigned_at: string };
  assertEquals(patch.status, "countersigned");
  assertEquals(patch.countersigned_at, "2026-07-18T15:30:00.000Z");

  const notifInserts = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(notifInserts.length, 1, "producer notification inserted exactly once");
  const rows = notifInserts[0].args[0] as Array<
    { type: string; user_id: string; related_entity_type: string; related_entity_id: string }
  >;
  assert(rows.every((r) => r.type === "hire_order_countersigned"));
  assert(rows.some((r) => r.user_id === "p1"), "notifies the resolved producer");
  assert(rows.every((r) => r.related_entity_type === "hire_order" && r.related_entity_id === "ho-1"));
});

Deno.test("document.completed falls back to org admins when no producer resolves", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: { DOCUMENSO_WEBHOOK_SECRET: SECRET },
    tables: {
      hire_orders: { data: issuedOrder() },
      org_memberships: { data: [{ user_id: "admin-1" }] },
    },
    rpcs: { resolve_show_assignments: { data: [] } },
  });

  const res = await handle(
    makeRequest({ headers: { "X-Documenso-Secret": SECRET }, body: documentCompletedBody() }),
    deps,
  );
  assertEquals(res.status, 200);

  const notifInserts = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(notifInserts.length, 1);
  const rows = notifInserts[0].args[0] as Array<{ user_id: string }>;
  assert(rows.some((r) => r.user_id === "admin-1"), "falls back to notifying org admins");
});

Deno.test("unknown envelope id -> 200 ignored, no status change", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: { DOCUMENSO_WEBHOOK_SECRET: SECRET },
    tables: { hire_orders: { data: null, error: null } },
  });

  const res = await handle(
    makeRequest({ headers: { "X-Documenso-Secret": SECRET }, body: documentCompletedBody("env-does-not-exist") }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ignored, true);
  assertEquals(calls.filter((c) => c.method === "update").length, 0, "no order was touched");
});

Deno.test("duplicate delivery (already countersigned) is an idempotent no-op", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: { DOCUMENSO_WEBHOOK_SECRET: SECRET },
    tables: { hire_orders: { data: issuedOrder({ status: "countersigned" }) } },
  });

  const res = await handle(
    makeRequest({ headers: { "X-Documenso-Secret": SECRET }, body: documentCompletedBody() }),
    deps,
  );
  assertEquals(res.status, 200);

  assertEquals(calls.filter((c) => c.table === "hire_orders" && c.method === "update").length, 0, "no re-stamp");
  assertEquals(calls.filter((c) => c.table === "notifications" && c.method === "insert").length, 0, "no second notification");
});

Deno.test("other event types are ignored without touching the db", async () => {
  const { deps, calls } = makeFakeDeps({ envVars: { DOCUMENSO_WEBHOOK_SECRET: SECRET } });
  const res = await handle(
    makeRequest({
      headers: { "X-Documenso-Secret": SECRET },
      body: { event: "DOCUMENT_SIGNED", payload: { id: 42, envelopeId: ENVELOPE_ID } },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ignored, true);
  assertEquals(calls.length, 0, "an event we don't act on must not touch the db");
});

Deno.test("document.completed with no envelope id in the payload is ignored", async () => {
  const { deps, calls } = makeFakeDeps({ envVars: { DOCUMENSO_WEBHOOK_SECRET: SECRET } });
  const res = await handle(
    makeRequest({ headers: { "X-Documenso-Secret": SECRET }, body: documentCompletedBodyMissingEnvelopeId() }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ignored, true);
  assertEquals(calls.length, 0);
});

// ── CORS ─────────────────────────────────────────────────────────────────

Deno.test("OPTIONS returns a CORS preflight response without requiring the secret", async () => {
  const { deps, calls } = makeFakeDeps({ envVars: {} });
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status, 204);
  assertEquals(calls.length, 0);
});
