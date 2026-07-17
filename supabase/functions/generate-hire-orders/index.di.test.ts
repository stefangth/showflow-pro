import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

// ── shared fixtures ──────────────────────────────────────────────────────

const ORG = "org-1";
const SD = "sd-1";
const JWT = { Authorization: "Bearer user-jwt" };

/** A confirmed booking row as the draft query returns it (artist joined). */
function booking(id: string, artistId: string, fee: number | null, name: string, email: string) {
  return {
    id,
    artist_id: artistId,
    fee_amount: fee,
    status: "confirmed",
    artists: { id: artistId, name, email, cast_role: "Lead", user_id: null },
  };
}

const SHOW_DATE_ROW = {
  id: SD,
  org_id: ORG,
  show_id: "show-1",
  city_id: "city-1",
  date: "2026-06-15",
  venue: "Venue A",
  duration_minutes: 90,
  notes: null,
  session_1: "19:00",
  session_2: null,
  session_3: null,
  shows: { program: "Aida", sub_program: null },
};

const NUMBERING = { org_id: ORG, value: { prefix: "HO", pattern: "{prefix}-{yyyy}-{mmdd}-{cast|seq}" } };
const DEFAULTS = { org_id: ORG, value: { default_fee: null, currency: "EUR" } };
const LETTERHEAD = { org_id: ORG, value: { legal_name: "Nord GmbH", address_lines: [], registration_line: "" } };
const TERMS_FILLED = { org_id: ORG, value: { lean: [], standard: [{ title: "T", body: "B" }], full: [] } };
const TERMS_EMPTY = { org_id: ORG, value: { lean: [], standard: [], full: [] } };

// ── draft ────────────────────────────────────────────────────────────────

Deno.test("draft creates one order per confirmed booking without an active order", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      show_dates: { data: SHOW_DATE_ROW },
      bookings: { data: [booking("b-A", "a-A", 500, "Ann", "ann@x.de"), booking("b-B", "a-B", null, "Ben", "ben@x.de")] },
      cities: { data: { name: "Berlin" } },
      hire_orders: [
        { when: { __write: false }, data: [{ booking_id: "b-A" }] },
        { when: { __write: true }, data: { id: "ho-new" } },
      ],
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
  });

  const res = await handle(makeRequest({ headers: JWT, body: { action: "draft", org_id: ORG, show_date_id: SD } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.created, ["ho-new"]);
  assertEquals(body.skipped.length, 1);
  assertEquals(body.skipped[0].booking_id, "b-A");
  assertEquals(body.skipped[0].reason, "exists");
});

Deno.test("draft snapshots showflow fields with source tags and org defaults", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      show_dates: { data: SHOW_DATE_ROW },
      bookings: { data: [booking("b-A", "a-A", 500, "Ann", "ann@x.de")] },
      cities: { data: { name: "Berlin" } },
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: "ho-1" } },
      ],
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
  });

  const res = await handle(makeRequest({ headers: JWT, body: { action: "draft", org_id: ORG, show_date_id: SD } }), deps);
  assertEquals(res.status, 200);

  const insert = calls.find((c) => c.table === "hire_orders" && c.method === "insert");
  assert(insert, "expected a hire_orders insert");
  const row = insert!.args[0] as { data: Record<string, { value: unknown; source: string }>; fee_currency: string };
  assertEquals(row.data.venue.source, "showflow");
  assertEquals(row.data.venue.value, "Venue A");
  assertEquals(row.data.fee.source, "showflow"); // booking carried a fee
  assertEquals(row.data.fee.value, 500);
  assertEquals(row.data.currency.source, "default"); // currency only from org defaults
  assertEquals(row.data.currency.value, "EUR");
  assertEquals(row.fee_currency, "EUR");
});

Deno.test("draft 403s when hire_orders entitlement is off", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: { org_memberships: { data: { role: "admin" } } },
    rpcs: { is_feature_enabled: { data: false, error: null } },
  });
  const res = await handle(makeRequest({ headers: JWT, body: { action: "draft", org_id: ORG, show_date_id: SD } }), deps);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "feature_disabled");
});

Deno.test("draft with notify inserts hire_orders_ready producer notifications once", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      show_dates: { data: SHOW_DATE_ROW },
      bookings: { data: [booking("b-A", "a-A", 500, "Ann", "ann@x.de")] },
      cities: { data: { name: "Berlin" } },
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: "ho-1" } },
      ],
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
    rpcs: { resolve_show_assignments: { data: [{ producer_user_id: "p1" }] } },
  });

  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "draft", org_id: ORG, show_date_id: SD, notify: true } }),
    deps,
  );
  assertEquals(res.status, 200);

  const notifInserts = calls.filter((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(notifInserts.length, 1, "producer notifications inserted exactly once");
  const rows = notifInserts[0].args[0] as Array<{ type: string; user_id: string }>;
  assert(rows.every((r) => r.type === "hire_orders_ready"), "all rows are hire_orders_ready");
  assert(rows.some((r) => r.user_id === "p1"), "notifies the resolved producer");
});

// ── issue ──────────────────────────────────────────────────────────────

function issuableOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "o-1",
    org_id: ORG,
    order_no: "HO-1",
    status: "draft",
    terms_variant: "standard",
    fee_currency: "EUR",
    artist_id: "a-A",
    data: {
      artist_name: { value: "Ann", source: "showflow" },
      recipient_email: { value: "ann@x.de", source: "showflow" },
      date: { value: "2026-06-15", source: "showflow" },
      fee: { value: 500, source: "showflow" },
      currency: { value: "EUR", source: "default" },
    },
    ...overrides,
  };
}

Deno.test("issue renders, uploads to hire-orders/<org>/<order_no>.pdf, stamps issued_at, sends email, notifies artist", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: issuableOrder() },
        { when: { __write: true }, data: null },
      ],
      artists: { data: { user_id: "u-artist" } },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });

  const res = await handle(makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.issued, ["o-1"]);
  assertEquals(body.failed, []);

  // uploaded to the org-scoped object path in the hire-orders bucket
  const upload = calls.find((c) => c.table === "storage:hire-orders" && c.method === "upload");
  assert(upload, "expected a storage upload");
  assertEquals(upload!.args[0], "org-1/HO-1.pdf");

  // stamped issued_at + pdf_path on the ready->issued transition
  const issuedUpdate = calls.find(
    (c) => c.table === "hire_orders" && c.method === "update" && (c.args[0] as { status?: string }).status === "issued",
  );
  assert(issuedUpdate, "expected an update to status issued");
  const upd = issuedUpdate!.args[0] as { issued_at?: string; pdf_path?: string };
  assert(upd.issued_at, "issued_at stamped");
  assertEquals(upd.pdf_path, "org-1/HO-1.pdf");

  // email with the PDF attachment
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assert(email, "expected a transactional email");
  const msg = email!.body as { template_name: string; recipient_email: string; attachments: Array<{ filename: string }> };
  assertEquals(msg.template_name, "hire-order-issued");
  assertEquals(msg.recipient_email, "ann@x.de");
  assertEquals(msg.attachments[0].filename, "HO-1.pdf");

  // artist in-app notification (artist has a linked user_id)
  const notif = calls.find((c) => c.table === "notifications" && c.method === "insert");
  assert(notif, "expected an artist notification");
  const rows = notif!.args[0] as Array<{ type: string; user_id: string }>;
  assert(rows.some((r) => r.type === "hire_order_issued" && r.user_id === "u-artist"));
});

Deno.test("issue refuses orders failing the ready gate and reports issue codes", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: issuableOrder({ data: { recipient_email: { value: "ann@x.de", source: "showflow" }, date: { value: "2026-06-15", source: "showflow" } } }) },
        { when: { __write: true }, data: null },
      ],
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });

  const res = await handle(makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }), deps);
  const body = await res.json();
  assertEquals(body.issued, []);
  assertEquals(body.failed[0].order_id, "o-1");
  assert(body.failed[0].issues.includes("missing_fee"), "reports missing_fee");
  // gate failed before rendering
  assertEquals(calls.filter((c) => c.table === "storage:hire-orders").length, 0);
});

Deno.test("issue refuses an order whose terms variant is empty with missing_terms", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: issuableOrder() },
        { when: { __write: true }, data: null },
      ],
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_EMPTY] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });

  const res = await handle(makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }), deps);
  const body = await res.json();
  assertEquals(body.issued, []);
  assertEquals(body.failed[0].order_id, "o-1");
  assert(body.failed[0].issues.includes("missing_terms"), "reports missing_terms");
});

Deno.test("issue is idempotent per order (already issued -> failed with already_issued)", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [{ when: { __write: false }, data: issuableOrder({ status: "issued" }) }],
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });

  const res = await handle(makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }), deps);
  const body = await res.json();
  assertEquals(body.issued, []);
  assert(body.failed[0].issues.includes("already_issued"));
});

Deno.test("order number collisions get -2 suffix", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      show_dates: { data: SHOW_DATE_ROW },
      bookings: { data: [booking("b-A", "a-A", 500, "Ann", "ann@x.de")] },
      cities: { data: { name: "Berlin" } },
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, error: { code: "23505", message: "duplicate key" } },
      ],
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
  });

  await handle(makeRequest({ headers: JWT, body: { action: "draft", org_id: ORG, show_date_id: SD } }), deps);

  const orderNos = calls
    .filter((c) => c.table === "hire_orders" && c.method === "insert")
    .map((c) => (c.args[0] as { order_no: string }).order_no);
  assert(orderNos.length >= 2, "retried after the collision");
  assert(orderNos.some((n) => n.endsWith("-2")), `expected a -2 suffix, got ${JSON.stringify(orderNos)}`);
});

// ── preview ────────────────────────────────────────────────────────────

Deno.test("preview returns base64 pdf without persisting", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: { data: issuableOrder() },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });

  const res = await handle(makeRequest({ headers: JWT, body: { action: "preview", org_id: ORG, order_id: "o-1" } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.pdf_base64, "JVBERg=="); // base64 of the fake "%PDF" bytes
  // nothing persisted
  assertEquals(calls.filter((c) => c.table === "hire_orders" && ["insert", "update"].includes(c.method)).length, 0);
});

// ── download-url ───────────────────────────────────────────────────────

Deno.test("download-url allows the linked artist and rejects an unrelated artist", async () => {
  const orderRow = {
    id: "o-1",
    org_id: ORG,
    artist_id: "a-A",
    status: "issued",
    pdf_path: "org-1/HO-1.pdf",
    order_no: "HO-1",
  };

  // Linked artist (artists lookup by user_id resolves) -> signed URL.
  const linked = makeFakeDeps({
    authUser: { id: "u-artist" },
    tables: {
      org_memberships: { data: [] }, // not an admin/producer
      platform_admins: { data: null },
      hire_orders: { data: orderRow },
      artists: { data: { id: "a-A" } }, // linked to caller
    },
  });
  const okRes = await handle(
    makeRequest({ headers: { Authorization: "Bearer artist-jwt" }, body: { action: "download-url", org_id: ORG, order_id: "o-1" } }),
    linked.deps,
  );
  assertEquals(okRes.status, 200);
  const okBody = await okRes.json();
  assert(typeof okBody.url === "string" && okBody.url.length > 0);
  assertEquals(okBody.expires_in, 3600);

  // Unrelated artist (no linked artists row) -> 403.
  const unrelated = makeFakeDeps({
    authUser: { id: "u-other" },
    tables: {
      org_memberships: { data: [] },
      platform_admins: { data: null },
      hire_orders: { data: orderRow },
      artists: { data: null },
    },
  });
  const denyRes = await handle(
    makeRequest({ headers: { Authorization: "Bearer other-jwt" }, body: { action: "download-url", org_id: ORG, order_id: "o-1" } }),
    unrelated.deps,
  );
  assertEquals(denyRes.status, 403);

  // Linked artist but the order is still a DRAFT -> 403 (artists only reach
  // issued/countersigned; drafts/ready are never downloadable by them).
  const draft = makeFakeDeps({
    authUser: { id: "u-artist" },
    tables: {
      org_memberships: { data: [] },
      platform_admins: { data: null },
      hire_orders: { data: { ...orderRow, status: "draft" } },
      artists: { data: { id: "a-A" } }, // linked, but status gates it out
    },
  });
  const draftRes = await handle(
    makeRequest({ headers: { Authorization: "Bearer artist-jwt" }, body: { action: "download-url", org_id: ORG, order_id: "o-1" } }),
    draft.deps,
  );
  assertEquals(draftRes.status, 403);
});

// ── coarse auth ────────────────────────────────────────────────────────

Deno.test("rejects non-cron non-producer callers", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-artist" },
    tables: { org_memberships: { data: { role: "artist" } } }, // filtered out of [admin, producer]
  });
  const res = await handle(makeRequest({ headers: JWT, body: { action: "draft", org_id: ORG, show_date_id: SD } }), deps);
  assertEquals(res.status, 403);
});

Deno.test("rejects a JWT admin of another org targeting this org (cross-tenant)", async () => {
  // Caller is an admin of org A but NOT a member of org B. The org-scoped gate
  // must reject targeting org B even though the caller holds the role elsewhere.
  // The rest of the preview path is seeded so that, WITHOUT the org gate, the
  // handler would render and leak org B's PDF — this test fails (200) against a
  // caller-org-blind gate and passes (403) once scoped to body.org_id.
  const { deps } = makeFakeDeps({
    authUser: { id: "u-adminA" },
    tables: {
      org_memberships: [
        { when: { org_id: "org-B" }, data: [] }, // no membership in the TARGET org
        { data: { role: "admin" } }, // admin somewhere (org A) — an ANY-org check would pass
      ],
      platform_admins: { data: null },
      hire_orders: { data: issuableOrder({ org_id: "org-B" }) },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [{ org_id: "org-B", value: { legal_name: "B GmbH", address_lines: [] } }] },
        { when: { key: "hire_order_terms" }, data: [{ org_id: "org-B", value: { lean: [], standard: [], full: [] } }] },
        { when: { key: "hire_order_defaults" }, data: [{ org_id: "org-B", value: { default_fee: null, currency: "EUR" } }] },
      ],
    },
  });
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "preview", org_id: "org-B", order_id: "o-1" } }),
    deps,
  );
  assertEquals(res.status, 403);
});

Deno.test("cron-secret caller is accepted (trigger path unchanged)", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      show_dates: { data: SHOW_DATE_ROW },
      bookings: { data: [booking("b-A", "a-A", 500, "Ann", "ann@x.de")] },
      cities: { data: { name: "Berlin" } },
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: "ho-cron" } },
      ],
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
    rpcs: { get_cron_secret: { data: "cron-secret-value", error: null } },
  });
  const res = await handle(
    makeRequest({
      headers: { "X-Cron-Secret": "cron-secret-value" },
      body: { action: "draft", org_id: ORG, show_date_id: SD },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).created, ["ho-cron"]);
});
