import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle, resolveOrderDefaults } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import type { RenderInput } from "../_shared/hireOrders.ts";
import {
  SAMPLE_LETTERHEAD,
  SAMPLE_ORDER_NO,
  SAMPLE_TERMS,
} from "../_shared/hire-order-pdf/sampleDocument.ts";

// ── shared fixtures ──────────────────────────────────────────────────────

const ORG = "org-1";
const SD = "sd-1";
const JWT = { Authorization: "Bearer user-jwt" };

/** A confirmed booking row as the draft query returns it (artist joined). */
function booking(
  id: string,
  artistId: string,
  fee: number | null,
  name: string,
  email: string,
) {
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

const NUMBERING = {
  org_id: ORG,
  value: { prefix: "HO", pattern: "{prefix}-{yyyy}-{mmdd}-{cast|seq}" },
};
const DEFAULTS = { org_id: ORG, value: { default_fee: null, currency: "EUR" } };
const LETTERHEAD = {
  org_id: ORG,
  value: { legal_name: "Nord GmbH", address_lines: [], registration_line: "" },
};
const TERMS_FILLED = {
  org_id: ORG,
  value: { lean: [], standard: [{ title: "T", body: "B" }], full: [] },
};
const TERMS_EMPTY = {
  org_id: ORG,
  value: { lean: [], standard: [], full: [] },
};
// New-shape (A1/A5) `hire_order_terms`: an org-authored template list + a `default_id`,
// replacing the legacy fixed lean/standard/full shape above (both shapes normalize
// through `normalizeTermsSetting`, so TERMS_FILLED/TERMS_EMPTY above stay valid fixtures).
const TERMS_TEMPLATES_FULL_DEFAULT = {
  org_id: ORG,
  value: {
    templates: [
      { id: "lean-tmpl", name: "Lean", clauses: [] },
      {
        id: "full",
        name: "Full",
        clauses: [{ title: "Full Terms", body: "Everything." }],
      },
    ],
    default_id: "full",
  },
};
/** Default template's id is NOT `terms_variant` on the test order — models an order
 *  whose referenced template was since deleted, falling back to this default. */
const TERMS_TEMPLATES_DEFAULT_FILLED = {
  org_id: ORG,
  value: {
    templates: [
      {
        id: "current-default",
        name: "Current",
        clauses: [{ title: "T2", body: "B2" }],
      },
    ],
    default_id: "current-default",
  },
};
const TERMS_TEMPLATES_DEFAULT_EMPTY = {
  org_id: ORG,
  value: {
    templates: [{ id: "current-default", name: "Current", clauses: [] }],
    default_id: "current-default",
  },
};

// ── resolveOrderDefaults (hire_order_defaults, legacy-org + validation) ────
//
// resolveOrgSetting replaces the fallback wholesale on a match rather than
// merging field-by-field (src/data/settings.ts:53, _shared/settings.ts:41), so
// an org that saved hire_order_defaults before default_fee_basis existed has a
// stored {default_fee, currency} row with the key entirely absent. And because
// app_settings holds hand-editable JSON with no validation on the way in, a
// stored default_fee_basis can also be garbage ("" , "weekly", ...) rather than
// simply missing. resolveOrderDefaults is the single resolution path for this
// setting across every action in this file (draft/draft-manual/draft-batch/
// issue/preview/sign), so its one piece of real logic — falling back to
// "per_date" for anything that isn't exactly a legal FeeBasis — is tested
// directly here rather than through an action whose response never surfaces
// default_fee_basis.

Deno.test("resolveOrderDefaults: a legacy stored default with no basis key resolves to per_date, other fields unchanged", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        {
          when: { key: "hire_order_defaults" },
          data: [{ org_id: ORG, value: { default_fee: 500, currency: "USD" } }],
        },
      ],
    },
  });

  const defaults = await resolveOrderDefaults(deps.admin, ORG);
  assertEquals(defaults.default_fee_basis, "per_date");
  assertEquals(defaults.default_fee, 500);
  assertEquals(defaults.currency, "USD");
});

Deno.test("resolveOrderDefaults: a stored basis of total is not clobbered by the validation", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        {
          when: { key: "hire_order_defaults" },
          data: [{ org_id: ORG, value: { default_fee: 500, currency: "USD", default_fee_basis: "total" } }],
        },
      ],
    },
  });

  const defaults = await resolveOrderDefaults(deps.admin, ORG);
  assertEquals(defaults.default_fee_basis, "total");
  assertEquals(defaults.default_fee, 500);
  assertEquals(defaults.currency, "USD");
});

Deno.test("resolveOrderDefaults: a stored empty-string basis (falsy but defined) resolves to per_date", async () => {
  // The case a plain `?? "per_date"` gets wrong: "" is defined, so `??` would
  // pass it straight through as if it were a legal FeeBasis.
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        {
          when: { key: "hire_order_defaults" },
          data: [{ org_id: ORG, value: { default_fee: 500, currency: "USD", default_fee_basis: "" } }],
        },
      ],
    },
  });

  const defaults = await resolveOrderDefaults(deps.admin, ORG);
  assertEquals(defaults.default_fee_basis, "per_date");
  assertEquals(defaults.default_fee, 500);
  assertEquals(defaults.currency, "USD");
});

Deno.test("resolveOrderDefaults: a stored non-FeeBasis string resolves to per_date", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        {
          when: { key: "hire_order_defaults" },
          data: [{ org_id: ORG, value: { default_fee: 500, currency: "USD", default_fee_basis: "weekly" } }],
        },
      ],
    },
  });

  const defaults = await resolveOrderDefaults(deps.admin, ORG);
  assertEquals(defaults.default_fee_basis, "per_date");
});

Deno.test("resolveOrderDefaults: a stored basis of toString does not sneak past validation via the prototype chain", async () => {
  // `in` walks the prototype chain, so a naive `value in FEE_BASIS_VALUES` check
  // would incorrectly accept "toString"/"constructor"/"hasOwnProperty" as legal
  // FeeBasis strings. Regression guard for the hasOwnProperty-based fix.
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        {
          when: { key: "hire_order_defaults" },
          data: [{ org_id: ORG, value: { default_fee: 500, currency: "USD", default_fee_basis: "toString" } }],
        },
      ],
    },
  });

  const defaults = await resolveOrderDefaults(deps.admin, ORG);
  assertEquals(defaults.default_fee_basis, "per_date");
});

// ── draft ────────────────────────────────────────────────────────────────

Deno.test("draft creates one order per confirmed booking without an active order", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      show_dates: { data: SHOW_DATE_ROW },
      bookings: {
        data: [
          booking("b-A", "a-A", 500, "Ann", "ann@x.de"),
          booking("b-B", "a-B", null, "Ben", "ben@x.de"),
        ],
      },
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

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "draft", org_id: ORG, show_date_id: SD },
    }),
    deps,
  );
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
  const six = Array.from(
    { length: 6 },
    (_, i) =>
      booking(`b-${i}`, `a-${i}`, 500, `Artist ${i}`, `artist${i}@x.de`),
  );
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
      app_settings: [{
        when: { key: "hire_order_defaults" },
        data: [DEFAULTS],
      }],
    },
  });

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "draft", org_id: ORG, show_date_id: SD },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.created.length, 6, "all six bookings drafted");
  assertEquals(body.skipped, [], "no booking dropped");

  const orderNos = calls
    .filter((c) => c.table === "hire_orders" && c.method === "insert")
    .map((c) => (c.args[0] as { order_no: string }).order_no);
  assertEquals(orderNos.length, 6);
  assertEquals(
    new Set(orderNos).size,
    6,
    `expected 6 distinct order numbers, got ${JSON.stringify(orderNos)}`,
  );
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

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "draft", org_id: ORG, show_date_id: SD },
    }),
    deps,
  );
  assertEquals(res.status, 200);

  const insert = calls.find((c) =>
    c.table === "hire_orders" && c.method === "insert"
  );
  assert(insert, "expected a hire_orders insert");
  const row = insert!.args[0] as {
    data: Record<string, { value: unknown; source: string }>;
    fee_currency: string;
  };
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
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "draft", org_id: ORG, show_date_id: SD },
    }),
    deps,
  );
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
    makeRequest({
      headers: JWT,
      body: { action: "draft", org_id: ORG, show_date_id: SD, notify: true },
    }),
    deps,
  );
  assertEquals(res.status, 200);

  const notifInserts = calls.filter((c) =>
    c.table === "notifications" && c.method === "insert"
  );
  assertEquals(
    notifInserts.length,
    1,
    "producer notifications inserted exactly once",
  );
  const rows = notifInserts[0].args[0] as Array<
    { type: string; user_id: string }
  >;
  assert(
    rows.every((r) => r.type === "hire_orders_ready"),
    "all rows are hire_orders_ready",
  );
  assert(
    rows.some((r) => r.user_id === "p1"),
    "notifies the resolved producer",
  );
});

Deno.test("draft stores the org's default terms-template id, not a hardcoded 'standard'", async () => {
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
        {
          when: { key: "hire_order_terms" },
          data: [TERMS_TEMPLATES_FULL_DEFAULT],
        },
      ],
    },
  });

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "draft", org_id: ORG, show_date_id: SD },
    }),
    deps,
  );
  assertEquals(res.status, 200);

  const insert = calls.find((c) =>
    c.table === "hire_orders" && c.method === "insert"
  );
  assert(insert, "expected a hire_orders insert");
  const row = insert!.args[0] as { terms_variant: string };
  assertEquals(row.terms_variant, "full");
});

// ── per-(cast x production) fee (Wireflow v3 phase 4, task B4) ─────────────
//
// Precedence for the snapshot fee is booking/manual fee -> (cast x production)
// fee -> org default. The (cast x production) fee is resolved by deriving the
// booking's cast: the artist's cast_members intersected with the show_date's
// eligible casts (per-date show_date_cast_eligibility, else show_cast_eligibility
// on show_id + city_id). Exactly one cast -> its cast_production_fees.fee_amount
// takes the place of the org default in the `default` layer; zero or many casts
// (ambiguous) -> org default wins.

const DEFAULTS_FEE_100 = {
  org_id: ORG,
  value: { default_fee: 100, currency: "EUR" },
};

Deno.test("draft: a sole eligible cast's production fee beats the org default", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      show_dates: { data: SHOW_DATE_ROW }, // show_id "show-1", city_id "city-1"
      // Booking carries NO fee of its own, so the resolved fee must fall to the
      // cast fee rather than the org default.
      bookings: { data: [booking("b-A1", "a-A1", null, "Ann", "ann@x.de")] },
      cities: { data: { name: "Berlin" } },
      // A1 belongs to cast C1.
      cast_members: { data: [{ artist_id: "a-A1", cast_id: "C1" }] },
      // C1 is the SOLE eligible cast for this date (per-date table has rows).
      show_date_cast_eligibility: { data: [{ cast_id: "C1" }] },
      // (C1 x show-1) fee is 250. draftOrders batches the fee lookup with .in()
      // for every matched cast_id on the date, so the seed matches on the
      // reserved __in:cast_id key rather than a plain eq() cast_id.
      cast_production_fees: [
        { when: { "__in:cast_id": JSON.stringify(["C1"]) }, data: [{ cast_id: "C1", fee_amount: 250 }] },
      ],
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: "ho-1" } },
      ],
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS_FEE_100] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
  });

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "draft", org_id: ORG, show_date_id: SD },
    }),
    deps,
  );
  assertEquals(res.status, 200);

  const insert = calls.find((c) =>
    c.table === "hire_orders" && c.method === "insert"
  );
  assert(insert, "expected a hire_orders insert");
  const row = insert!.args[0] as {
    data: Record<string, { value: unknown; source: string }>;
    fee_amount: number | null;
  };
  assertEquals(row.fee_amount, 250);
  // The cast fee occupies the DEFAULT layer (in place of the org default).
  assertEquals(row.data.fee.value, 250);
  assertEquals(row.data.fee.source, "default");
});

Deno.test("draft: an artist in two eligible casts is ambiguous, so the org default wins", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      show_dates: { data: SHOW_DATE_ROW },
      bookings: { data: [booking("b-A2", "a-A2", null, "Bea", "bea@x.de")] },
      cities: { data: { name: "Berlin" } },
      // A2 belongs to BOTH C1 and C2.
      cast_members: {
        data: [{ artist_id: "a-A2", cast_id: "C1" }, { artist_id: "a-A2", cast_id: "C2" }],
      },
      // Both C1 and C2 are eligible for this date -> intersection is {C1,C2}.
      show_date_cast_eligibility: {
        data: [{ cast_id: "C1" }, { cast_id: "C2" }],
      },
      cast_production_fees: [
        { when: { cast_id: "C1" }, data: { fee_amount: 250 } },
        { when: { cast_id: "C2" }, data: { fee_amount: 300 } },
      ],
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: "ho-2" } },
      ],
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS_FEE_100] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
  });

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "draft", org_id: ORG, show_date_id: SD },
    }),
    deps,
  );
  assertEquals(res.status, 200);

  const insert = calls.find((c) =>
    c.table === "hire_orders" && c.method === "insert"
  );
  assert(insert, "expected a hire_orders insert");
  const row = insert!.args[0] as {
    data: Record<string, { value: unknown; source: string }>;
    fee_amount: number | null;
  };
  assertEquals(row.fee_amount, 100); // org default, cast resolution was ambiguous
  assertEquals(row.data.fee.value, 100);
  assertEquals(row.data.fee.source, "default");
});

Deno.test("draft: a booking's own fee beats the sole cast's production fee", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      show_dates: { data: SHOW_DATE_ROW },
      // Booking carries its own fee of 400.
      bookings: { data: [booking("b-A1", "a-A1", 400, "Ann", "ann@x.de")] },
      cities: { data: { name: "Berlin" } },
      cast_members: { data: [{ artist_id: "a-A1", cast_id: "C1" }] },
      show_date_cast_eligibility: { data: [{ cast_id: "C1" }] },
      cast_production_fees: [
        { when: { "__in:cast_id": JSON.stringify(["C1"]) }, data: [{ cast_id: "C1", fee_amount: 250 }] },
      ],
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: "ho-3" } },
      ],
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS_FEE_100] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
  });

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "draft", org_id: ORG, show_date_id: SD },
    }),
    deps,
  );
  assertEquals(res.status, 200);

  const insert = calls.find((c) =>
    c.table === "hire_orders" && c.method === "insert"
  );
  assert(insert, "expected a hire_orders insert");
  const row = insert!.args[0] as {
    data: Record<string, { value: unknown; source: string }>;
    fee_amount: number | null;
  };
  assertEquals(row.fee_amount, 400); // booking fee beats the 250 cast fee
  assertEquals(row.data.fee.value, 400);
  assertEquals(row.data.fee.source, "showflow");
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
    makeRequest({
      headers: JWT,
      body: { action: "draft-manual", org_id: ORG, manual },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.created.length, 1, "expected exactly one created order");

  // No queries against artists/show_dates at all — neither id was given.
  assertEquals(calls.filter((c) => c.table === "artists").length, 0);
  assertEquals(calls.filter((c) => c.table === "show_dates").length, 0);

  const insert = calls.find((c) =>
    c.table === "hire_orders" && c.method === "insert"
  );
  assert(insert, "expected a hire_orders insert");
  const row = insert!.args[0] as {
    booking_id: string | null;
    artist_id: string | null;
    show_date_id: string | null;
    fee_currency: string;
    terms_variant: string;
    status: string;
    data: Record<string, { value: unknown; source: string }>;
  };
  assertEquals(row.booking_id, null, "manual orders never link a booking");
  assertEquals(row.artist_id, null);
  assertEquals(row.show_date_id, null);
  assertEquals(row.status, "draft");
  assertEquals(row.terms_variant, "standard");
  for (const key of Object.keys(manual)) {
    assertEquals(
      row.data[key]?.source,
      "manual",
      `${key} should be source manual`,
    );
  }
  assertEquals(row.data.fee.value, 750);
  assertEquals(
    row.fee_currency,
    "USD",
    "fee_currency follows the resolved (manual) currency, not the org default",
  );
});

Deno.test("draft-manual with artist_id and show_date_id resolves showflow fields underneath a manual override", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      artists: {
        data: { id: "a-A", name: "Ann", email: "ann@x.de", cast_role: "Lead" },
      },
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

  const insert = calls.find((c) =>
    c.table === "hire_orders" && c.method === "insert"
  );
  assert(insert, "expected a hire_orders insert");
  const row = insert!.args[0] as {
    artist_id: string | null;
    show_date_id: string | null;
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
    makeRequest({
      headers: JWT,
      body: {
        action: "draft-manual",
        org_id: ORG,
        manual: { venue: "The Loft" },
      },
    }),
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
    makeRequest({
      headers: JWT,
      body: { action: "draft-manual", org_id: ORG, manual: { fee: 500 } },
    }),
    deps,
  );
  assertEquals(res.status, 403);
});

Deno.test("draft-manual rejects a non-numeric manual fee with 400 invalid_fee instead of silently nulling it", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: "ho-should-not-be-created" } },
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
        manual: { fee: "not-a-number" },
      },
    }),
    deps,
  );
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "invalid_fee" });
  assertEquals(
    calls.filter((c) => c.table === "hire_orders" && c.method === "insert")
      .length,
    0,
    "an invalid fee must reject before any insert",
  );
});

Deno.test("draft-manual creates the order with the numeric fee when a valid manual fee is given", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: "ho-fee-ok" } },
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
      body: { action: "draft-manual", org_id: ORG, manual: { fee: 500 } },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).created, ["ho-fee-ok"]);
  const insert = calls.find((c) =>
    c.table === "hire_orders" && c.method === "insert"
  );
  assert(insert, "expected a hire_orders insert");
  assertEquals(
    (insert!.args[0] as { fee_amount: number | null }).fee_amount,
    500,
  );
});

Deno.test("draft-manual creates the order with a null fee when no manual fee is given", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: "ho-fee-null" } },
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
        manual: { venue: "The Loft" },
      },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).created, ["ho-fee-null"]);
  const insert = calls.find((c) =>
    c.table === "hire_orders" && c.method === "insert"
  );
  assert(insert, "expected a hire_orders insert");
  assertEquals(
    (insert!.args[0] as { fee_amount: number | null }).fee_amount,
    null,
  );
});

/** Deps for the draft-manual fee-basis cases below: the same admin/settings
 *  seed the other draft-manual tests use, plus a reader for the inserted row's
 *  snapshot. */
function makeManualDeps(insertedId = "ho-basis") {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: insertedId } },
      ],
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
  });
  const insertedData = () => {
    const insert = calls.find((c) =>
      c.table === "hire_orders" && c.method === "insert"
    );
    assert(insert, "expected a hire_orders insert");
    return (insert!.args[0] as {
      data: Record<string, { value: unknown; source: string } | undefined>;
    }).data;
  };
  return { deps, calls, insertedData };
}

Deno.test("draft-manual stores the request's per-date fee basis in the snapshot", async () => {
  // The wizard shows "500.00 per date" on step 4 for a manual order, so the
  // snapshot has to say the same thing. A manual order is single-date, so
  // per-date x 1 is the entered amount and no total changes.
  const { deps, insertedData } = makeManualDeps();
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: {
        action: "draft-manual",
        org_id: ORG,
        manual: { fee: 500 },
        fee_basis: "per_date",
      },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const data = insertedData();
  assertEquals(data.fee?.value, 500);
  assertEquals(data.fee_basis?.value, "per_date");
  assertEquals(data.fee_per_date?.value, 500);
});

Deno.test("draft-manual stores a total fee basis and records no per-date amount", async () => {
  const { deps, insertedData } = makeManualDeps();
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: {
        action: "draft-manual",
        org_id: ORG,
        manual: { fee: 500 },
        fee_basis: "total",
      },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const data = insertedData();
  assertEquals(data.fee_basis?.value, "total");
  assertEquals(data.fee_per_date, undefined);
});

Deno.test("draft-manual falls back to the org's default fee basis when the request omits one", async () => {
  const { deps, insertedData } = makeManualDeps();
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "draft-manual", org_id: ORG, manual: { fee: 500 } },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  // DEFAULTS predates default_fee_basis, so resolveOrderDefaults supplies per_date.
  assertEquals(insertedData().fee_basis?.value, "per_date");
});

Deno.test("draft-manual omits fee_basis and fee_per_date when no fee is entered", async () => {
  const { deps, insertedData } = makeManualDeps();
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: {
        action: "draft-manual",
        org_id: ORG,
        manual: { venue: "The Loft" },
        fee_basis: "per_date",
      },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const data = insertedData();
  assertEquals(data.fee_basis, undefined);
  assertEquals(data.fee_per_date, undefined);
});

Deno.test("draft-manual rejects an unknown fee_basis with the same 400 draft-batch returns", async () => {
  // One action accepting what the other rejects is how a bad basis reaches the
  // snapshot in the first place.
  const { deps, calls } = makeManualDeps();
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: {
        action: "draft-manual",
        org_id: ORG,
        manual: { fee: 500 },
        fee_basis: "weekly",
      },
    }),
    deps,
  );
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "invalid_fee_basis" });
  assertEquals(
    calls.filter((c) => c.table === "hire_orders" && c.method === "insert")
      .length,
    0,
    "an invalid fee basis must reject before any insert",
  );
});

Deno.test("draft-manual for an artist/date pair that already has an active order returns created:[] with a skip indicator, no retry", async () => {
  // Simulates the hire_orders_active_artist_date_uniq backstop firing: the insert
  // returns a 23505 whose message names that index (exactly the shape supabase-js
  // surfaces for a Postgres unique_violation). insertWithRetry must recognize this
  // as a genuine duplicate -- NOT a order_no collision -- and return immediately
  // rather than retrying the collision suffix 20 times.
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      artists: {
        data: { id: "a-A", name: "Ann", email: "ann@x.de", cast_role: "Lead" },
      },
      show_dates: { data: SHOW_DATE_ROW },
      cities: { data: { name: "Berlin" } },
      hire_orders: [
        { when: { __write: false }, data: [] },
        {
          when: { __write: true },
          error: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "hire_orders_active_artist_date_uniq"',
          },
        },
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
        manual: {},
      },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.created, [], "no order was created");
  assertEquals(
    body.skipped,
    [{ reason: "exists" }],
    "reports a skip indicator, not a generic error",
  );
  assertEquals(
    body.error,
    undefined,
    "must not surface as an order_no_collision error",
  );

  const inserts = calls.filter((c) =>
    c.table === "hire_orders" && c.method === "insert"
  );
  assertEquals(
    inserts.length,
    1,
    "must not retry the collision suffix for a real artist/date duplicate",
  );
});

// ── draft-batch ─────────────────────────────────────────────────────────

const BATCH_ARTIST_1 = "11111111-1111-4111-8111-111111111111";
const BATCH_ARTIST_2 = "22222222-2222-4222-8222-222222222222";
const BATCH_ARTIST_3 = "33333333-3333-4333-8333-333333333333";
const BATCH_DATE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BATCH_DATE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const BATCH_SHOW_DATE_ROW_1 = {
  ...SHOW_DATE_ROW,
  id: BATCH_DATE_1,
};

const SHOW_DATE_ROW_2 = {
  ...SHOW_DATE_ROW,
  id: BATCH_DATE_2,
  city_id: "city-2",
  date: "2026-06-14",
  venue: "Venue B",
};

Deno.test("draft-batch creates one order per artist and snapshots all assigned dates in ascending order", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    rpcs: {
      create_hire_order_with_dates: { data: "ho-new", error: null },
    },
    tables: {
      org_memberships: { data: { role: "admin" } },
      artists: {
        data: [
          {
            id: BATCH_ARTIST_1,
            name: "Ann",
            email: "ann@x.de",
            cast_role: "Lead",
          },
          {
            id: BATCH_ARTIST_2,
            name: "Ben",
            email: "ben@x.de",
            cast_role: "Soloist",
          },
        ],
      },
      show_dates: { data: [BATCH_SHOW_DATE_ROW_1, SHOW_DATE_ROW_2] },
      cities: {
        data: [{ id: "city-1", name: "Berlin" }, {
          id: "city-2",
          name: "Hamburg",
        }],
      },
      hire_orders: { data: [] },
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
        action: "draft-batch",
        org_id: ORG,
        artists: [
          {
            artist_id: BATCH_ARTIST_1,
            show_date_ids: [BATCH_DATE_1, BATCH_DATE_2],
          },
          {
            artist_id: BATCH_ARTIST_2.toUpperCase(),
            show_date_ids: [BATCH_DATE_1.toUpperCase()],
          },
        ],
        manual: {
          fee: 900,
          currency: "EUR",
          duration_min: 75,
          sessions: ["20:00"],
        },
      },
    }),
    deps,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.created.length, 2);
  assertEquals(body.skipped, []);
  assertEquals(body.errors, []);

  const aggregateCreates = calls.filter((c) =>
    c.table === "rpc:create_hire_order_with_dates"
  );
  assertEquals(
    aggregateCreates.length,
    2,
    "the transactional RPC creates each aggregate parent and its child rows",
  );
  const firstAggregate = aggregateCreates[0].args[0] as {
    p_artist: string;
    p_show_date_ids: string[];
    p_data: Record<string, { value: unknown; source: string }>;
  };
  assertEquals(firstAggregate.p_artist, BATCH_ARTIST_1);
  assertEquals(firstAggregate.p_show_date_ids, [BATCH_DATE_2, BATCH_DATE_1]);
  assertEquals(firstAggregate.p_data.date.value, "2026-06-14");
  assertEquals(firstAggregate.p_data.venue.value, "Venue B");
  assertEquals(firstAggregate.p_data.city.value, "Hamburg");
  assertEquals(
    firstAggregate.p_data.fee.value,
    1800,
    "the shared manual fee (900) is entered once, and the org's default per_date " +
      "basis (no fee_basis in the request, DEFAULTS carries no override) multiplies " +
      "it by this artist's 2 surviving dates",
  );
  assertEquals(firstAggregate.p_data.engagement_dates.source, "showflow");
  assertEquals(firstAggregate.p_data.engagement_dates.value, [
    {
      show_date_id: BATCH_DATE_2,
      date: "2026-06-14",
      venue: "Venue B",
      city: "Hamburg",
      sessions: ["19:00"],
      duration_min: 90,
    },
    {
      show_date_id: BATCH_DATE_1,
      date: "2026-06-15",
      venue: "Venue A",
      city: "Berlin",
      sessions: ["19:00"],
      duration_min: 90,
    },
  ]);

  assertEquals(
    calls.some((c) => c.table === "hire_orders" && c.method === "insert"),
    false,
    "the edge must not create a parent outside the transactional RPC",
  );
  assertEquals(
    calls.some((c) => c.table === "hire_order_dates" && c.method === "insert"),
    false,
    "the edge must not create child links outside the transactional RPC",
  );

  for (const table of ["artists", "show_dates"]) {
    assert(
      calls.some((call) =>
        call.table === table && call.method === "eq" &&
        call.args[0] === "org_id" && call.args[1] === ORG
      ),
      `${table} batch lookup must be scoped to the request organisation`,
    );
  }
  const artistLookup = calls.find((call) =>
    call.table === "artists" && call.method === "in" && call.args[0] === "id"
  );
  const dateLookup = calls.find((call) =>
    call.table === "show_dates" && call.method === "in" &&
    call.args[0] === "id"
  );
  assertEquals(artistLookup?.args[1], [BATCH_ARTIST_1, BATCH_ARTIST_2]);
  assertEquals(dateLookup?.args[1], [BATCH_DATE_1, BATCH_DATE_2]);
});

Deno.test("draft-batch resolves distinct per-date sessions from each date's own session_1..3", async () => {
  // BATCH_DATE_1 keeps SHOW_DATE_ROW's session_1 "19:00" / 90min; BATCH_DATE_2
  // carries its own, DIFFERENT running order + duration.
  const secondDateRow = {
    ...SHOW_DATE_ROW_2,
    session_1: "18:00",
    session_2: "21:00",
    session_3: null,
    duration_minutes: 60,
  };
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    rpcs: {
      create_hire_order_with_dates: { data: "ho-new", error: null },
    },
    tables: {
      org_memberships: { data: { role: "admin" } },
      artists: {
        data: [
          {
            id: BATCH_ARTIST_1,
            name: "Ann",
            email: "ann@x.de",
            cast_role: "Lead",
          },
        ],
      },
      show_dates: { data: [BATCH_SHOW_DATE_ROW_1, secondDateRow] },
      cities: {
        data: [{ id: "city-1", name: "Berlin" }, {
          id: "city-2",
          name: "Hamburg",
        }],
      },
      hire_orders: { data: [] },
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
        action: "draft-batch",
        org_id: ORG,
        artists: [
          {
            artist_id: BATCH_ARTIST_1,
            show_date_ids: [BATCH_DATE_1, BATCH_DATE_2],
          },
        ],
        manual: {},
      },
    }),
    deps,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.created, ["ho-new"]);

  const aggregateCreate = calls.find((c) =>
    c.table === "rpc:create_hire_order_with_dates"
  );
  const args = aggregateCreate!.args[0] as {
    p_data: {
      engagement_dates: {
        value: Array<
          { show_date_id: string; sessions: string[]; duration_min: number | null }
        >;
      };
    };
  };
  const byId = new Map(
    args.p_data.engagement_dates.value.map((d) => [d.show_date_id, d]),
  );
  assertEquals(byId.get(BATCH_DATE_1)?.sessions, ["19:00"]);
  assertEquals(byId.get(BATCH_DATE_1)?.duration_min, 90);
  assertEquals(byId.get(BATCH_DATE_2)?.sessions, ["18:00", "21:00"]);
  assertEquals(byId.get(BATCH_DATE_2)?.duration_min, 60);
});

Deno.test("draft-batch applies a date_overrides entry to replace one date's sessions", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    rpcs: {
      create_hire_order_with_dates: { data: "ho-new", error: null },
    },
    tables: {
      org_memberships: { data: { role: "admin" } },
      artists: {
        data: [
          {
            id: BATCH_ARTIST_1,
            name: "Ann",
            email: "ann@x.de",
            cast_role: "Lead",
          },
        ],
      },
      show_dates: { data: [BATCH_SHOW_DATE_ROW_1, SHOW_DATE_ROW_2] },
      cities: {
        data: [{ id: "city-1", name: "Berlin" }, {
          id: "city-2",
          name: "Hamburg",
        }],
      },
      hire_orders: { data: [] },
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
        action: "draft-batch",
        org_id: ORG,
        artists: [
          {
            artist_id: BATCH_ARTIST_1,
            show_date_ids: [BATCH_DATE_1, BATCH_DATE_2],
          },
        ],
        manual: {},
        date_overrides: {
          [BATCH_DATE_1]: { sessions: ["20:30"], duration_min: 45 },
        },
      },
    }),
    deps,
  );

  assertEquals(res.status, 200);
  assertEquals((await res.json()).created, ["ho-new"]);

  const aggregateCreate = calls.find((c) =>
    c.table === "rpc:create_hire_order_with_dates"
  );
  const args = aggregateCreate!.args[0] as {
    p_data: {
      engagement_dates: {
        value: Array<
          { show_date_id: string; sessions: string[]; duration_min: number | null }
        >;
      };
    };
  };
  const byId = new Map(
    args.p_data.engagement_dates.value.map((d) => [d.show_date_id, d]),
  );
  // overridden date reflects the override, not the synced session_1..3
  assertEquals(byId.get(BATCH_DATE_1)?.sessions, ["20:30"]);
  assertEquals(byId.get(BATCH_DATE_1)?.duration_min, 45);
  // the other date is untouched: still its own synced session
  assertEquals(byId.get(BATCH_DATE_2)?.sessions, ["19:00"]);
  assertEquals(byId.get(BATCH_DATE_2)?.duration_min, 90);
});

Deno.test("draft-batch rejects a malformed date_overrides entry with 400 invalid_date_override", async () => {
  for (
    const dateOverrides of [
      // more than 3 sessions
      { [BATCH_DATE_1]: { sessions: ["a", "b", "c", "d"] } },
      // negative duration
      { [BATCH_DATE_1]: { duration_min: -5 } },
      // blank session (post-trim)
      { [BATCH_DATE_1]: { sessions: ["   "] } },
      // key isn't among the request's selected show_date_ids
      { [BATCH_DATE_2]: { sessions: ["19:00"] } },
    ]
  ) {
    const { deps, calls } = makeFakeDeps({
      authUser: { id: "u-admin" },
      tables: { org_memberships: { data: { role: "admin" } } },
    });
    const res = await handle(
      makeRequest({
        headers: JWT,
        body: {
          action: "draft-batch",
          org_id: ORG,
          artists: [
            { artist_id: BATCH_ARTIST_1, show_date_ids: [BATCH_DATE_1] },
          ],
          manual: {},
          date_overrides: dateOverrides,
        },
      }),
      deps,
    );
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, "invalid_date_override");
    assertEquals(
      calls.some((call) =>
        call.table === "artists" || call.table === "show_dates"
      ),
      false,
      "a malformed date_overrides entry must be rejected before batch lookups",
    );
  }
});

Deno.test("draft-batch rejects empty input, duplicate artists, and artists without dates", async () => {
  for (
    const [artists, error] of [
      [[], "artists required"],
      [[{ artist_id: BATCH_ARTIST_1, show_date_ids: [BATCH_DATE_1] }, {
        artist_id: BATCH_ARTIST_1,
        show_date_ids: [BATCH_DATE_2],
      }], "duplicate_artist_id"],
      [
        [{ artist_id: BATCH_ARTIST_1, show_date_ids: [] }],
        "show_date_ids required",
      ],
    ] as const
  ) {
    const { deps } = makeFakeDeps({
      authUser: { id: "u-admin" },
      tables: { org_memberships: { data: { role: "admin" } } },
    });
    const res = await handle(
      makeRequest({
        headers: JWT,
        body: { action: "draft-batch", org_id: ORG, artists, manual: {} },
      }),
      deps,
    );
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, error);
  }
});

Deno.test("draft-batch rejects malformed artist and show-date UUIDs before querying", async () => {
  for (
    const [artists, error] of [
      [
        [{ artist_id: "not-a-uuid", show_date_ids: [BATCH_DATE_1] }],
        "invalid_artist_id",
      ],
      [
        [{ artist_id: BATCH_ARTIST_1, show_date_ids: ["not-a-uuid"] }],
        "invalid_show_date_id",
      ],
    ] as const
  ) {
    const { deps, calls } = makeFakeDeps({
      authUser: { id: "u-admin" },
      tables: { org_memberships: { data: { role: "admin" } } },
    });
    const response = await handle(
      makeRequest({
        headers: JWT,
        body: { action: "draft-batch", org_id: ORG, artists, manual: {} },
      }),
      deps,
    );

    assertEquals(response.status, 400);
    assertEquals((await response.json()).error, error);
    assertEquals(
      calls.some((call) =>
        call.table === "artists" || call.table === "show_dates"
      ),
      false,
      "malformed UUIDs must be rejected before batch lookups",
    );
  }
});

Deno.test("draft-batch canonicalizes UUIDs before duplicate artist and date detection", async () => {
  for (
    const [artists, error] of [
      [[
        { artist_id: BATCH_ARTIST_1, show_date_ids: [BATCH_DATE_1] },
        {
          artist_id: BATCH_ARTIST_1.toUpperCase(),
          show_date_ids: [BATCH_DATE_2],
        },
      ], "duplicate_artist_id"],
      [[{
        artist_id: BATCH_ARTIST_1,
        show_date_ids: [BATCH_DATE_1, BATCH_DATE_1.toUpperCase()],
      }], "duplicate_show_date_id"],
    ] as const
  ) {
    const { deps } = makeFakeDeps({
      authUser: { id: "u-admin" },
      tables: { org_memberships: { data: { role: "admin" } } },
    });
    const response = await handle(
      makeRequest({
        headers: JWT,
        body: { action: "draft-batch", org_id: ORG, artists, manual: {} },
      }),
      deps,
    );

    assertEquals(response.status, 400);
    assertEquals((await response.json()).error, error);
  }
});

Deno.test("draft-batch keeps artist outcomes independent when one referenced artist is missing", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    rpcs: {
      create_hire_order_with_dates: { data: "ho-2", error: null },
    },
    tables: {
      org_memberships: { data: { role: "admin" } },
      artists: {
        data: [{
          id: BATCH_ARTIST_2,
          name: "Ben",
          email: "ben@x.de",
          cast_role: "Soloist",
        }],
      },
      show_dates: { data: [BATCH_SHOW_DATE_ROW_1] },
      cities: { data: [{ id: "city-1", name: "Berlin" }] },
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: "ho-2" } },
      ],
      hire_order_dates: { data: null },
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
        action: "draft-batch",
        org_id: ORG,
        artists: [
          { artist_id: BATCH_ARTIST_3, show_date_ids: [BATCH_DATE_1] },
          { artist_id: BATCH_ARTIST_2, show_date_ids: [BATCH_DATE_1] },
        ],
        manual: { fee: 900, currency: "EUR" },
      },
    }),
    deps,
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    created: ["ho-2"],
    skipped: [],
    errors: [{ artist_id: BATCH_ARTIST_3, reason: "artist_not_found" }],
  });
});

Deno.test("draft-batch continues after one transactional aggregate creation fails", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    rpcs: {
      create_hire_order_with_dates: { data: "ho-2", error: null },
    },
    tables: {
      org_memberships: { data: { role: "admin" } },
      artists: {
        data: [
          {
            id: BATCH_ARTIST_1,
            name: "Ann",
            email: "ann@x.de",
            cast_role: "Lead",
          },
          {
            id: BATCH_ARTIST_2,
            name: "Ben",
            email: "ben@x.de",
            cast_role: "Soloist",
          },
        ],
      },
      show_dates: { data: [BATCH_SHOW_DATE_ROW_1] },
      cities: { data: [{ id: "city-1", name: "Berlin" }] },
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: "ho-2" } },
      ],
      hire_order_dates: { data: null },
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
  });
  const admin = deps.admin as unknown as {
    rpc: (
      name: string,
      params?: unknown,
    ) => Promise<{ data: unknown; error: unknown }>;
  };
  const originalRpc = admin.rpc.bind(admin);
  admin.rpc = (name, params) => {
    if (
      name === "create_hire_order_with_dates" &&
      (params as { p_artist?: string })?.p_artist === BATCH_ARTIST_1
    ) {
      return Promise.resolve({
        data: null,
        error: { message: "aggregate creation failed" },
      });
    }
    return originalRpc(name, params);
  };

  const response = await handle(
    makeRequest({
      headers: JWT,
      body: {
        action: "draft-batch",
        org_id: ORG,
        artists: [
          { artist_id: BATCH_ARTIST_1, show_date_ids: [BATCH_DATE_1] },
          { artist_id: BATCH_ARTIST_2, show_date_ids: [BATCH_DATE_1] },
        ],
        manual: { fee: 900, currency: "EUR" },
      },
    }),
    deps,
  );

  assertEquals(response.status, 200);
  // The failing artist surfaces the REAL Postgres reason (here the fake rpc's
  // message), not the opaque catch-all "aggregate_insert_failed" -- so a genuine
  // constraint violation (e.g. a stale check constraint) is visible in the batch
  // response instead of being masked. Mirrors the single-date insertWithRetry,
  // which already returns error.message.
  assertEquals(await response.json(), {
    created: ["ho-2"],
    skipped: [],
    errors: [{
      artist_id: BATCH_ARTIST_1,
      reason: "aggregate creation failed",
    }],
  });
});

Deno.test("draft-batch drops an already-covered date and still creates the order for the rest (partial success)", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    rpcs: { create_hire_order_with_dates: { data: "ho-new", error: null } },
    tables: {
      org_memberships: { data: { role: "admin" } },
      artists: { data: [{ id: BATCH_ARTIST_1, name: "Ann", email: "ann@x.de", cast_role: "Lead" }] },
      show_dates: { data: [BATCH_SHOW_DATE_ROW_1, SHOW_DATE_ROW_2] },
      cities: { data: [{ id: "city-1", name: "Berlin" }, { id: "city-2", name: "Hamburg" }] },
      // The coverage read (.eq artist_id) returns an active order on BATCH_DATE_1;
      // the org-wide sequence-count read (no artist_id in its eq map) falls back to [].
      hire_orders: [
        { when: { artist_id: BATCH_ARTIST_1 }, data: [{ id: "cov-1", show_date_id: BATCH_DATE_1, status: "issued" }] },
        { data: [] },
      ],
      hire_order_dates: { data: [] },
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
        action: "draft-batch",
        org_id: ORG,
        artists: [{ artist_id: BATCH_ARTIST_1, show_date_ids: [BATCH_DATE_1, BATCH_DATE_2] }],
        manual: { fee: 900, currency: "EUR" },
      },
    }),
    deps,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.created, ["ho-new"]);
  assertEquals(body.skipped, []);
  assertEquals(body.errors, []);
  assertEquals(body.date_conflicts, [{ artist_id: BATCH_ARTIST_1, dropped: [BATCH_DATE_1] }]);

  // The RPC is invoked with ONLY the remaining (uncovered) date.
  const aggregateCreate = calls.find((c) => c.table === "rpc:create_hire_order_with_dates");
  const args = aggregateCreate!.args[0] as { p_show_date_ids: string[] };
  assertEquals(args.p_show_date_ids, [BATCH_DATE_2]);
});

Deno.test("draft-batch skips an artist whose every requested date is already covered", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    rpcs: { create_hire_order_with_dates: { data: "ho-new", error: null } },
    tables: {
      org_memberships: { data: { role: "admin" } },
      artists: { data: [{ id: BATCH_ARTIST_1, name: "Ann", email: "ann@x.de", cast_role: "Lead" }] },
      show_dates: { data: [BATCH_SHOW_DATE_ROW_1] },
      cities: { data: [{ id: "city-1", name: "Berlin" }] },
      hire_orders: [
        { when: { artist_id: BATCH_ARTIST_1 }, data: [{ id: "cov-1", show_date_id: BATCH_DATE_1, status: "issued" }] },
        { data: [] },
      ],
      hire_order_dates: { data: [] },
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
        action: "draft-batch",
        org_id: ORG,
        artists: [{ artist_id: BATCH_ARTIST_1, show_date_ids: [BATCH_DATE_1] }],
        manual: {},
      },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.created, []);
  assertEquals(body.skipped, [{ artist_id: BATCH_ARTIST_1, reason: "exists" }]);
  assertEquals(calls.filter((c) => c.table === "rpc:create_hire_order_with_dates").length, 0);
});

// ── draft-batch: per-date fee multiplication ────────────────────────────────

const ARTIST_A = "44444444-4444-4444-8444-444444444444";
const DATE_1 = "55555555-5555-4555-8555-555555555555";
const DATE_2 = "66666666-6666-4666-8666-666666666666";
const DATE_3 = "77777777-7777-4777-8777-777777777777";

/**
 * Fake deps for the fee-basis tests: one artist (ARTIST_A) and up to three
 * show_dates (DATE_1/2/3, one per entry in `dates`), built the same way as the
 * draft-batch fixtures above (SHOW_DATE_ROW spread + id/date override,
 * hire_orders array-seed keyed by `artist_id` for the coverage read). Passing
 * `coveredDateIds` seeds an active order covering those dates for ARTIST_A, so
 * `coveredDatesForArtist` drops them exactly like the partial-success fixture
 * above (BATCH_ARTIST_1 / BATCH_DATE_1).
 *
 * `inserted.hire_orders` reads back what the transactional RPC was called
 * with after `handle` runs: `{ data, fee_amount }`, mirroring the args
 * `draftBatchArtist` passes to `create_hire_order_with_dates`.
 */
function makeBatchDeps(
  opts: { dates: string[]; coveredDateIds?: string[] },
) {
  const ids = [DATE_1, DATE_2, DATE_3].slice(0, opts.dates.length);
  const showDateRows = ids.map((id, i) => ({
    ...SHOW_DATE_ROW,
    id,
    date: opts.dates[i],
  }));
  const coveredDateIds = opts.coveredDateIds ?? [];
  const coveredRows = coveredDateIds.map((id, i) => ({
    id: `cov-${i}`,
    show_date_id: id,
    status: "issued",
  }));

  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    rpcs: { create_hire_order_with_dates: { data: "ho-new", error: null } },
    tables: {
      org_memberships: { data: { role: "admin" } },
      artists: {
        data: [{ id: ARTIST_A, name: "Ann", email: "ann@x.de", cast_role: "Lead" }],
      },
      show_dates: { data: showDateRows },
      cities: { data: [{ id: "city-1", name: "Berlin" }] },
      hire_orders: coveredRows.length > 0
        ? [{ when: { artist_id: ARTIST_A }, data: coveredRows }, { data: [] }]
        : { data: [] },
      hire_order_dates: { data: [] },
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
  });

  const inserted = {
    // Maps the RPC's p_-prefixed args (p_data, p_fee_amount — see
    // create_hire_order_with_dates's signature) onto the plain field names the
    // brief's assertions read, so a test can say `order.data.fee.value` instead
    // of reaching into the RPC's own argument-naming convention.
    get hire_orders() {
      return calls
        .filter((c) => c.table === "rpc:create_hire_order_with_dates")
        .map((c) => {
          const args = c.args[0] as {
            p_data: Record<string, { value: unknown; source: string }>;
            p_fee_amount: number | null;
          };
          return { data: args.p_data, fee_amount: args.p_fee_amount };
        });
    },
  };
  return { deps, calls, inserted };
}

/** Build a draft-batch request body, defaulting `action`/`org_id` the way
 *  every case in this section needs them. */
function batchRequest(overrides: Record<string, unknown>): Request {
  return makeRequest({
    headers: JWT,
    body: { action: "draft-batch", org_id: ORG, ...overrides },
  });
}

Deno.test("draft-batch multiplies a per-date fee by the artist's date count", async () => {
  const { deps, inserted } = makeBatchDeps({
    dates: ["2026-06-15", "2026-06-16", "2026-06-17"],
  });
  const res = await handle(
    batchRequest({
      artists: [{ artist_id: ARTIST_A, show_date_ids: [DATE_1, DATE_2, DATE_3] }],
      manual: { fee: 500 },
      fee_basis: "per_date",
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const order = inserted.hire_orders[0];
  assertEquals(order.data.fee.value, 1500);
  assertEquals(order.data.fee_per_date.value, 500);
  assertEquals(order.data.fee_basis.value, "per_date");
  assertEquals(order.fee_amount, 1500);
});

Deno.test("draft-batch bills only the dates that survive the covered-date drop", async () => {
  // DATE_3 is already covered by an active order for this artist.
  const { deps, inserted } = makeBatchDeps({
    dates: ["2026-06-15", "2026-06-16", "2026-06-17"],
    coveredDateIds: [DATE_3],
  });
  const res = await handle(
    batchRequest({
      artists: [{ artist_id: ARTIST_A, show_date_ids: [DATE_1, DATE_2, DATE_3] }],
      manual: { fee: 500 },
      fee_basis: "per_date",
    }),
    deps,
  );
  assertEquals(res.status, 200);
  // Two dates survive, so the total is 1000 and not 1500.
  assertEquals(inserted.hire_orders[0].data.fee.value, 1000);
});

Deno.test("draft-batch leaves a total-basis fee unmultiplied and records no per-date amount", async () => {
  const { deps, inserted } = makeBatchDeps({ dates: ["2026-06-15", "2026-06-16"] });
  const res = await handle(
    batchRequest({
      artists: [{ artist_id: ARTIST_A, show_date_ids: [DATE_1, DATE_2] }],
      manual: { fee: 1500 },
      fee_basis: "total",
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const order = inserted.hire_orders[0];
  assertEquals(order.data.fee.value, 1500);
  assertEquals(order.data.fee_basis.value, "total");
  assertEquals(order.data.fee_per_date, undefined);
});

Deno.test("draft-batch is exact for a fractional per-date fee through the real call path", async () => {
  // 500.10 * 3 in binary floating point is 1500.3000000000002, which would be
  // stored and printed verbatim on the PDF. computeFeeTotal multiplies in
  // integer cents; this asserts the whole action keeps that property, not just
  // the helper in isolation.
  const { deps, inserted } = makeBatchDeps({
    dates: ["2026-06-15", "2026-06-16", "2026-06-17"],
  });
  const res = await handle(
    batchRequest({
      artists: [{ artist_id: ARTIST_A, show_date_ids: [DATE_1, DATE_2, DATE_3] }],
      manual: { fee: 500.1 },
      fee_basis: "per_date",
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const order = inserted.hire_orders[0];
  assertEquals(order.data.fee.value, 1500.3);
  assertEquals(order.fee_amount, 1500.3);
  assertEquals(order.data.fee_per_date.value, 500.1);
});

Deno.test("draft-batch omits fee_basis and fee_per_date entirely when no fee is entered", async () => {
  // The shape the PDF renderer's reconcile guard depends on: with no fee there
  // is nothing for a breakdown to explain, so the keys must be ABSENT rather
  // than present with a null amount.
  const { deps, inserted } = makeBatchDeps({ dates: ["2026-06-15", "2026-06-16"] });
  const res = await handle(
    batchRequest({
      artists: [{ artist_id: ARTIST_A, show_date_ids: [DATE_1, DATE_2] }],
      manual: { venue: "The Loft" },
      fee_basis: "per_date",
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const order = inserted.hire_orders[0];
  assertEquals(order.fee_amount, null);
  assertEquals(order.data.fee_basis, undefined);
  assertEquals(order.data.fee_per_date, undefined);
});

Deno.test("draft-batch rejects an unknown fee_basis", async () => {
  const { deps } = makeBatchDeps({ dates: ["2026-06-15"] });
  const res = await handle(
    batchRequest({
      artists: [{ artist_id: ARTIST_A, show_date_ids: [DATE_1] }],
      manual: { fee: 500 },
      fee_basis: "weekly",
    }),
    deps,
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "invalid_fee_basis");
});

// NOTE: the brief's fifth test in this group ("draft-batch refuses to bill an
// order with no surviving dates") is intentionally NOT reproduced here. See
// the no_billable_dates guard comment in draftBatchArtist (index.ts) and the
// task report for why it is unreachable through this file's public surface:
// `dates.length === 0` is checked once already, a few lines above the new
// guard, with an early `return { kind: "skipped", reason: "exists" }` — the
// exact same `const dates` value is read both times (nothing reassigns or
// filters it in between), so no request shape can make the first check pass
// and the second one fail. Reaching the new guard requires a future refactor
// to remove or reorder that earlier check, which is exactly the scenario the
// guard's comment says it exists for.

// ── agent signature ──────────────────────────────────────────────────────

// A real 1x1 transparent PNG (valid 8-byte signature) for the upload tests.
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

Deno.test("upload-agent-signature stores a valid PNG at the org path and returns a signed url", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: { org_memberships: { data: { role: "admin" } } },
  });
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "upload-agent-signature", org_id: ORG, signature_png: TINY_PNG_DATA_URL } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.path, `${ORG}/agent-signature.png`);
  assertEquals(typeof body.url, "string");
  const upload = calls.find((c) => c.table === "storage:hire-orders" && c.method === "upload");
  assertEquals(upload!.args[0], `${ORG}/agent-signature.png`);
});

Deno.test("upload-agent-signature rejects a non-PNG payload with 400", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: { org_memberships: { data: { role: "admin" } } },
  });
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "upload-agent-signature", org_id: ORG, signature_png: "data:image/png;base64,AAAA" } }),
    deps,
  );
  assertEquals(res.status, 400);
});

Deno.test("upload-agent-signature requires admin (a producer gets 403)", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-prod" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: { org_memberships: { data: { role: "producer" } } },
  });
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "upload-agent-signature", org_id: ORG, signature_png: TINY_PNG_DATA_URL } }),
    deps,
  );
  assertEquals(res.status, 403);
});

Deno.test("agent-signature-url returns a signed url when a signature is stored", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      org_memberships: { data: { role: "admin" } },
      app_settings: [{
        when: { key: "hire_order_letterhead" },
        data: [{ org_id: ORG, value: { legal_name: "X", address_lines: [], agent_signature_path: `${ORG}/agent-signature.png` } }],
      }],
    },
  });
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "agent-signature-url", org_id: ORG } }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(typeof (await res.json()).url, "string");
});

Deno.test("agent-signature-url returns null when no signature is stored", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      org_memberships: { data: { role: "admin" } },
      app_settings: [{
        when: { key: "hire_order_letterhead" },
        data: [{ org_id: ORG, value: { legal_name: "X", address_lines: [] } }],
      }],
    },
  });
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "agent-signature-url", org_id: ORG } }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).url, null);
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
      engagement_dates: {
        value: [
          { show_date_id: "sd-1", date: "2026-06-15", venue: "Colosseum", city: "Berlin" },
          { show_date_id: "sd-2", date: "2026-06-16", venue: "Huxleys", city: "Berlin" },
        ],
        source: "showflow",
      },
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

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.issued, ["o-1"]);
  assertEquals(body.failed, []);

  // uploaded to the org-scoped object path in the hire-orders bucket
  const upload = calls.find((c) =>
    c.table === "storage:hire-orders" && c.method === "upload"
  );
  assert(upload, "expected a storage upload");
  assertEquals(upload!.args[0], "org-1/HO-1.pdf");

  // stamped issued_at + pdf_path on the ready->issued transition
  const issuedUpdate = calls.find(
    (c) =>
      c.table === "hire_orders" && c.method === "update" &&
      (c.args[0] as { status?: string }).status === "issued",
  );
  assert(issuedUpdate, "expected an update to status issued");
  const upd = issuedUpdate!.args[0] as {
    issued_at?: string;
    pdf_path?: string;
  };
  assert(upd.issued_at, "issued_at stamped");
  assertEquals(upd.pdf_path, "org-1/HO-1.pdf");
  const sentUpdate = calls.find(
    (c) =>
      c.table === "hire_orders" && c.method === "update" &&
      "last_sent_at" in (c.args[0] as object),
  );
  assert(sentUpdate, "successful initial delivery stamps last_sent_at");
  assertEquals(
    (sentUpdate!.args[0] as { last_sent_at: string }).last_sent_at,
    "2026-06-01T12:00:00.000Z",
  );

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
  // and keyed by the order UUID because the route is /contracts/:id.
  assert(
    String(td.download_url).includes("/contracts/o-1"),
    `download_url was ${td.download_url}`,
  );
  // date_label is a timezone-safe human label, not the raw ISO string.
  assert(
    td.date_label !== "2026-06-15" && String(td.date_label).includes("2026"),
    `date_label was ${td.date_label}`,
  );
  assert(String(td.engagement_dates_label).includes("Jun 15, 2026"));
  assert(String(td.engagement_dates_label).includes("Jun 16, 2026"));
  assert(String(td.engagement_dates_label).includes("Huxleys"));

  // artist in-app notification (artist has a linked user_id)
  const notif = calls.find((c) =>
    c.table === "notifications" && c.method === "insert"
  );
  assert(notif, "expected an artist notification");
  const rows = notif!.args[0] as Array<{ type: string; user_id: string }>;
  assert(
    rows.some((r) =>
      r.type === "hire_order_issued" && r.user_id === "u-artist"
    ),
  );
});

Deno.test("issue keeps the order issued but does not stamp ambiguous email delivery", async () => {
  for (const data of [null, {}]) {
    const { deps, calls } = makeFakeDeps({
      authUser: { id: "u-admin" },
      emailResult: { data, error: null },
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

    const response = await handle(
      makeRequest({
        headers: JWT,
        body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
      }),
      deps,
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { issued: ["o-1"], failed: [] });
    assert(
      calls.some((call) =>
        call.table === "hire_orders" && call.method === "update" &&
        (call.args[0] as { status?: string }).status === "issued"
      ),
      "best-effort email non-delivery must preserve the issued transition",
    );
    assertEquals(
      calls.some((call) =>
        call.table === "hire_orders" && call.method === "update" &&
        "last_sent_at" in (call.args[0] as object)
      ),
      false,
      "ambiguous delivery must not stamp last_sent_at",
    );
  }
});

// `highlightRole` (docTypes.ts) is a preview-only field: an accent outline
// around a heading on an issued, hashed, artist-emailed PDF would be a real
// defect on a legal document. This guards the issue path never threads it
// through, by capturing what the renderer actually received (not merely that
// the request succeeded) — so a future change that wires the editor's
// selection into the issue call fails this test even though `issue` still
// returns 200 and a PDF.
Deno.test("issue never passes highlightRole to the renderer", async () => {
  const renderCalls: RenderInput[] = [];
  const { deps } = makeFakeDeps({
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
  deps.renderHireOrderPdf = (input) => {
    renderCalls.push(input);
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(renderCalls.length, 1, "expected exactly one render call for the issued order");
  assertEquals(renderCalls[0].highlightRole, undefined);
});

// ── resend ──────────────────────────────────────────────────────────────

function installStorageDownload(
  deps: ReturnType<typeof makeFakeDeps>["deps"],
  result: { data: Blob | null; error: unknown },
): string[] {
  const downloadedPaths: string[] = [];
  const storage = deps.admin.storage as unknown as {
    from: (bucket: string) => Record<string, unknown>;
  };
  const originalFrom = storage.from.bind(storage);
  storage.from = (bucket: string) => ({
    ...originalFrom(bucket),
    download: (path: string) => {
      downloadedPaths.push(path);
      return Promise.resolve(result);
    },
  });
  return downloadedPaths;
}

Deno.test("resend reuses the stored document and stamps last_sent_at only after the provider accepts", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    now: new Date("2026-06-01T12:00:00.000Z"),
    emailResult: { data: { success: true }, error: null },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        {
          when: { __write: false },
          data: issuableOrder({
            status: "countersigned",
            pdf_path: `${ORG}/HO-1.pdf`,
            signed_pdf_path: `${ORG}/HO-1-signed.pdf`,
            countersign_mode: "electronic",
            issue_snapshot: { countersign_mode: "electronic" },
          }),
        },
        { when: { __write: true }, data: null },
      ],
    },
  });
  const downloadedPaths = installStorageDownload(deps, {
    data: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
      type: "application/pdf",
    }),
    error: null,
  });
  deps.renderHireOrderPdf = () => {
    throw new Error("resend must not render");
  };

  const response = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "resend", org_id: ORG, order_id: "o-1" },
    }),
    deps,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { sent_at: "2026-06-01T12:00:00.000Z" });
  assertEquals(
    downloadedPaths,
    [`${ORG}/HO-1-signed.pdf`],
    "resend must prefer the immutable signed PDF when one exists",
  );
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assert(email, "stored PDF is delivered through the existing email helper");
  assertEquals(
    (email!.body as { idempotency_key: string }).idempotency_key,
    "hire-order-resend-o-1-2026-06-01T12:00:00.000Z",
  );
  assertEquals(
    (email!.body as { attachments: Array<{ filename: string }> }).attachments[0]
      .filename,
    "HO-1-signed.pdf",
  );
  const templateData = (email!.body as {
    templateData: Record<string, unknown>;
  }).templateData;
  assertEquals(templateData.is_fully_signed, true);
  assert(String(templateData.engagement_dates_label).includes("Jun 16, 2026"));
  const sentUpdate = calls.find(
    (c) =>
      c.table === "hire_orders" && c.method === "update" &&
      "last_sent_at" in (c.args[0] as object),
  );
  assert(sentUpdate, "provider acceptance stamps the order");
  assertEquals(
    (sentUpdate!.args[0] as { last_sent_at: string }).last_sent_at,
    "2026-06-01T12:00:00.000Z",
  );
});

Deno.test("resend preserves the issued electronic CTA while manual remains manual", async () => {
  for (
    const [issueSnapshot, storedMode, expectedMode, expectedSigningUrl] of [
      [
        { countersign_mode: "electronic" },
        "manual",
        "electronic",
        "https://app.showflow.pro/contracts/o-1",
      ],
      [{ countersign_mode: "manual" }, "electronic", "manual", undefined],
      [
        null,
        "electronic",
        "electronic",
        "https://app.showflow.pro/contracts/o-1",
      ],
    ] as const
  ) {
    const { deps, invokeCalls } = makeFakeDeps({
      authUser: { id: "u-admin" },
      emailResult: { data: { success: true }, error: null },
      tables: {
        org_memberships: { data: { role: "admin" } },
        hire_orders: [
          {
            when: { __write: false },
            data: issuableOrder({
              status: "issued",
              pdf_path: `${ORG}/HO-1.pdf`,
              signed_pdf_path: null,
              issue_snapshot: issueSnapshot,
              countersign_mode: storedMode,
            }),
          },
          { when: { __write: true }, data: null },
        ],
      },
    });
    installStorageDownload(deps, {
      data: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
        type: "application/pdf",
      }),
      error: null,
    });

    const response = await handle(
      makeRequest({
        headers: JWT,
        body: { action: "resend", org_id: ORG, order_id: "o-1" },
      }),
      deps,
    );

    assertEquals(response.status, 200);
    const email = invokeCalls.find((call) =>
      call.name === "send-transactional-email"
    );
    assert(email, "resend should use the issued email template");
    const templateData = (email!.body as {
      templateData: {
        countersign_mode: string;
        signing_url?: string;
      };
    }).templateData;
    assertEquals(templateData.countersign_mode, expectedMode);
    assertEquals(templateData.signing_url, expectedSigningUrl);
  }
});

Deno.test("resend provider failure leaves last_sent_at unchanged", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    emailResult: { data: null, error: { message: "provider down" } },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        {
          when: { __write: false },
          data: issuableOrder({
            status: "issued",
            pdf_path: `${ORG}/HO-1.pdf`,
            signed_pdf_path: null,
          }),
        },
        { when: { __write: true }, data: null },
      ],
    },
  });
  installStorageDownload(deps, {
    data: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
      type: "application/pdf",
    }),
    error: null,
  });

  const response = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "resend", org_id: ORG, order_id: "o-1" },
    }),
    deps,
  );

  assertEquals(response.status, 502);
  assertEquals((await response.json()).error, "email_failed");
  assertEquals(
    calls.some((c) =>
      c.table === "hire_orders" && c.method === "update" &&
      "last_sent_at" in (c.args[0] as object)
    ),
    false,
  );
});

Deno.test("resend suppressed delivery leaves last_sent_at unchanged", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    emailResult: {
      data: { success: false, reason: "email_suppressed" },
      error: null,
    },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        {
          when: { __write: false },
          data: issuableOrder({
            status: "issued",
            pdf_path: `${ORG}/HO-1.pdf`,
            signed_pdf_path: null,
          }),
        },
        { when: { __write: true }, data: null },
      ],
    },
  });
  installStorageDownload(deps, {
    data: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
      type: "application/pdf",
    }),
    error: null,
  });

  const response = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "resend", org_id: ORG, order_id: "o-1" },
    }),
    deps,
  );

  assertEquals(response.status, 502);
  assertEquals(
    calls.some((c) =>
      c.table === "hire_orders" && c.method === "update" &&
      "last_sent_at" in (c.args[0] as object)
    ),
    false,
  );
});

Deno.test("resend rejects null and empty provider data without stamping last_sent_at", async () => {
  for (const data of [null, {}]) {
    const { deps, calls } = makeFakeDeps({
      authUser: { id: "u-admin" },
      emailResult: { data, error: null },
      tables: {
        org_memberships: { data: { role: "admin" } },
        hire_orders: [
          {
            when: { __write: false },
            data: issuableOrder({
              status: "issued",
              pdf_path: `${ORG}/HO-1.pdf`,
              signed_pdf_path: null,
            }),
          },
          { when: { __write: true }, data: null },
        ],
      },
    });
    installStorageDownload(deps, {
      data: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
        type: "application/pdf",
      }),
      error: null,
    });

    const response = await handle(
      makeRequest({
        headers: JWT,
        body: { action: "resend", org_id: ORG, order_id: "o-1" },
      }),
      deps,
    );

    assertEquals(response.status, 502);
    assertEquals((await response.json()).error, "email_failed");
    assertEquals(
      calls.some((call) =>
        call.table === "hire_orders" && call.method === "update" &&
        "last_sent_at" in (call.args[0] as object)
      ),
      false,
    );
  }
});

Deno.test("resend threads the frozen issue-snapshot locale to the wrapper email (de, entitled)", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    now: new Date("2026-06-01T12:00:00.000Z"),
    emailResult: { data: { success: true }, error: null },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        {
          when: { __write: false },
          data: issuableOrder({
            status: "issued",
            pdf_path: `${ORG}/HO-1.pdf`,
            countersign_mode: "manual",
            issue_snapshot: { countersign_mode: "manual", locale: "de" },
          }),
        },
        { when: { __write: true }, data: null },
      ],
    },
  });
  installStorageDownload(deps, {
    data: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
      type: "application/pdf",
    }),
    error: null,
  });

  const response = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "resend", org_id: ORG, order_id: "o-1" },
    }),
    deps,
  );

  assertEquals(response.status, 200);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assert(email, "resend delivers through send-transactional-email");
  assertEquals(
    (email!.body as { locale?: string }).locale,
    "de",
    "the frozen snapshot locale is forced on the whole email",
  );
});

// The entitlement re-gate on the replayed locale (a frozen "de" falling back to
// "en" when the org later loses language_packages) lives in resolveOrgLocale and
// is covered at the send-transactional-email layer; it can't be exercised here
// because a false is_feature_enabled fake would also trip the hire_orders gate.

Deno.test("issue refuses orders failing the ready gate and reports issue codes", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        {
          when: { __write: false },
          data: issuableOrder({
            data: {
              recipient_email: { value: "ann@x.de", source: "showflow" },
              date: { value: "2026-06-15", source: "showflow" },
            },
          }),
        },
        { when: { __write: true }, data: null },
      ],
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  const body = await res.json();
  assertEquals(body.issued, []);
  assertEquals(body.failed[0].order_id, "o-1");
  assert(body.failed[0].issues.includes("missing_fee"), "reports missing_fee");
  // gate failed before rendering
  assertEquals(
    calls.filter((c) => c.table === "storage:hire-orders").length,
    0,
  );
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

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  const body = await res.json();
  assertEquals(body.issued, []);
  assertEquals(body.failed[0].order_id, "o-1");
  assert(
    body.failed[0].issues.includes("missing_terms"),
    "reports missing_terms",
  );
});

Deno.test("issue of an order whose terms_variant points at a deleted template renders the default template's clauses", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        {
          when: { __write: false },
          data: issuableOrder({ terms_variant: "deleted-template" }),
        },
        { when: { __write: true }, data: null },
      ],
      artists: { data: { user_id: "u-artist" } },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        {
          when: { key: "hire_order_terms" },
          data: [TERMS_TEMPLATES_DEFAULT_FILLED],
        },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured: { terms: Array<{ title: string; body: string }> } | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.issued, ["o-1"]);
  assertEquals(captured!.terms, [{ title: "T2", body: "B2" }]);
});

Deno.test("issue with a deleted-template reference falling back to an empty default still fails missing_terms", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        {
          when: { __write: false },
          data: issuableOrder({ terms_variant: "deleted-template" }),
        },
        { when: { __write: true }, data: null },
      ],
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        {
          when: { key: "hire_order_terms" },
          data: [TERMS_TEMPLATES_DEFAULT_EMPTY],
        },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  const body = await res.json();
  assertEquals(body.issued, []);
  assert(
    body.failed[0].issues.includes("missing_terms"),
    "reports missing_terms even when falling back to the default template",
  );
  assertEquals(
    calls.filter((c) => c.table === "storage:hire-orders").length,
    0,
    "gate failed before rendering",
  );
});

Deno.test("issue is idempotent per order (already issued -> failed with already_issued)", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [{
        when: { __write: false },
        data: issuableOrder({ status: "issued" }),
      }],
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  const body = await res.json();
  assertEquals(body.issued, []);
  assert(body.failed[0].issues.includes("already_issued"));
});

Deno.test("issue merges the order's agent override over the org letterhead", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        {
          when: { __write: false },
          data: issuableOrder({
            agent_name: "Solo Agent",
            agent_email: "solo@x.com",
          }),
        },
        { when: { __write: true }, data: null },
      ],
      artists: { data: { user_id: "u-artist" } },
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{
            org_id: ORG,
            value: {
              legal_name: "Nord GmbH",
              address_lines: [],
              registration_line: "",
              agent_name: "Org Agent",
              agent_email: "org@x.com",
            },
          }],
        },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured:
    | { letterhead: { agent_name?: string; agent_email?: string } }
    | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured!.letterhead.agent_name, "Solo Agent");
  assertEquals(captured!.letterhead.agent_email, "solo@x.com");
});

Deno.test("issue resolves the org agent signature and passes it to the renderer as a data url", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    storageDownloadResult: {
      data: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]),
      error: null,
    },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: issuableOrder() },
        { when: { __write: true }, data: null },
      ],
      artists: { data: { user_id: "u-artist" } },
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{
            org_id: ORG,
            value: {
              legal_name: "Nord GmbH",
              address_lines: [],
              agent_signature_path: `${ORG}/agent-signature.png`,
            },
          }],
        },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured: { letterhead: { agent_signature_data_url?: string | null } } | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }),
    deps,
  );
  assertEquals(res.status, 200);
  const url = captured!.letterhead.agent_signature_data_url ?? "";
  assertEquals(url.startsWith("data:image/png;base64,"), true);
});

Deno.test("bulk issue downloads the shared agent signature once, not once per order", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    storageDownloadResult: {
      data: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]),
      error: null,
    },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: issuableOrder() },
        { when: { __write: true }, data: null },
      ],
      artists: { data: { user_id: "u-artist" } },
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{
            org_id: ORG,
            value: {
              legal_name: "Nord GmbH",
              address_lines: [],
              agent_signature_path: `${ORG}/agent-signature.png`,
            },
          }],
        },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  deps.renderHireOrderPdf = () => Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));

  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1", "o-2"] } }),
    deps,
  );
  assertEquals(res.status, 200);
  // Both orders share the org's single signature; it must be fetched once for the
  // whole batch, not once per order.
  assertEquals(calls.filter((c) => c.method === "download").length, 1);
});

Deno.test("issue inherits the letterhead agent when the order override is null", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        {
          when: { __write: false },
          data: issuableOrder({ agent_name: null, agent_email: null }),
        },
        { when: { __write: true }, data: null },
      ],
      artists: { data: { user_id: "u-artist" } },
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{
            org_id: ORG,
            value: {
              legal_name: "Nord GmbH",
              address_lines: [],
              registration_line: "",
              agent_name: "Org Agent",
              agent_email: "org@x.com",
            },
          }],
        },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured:
    | { letterhead: { agent_name?: string; agent_email?: string } }
    | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured!.letterhead.agent_name, "Org Agent");
  assertEquals(captured!.letterhead.agent_email, "org@x.com");
});

Deno.test("issue stamps issued_pdf_sha256 on the issued update", async () => {
  const { deps, calls } = makeFakeDeps({
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
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const issuedUpdate = calls.find(
    (c) =>
      c.table === "hire_orders" && c.method === "update" &&
      (c.args[0] as { status?: string }).status === "issued",
  );
  const upd = issuedUpdate!.args[0] as { issued_pdf_sha256?: string };
  assert(
    typeof upd.issued_pdf_sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(upd.issued_pdf_sha256),
    "64-char hex hash stamped",
  );
});

Deno.test("issue snapshots the resolved letterhead + terms on the issued update", async () => {
  // The signed re-render (the sign action) must reproduce the issued document even
  // if the org edits its letterhead/terms afterwards, so issue freezes both into
  // issue_snapshot on the ready->issued transition.
  const { deps, calls } = makeFakeDeps({
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
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  assertEquals(res.status, 200);

  const issuedUpdate = calls.find(
    (c) =>
      c.table === "hire_orders" && c.method === "update" &&
      (c.args[0] as { status?: string }).status === "issued",
  );
  assert(issuedUpdate, "expected the issued update");
  const snap = (issuedUpdate!.args[0] as {
    issue_snapshot?: {
      letterhead?: { legal_name?: string };
      terms?: Array<{ title: string }>;
      countersign_mode?: string;
    };
  }).issue_snapshot;
  assert(snap, "the issued update writes issue_snapshot");
  assertEquals(
    snap!.letterhead?.legal_name,
    "Nord GmbH",
    "snapshot carries the resolved letterhead",
  );
  assert(
    Array.isArray(snap!.terms) && snap!.terms.length > 0,
    "snapshot carries a non-empty terms array",
  );
  assertEquals(
    snap!.terms![0].title,
    "T",
    "snapshot terms are the resolved variant terms",
  );
  // The snapshot also freezes the issue-time countersign mode (no setting -> manual default).
  assertEquals(
    snap!.countersign_mode,
    "manual",
    "snapshot freezes the issue-time countersign mode",
  );
});

Deno.test("issue freezes the countersign mode into issue_snapshot (electronic)", async () => {
  // The electronic-vs-manual signing gate must follow the mode the order was ISSUED
  // under, not the org's live setting, so issue freezes countersign.mode into the
  // snapshot alongside the letterhead/terms.
  const { deps, calls } = makeFakeDeps({
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
        {
          when: { key: "hire_order_countersign" },
          data: [{ org_id: ORG, value: { mode: "electronic" } }],
        },
      ],
    },
  });
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  assertEquals(res.status, 200);

  const issuedUpdate = calls.find(
    (c) =>
      c.table === "hire_orders" && c.method === "update" &&
      (c.args[0] as { status?: string }).status === "issued",
  );
  const snap = (issuedUpdate!.args[0] as {
    issue_snapshot?: { countersign_mode?: string };
  }).issue_snapshot;
  assertEquals(
    snap!.countersign_mode,
    "electronic",
    "snapshot freezes the electronic issue-time mode",
  );
});

Deno.test("issue in electronic mode emails a signing_url pointing at the in-app order page", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
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
        {
          when: { key: "hire_order_countersign" },
          data: [{ org_id: ORG, value: { mode: "electronic" } }],
        },
      ],
    },
  });
  await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  const td =
    (email!.body as { templateData: Record<string, unknown> }).templateData;
  assertEquals(td.countersign_mode, "electronic");
  assert(
    String(td.signing_url).includes("/contracts/o-1"),
    `signing_url was ${td.signing_url}`,
  );
});

// ── documenso countersign ────────────────────────────────────────────────

/** A fake fetch that plays back the create -> recipient -> distribute sequence
 *  createAndSendEnvelope issues, keyed by URL suffix (order-independent). */
function fakeDocumensoFetch(): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.endsWith("/envelope/create")) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: "envelope_1" }), { status: 200 }),
      );
    }
    if (u.endsWith("/recipient/create-many")) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ token: "sign-tok" }] }), {
          status: 200,
        }),
      );
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
    // The base URL is OPERATOR-controlled only, via this edge secret — never the
    // per-org setting (see the ignored `base_url` below, a different host entirely).
    envVars: {
      DOCUMENSO_API_TOKEN: "tok-secret",
      DOCUMENSO_BASE_URL: "https://documenso.test",
    },
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
          // An attacker-controlled (or merely stale) org setting base_url that MUST
          // be ignored — the shared DOCUMENSO_API_TOKEN would otherwise leak to it.
          when: { key: "hire_order_countersign" },
          data: [{
            org_id: ORG,
            value: {
              mode: "documenso",
              base_url: "https://attacker.example.com",
            },
          }],
        },
      ],
    },
  });

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  const body = await res.json();
  assertEquals(body.issued, ["o-1"]);
  assertEquals(body.failed, []);

  assertEquals(
    docCalls.length,
    3,
    "expected the create -> recipient -> distribute sequence",
  );
  for (const c of docCalls) {
    assert(
      c.url.startsWith("https://documenso.test/"),
      `expected the env-configured host, not the org setting's base_url: ${c.url}`,
    );
    const headers = new Headers(c.init?.headers);
    // Documenso API v1 uses the raw api_... token with no "Bearer " scheme.
    assertEquals(headers.get("Authorization"), "tok-secret");
  }

  const csUpdate = calls.find(
    (c) =>
      c.table === "hire_orders" && c.method === "update" &&
      "countersign_mode" in (c.args[0] as object),
  );
  assert(csUpdate, "expected a countersign_mode/documenso_envelope_id update");
  const csRow = csUpdate!.args[0] as {
    countersign_mode: string;
    documenso_envelope_id: string;
  };
  assertEquals(csRow.countersign_mode, "documenso");
  assertEquals(csRow.documenso_envelope_id, "envelope_1");

  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assert(email, "expected the issued email");
  const td =
    (email!.body as { templateData: Record<string, unknown> }).templateData;
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
        {
          when: { key: "hire_order_countersign" },
          data: [{ org_id: ORG, value: { mode: "manual" } }],
        },
      ],
    },
  });

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  const body = await res.json();
  assertEquals(body.issued, ["o-1"]);
  assertEquals(fetchCalls, 0, "manual mode must never call Documenso");
});

Deno.test("issue keeps the order issued with a documenso_failed warning when Documenso errors (never un-issues)", async () => {
  const fetchImpl = (() =>
    Promise.resolve(
      new Response("unauthorized", { status: 401 }),
    )) as typeof fetch;
  const { deps, calls, invokeCalls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    fetchImpl,
    envVars: {
      DOCUMENSO_API_TOKEN: "tok-secret",
      DOCUMENSO_BASE_URL: "https://documenso.test",
    },
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
          data: [{ org_id: ORG, value: { mode: "documenso" } }],
        },
      ],
    },
  });

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "issue", org_id: ORG, order_ids: ["o-1"] },
    }),
    deps,
  );
  const body = await res.json();
  assertEquals(
    body.issued,
    ["o-1"],
    "the document stays issued despite the Documenso failure",
  );
  assertEquals(body.failed, [{
    order_id: "o-1",
    issues: ["documenso_failed"],
  }]);

  const csUpdate = calls.find(
    (c) =>
      c.table === "hire_orders" && c.method === "update" &&
      "countersign_mode" in (c.args[0] as object),
  );
  assert(csUpdate, "expected a countersign_mode fallback update");
  assertEquals(
    (csUpdate!.args[0] as { countersign_mode: string }).countersign_mode,
    "manual",
  );

  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assert(email, "expected the issued email to still send");
  const td =
    (email!.body as { templateData: Record<string, unknown> }).templateData;
  assertEquals(td.countersign_mode, "manual");
  assertEquals(td.signing_url, undefined);
});

Deno.test("countersign-test is admin-only, checks connectivity against the env-configured host, and never leaks the token", async () => {
  const producerCalls: Array<{ url: string; init?: RequestInit }> = [];
  const producerFetchImpl =
    ((url: string | URL | Request, init?: RequestInit) => {
      producerCalls.push({ url: String(url), init });
      return Promise.resolve(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );
    }) as typeof fetch;

  // Producer passes the coarse draft/issue gate but must be rejected here (admin-only).
  // The request body's base_url is attacker-controllable and MUST be ignored — see
  // the admin assertions below, which prove the real request goes to the env host.
  const producer = makeFakeDeps({
    authUser: { id: "u-producer" },
    fetchImpl: producerFetchImpl,
    envVars: {
      DOCUMENSO_API_TOKEN: "tok-secret",
      DOCUMENSO_BASE_URL: "https://documenso.test",
    },
    tables: { org_memberships: { data: { role: "producer" } } },
  });
  const producerRes = await handle(
    makeRequest({
      headers: JWT,
      body: {
        action: "countersign-test",
        org_id: ORG,
        base_url: "https://attacker.example.com",
      },
    }),
    producer.deps,
  );
  assertEquals(producerRes.status, 403);

  const adminCalls: Array<{ url: string; init?: RequestInit }> = [];
  const adminFetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    adminCalls.push({ url: String(url), init });
    return Promise.resolve(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
  }) as typeof fetch;
  const admin = makeFakeDeps({
    authUser: { id: "u-admin" },
    fetchImpl: adminFetchImpl,
    envVars: {
      DOCUMENSO_API_TOKEN: "tok-secret",
      DOCUMENSO_BASE_URL: "https://documenso.test",
    },
    tables: { org_memberships: { data: { role: "admin" } } },
  });
  const adminRes = await handle(
    // A body-supplied base_url (attacker or otherwise) is IGNORED entirely.
    makeRequest({
      headers: JWT,
      body: {
        action: "countersign-test",
        org_id: ORG,
        base_url: "https://attacker.example.com",
      },
    }),
    admin.deps,
  );
  assertEquals(adminRes.status, 200);
  const adminBody = await adminRes.json();
  assertEquals(adminBody.ok, true);
  assert(typeof adminBody.detail === "string");
  assert(
    !JSON.stringify(adminBody).includes("tok-secret"),
    "the token must never be echoed back",
  );

  assertEquals(
    adminCalls.length,
    1,
    "expected a single Documenso connectivity check request",
  );
  assert(
    adminCalls[0].url.startsWith("https://documenso.test/"),
    `expected the env-configured host, not the body's base_url: ${
      adminCalls[0].url
    }`,
  );
  const headers = new Headers(adminCalls[0].init?.headers);
  // Documenso API v1 uses the raw api_... token with no "Bearer " scheme.
  assertEquals(headers.get("Authorization"), "tok-secret");
});

Deno.test("countersign-test falls back to the hosted app.documenso.com when DOCUMENSO_BASE_URL is unset", async () => {
  const calls: Array<{ url: string }> = [];
  const fetchImpl = ((url: string | URL | Request) => {
    calls.push({ url: String(url) });
    return Promise.resolve(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
  }) as typeof fetch;
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    fetchImpl,
    envVars: { DOCUMENSO_API_TOKEN: "tok-secret" },
    tables: { org_memberships: { data: { role: "admin" } } },
  });
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "countersign-test", org_id: ORG },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
  assert(calls[0].url.startsWith("https://app.documenso.com/"));
});

Deno.test("countersign-test rejects a non-https DOCUMENSO_BASE_URL instead of silently falling back", async () => {
  let fetchCalls = 0;
  const fetchImpl = (() => {
    fetchCalls++;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    fetchImpl,
    envVars: {
      DOCUMENSO_API_TOKEN: "tok-secret",
      DOCUMENSO_BASE_URL: "http://insecure.example.com",
    },
    tables: { org_memberships: { data: { role: "admin" } } },
  });
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "countersign-test", org_id: ORG },
    }),
    deps,
  );
  assertEquals(
    res.status,
    200,
    "connectivity failures are reported in the body, never a 500",
  );
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.detail, "documenso_base_url_invalid");
  assertEquals(fetchCalls, 0, "must never call an insecure host");
});

Deno.test("countersign-test reports ok:false without throwing when Documenso is unreachable/unauthorized", async () => {
  const fetchImpl = (() =>
    Promise.resolve(
      new Response("unauthorized", { status: 401 }),
    )) as typeof fetch;
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    fetchImpl,
    envVars: {
      DOCUMENSO_API_TOKEN: "tok-secret",
      DOCUMENSO_BASE_URL: "https://documenso.test",
    },
    tables: { org_memberships: { data: { role: "admin" } } },
  });
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "countersign-test", org_id: ORG },
    }),
    deps,
  );
  assertEquals(
    res.status,
    200,
    "connectivity failures are reported in the body, never a 500",
  );
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
        {
          when: { __write: true },
          error: { code: "23505", message: "duplicate key" },
        },
      ],
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
  });

  await handle(
    makeRequest({
      headers: JWT,
      body: { action: "draft", org_id: ORG, show_date_id: SD },
    }),
    deps,
  );

  const orderNos = calls
    .filter((c) => c.table === "hire_orders" && c.method === "insert")
    .map((c) => (c.args[0] as { order_no: string }).order_no);
  assert(orderNos.length >= 2, "retried after the collision");
  assert(
    orderNos.some((n) => n.endsWith("-2")),
    `expected a -2 suffix, got ${JSON.stringify(orderNos)}`,
  );
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

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "preview", org_id: ORG, order_id: "o-1" },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.pdf_base64, "JVBERg=="); // base64 of the fake "%PDF" bytes
  // nothing persisted
  assertEquals(
    calls.filter((c) =>
      c.table === "hire_orders" && ["insert", "update"].includes(c.method)
    ).length,
    0,
  );
});

Deno.test("preview merges the order's agent override over the org letterhead", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: {
        data: issuableOrder({
          agent_name: "Solo Agent",
          agent_email: "solo@x.com",
        }),
      },
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{
            org_id: ORG,
            value: {
              legal_name: "Nord GmbH",
              address_lines: [],
              registration_line: "",
              agent_name: "Org Agent",
              agent_email: "org@x.com",
            },
          }],
        },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured:
    | { letterhead: { agent_name?: string; agent_email?: string } }
    | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "preview", org_id: ORG, order_id: "o-1" },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured!.letterhead.agent_name, "Solo Agent");
  assertEquals(captured!.letterhead.agent_email, "solo@x.com");
});

Deno.test("preview inherits the letterhead agent when the order override is null", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: {
        data: issuableOrder({ agent_name: null, agent_email: null }),
      },
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{
            org_id: ORG,
            value: {
              legal_name: "Nord GmbH",
              address_lines: [],
              registration_line: "",
              agent_name: "Org Agent",
              agent_email: "org@x.com",
            },
          }],
        },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured:
    | { letterhead: { agent_name?: string; agent_email?: string } }
    | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };

  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "preview", org_id: ORG, order_id: "o-1" },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured!.letterhead.agent_name, "Org Agent");
  assertEquals(captured!.letterhead.agent_email, "org@x.com");
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
    makeRequest({
      headers: { Authorization: "Bearer artist-jwt" },
      body: { action: "download-url", org_id: ORG, order_id: "o-1" },
    }),
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
    makeRequest({
      headers: { Authorization: "Bearer other-jwt" },
      body: { action: "download-url", org_id: ORG, order_id: "o-1" },
    }),
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
    makeRequest({
      headers: { Authorization: "Bearer artist-jwt" },
      body: { action: "download-url", org_id: ORG, order_id: "o-1" },
    }),
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
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "draft", org_id: ORG, show_date_id: SD },
    }),
    deps,
  );
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
        {
          when: { key: "hire_order_letterhead" },
          data: [{
            org_id: "org-B",
            value: { legal_name: "B GmbH", address_lines: [] },
          }],
        },
        {
          when: { key: "hire_order_terms" },
          data: [{
            org_id: "org-B",
            value: { lean: [], standard: [], full: [] },
          }],
        },
        {
          when: { key: "hire_order_defaults" },
          data: [{
            org_id: "org-B",
            value: { default_fee: null, currency: "EUR" },
          }],
        },
      ],
    },
  });
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "preview", org_id: "org-B", order_id: "o-1" },
    }),
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

// ── sign action ────────────────────────────────────────────────────────────

const SIGN_ORDER = {
  id: "o-1",
  org_id: ORG,
  order_no: "HO-1",
  status: "issued",
  artist_id: "a-A",
  terms_variant: "standard",
  fee_currency: "EUR",
  agent_name: null,
  agent_email: null,
  issued_pdf_sha256: "c".repeat(64),
  show_date_id: SD,
  show_dates: {
    city_id: "city-1",
    shows: { program: "Aida", sub_program: null },
  },
  data: {
    artist_name: { value: "Ann", source: "showflow" },
    recipient_email: { value: "ann@x.de", source: "showflow" },
    date: { value: "2026-06-15", source: "showflow" },
    venue: { value: "Colosseum", source: "showflow" },
    fee: { value: 500, source: "showflow" },
  },
};

function signDeps(
  overrides: {
    order?: unknown;
    artist?: unknown;
    mode?: string;
    featureOn?: boolean;
  } = {},
) {
  return makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: {
      is_feature_enabled: { data: overrides.featureOn ?? true, error: null },
    },
    tables: {
      hire_orders: [
        { when: { __write: false }, data: overrides.order ?? SIGN_ORDER },
        { when: { __write: true }, data: [{ id: "o-1" }] }, // the guarded transition matched a row
      ],
      // Preserve an EXPLICIT null (unrelated user: the artist lookup finds no row) —
      // `?? { id: "a-A" }` would swallow it and make every caller look linked.
      artists: {
        data: "artist" in overrides ? overrides.artist : { id: "a-A" },
      },
      org_memberships: { data: [] },
      app_settings: [
        {
          when: { key: "hire_order_countersign" },
          data: [{
            org_id: ORG,
            value: { mode: overrides.mode ?? "electronic" },
          }],
        },
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
}

const SIGN_BODY = {
  action: "sign",
  org_id: ORG,
  order_id: "o-1",
  method: "typed",
  typed_name: "Ann Lee",
  consent: true,
};

Deno.test("sign: linked artist signs an issued electronic order -> countersigned", async () => {
  const { deps, calls, invokeCalls } = signDeps();
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: SIGN_BODY,
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.countersigned, true);
  // signed PDF uploaded
  const up = calls.find((c) =>
    c.table === "storage:hire-orders" && c.method === "upload" &&
    String(c.args[0]).endsWith("-signed.pdf")
  );
  assert(up, "signed pdf uploaded");
  // audit row inserted
  const sig = calls.find((c) =>
    c.table === "hire_order_signatures" && c.method === "insert"
  );
  assert(sig, "audit row inserted");
  const row = (sig!.args[0] as Array<Record<string, unknown>>)[0]; // insert([{...}]) -> first row
  assertEquals(row.method, "typed");
  assertEquals(row.hire_order_id, "o-1");
  assertEquals(row.document_sha256, "c".repeat(64));
  // transitioned with signed_pdf_path + countersign_mode
  const upd = calls.find((c) =>
    c.table === "hire_orders" && c.method === "update" &&
    (c.args[0] as { status?: string }).status === "countersigned"
  );
  const patch = upd!.args[0] as {
    signed_pdf_path?: string;
    countersign_mode?: string;
  };
  assert(patch.signed_pdf_path?.endsWith("-signed.pdf"));
  assertEquals(patch.countersign_mode, "electronic");
  // countersigned email to the artist
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertEquals(
    (email!.body as { template_name: string }).template_name,
    "hire-order-countersigned",
  );
});

Deno.test("sign: an unrelated user is rejected 403", async () => {
  const { deps } = signDeps({ artist: null });
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer other" },
      body: SIGN_BODY,
    }),
    deps,
  );
  assertEquals(res.status, 403);
});

Deno.test("sign: consent is required", async () => {
  const { deps } = signDeps();
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: { ...SIGN_BODY, consent: false },
    }),
    deps,
  );
  assertEquals(res.status, 400);
});

Deno.test("sign: a non-issued order is rejected 409", async () => {
  const { deps } = signDeps({ order: { ...SIGN_ORDER, status: "draft" } });
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: SIGN_BODY,
    }),
    deps,
  );
  assertEquals(res.status, 409);
});

Deno.test("sign: already-countersigned order is an idempotent 200", async () => {
  const { deps } = signDeps({
    order: { ...SIGN_ORDER, status: "countersigned" },
  });
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: SIGN_BODY,
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).idempotent, true);
});

Deno.test("sign: 23505 on the audit insert falls through to the guarded flip and completes the countersign when the order is still issued", async () => {
  // A prior submit inserted the audit row but its status flip then FAILED, leaving
  // the order stranded at 'issued' with an orphan audit row. This retry passes the
  // status==="issued" guard, re-does the work, and hits 23505 on the insert. It must
  // NOT blind-return success: it falls through to the guarded flip, which finds the
  // order still 'issued', completes the countersign, and runs the side effects once
  // (the prior submit whose flip failed never ran them).
  const { deps, calls, invokeCalls } = makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      hire_orders: [
        { when: { __write: false }, data: SIGN_ORDER }, // read -> still issued
        { when: { __write: true }, data: [{ id: "o-1" }] }, // guarded flip matches -> completes
      ],
      artists: { data: { id: "a-A" } },
      org_memberships: { data: [] },
      hire_order_signatures: { error: { code: "23505" } },
      app_settings: [
        {
          when: { key: "hire_order_countersign" },
          data: [{ org_id: ORG, value: { mode: "electronic" } }],
        },
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });

  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: SIGN_BODY,
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.countersigned, true);
  assertEquals(
    body.idempotent,
    undefined,
    "a real completion is not the idempotent no-op",
  );

  // The guarded flip IS the single source of truth: assert it was attempted, not a
  // blind early-return that reports success without flipping.
  const flip = calls.find((c) =>
    c.table === "hire_orders" && c.method === "update" &&
    (c.args[0] as { status?: string }).status === "countersigned"
  );
  assert(flip, "expected the guarded flip to status countersigned");

  // Side effects ran once, because the flip actually completed the countersign.
  const email = invokeCalls.find((c) =>
    c.name === "send-transactional-email" &&
    (c.body as { template_name?: string }).template_name ===
      "hire-order-countersigned"
  );
  assert(email, "expected the countersigned email once the flip completed");
});

Deno.test("sign: 23505 on the audit insert with an already-flipped order is an idempotent 200 with no side effects", async () => {
  // A concurrent winner already inserted the audit row AND flipped the order. This
  // loser hits 23505 on insert, falls through to the guarded flip, which matches no
  // 'issued' row (already countersigned) -> !affected -> idempotent, no side effects
  // (they belong to the winner).
  const { deps, calls, invokeCalls } = makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      hire_orders: [
        { when: { __write: false }, data: SIGN_ORDER },
        { when: { __write: true }, data: [] }, // guarded flip matches nothing -> already flipped
      ],
      artists: { data: { id: "a-A" } },
      org_memberships: { data: [] },
      hire_order_signatures: { error: { code: "23505" } },
      app_settings: [
        {
          when: { key: "hire_order_countersign" },
          data: [{ org_id: ORG, value: { mode: "electronic" } }],
        },
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });

  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: SIGN_BODY,
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).idempotent, true);

  // No side effects — the winning request owns them.
  assertEquals(
    calls.filter((c) => c.table === "notifications" && c.method === "insert")
      .length,
    0,
  );
  assertEquals(
    invokeCalls.filter((c) => c.name === "send-transactional-email").length,
    0,
  );
});

Deno.test("sign: a non-23505 audit-insert error still fails 500 (signature_insert_failed)", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      hire_orders: [
        { when: { __write: false }, data: SIGN_ORDER },
        { when: { __write: true }, data: [{ id: "o-1" }] },
      ],
      artists: { data: { id: "a-A" } },
      org_memberships: { data: [] },
      hire_order_signatures: {
        error: { code: "23502", message: "not-null violation" },
      },
      app_settings: [
        {
          when: { key: "hire_order_countersign" },
          data: [{ org_id: ORG, value: { mode: "electronic" } }],
        },
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: SIGN_BODY,
    }),
    deps,
  );
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "signature_insert_failed");
});

Deno.test("sign: manual-mode org is rejected 409 wrong_mode", async () => {
  const { deps } = signDeps({ mode: "manual" });
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: SIGN_BODY,
    }),
    deps,
  );
  assertEquals(res.status, 409);
});

Deno.test("sign: order issued electronic still signs even after the org switched to manual (issue-time mode drives the gate)", async () => {
  // The order was ISSUED electronic (frozen in issue_snapshot); the org's LIVE
  // hire_order_countersign is now manual. The gate must follow the frozen issue-time
  // mode, so the linked artist can still sign — otherwise a mid-flight org switch would
  // strand the order (the DB gate keys off the same frozen mode).
  const snapshotOrder = {
    ...SIGN_ORDER,
    issue_snapshot: {
      letterhead: { legal_name: "Snapshot GmbH", address_lines: [] },
      terms: [{ title: "SNAP", body: "snapshot terms" }],
      currency: "EUR",
      countersign_mode: "electronic",
    },
  };
  const { deps } = signDeps({ order: snapshotOrder, mode: "manual" });
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: SIGN_BODY,
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).countersigned, true);
});

Deno.test("sign: feature-off org is denied", async () => {
  const { deps } = signDeps({ featureOn: false });
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: SIGN_BODY,
    }),
    deps,
  );
  assert(
    res.status === 403 || res.status === 402,
    `feature gate status was ${res.status}`,
  );
});

Deno.test("download-url serves the signed copy once signed_pdf_path is set", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-artist" },
    tables: {
      org_memberships: { data: [] },
      platform_admins: { data: null },
      hire_orders: {
        data: {
          id: "o-1",
          org_id: ORG,
          artist_id: "a-A",
          status: "countersigned",
          pdf_path: "org-1/HO-1.pdf",
          signed_pdf_path: "org-1/HO-1-signed.pdf",
          order_no: "HO-1",
        },
      },
      artists: { data: { id: "a-A" } },
    },
  });
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: { action: "download-url", org_id: ORG, order_id: "o-1" },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const signCall = calls.find((c) =>
    c.table === "storage:hire-orders" && c.method === "createSignedUrl"
  );
  assertEquals(signCall!.args[0], "org-1/HO-1-signed.pdf");
});

Deno.test("sign: drawn method uploads the signature image and records method drawn", async () => {
  const { deps, calls } = signDeps();
  // 2x1 opaque RGBA PNG: one #15131C pixel and one white pixel. This mirrors the
  // dark-mode canvas export (white ink on an opaque dark surface), so the stored
  // image and the image handed to the PDF renderer both contain visible contrast.
  const signaturePng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGMQFZb5DwIAEM8FQMsechsAAAAASUVORK5CYII=";
  let renderedSignaturePng: string | undefined;
  deps.renderHireOrderPdf = (input) => {
    renderedSignaturePng = input.signature?.imageDataUrl;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: {
        action: "sign",
        org_id: ORG,
        order_id: "o-1",
        method: "drawn",
        signature_png: signaturePng,
        consent: true,
      },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).countersigned, true);

  // The drawn PNG is uploaded to the signatures/ path (distinct from the signed PDF).
  const imgUpload = calls.find((c) =>
    c.table === "storage:hire-orders" && c.method === "upload" &&
    String(c.args[0]).endsWith("signatures/HO-1.png")
  );
  assert(imgUpload, "signature image uploaded to signatures/HO-1.png");
  const expectedBytes = Uint8Array.from(
    atob(signaturePng.slice(signaturePng.indexOf(",") + 1)),
    (char) => char.charCodeAt(0),
  );
  assertEquals(imgUpload!.args[1], expectedBytes);
  assertEquals(
    renderedSignaturePng,
    signaturePng,
    "the same contrast-bearing PNG is embedded in the signed PDF",
  );

  // Audit row carries method drawn + the image path, and no typed_name.
  const sig = calls.find((c) =>
    c.table === "hire_order_signatures" && c.method === "insert"
  );
  assert(sig, "audit row inserted");
  const row = (sig!.args[0] as Array<Record<string, unknown>>)[0]; // insert([{...}]) -> first row
  assertEquals(row.method, "drawn");
  assert(
    String(row.signature_image_path).endsWith("signatures/HO-1.png"),
    `signature_image_path was ${row.signature_image_path}`,
  );
  assertEquals(row.typed_name, null);
});

Deno.test("sign: a malformed drawn-signature payload is a clean 400, not an unhandled 500", async () => {
  // Prefix-valid but body-undecodable base64 (invalid chars after the data: URL
  // prefix): decodeBase64 throws. handle() has no try/catch around signOrder, so
  // without the guard this escapes as a CORS-less 500. It must be a clean 400
  // invalid_signature (the shape the other payload-validation failures use), and
  // must bail BEFORE any image upload / audit insert / status flip.
  const { deps, calls } = signDeps();
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: {
        action: "sign",
        org_id: ORG,
        order_id: "o-1",
        method: "drawn",
        signature_png: "data:image/png;base64,!!!not-valid-base64!!!",
        consent: true,
      },
    }),
    deps,
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "invalid_signature");

  assertEquals(
    calls.filter((c) =>
      c.table === "storage:hire-orders" && c.method === "upload"
    ).length,
    0,
  );
  assertEquals(
    calls.filter((c) =>
      c.table === "hire_order_signatures" && c.method === "insert"
    ).length,
    0,
  );
  assertEquals(
    calls.filter((c) => c.table === "hire_orders" && c.method === "update")
      .length,
    0,
  );
});

Deno.test("sign: a valid-base64 but non-PNG drawn-signature payload is a clean 400, not a render 500", async () => {
  // btoa("not a png") is VALID base64 that decodes fine, so it slips past the
  // decode try/catch — but the bytes are not a PNG. Without the magic-byte guard
  // it would be uploaded and then crash the react-pdf <Image> render into an
  // uncaught CORS-less 500. It must be a clean 400 invalid_signature, bailing
  // before any upload / audit insert / status flip.
  const nonPng = btoa("not a png"); // valid base64, non-PNG bytes
  const { deps, calls } = signDeps();
  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: {
        action: "sign",
        org_id: ORG,
        order_id: "o-1",
        method: "drawn",
        signature_png: "data:image/png;base64," + nonPng,
        consent: true,
      },
    }),
    deps,
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "invalid_signature");

  assertEquals(
    calls.filter((c) =>
      c.table === "storage:hire-orders" && c.method === "upload"
    ).length,
    0,
  );
  assertEquals(
    calls.filter((c) =>
      c.table === "hire_order_signatures" && c.method === "insert"
    ).length,
    0,
  );
  assertEquals(
    calls.filter((c) => c.table === "hire_orders" && c.method === "update")
      .length,
    0,
  );
});

Deno.test("sign: emails BOTH the artist and the producers when email_producers_on_countersign is on", async () => {
  // signDeps fixes the countersign seed to { mode: electronic } and never seeds
  // resolve_show_assignments / usersById, so the producer fan-out is inlined here.
  const { deps, invokeCalls } = makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: {
      is_feature_enabled: { data: true, error: null },
      resolve_show_assignments: {
        data: [{ producer_user_id: "p1" }],
        error: null,
      },
    },
    usersById: { p1: { email: "prod@x.de" } }, // admin.auth.admin.getUserById("p1")
    tables: {
      hire_orders: [
        { when: { __write: false }, data: SIGN_ORDER },
        { when: { __write: true }, data: [{ id: "o-1" }] },
      ],
      artists: { data: { id: "a-A" } },
      org_memberships: { data: [] },
      app_settings: [
        {
          when: { key: "hire_order_countersign" },
          data: [{
            org_id: ORG,
            value: { mode: "electronic", email_producers_on_countersign: true },
          }],
        },
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });

  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: SIGN_BODY,
    }),
    deps,
  );
  assertEquals(res.status, 200);

  const countersignedEmails = invokeCalls.filter((c) =>
    c.name === "send-transactional-email" &&
    (c.body as { template_name: string }).template_name ===
      "hire-order-countersigned"
  );
  assertEquals(
    countersignedEmails.length,
    2,
    "one email to the artist, one to the producer",
  );
  const recipients = countersignedEmails.map((c) =>
    (c.body as { recipient_email: string }).recipient_email
  ).sort();
  assertEquals(recipients, ["ann@x.de", "prod@x.de"]);
});

// ── sign renders from the issue snapshot (finding W1) ───────────────────────

/** Capture-shape for the render input's snapshot-relevant fields. */
type CapturedRender = {
  terms: Array<{ title: string }>;
  letterhead: { legal_name?: string };
};

Deno.test("sign renders the signed PDF from the issue snapshot, not the current live letterhead/terms", async () => {
  // The order carries a frozen snapshot; the LIVE hire_order_letterhead/terms settings
  // are deliberately DIFFERENT. The signed re-render must reproduce the snapshot so the
  // certificate hash still matches the issued document.
  const snapshotOrder = {
    ...SIGN_ORDER,
    issue_snapshot: {
      letterhead: { legal_name: "Snapshot GmbH", address_lines: [] },
      terms: [{ title: "SNAP", body: "snapshot terms" }],
      currency: "EUR",
    },
  };
  const { deps } = makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      hire_orders: [
        { when: { __write: false }, data: snapshotOrder },
        { when: { __write: true }, data: [{ id: "o-1" }] },
      ],
      artists: { data: { id: "a-A" } },
      org_memberships: { data: [] },
      app_settings: [
        {
          when: { key: "hire_order_countersign" },
          data: [{ org_id: ORG, value: { mode: "electronic" } }],
        },
        {
          when: { key: "hire_order_letterhead" },
          data: [{
            org_id: ORG,
            value: { legal_name: "Live GmbH", address_lines: [] },
          }],
        },
        {
          when: { key: "hire_order_terms" },
          data: [{
            org_id: ORG,
            value: {
              lean: [],
              standard: [{ title: "LIVE", body: "live terms" }],
              full: [],
            },
          }],
        },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  const captured: CapturedRender[] = [];
  deps.renderHireOrderPdf = (input) => {
    captured.push(input as unknown as CapturedRender);
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };

  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: SIGN_BODY,
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured.length, 1, "rendered exactly once");
  assertEquals(
    captured[0].terms.map((t) => t.title),
    ["SNAP"],
    "terms come from the snapshot, not the live setting",
  );
  assertEquals(
    captured[0].letterhead.legal_name,
    "Snapshot GmbH",
    "letterhead comes from the snapshot",
  );
});

Deno.test("sign falls back to the live-resolved letterhead/terms for a legacy order with a null issue snapshot", async () => {
  // Orders issued before the issue_snapshot column carry null; the sign action must
  // keep working by re-resolving the org's current letterhead/terms for those.
  const legacyOrder = { ...SIGN_ORDER, issue_snapshot: null };
  const { deps } = makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      hire_orders: [
        { when: { __write: false }, data: legacyOrder },
        { when: { __write: true }, data: [{ id: "o-1" }] },
      ],
      artists: { data: { id: "a-A" } },
      org_memberships: { data: [] },
      app_settings: [
        {
          when: { key: "hire_order_countersign" },
          data: [{ org_id: ORG, value: { mode: "electronic" } }],
        },
        {
          when: { key: "hire_order_letterhead" },
          data: [{
            org_id: ORG,
            value: { legal_name: "Live GmbH", address_lines: [] },
          }],
        },
        {
          when: { key: "hire_order_terms" },
          data: [{
            org_id: ORG,
            value: {
              lean: [],
              standard: [{ title: "LIVE", body: "live terms" }],
              full: [],
            },
          }],
        },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  const captured: CapturedRender[] = [];
  deps.renderHireOrderPdf = (input) => {
    captured.push(input as unknown as CapturedRender);
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };

  const res = await handle(
    makeRequest({
      headers: { Authorization: "Bearer artist" },
      body: SIGN_BODY,
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured.length, 1, "rendered exactly once");
  assertEquals(
    captured[0].terms.map((t) => t.title),
    ["LIVE"],
    "legacy orders fall back to the live-resolved terms",
  );
  assertEquals(
    captured[0].letterhead.legal_name,
    "Live GmbH",
    "legacy orders fall back to the live letterhead",
  );
});

// ── producer capability gate (draft / draft-manual / issue) ────────────────
//
// Admins/super-admins bypass the capability gate outright (the adminGate check
// inside handle() passes before the capability RPC is ever consulted). A caller
// who is only a producer of the target org must additionally hold the per-action
// capability: producer_can_generate_hire_orders for draft/draft-manual,
// producer_can_issue_hire_orders for issue. preview/download-url/countersign-test
// stay ungated by capabilities (countersign-test remains admin-only via its own
// re-check, covered above).

Deno.test("draft: producer with producer_can_generate_hire_orders OFF → 403 capability_disabled, no writes", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-producer" },
    tables: { org_memberships: { data: { role: "producer" } } },
    rpcs: { is_capability_enabled: { data: false, error: null } },
  });
  const res = await handle(makeRequest({ headers: JWT, body: { action: "draft", org_id: ORG, show_date_id: SD } }), deps);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, "capability_disabled");
  assertEquals(calls.some((c) => c.table === "hire_orders" && c.method === "insert"), false);
});

Deno.test("draft: producer with producer_can_generate_hire_orders ON → proceeds past the gate", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-producer" },
    tables: {
      org_memberships: { data: { role: "producer" } },
      show_dates: { data: SHOW_DATE_ROW },
      bookings: { data: [booking("b-A", "a-A", 500, "Ann", "ann@x.de")] },
      cities: { data: { name: "Berlin" } },
      hire_orders: [
        { when: { __write: false }, data: [] },
        { when: { __write: true }, data: { id: "ho-producer" } },
      ],
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_numbering" }, data: [NUMBERING] },
      ],
    },
    rpcs: { is_capability_enabled: { data: true, error: null } },
  });
  const res = await handle(makeRequest({ headers: JWT, body: { action: "draft", org_id: ORG, show_date_id: SD } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).created, ["ho-producer"]);
});

Deno.test("draft-manual: producer with producer_can_generate_hire_orders OFF → 403 capability_disabled", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-producer" },
    tables: { org_memberships: { data: { role: "producer" } } },
    rpcs: { is_capability_enabled: { data: false, error: null } },
  });
  const res = await handle(makeRequest({ headers: JWT, body: { action: "draft-manual", org_id: ORG, manual: {} } }), deps);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "capability_disabled");
});

Deno.test("issue: producer with producer_can_issue_hire_orders OFF → 403 capability_disabled, no writes", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-producer" },
    tables: { org_memberships: { data: { role: "producer" } } },
    rpcs: { is_capability_enabled: { data: false, error: null } },
  });
  const res = await handle(makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }), deps);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, "capability_disabled");
  assertEquals(calls.some((c) => c.table === "hire_orders" && c.method === "update"), false);
});

Deno.test("issue: producer with producer_can_issue_hire_orders ON → proceeds past the gate", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-producer" },
    tables: {
      org_memberships: { data: { role: "producer" } },
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
    rpcs: { is_capability_enabled: { data: true, error: null } },
  });
  const res = await handle(makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.issued, ["o-1"]);
  assertEquals(body.failed, []);
});

Deno.test("issue: admin bypasses the capability gate entirely (never calls is_capability_enabled)", async () => {
  const { deps, calls } = makeFakeDeps({
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
    // is_capability_enabled intentionally NOT seeded — the fake defaults it to
    // { data: null, error: null }, which checkCapability treats as OFF. An admin
    // caller must never reach that check at all.
  });
  const res = await handle(makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.some((c) => c.table === "rpc:is_capability_enabled"), false);
});

// ── editable pdf copy (part E) ──────────────────────────────────────────────

const COPY_SETTING = (value: Record<string, string>) => ({ org_id: ORG, value });

Deno.test("preview: an ad-hoc copy_override reaches the renderer", async () => {
  const { deps } = makeFakeDeps({
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
  let captured: { copy?: Record<string, string> } | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "preview", org_id: ORG, order_id: "o-1", copy_override: { terms_heading: "Bespoke terms" } },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured!.copy?.terms_heading, "Bespoke terms");
  // untouched keys still resolve to their defaults (full record)
  assertEquals(captured!.copy?.fees_total, "Total payable");
});

Deno.test("preview: copy_override wins over the stored org copy setting", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: { data: issuableOrder() },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_copy" }, data: [COPY_SETTING({ terms_heading: "Stored" })] },
      ],
    },
  });
  let captured: { copy?: Record<string, string> } | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "preview", org_id: ORG, order_id: "o-1", copy_override: { terms_heading: "Adhoc" } },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured!.copy?.terms_heading, "Adhoc");
});

Deno.test("preview: with no order_id renders a sample document with the copy override", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured:
    | { copy?: Record<string, string>; status?: string; data?: Record<string, { value?: unknown }> }
    | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "preview", org_id: ORG, copy_override: { terms_heading: "Bespoke terms" } },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.pdf_base64, "JVBERg=="); // base64 of the fake "%PDF" bytes
  assertEquals(captured!.status, "preview");
  assertEquals(captured!.copy?.terms_heading, "Bespoke terms");
  // representative sample data so the preview isn't a blank document
  assert(captured!.data?.artist_name?.value, "sample data carries an artist name");
  // no order was looked up and nothing was persisted
  assertEquals(calls.filter((c) => c.table === "hire_orders").length, 0);
});

// The template editor's "Open exact PDF" is the exactness check for its live
// browser preview, so the two documents must be the SAME document. The server
// sample used to carry no signature, no engagement dates and no fee basis, so
// the exact PDF was missing the certificate page, the signature mark, the
// engagement-dates section and the fee-breakdown line the preview showed.
// Both sides now compose through _shared/hire-order-pdf/sampleDocument.ts.
Deno.test("preview: the sample document carries every section the editor can style", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured: RenderInput | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as RenderInput;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "preview", org_id: ORG } }),
    deps,
  );
  assertEquals(res.status, 200);

  const input = captured as unknown as RenderInput;
  assertEquals(input.orderNo, SAMPLE_ORDER_NO);
  assertEquals(input.status, "preview");
  assert(input.signature, "sample carries a synthetic countersignature (certificate page)");
  assertEquals((input.data.engagement_dates?.value as unknown[]).length, 3);
  assertEquals(input.data.fee_basis?.value, "per_date");
  // The org's OWN letterhead and terms, never the fixtures, when it has them.
  assertEquals(input.letterhead.legal_name, "Nord GmbH");
  assertEquals(input.terms, [{ title: "T", body: "B" }]);
});

Deno.test("preview: the sample falls back to the fixture letterhead and terms only when the org has none", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { data: [] },
      ],
    },
  });
  let captured: RenderInput | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as RenderInput;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  await handle(makeRequest({ headers: JWT, body: { action: "preview", org_id: ORG } }), deps);

  const input = captured as unknown as RenderInput;
  // An unconfigured org would otherwise preview a blank letterhead block and
  // no terms section at all, leaving those roles unstylable.
  assertEquals(input.letterhead.legal_name, SAMPLE_LETTERHEAD.legal_name);
  assertEquals(input.terms, SAMPLE_TERMS);
});

Deno.test("preview: a REAL order never borrows the sample fixtures", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: { data: { id: "o-1", org_id: ORG, order_no: "HO-9", data: {}, terms_variant: null } },
      app_settings: [
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { data: [] },
      ],
    },
  });
  let captured: RenderInput | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as RenderInput;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  await handle(
    makeRequest({ headers: JWT, body: { action: "preview", org_id: ORG, order_id: "o-1" } }),
    deps,
  );

  const input = captured as unknown as RenderInput;
  // Fabricating a letterhead onto a real order's preview would misrepresent
  // the document of record.
  assertEquals(input.orderNo, "HO-9");
  assertEquals(input.letterhead.legal_name, "");
  assertEquals(input.terms, []);
  assertEquals(input.signature, undefined);
});

Deno.test("issue freezes the resolved copy into issue_snapshot", async () => {
  const { deps, calls } = makeFakeDeps({
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
        { when: { key: "hire_order_copy" }, data: [COPY_SETTING({ terms_heading: "Frozen heading" })] },
      ],
    },
  });
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }),
    deps,
  );
  assertEquals(res.status, 200);
  const issuedUpdate = calls.find(
    (c) => c.table === "hire_orders" && c.method === "update" &&
      (c.args[0] as { status?: string }).status === "issued",
  );
  assert(issuedUpdate, "expected the issued update");
  const snap = (issuedUpdate!.args[0] as { issue_snapshot?: { copy?: Record<string, string> } }).issue_snapshot;
  assertEquals(snap?.copy?.terms_heading, "Frozen heading");
  // the frozen copy is the FULL resolved record, so untouched keys are present too
  assertEquals(snap?.copy?.fees_total, "Total payable");
});

Deno.test("sign re-renders using snapshot.copy, ignoring a later live copy edit", async () => {
  const snapshotOrder = {
    ...SIGN_ORDER,
    issue_snapshot: {
      letterhead: { legal_name: "Snapshot GmbH", address_lines: [] },
      terms: [{ title: "SNAP", body: "snapshot terms" }],
      currency: "EUR",
      copy: { terms_heading: "Frozen heading" }, // partial snapshot copy is fine
    },
  };
  const { deps } = makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      hire_orders: [
        { when: { __write: false }, data: snapshotOrder },
        { when: { __write: true }, data: [{ id: "o-1" }] },
      ],
      artists: { data: { id: "a-A" } },
      org_memberships: { data: [] },
      app_settings: [
        { when: { key: "hire_order_countersign" }, data: [{ org_id: ORG, value: { mode: "electronic" } }] },
        { when: { key: "hire_order_letterhead" }, data: [{ org_id: ORG, value: { legal_name: "Live GmbH", address_lines: [] } }] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_copy" }, data: [COPY_SETTING({ terms_heading: "Changed live" })] },
      ],
    },
  });
  let captured: { copy?: Record<string, string> } | null = null;
  deps.renderHireOrderPdf = (input) => {
    captured = input as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer artist" }, body: SIGN_BODY }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured!.copy?.terms_heading, "Frozen heading");
});

Deno.test("sign falls back to default copy for a legacy snapshot without copy", async () => {
  const legacySnapshotOrder = {
    ...SIGN_ORDER,
    issue_snapshot: {
      letterhead: { legal_name: "Snapshot GmbH", address_lines: [] },
      terms: [{ title: "SNAP", body: "snapshot terms" }],
      currency: "EUR",
      // no `copy` — issued before part E
    },
  };
  const { deps } = makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      hire_orders: [
        { when: { __write: false }, data: legacySnapshotOrder },
        { when: { __write: true }, data: [{ id: "o-1" }] },
      ],
      artists: { data: { id: "a-A" } },
      org_memberships: { data: [] },
      app_settings: [
        { when: { key: "hire_order_countersign" }, data: [{ org_id: ORG, value: { mode: "electronic" } }] },
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured: { copy?: Record<string, string> } | null = null;
  deps.renderHireOrderPdf = (input) => {
    captured = input as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer artist" }, body: SIGN_BODY }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured!.copy?.terms_heading, "Terms & conditions"); // stock default
});

// ── issue_snapshot must not bloat with the agent-signature base64 ────────────

Deno.test("issue freezes only the signature path into issue_snapshot, not the base64 data url", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    storageDownloadResult: {
      data: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]),
      error: null,
    },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: issuableOrder() },
        { when: { __write: true }, data: null },
      ],
      artists: { data: { user_id: "u-artist" } },
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{
            org_id: ORG,
            value: {
              legal_name: "Nord GmbH",
              address_lines: [],
              agent_signature_path: `${ORG}/agent-signature.png`,
            },
          }],
        },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured: { letterhead: { agent_signature_data_url?: string | null } } | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }),
    deps,
  );
  assertEquals(res.status, 200);
  // The RENDER still gets the resolved data url so the signature prints on the PDF.
  assertEquals((captured!.letterhead.agent_signature_data_url ?? "").startsWith("data:image/png;base64,"), true);
  // The SNAPSHOT keeps only the small path, never the ~2MB base64 blob (it rides
  // along on every select("*") list/detail fetch).
  const issuedUpdate = calls.find(
    (c) => c.table === "hire_orders" && c.method === "update" &&
      (c.args[0] as { status?: string }).status === "issued",
  );
  const snapLetterhead = (issuedUpdate!.args[0] as {
    issue_snapshot?: { letterhead?: { agent_signature_path?: string; agent_signature_data_url?: string | null } };
  }).issue_snapshot?.letterhead;
  assertEquals(snapLetterhead?.agent_signature_path, `${ORG}/agent-signature.png`);
  assertEquals(snapLetterhead?.agent_signature_data_url, undefined);
});

Deno.test("sign re-resolves the agent signature from the snapshot path, not a frozen data url", async () => {
  const snapshotOrder = {
    ...SIGN_ORDER,
    issue_snapshot: {
      letterhead: {
        legal_name: "Snapshot GmbH",
        address_lines: [],
        agent_signature_path: `${ORG}/agent-signature.png`, // path only, no data url
      },
      terms: [{ title: "SNAP", body: "x" }],
      currency: "EUR",
    },
  };
  const { deps } = makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    storageDownloadResult: {
      data: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]),
      error: null,
    },
    tables: {
      hire_orders: [
        { when: { __write: false }, data: snapshotOrder },
        { when: { __write: true }, data: [{ id: "o-1" }] },
      ],
      artists: { data: { id: "a-A" } },
      org_memberships: { data: [] },
      app_settings: [
        { when: { key: "hire_order_countersign" }, data: [{ org_id: ORG, value: { mode: "electronic" } }] },
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured: { letterhead: { agent_signature_data_url?: string | null } } | null = null;
  deps.renderHireOrderPdf = (input) => {
    captured = input as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer artist" }, body: SIGN_BODY }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((captured!.letterhead.agent_signature_data_url ?? "").startsWith("data:image/png;base64,"), true);
});

// ── editable pdf theme (task 7) ──────────────────────────────────────────────

const THEME_SETTING = (value: Record<string, unknown>) => ({ org_id: ORG, value });

Deno.test("preview: theme_override reaches the renderer, layered over the stored theme", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: { data: issuableOrder() },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_theme" }, data: [THEME_SETTING({ base: { scale: 1.2 } })] },
      ],
    },
  });
  let captured: { theme?: { base: { scale: number } } } | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: {
        action: "preview",
        org_id: ORG,
        order_id: "o-1",
        theme_override: { base: { scale: 1.4 } },
      },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured!.theme?.base.scale, 1.4);
});

Deno.test("preview: falls back to the stored theme when no theme_override is sent", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: { data: issuableOrder() },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_theme" }, data: [THEME_SETTING({ base: { scale: 1.2 } })] },
      ],
    },
  });
  let captured: { theme?: { base: { scale: number } } } | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: { action: "preview", org_id: ORG, order_id: "o-1" },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured!.theme?.base.scale, 1.2);
});

// layerThemeOverride merges per FIELD at every depth (base scalars, base.colors,
// base.page, and each role's individual style fields) rather than wholesale per
// top-level group or per role key -- see the doc comment on layerThemeOverride
// in index.ts for why. This test is what proves that choice: an ad-hoc override
// that only tweaks ONE field of a role must not wipe the rest of that role's
// stored customization.
Deno.test("preview: theme_override merges per role FIELD, not per whole role", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: { data: issuableOrder() },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        {
          when: { key: "hire_order_theme" },
          data: [THEME_SETTING({ roles: { sectionHeading: { size: 20, color: "accent" } } })],
        },
      ],
    },
  });
  let captured:
    | { theme?: { roles: Record<string, { size?: number; color?: string; weight?: number }> } }
    | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({
      headers: JWT,
      body: {
        action: "preview",
        org_id: ORG,
        order_id: "o-1",
        // Only tweaks weight; size/color must survive from the stored theme.
        theme_override: { roles: { sectionHeading: { weight: 600 } } },
      },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const role = captured!.theme?.roles.sectionHeading;
  assertEquals(role?.weight, 600, "the ad-hoc field wins");
  assertEquals(role?.size, 20, "the stored field survives a per-field merge");
  assertEquals(role?.color, "accent", "the stored field survives a per-field merge");
});

Deno.test("issue freezes the resolved theme into issue_snapshot, without font bytes", async () => {
  const { deps, calls } = makeFakeDeps({
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
        { when: { key: "hire_order_theme" }, data: [THEME_SETTING({ base: { scale: 1.3 } })] },
      ],
    },
  });
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }),
    deps,
  );
  assertEquals(res.status, 200);
  const issuedUpdate = calls.find(
    (c) => c.table === "hire_orders" && c.method === "update" &&
      (c.args[0] as { status?: string }).status === "issued",
  );
  assert(issuedUpdate, "expected the issued update");
  const snap = (issuedUpdate!.args[0] as { issue_snapshot?: { theme?: { base: { scale: number } } } })
    .issue_snapshot;
  assertEquals(snap?.theme?.base.scale, 1.3);
  // Font BYTES must never reach the snapshot -- HireOrderTheme carries only
  // FontFamilyKey strings (e.g. "geist"), never react-pdf font file data, so no
  // base64 payload should appear anywhere in the frozen snapshot.
  assertEquals(JSON.stringify(snap).includes("base64"), false);
});

Deno.test("sign re-renders using snapshot.theme, ignoring a later live theme edit", async () => {
  const snapshotOrder = {
    ...SIGN_ORDER,
    issue_snapshot: {
      letterhead: { legal_name: "Snapshot GmbH", address_lines: [] },
      terms: [{ title: "SNAP", body: "snapshot terms" }],
      currency: "EUR",
      theme: { base: { scale: 1.25 } }, // partial snapshot theme is fine (resolver fills gaps)
    },
  };
  const { deps } = makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      hire_orders: [
        { when: { __write: false }, data: snapshotOrder },
        { when: { __write: true }, data: [{ id: "o-1" }] },
      ],
      artists: { data: { id: "a-A" } },
      org_memberships: { data: [] },
      app_settings: [
        { when: { key: "hire_order_countersign" }, data: [{ org_id: ORG, value: { mode: "electronic" } }] },
        {
          when: { key: "hire_order_letterhead" },
          data: [{ org_id: ORG, value: { legal_name: "Live GmbH", address_lines: [] } }],
        },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        // Live setting changed AFTER issue; the signed re-render must ignore it.
        { when: { key: "hire_order_theme" }, data: [THEME_SETTING({ base: { scale: 1.45 } })] },
      ],
    },
  });
  let captured: { theme?: { base: { scale: number } } } | null = null;
  deps.renderHireOrderPdf = (input) => {
    captured = input as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer artist" }, body: SIGN_BODY }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured!.theme?.base.scale, 1.25);
});

Deno.test("sign falls back to the built-in default theme for a snapshot without a theme field", async () => {
  const legacySnapshotOrder = {
    ...SIGN_ORDER,
    issue_snapshot: {
      letterhead: { legal_name: "Snapshot GmbH", address_lines: [] },
      terms: [{ title: "SNAP", body: "snapshot terms" }],
      currency: "EUR",
      // no `theme` key -- issued before this change
    },
  };
  const { deps } = makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      hire_orders: [
        { when: { __write: false }, data: legacySnapshotOrder },
        { when: { __write: true }, data: [{ id: "o-1" }] },
      ],
      artists: { data: { id: "a-A" } },
      org_memberships: { data: [] },
      app_settings: [
        { when: { key: "hire_order_countersign" }, data: [{ org_id: ORG, value: { mode: "electronic" } }] },
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        // A live theme setting exists, but a present snapshot (letterhead + terms both
        // there) must NOT consult it -- only a wholly missing/invalid snapshot does
        // (see the next test). Missing `theme` falls to the BUILT-IN default instead,
        // exactly mirroring how a snapshot without `copy` behaves.
        { when: { key: "hire_order_theme" }, data: [THEME_SETTING({ base: { scale: 1.45 } })] },
      ],
    },
  });
  let captured: { theme?: { base: { scale: number } } } | null = null;
  deps.renderHireOrderPdf = (input) => {
    captured = input as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer artist" }, body: SIGN_BODY }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured!.theme?.base.scale, 1); // stock default, ignoring the live 1.45 setting
});

Deno.test("sign re-resolves the live theme setting for a legacy order with a null issue snapshot", async () => {
  const legacyOrder = { ...SIGN_ORDER, issue_snapshot: null };
  const { deps } = makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      hire_orders: [
        { when: { __write: false }, data: legacyOrder },
        { when: { __write: true }, data: [{ id: "o-1" }] },
      ],
      artists: { data: { id: "a-A" } },
      org_memberships: { data: [] },
      app_settings: [
        { when: { key: "hire_order_countersign" }, data: [{ org_id: ORG, value: { mode: "electronic" } }] },
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "hire_order_theme" }, data: [THEME_SETTING({ base: { scale: 1.45 } })] },
      ],
    },
  });
  let captured: { theme?: { base: { scale: number } } } | null = null;
  deps.renderHireOrderPdf = (input) => {
    captured = input as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer artist" }, body: SIGN_BODY }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured!.theme?.base.scale, 1.45, "no issue_snapshot at all -> re-resolve the live theme setting");
});

// ===========================================================================
// Per-org language (Section C): issue renders German copy + locale for a de,
// entitled org, and freezes the locale into issue_snapshot. English default is
// covered implicitly by every other issue test (org_language unset => "en").
// The gate (de setting but language_packages off => English) is covered by
// orgLocale.test.ts and the send-transactional-email di tests; the fake's
// is_feature_enabled returns one value for all features, so it cannot represent
// hire_orders-on + language_packages-off here.
// ===========================================================================
Deno.test("issue: a de, entitled org renders the German copy base and freezes locale='de'", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: issuableOrder({}) },
        { when: { __write: true }, data: null },
      ],
      artists: { data: { user_id: "u-artist" } },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_TEMPLATES_DEFAULT_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
        { when: { key: "org_language" }, data: [{ org_id: ORG, value: "de" }] },
      ],
    },
  });
  let captured: { locale?: string; copy?: { header_eyebrow?: string } } | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };

  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.issued, ["o-1"]);
  assertEquals(captured!.locale, "de");
  assertEquals(captured!.copy?.header_eyebrow, "Engagementvertrag");

  // Locale is frozen into issue_snapshot alongside the copy.
  const issueWrite = calls.find(
    (c) => c.table === "hire_orders" && c.method === "update" &&
      typeof c.args?.[0] === "object" && c.args[0] !== null &&
      (c.args[0] as { status?: string }).status === "issued",
  );
  assertExists(issueWrite);
  const snapshot = (issueWrite!.args[0] as { issue_snapshot?: { locale?: string } }).issue_snapshot;
  assertEquals(snapshot?.locale, "de");
});

Deno.test("issue: an org with no org_language renders the English copy base and locale='en'", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: issuableOrder({}) },
        { when: { __write: true }, data: null },
      ],
      artists: { data: { user_id: "u-artist" } },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_TEMPLATES_DEFAULT_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured: { locale?: string; copy?: { header_eyebrow?: string } } | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };

  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(captured!.locale, "en");
  assertEquals(captured!.copy?.header_eyebrow, "Performance hire order");
});

// Regression (Section C): a hire order issued in German countersigns in German —
// the frozen issue_snapshot.locale drives BOTH the re-rendered signed PDF and the
// countersigned artist email (not the org's live locale). Gated: resolveOrgLocale
// still checks language_packages (featureOn), matching the resend path.
Deno.test("sign: a de, entitled order countersigns in German (PDF + artist email)", async () => {
  const deSnapshot = {
    countersign_mode: "electronic",
    locale: "de",
    letterhead: LETTERHEAD,
    terms: [{ title: "Terms", body: "Body" }],
    currency: "EUR",
  };
  const { deps, invokeCalls } = signDeps({
    order: { ...SIGN_ORDER, issue_snapshot: deSnapshot },
    featureOn: true,
  });
  let renderedLocale: string | undefined;
  deps.renderHireOrderPdf = (input) => {
    renderedLocale = (input as { locale?: string }).locale;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer artist" }, body: SIGN_BODY }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).countersigned, true);
  // The signed PDF re-renders in the frozen German locale.
  assertEquals(renderedLocale, "de");
  // The countersigned email that ships it matches the PDF locale.
  const email = invokeCalls.find(
    (c) => c.name === "send-transactional-email" &&
      (c.body as { template_name?: string }).template_name === "hire-order-countersigned",
  );
  assertExists(email);
  assertEquals((email!.body as { locale?: string }).locale, "de");
  // The date_label TOKEN is formatted in German too (not just the wrapper).
  const expectedDe = new Date("2026-06-15T00:00:00Z").toLocaleDateString("de-DE", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
  assertEquals(
    (email!.body as { templateData: { date_label: string } }).templateData.date_label,
    expectedDe,
  );
});

// ── workspace type (org_kind) vocabulary at issue and preview ─────────────────

Deno.test("issue: a staffing org renders and freezes staffing vocabulary in the copy", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      organizations: { data: { org_kind: "staffing" } },
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
  let captured: { copy?: Record<string, string> } | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }),
    deps,
  );
  assertEquals(res.status, 200);
  // The RENDER gets the staffing wording. The runtime {{castRef}} token is still
  // unfilled at this layer (applyTokens runs inside the real renderer), so assert
  // on the leading substituted prose only.
  assert(
    captured!.copy?.party_cast_reference?.startsWith("Team reference:"),
    `expected staffing "Team reference:", got ${captured!.copy?.party_cast_reference}`,
  );
  // And the substituted copy is FROZEN into issue_snapshot.copy.
  const issuedUpdate = calls.find(
    (c) => c.table === "hire_orders" && c.method === "update" &&
      (c.args[0] as { status?: string }).status === "issued",
  );
  assert(issuedUpdate, "expected the issued update");
  const snap = (issuedUpdate!.args[0] as { issue_snapshot?: { copy?: Record<string, string> } }).issue_snapshot;
  assert(
    snap?.copy?.party_cast_reference?.startsWith("Team reference:"),
    `issue_snapshot.copy must carry the staffing strings, got ${snap?.copy?.party_cast_reference}`,
  );
});

Deno.test("issue: a production org freezes byte-identical copy (org_kind control)", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      organizations: { data: { org_kind: "production" } },
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
  let captured: { copy?: Record<string, string> } | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }),
    deps,
  );
  assertEquals(res.status, 200);
  // Byte-identical to pre-org_kind: the production vocabulary equals the literals.
  assertEquals(captured!.copy?.party_cast_reference, "Cast reference: {{castRef}}");
  const issuedUpdate = calls.find(
    (c) => c.table === "hire_orders" && c.method === "update" &&
      (c.args[0] as { status?: string }).status === "issued",
  );
  const snap = (issuedUpdate!.args[0] as { issue_snapshot?: { copy?: Record<string, string> } }).issue_snapshot;
  assertEquals(snap?.copy?.party_cast_reference, "Cast reference: {{castRef}}");
});

Deno.test("preview: a staffing org renders staffing vocabulary (live kind)", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      organizations: { data: { org_kind: "staffing" } },
      org_memberships: { data: { role: "admin" } },
      hire_orders: { data: issuableOrder() },
      app_settings: [
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured: { copy?: Record<string, string> } | null = null;
  deps.renderHireOrderPdf = (a) => {
    captured = a as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({ headers: JWT, body: { action: "preview", org_id: ORG, order_id: "o-1" } }),
    deps,
  );
  assertEquals(res.status, 200);
  assert(
    captured!.copy?.party_cast_reference?.startsWith("Team reference:"),
    `expected staffing preview "Team reference:", got ${captured!.copy?.party_cast_reference}`,
  );
});

Deno.test("snapshot re-render keeps the frozen staffing copy (no re-substitution)", async () => {
  // Phase 1: issue under a staffing org and capture the frozen snapshot.
  const issue = makeFakeDeps({
    authUser: { id: "u-admin" },
    tables: {
      organizations: { data: { org_kind: "staffing" } },
      org_memberships: { data: { role: "admin" } },
      hire_orders: [
        { when: { __write: false }, data: issuableOrder() },
        { when: { __write: true }, data: null },
      ],
      artists: { data: { user_id: "u-artist" } },
      app_settings: [
        // Freeze electronic so the snapshot supports the sign re-render below.
        { when: { key: "hire_order_countersign" }, data: [{ org_id: ORG, value: { mode: "electronic" } }] },
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  issue.deps.renderHireOrderPdf = () => Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  const issueRes = await handle(
    makeRequest({ headers: JWT, body: { action: "issue", org_id: ORG, order_ids: ["o-1"] } }),
    issue.deps,
  );
  assertEquals(issueRes.status, 200);
  const issuedUpdate = issue.calls.find(
    (c) => c.table === "hire_orders" && c.method === "update" &&
      (c.args[0] as { status?: string }).status === "issued",
  );
  const frozen = (issuedUpdate!.args[0] as {
    issue_snapshot?: {
      copy?: Record<string, string>;
      letterhead?: unknown;
      terms?: unknown;
      currency?: string;
    };
  }).issue_snapshot!;
  assert(
    frozen.copy?.party_cast_reference?.startsWith("Team reference:"),
    "issue must freeze staffing copy",
  );

  // Phase 2: re-render from that snapshot via the sign path. The org is NOT seeded
  // as staffing here, so if the re-render re-substituted from the live kind it would
  // revert to production ("Cast reference:"). The frozen wording must survive.
  const snapshotOrder = { ...SIGN_ORDER, issue_snapshot: frozen };
  const { deps } = makeFakeDeps({
    authUser: { id: "u-artist" },
    rpcs: { is_feature_enabled: { data: true, error: null } },
    tables: {
      hire_orders: [
        { when: { __write: false }, data: snapshotOrder },
        { when: { __write: true }, data: [{ id: "o-1" }] },
      ],
      artists: { data: { id: "a-A" } },
      org_memberships: { data: [] },
      app_settings: [
        { when: { key: "hire_order_countersign" }, data: [{ org_id: ORG, value: { mode: "electronic" } }] },
        { when: { key: "hire_order_letterhead" }, data: [LETTERHEAD] },
        { when: { key: "hire_order_terms" }, data: [TERMS_FILLED] },
        { when: { key: "hire_order_defaults" }, data: [DEFAULTS] },
      ],
    },
  });
  let captured: { copy?: Record<string, string> } | null = null;
  deps.renderHireOrderPdf = (input) => {
    captured = input as unknown as typeof captured;
    return Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  };
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer artist" }, body: SIGN_BODY }),
    deps,
  );
  assertEquals(res.status, 200);
  assert(
    captured!.copy?.party_cast_reference?.startsWith("Team reference:"),
    `re-render must stay frozen on staffing, got ${captured!.copy?.party_cast_reference}`,
  );
});
