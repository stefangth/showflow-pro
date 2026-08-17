/**
 * DI tests for sandbox-view — the public, unauthenticated read-only demo
 * snapshot endpoint. See index.ts for the security rationale (verify_jwt=false,
 * inline is_demo re-assertion, display-safe field curation).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG_ID = "00000000-0000-0000-0000-0000000000a1";
const FUTURE_ISO = "2030-01-01T00:00:00.000Z";
const PAST_ISO = "2020-01-01T00:00:00.000Z";

function validLink(overrides: Partial<{ org_id: string; expires_at: string; revoked_at: string | null }> = {}) {
  return { org_id: ORG_ID, expires_at: FUTURE_ISO, revoked_at: null, ...overrides };
}

Deno.test("sandbox-view: 400 when token missing", async () => {
  const { deps } = makeFakeDeps({});
  const res = await handle(makeRequest({ body: {} }), deps);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "bad_request");
});

Deno.test("sandbox-view: 404 not_found for unknown token", async () => {
  // demo_sandbox_links left unseeded — the fake defaults to an empty result,
  // which .maybeSingle() normalizes to null.
  const { deps } = makeFakeDeps({});
  const res = await handle(makeRequest({ body: { token: "no-such-token" } }), deps);
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.reason, "not_found");
});

Deno.test("sandbox-view: 404 not_found when org is not a demo org", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      demo_sandbox_links: { data: validLink(), error: null },
      organizations: { data: { name: "Real Customer Org", is_demo: false }, error: null },
    },
  });
  const res = await handle(makeRequest({ body: { token: "tok-1" } }), deps);
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.reason, "not_found");
});

Deno.test("sandbox-view: 410 expired when expires_at in the past", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      demo_sandbox_links: { data: validLink({ expires_at: PAST_ISO }), error: null },
    },
  });
  const res = await handle(makeRequest({ body: { token: "tok-1" } }), deps);
  assertEquals(res.status, 410);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.reason, "expired");
});

Deno.test("sandbox-view: 410 revoked when revoked_at set", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      demo_sandbox_links: { data: validLink({ revoked_at: "2026-01-01T00:00:00.000Z" }), error: null },
    },
  });
  const res = await handle(makeRequest({ body: { token: "tok-1" } }), deps);
  assertEquals(res.status, 410);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.reason, "revoked");
});

Deno.test("sandbox-view: 200 returns a display-safe snapshot for a valid token", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      demo_sandbox_links: { data: validLink(), error: null },
      organizations: { data: { name: "Acme Productions", is_demo: true }, error: null },
      demo_state: { data: { volume: "small", prospect_label: "Acme Prospect" }, error: null },
      shows: {
        data: [
          { id: "show-1", program: "Cabaret", sub_program: "Berlin Run", main_cast_slots: 3 },
        ],
        error: null,
      },
      cities: { data: [{ id: "city-1", name: "Berlin" }], error: null },
      show_dates: {
        data: [
          { id: "sd-1", date: "2026-07-01", status: "suggested", show_id: "show-1", city_id: "city-1" },
        ],
        error: null,
      },
      bookings: {
        data: [
          { status: "confirmed", show_date_id: "sd-1" },
          { status: "suggested", show_date_id: "sd-1" },
        ],
        error: null,
      },
      hire_orders: {
        data: [{ status: "issued", show_date_id: "sd-1" }],
        error: null,
      },
    },
  });

  const res = await handle(makeRequest({ body: { token: "tok-1" } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);

  const snapshot = body.snapshot;
  assertEquals(snapshot.org.label, "Acme Prospect");
  assertEquals(snapshot.org.volume, "small");
  assertEquals(typeof snapshot.generatedAt, "string");
  assert(typeof snapshot.kpis.confirmedBookings === "number");
  assert(typeof snapshot.kpis.upcomingDates === "number");
  assert(typeof snapshot.kpis.fillRate === "number");
  assert(typeof snapshot.kpis.hireOrdersIssued === "number");
  assertEquals(snapshot.kpis.confirmedBookings, 1);
  assertEquals(snapshot.kpis.hireOrdersIssued, 1);

  assertEquals(snapshot.shows.length, 1);
  assertEquals(snapshot.shows[0].label, "Cabaret · Berlin Run");

  assertEquals(snapshot.dates.length, 1);
  assertEquals(snapshot.dates[0].id, "sd-1");
  assertEquals(snapshot.dates[0].showLabel, "Cabaret · Berlin Run");
  assertEquals(snapshot.dates[0].city, "Berlin");
  assertEquals(snapshot.dates[0].filled, 1);
  assertEquals(snapshot.dates[0].needed, 3);

  assertEquals(snapshot.bookingsByStatus.confirmed, 1);
  assertEquals(snapshot.bookingsByStatus.suggested, 1);

  assertEquals(snapshot.hireOrders.length, 1);
  assertEquals(snapshot.hireOrders[0].status, "issued");
  assertEquals(snapshot.hireOrders[0].showLabel, "Cabaret · Berlin Run");
  assertEquals(snapshot.hireOrders[0].dateOn, "2026-07-01");

  // Display-safe: the serialized snapshot must NOT contain PII/secret keys.
  const serialized = JSON.stringify(snapshot);
  for (
    const banned of [
      "email",
      "phone",
      "storage_path",
      "preview_html",
      "user_id",
      "signedUrl",
      "token",
    ]
  ) {
    assert(!serialized.includes(banned), `snapshot must not contain "${banned}"`);
  }
});
