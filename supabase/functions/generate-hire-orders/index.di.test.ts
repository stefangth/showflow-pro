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

Deno.test("draft assigns a distinct order number to every artist on one date (no silent drop past 5)", async () => {
  // Six confirmed bookings on ONE date that carries a program/cast label. The
  // default pattern differentiates by {seq}, so every artist gets a distinct base
  // order number and ALL six are created — the pre-fix default collapsed the base
  // to the shared cast code and silently lost the 6th to the 5-try collision cap.
  const six = Array.from({ length: 6 }, (_, i) =>
    booking(`b-${i}`, `a-${i}`, 500, `Artist ${i}`, `artist${i}@x.de`));
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      show_dates: { data: SHOW_DATE_ROW }, // program "Aida" -> a cast code IS present
      bookings: { data: six },
      cities: { data: { name: "Berlin" } },
      hire_orders: [
        { when: { __write: false }, data: [] }, // no existing orders; seq base 0
        { when: { __write: true }, data: { id: "ho-x" } }, // every insert succeeds
      ],
      // hire_order_numbering intentionally NOT seeded -> the code's NUMBERING_DEFAULT applies.
      app_settings: [{ when: { key: "hire_order_defaults" }, data: [DEFAULTS] }],
    },
  });

  const res = await handle(makeRequest({ headers: JWT, body: { action: "draft", org_id: ORG, show_date_id: SD } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.created.length, 6, "all six bookings drafted");
  assertEquals(body.skipped, [], "no booking dropped");

  const orderNos = calls
    .filter((c) => c.table === "hire_orders" && c.method === "insert")
    .map((c) => (c.args[0] as { order_no: string }).order_no);
  assertEquals(orderNos.length, 6);
  assertEquals(new Set(orderNos).size, 6, `expected 6 distinct order numbers, got ${JSON.stringify(orderNos)}`);
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

// ── draft-manual ─────────────────────────────────────────────────────────

Deno.test("draft-manual with only manual fields creates an unlinked draft where every field is source manual", async () => {
  const manual = {
    artist_name: "Walk-in Artist",
    recipient_email: "walkin@example.com",
    role: "Soloist",
    cast: "Cast A",
    date: "2026-08-01",
    venue: "The Loft",
    city: "Hamburg",
    duration_min: 60,
    sessions: ["20:00"],
    fee: 750,
    currency: "USD",
    notes: "Fully manual engagement",
  };
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: [] }, // sequence-base count read
        { when: { __write: true }, data: { id: "ho-manual-1" } },
      ],
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
  });

  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "draft-manual", org_id: ORG, manual } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.created.length, 1, "expected exactly one created order");

  // No queries against artists/show_dates at all — neither id was given.
  assertEquals(calls.filter((c) => c.table === "artists").length, 0);
  assertEquals(calls.filter((c) => c.table === "show_dates").length, 0);

  const insert = calls.find((c) => c.table === "hire_orders" && c.method === "insert");
  assert(insert, "expected a hire_orders insert");
  const row = insert!.args[0] as {
    booking_id: string | null; artist_id: string | null; show_date_id: string | null;
    fee_currency: string; terms_variant: string; status: string;
    data: Record<string, { value: unknown; source: string }>;
  };
  assertEquals(row.booking_id, null, "manual orders never link a booking");
  assertEquals(row.artist_id, null);
  assertEquals(row.show_date_id, null);
  assertEquals(row.status, "draft");
  assertEquals(row.terms_variant, "standard");
  for (const key of Object.keys(manual)) {
    assertEquals(row.data[key]?.source, "manual", `${key} should be source manual`);
  }
  assertEquals(row.data.fee.value, 750);
  assertEquals(row.fee_currency, "USD", "fee_currency follows the resolved (manual) currency, not the org default");
});

Deno.test("draft-manual with artist_id and show_date_id resolves showflow fields underneath a manual override", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      artists: { data: { id: "a-A", name: "Ann", email: "ann@x.de", cast_role: "Lead" } },
      show_dates: { data: SHOW_DATE_ROW },
      cities: { data: { name: "Berlin" } },
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: "ho-manual-2" } },
      ],
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
  });

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: {
        action: "draft-manual",
        org_id: ORG,
        artist_id: "a-A",
        show_date_id: SD,
        manual: { venue: "Overridden Hall", fee: 900 },
      },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.created.length, 1);

  const insert = calls.find((c) => c.table === "hire_orders" && c.method === "insert");
  assert(insert, "expected a hire_orders insert");
  const row = insert!.args[0] as {
    artist_id: string | null; show_date_id: string | null;
    data: Record<string, { value: unknown; source: string }>;
  };
  assertEquals(row.artist_id, "a-A");
  assertEquals(row.show_date_id, SD);

  // Showflow-derived fields resolve underneath.
  assertEquals(row.data.artist_name.value, "Ann");
  assertEquals(row.data.artist_name.source, "showflow");
  assertEquals(row.data.recipient_email.value, "ann@x.de");
  assertEquals(row.data.recipient_email.source, "showflow");
  assertEquals(row.data.city.value, "Berlin");
  assertEquals(row.data.city.source, "showflow");
  assertEquals(row.data.date.value, "2026-06-15");
  assertEquals(row.data.date.source, "showflow");

  // The manual override for venue/fee wins over showflow/defaults.
  assertEquals(row.data.venue.value, "Overridden Hall");
  assertEquals(row.data.venue.source, "manual");
  assertEquals(row.data.fee.value, 900);
  assertEquals(row.data.fee.source, "manual");
});

Deno.test("draft-manual does not gate on recipient_email at draft time", async () => {
  // No recipient_email anywhere (no artist link, no manual override) — draft-manual
  // must still succeed; the ready gate is enforced at issue, not draft.
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: "ho-manual-3" } },
      ],
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
  });
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "draft-manual", org_id: ORG, manual: { venue: "The Loft" } } }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).created.length, 1);
});

Deno.test("draft-manual 403s when hire_orders entitlement is off", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: { org_memberships: { data: { role: "admin" } } },
    rpcs: { is_feature_enabled: { data: false, error: null } },
  });
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "draft-manual", org_id: ORG, manual: { fee: 500 } } }),
    deps,
  );
  assertEquals(res.status, 403);
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
      venue: { value: "Colosseum", source: "showflow" },
      city: { value: "Berlin", source: "showflow" },
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

  // email with the PDF attachment + the full template contract (snake_case, 8 keys)
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assert(email, "expected a transactional email");
  const msg = email!.body as {
    template_name: string;
    recipient_email: string;
    attachments: Array<{ filename: string }>;
    templateData: Record<string, unknown>;
  };
  assertEquals(msg.template_name, "hire-order-issued");
  assertEquals(msg.recipient_email, "ann@x.de");
  assertEquals(msg.attachments[0].filename, "HO-1.pdf");
  const td = msg.templateData;
  assertEquals(td.artist_name, "Ann");
  assertEquals(td.order_no, "HO-1");
  assertEquals(td.venue, "Colosseum");
  assertEquals(td.city, "Berlin");
  assertEquals(td.fee_label, "€500.00"); // same fee/currency the PDF shows
  assertEquals(td.countersign_mode, "manual"); // org default (no hire_order_countersign seeded)
  // Durable auth-gated detail-page link (re-signs on demand), NOT a 3600s signed URL,
  // and keyed by the order UUID because the route is /hire-orders/:id.
  assert(String(td.download_url).includes("/hire-orders/o-1"), `download_url was ${td.download_url}`);
  // date_label is a timezone-safe human label, not the raw ISO string.
  assert(td.date_label !== "2026-06-15" && String(td.date_label).includes("2026"), `date_label was ${td.date_label}`);

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

// ── documenso countersign ────────────────────────────────────────────────

/** A fake fetch that plays back the create -> recipient -> distribute sequence
 *  createAndSendEnvelope issues, keyed by URL suffix (order-independent). */
function fakeDocumensoFetch(): { fetchImpl: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.endsWith("/envelope/create")) {
      return Promise.resolve(new Response(JSON.stringify({ id: "envelope_1" }), { status: 200 }));
    }
    if (u.endsWith("/recipient/create-many")) {
      return Promise.resolve(new Response(JSON.stringify({ data: [{ token: "sign-tok" }] }), { status: 200 }));
    }
    if (u.endsWith("/distribute")) {
      return Promise.resolve(new Response("{}", { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  return { fetchImpl, calls };
}

Deno.test("issue sends a Documenso envelope when countersign mode is documenso: stamps the order and carries signing_url in the email", async () => {
  const { fetchImpl, calls: docCalls } = fakeDocumensoFetch();
  const { deps, calls, invokeCalls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    fetchImpl,
    envVars: { DOCUMENSO_API_TOKEN: "tok-secret" },
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
        {
          when: { key: "hire_order_countersign" },
          data: [{ org_id: ORG, value: { mode: "documenso", base_url: "https://documenso.test" } }],
        },
      ],
    },
  });

  const res = await handle(makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }), deps);
  const body = await res.json();
  assertEquals(body.issued, ["o-1"]);
  assertEquals(body.failed, []);

  assertEquals(docCalls.length, 3, "expected the create -> recipient -> distribute sequence");
  for (const c of docCalls) {
    const headers = new Headers(c.init?.headers);
    // Documenso API v1 uses the raw api_... token with no "Bearer " scheme.
    assertEquals(headers.get("Authorization"), "tok-secret");
  }

  const csUpdate = calls.find(
    (c) => c.table === "hire_orders" && c.method === "update" && "countersign_mode" in (c.args[0] as object),
  );
  assert(csUpdate, "expected a countersign_mode/documenso_envelope_id update");
  const csRow = csUpdate!.args[0] as { countersign_mode: string; documenso_envelope_id: string };
  assertEquals(csRow.countersign_mode, "documenso");
  assertEquals(csRow.documenso_envelope_id, "envelope_1");

  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assert(email, "expected the issued email");
  const td = (email!.body as { templateData: Record<string, unknown> }).templateData;
  assertEquals(td.countersign_mode, "documenso");
  assertEquals(td.signing_url, "https://documenso.test/sign/sign-tok");
});

Deno.test("issue never calls Documenso when countersign mode is manual", async () => {
  let fetchCalls = 0;
  const fetchImpl = (() => {
    fetchCalls++;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    fetchImpl,
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
        { when: { key: "hire_order_countersign" }, data: [{ org_id: ORG, value: { mode: "manual" } }] },
      ],
    },
  });

  const res = await handle(makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }), deps);
  const body = await res.json();
  assertEquals(body.issued, ["o-1"]);
  assertEquals(fetchCalls, 0, "manual mode must never call Documenso");
});

Deno.test("issue keeps the order issued with a documenso_failed warning when Documenso errors (never un-issues)", async () => {
  const fetchImpl = (() => Promise.resolve(new Response("unauthorized", { status: 401 }))) as typeof fetch;
  const { deps, calls, invokeCalls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    fetchImpl,
    envVars: { DOCUMENSO_API_TOKEN: "tok-secret" },
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
        {
          when: { key: "hire_order_countersign" },
          data: [{ org_id: ORG, value: { mode: "documenso", base_url: "https://documenso.test" } }],
        },
      ],
    },
  });

  const res = await handle(makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }), deps);
  const body = await res.json();
  assertEquals(body.issued, ["o-1"], "the document stays issued despite the Documenso failure");
  assertEquals(body.failed, [{ order_id: "o-1", issues: ["documenso_failed"] }]);

  const csUpdate = calls.find(
    (c) => c.table === "hire_orders" && c.method === "update" && "countersign_mode" in (c.args[0] as object),
  );
  assert(csUpdate, "expected a countersign_mode fallback update");
  assertEquals((csUpdate!.args[0] as { countersign_mode: string }).countersign_mode, "manual");

  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assert(email, "expected the issued email to still send");
  const td = (email!.body as { templateData: Record<string, unknown> }).templateData;
  assertEquals(td.countersign_mode, "manual");
  assertEquals(td.signing_url, undefined);
});

Deno.test("countersign-test is admin-only, checks connectivity, and never leaks the token", async () => {
  const producerCalls: Array<{ url: string; init?: RequestInit }> = [];
  const producerFetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    producerCalls.push({ url: String(url), init });
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  }) as typeof fetch;

  // Producer passes the coarse draft/issue gate but must be rejected here (admin-only).
  const producer = makeFakeDeps({
    authUser: { id: "u-producer" },
    fetchImpl: producerFetchImpl,
    envVars: { DOCUMENSO_API_TOKEN: "tok-secret" },
    tables: { org_memberships: { data: { role: "producer" } } },
  });
  const producerRes = await handle(
    makeRequest({ headers: JWT, body: { action: "countersign-test", org_id: ORG, base_url: "https://documenso.test" } }),
    producer.deps,
  );
  assertEquals(producerRes.status, 403);

  const adminCalls: Array<{ url: string; init?: RequestInit }> = [];
  const adminFetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    adminCalls.push({ url: String(url), init });
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  }) as typeof fetch;
  const admin = makeFakeDeps({
    authUser: { id: "u-admin" },
    fetchImpl: adminFetchImpl,
    envVars: { DOCUMENSO_API_TOKEN: "tok-secret" },
    tables: { org_memberships: { data: { role: "admin" } } },
  });
  const adminRes = await handle(
    makeRequest({ headers: JWT, body: { action: "countersign-test", org_id: ORG, base_url: "https://documenso.test" } }),
    admin.deps,
  );
  assertEquals(adminRes.status, 200);
  const adminBody = await adminRes.json();
  assertEquals(adminBody.ok, true);
  assert(typeof adminBody.detail === "string");
  assert(!JSON.stringify(adminBody).includes("tok-secret"), "the token must never be echoed back");

  assertEquals(adminCalls.length, 1, "expected a single Documenso connectivity check request");
  const headers = new Headers(adminCalls[0].init?.headers);
  // Documenso API v1 uses the raw api_... token with no "Bearer " scheme.
  assertEquals(headers.get("Authorization"), "tok-secret");
});

Deno.test("countersign-test reports ok:false without throwing when Documenso is unreachable/unauthorized", async () => {
  const fetchImpl = (() => Promise.resolve(new Response("unauthorized", { status: 401 }))) as typeof fetch;
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    fetchImpl,
    envVars: { DOCUMENSO_API_TOKEN: "tok-secret" },
    tables: { org_memberships: { data: { role: "admin" } } },
  });
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "countersign-test", org_id: ORG, base_url: "https://documenso.test" } }),
    deps,
  );
  assertEquals(res.status, 200, "connectivity failures are reported in the body, never a 500");
  const resBody = await res.json();
  assertEquals(resBody.ok, false);
  assert(typeof resBody.detail === "string" && resBody.detail.length > 0);
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
