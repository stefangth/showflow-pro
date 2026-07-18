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

Deno.test("document.completed for an issued order with no show_date_id (manual order) countersigns and falls back to org admins", async () => {
  // A manual/import order has no linked show_date, so show_dates comes back null
  // from the embedded select. resolve_show_assignments is left unseeded (defaults
  // to { data: null, error: null }) and we assert it is never even called -- the
  // handler must skip straight to the org-admin fallback rather than reaching for
  // a show_date that doesn't exist.
  const { deps, calls } = makeFakeDeps({
    envVars: { DOCUMENSO_WEBHOOK_SECRET: SECRET },
    now: new Date("2026-07-18T15:30:00.000Z"),
    tables: {
      hire_orders: { data: issuedOrder({ show_date_id: null, show_dates: null }) },
      org_memberships: { data: [{ user_id: "admin-1" }] },
    },
  });

  const res = await handle(
    makeRequest({ headers: { "X-Documenso-Secret": SECRET }, body: documentCompletedBody() }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).countersigned, true);

  const update = calls.find((c) => c.table === "hire_orders" && c.method === "update");
  assert(update, "expected a hire_orders update even for an unlinked order");
  const patch = update!.args[0] as { status: string; countersigned_at: string };
  assertEquals(patch.status, "countersigned");
  assertEquals(patch.countersigned_at, "2026-07-18T15:30:00.000Z");

  assertEquals(
    calls.filter((c) => c.table === "rpc:resolve_show_assignments").length,
    0,
    "resolve_show_assignments must not be called when the order has no show_date",
  );

  const notifInserts = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(notifInserts.length, 1, "producer notification inserted exactly once");
  const rows = notifInserts[0].args[0] as Array<{ user_id: string; type: string }>;
  assert(rows.some((r) => r.user_id === "admin-1"), "falls back to notifying org admins for an unlinked order");
  assert(rows.every((r) => r.type === "hire_order_countersigned"));
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

Deno.test("second concurrent document.completed delivery for the same order does not double-notify (atomic conditional update)", async () => {
  // Two near-simultaneous DOCUMENT_COMPLETED deliveries for the same envelope.
  // Each delivery gets its own read of the db (independent fake deps, modeling
  // two separate HTTP requests hitting two separate db snapshots): the FIRST
  // delivery's conditional .eq("status", "issued") update matches the row and
  // transitions + notifies exactly once. The SECOND delivery's read still shows
  // "issued" (its read happened before the first delivery's write committed),
  // but by the time its own conditional update runs, the row has already been
  // flipped by the first delivery, so the update matches zero rows and the
  // handler must treat that as an idempotent no-op instead of notifying again.

  // First delivery: normal success path.
  const first = makeFakeDeps({
    envVars: { DOCUMENSO_WEBHOOK_SECRET: SECRET },
    now: new Date("2026-07-18T15:30:00.000Z"),
    tables: { hire_orders: { data: issuedOrder() } },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "p1" }] } },
  });
  const firstRes = await handle(
    makeRequest({ headers: { "X-Documenso-Secret": SECRET }, body: documentCompletedBody() }),
    first.deps,
  );
  assertEquals(firstRes.status, 200);
  assertEquals((await firstRes.json()).countersigned, true);
  assertEquals(
    first.calls.filter((c) => c.table === "notifications" && c.method === "insert").length,
    1,
    "the first delivery notifies exactly once",
  );

  // Second (losing) delivery: same order, but the conditional update affects
  // zero rows because the first delivery already won the race. The `__write`
  // match key (see _shared/testing.ts) distinguishes the update-then-select
  // from the plain read that precedes it, even though both target the same
  // table with an otherwise-identical seed.
  const second = makeFakeDeps({
    envVars: { DOCUMENSO_WEBHOOK_SECRET: SECRET },
    tables: {
      hire_orders: [
        { when: { __write: true }, data: [] },
        { when: {}, data: issuedOrder() },
      ],
    },
  });
  const secondRes = await handle(
    makeRequest({ headers: { "X-Documenso-Secret": SECRET }, body: documentCompletedBody() }),
    second.deps,
  );
  assertEquals(secondRes.status, 200);
  const secondBody = await secondRes.json();
  assertEquals(secondBody.countersigned, true);
  assertEquals(secondBody.idempotent, true, "the losing delivery reports itself as an idempotent no-op");

  const update = second.calls.find((c) => c.table === "hire_orders" && c.method === "update");
  assert(update, "the losing delivery still attempts the conditional update");
  const statusGuard = second.calls.find(
    (c) => c.table === "hire_orders" && c.method === "eq" && c.args[0] === "status" && c.args[1] === "issued",
  );
  assert(statusGuard, "the update is guarded by .eq('status', 'issued'), not just the earlier read");

  assertEquals(
    second.calls.filter((c) => c.table === "notifications" && c.method === "insert").length,
    0,
    "the second (losing) delivery must not insert a second countersigned notification",
  );
});

Deno.test("document.completed for a matched but not-yet-issued order is ignored (no transition, no notification)", async () => {
  // Distinct from the already-countersigned idempotent case above: this is the
  // OTHER branch of the status guard -- a draft/void order that was never
  // actually issued but somehow has a Documenso envelope id on file.
  const { deps, calls } = makeFakeDeps({
    envVars: { DOCUMENSO_WEBHOOK_SECRET: SECRET },
    tables: { hire_orders: { data: issuedOrder({ status: "draft" }) } },
  });

  const res = await handle(
    makeRequest({ headers: { "X-Documenso-Secret": SECRET }, body: documentCompletedBody() }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ignored, true);

  assertEquals(
    calls.filter((c) => c.table === "hire_orders" && c.method === "update").length,
    0,
    "a non-issued order must not be transitioned to countersigned",
  );
  assertEquals(
    calls.filter((c) => c.table === "notifications" && c.method === "insert").length,
    0,
    "a non-issued order must not trigger a countersigned notification",
  );
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
