/**
 * DI tests for notify-cast — the "Needs you" queue's "Notify cast" action.
 *
 * Coverage:
 *  - Cancelled date with 2 cancelled bookings (artists.user_id set): inserts 2
 *    notifications (type schedule_change, title "Booking cancelled", message
 *    carries the show label + date — this is the SOLE cancellation notice
 *    (it stamps digested_at so send-confirmation-digest won't re-notify), so a
 *    generic message would make two different cancellations indistinguishable
 *    in the bell —, related_entity_type show_date, org_id carried), stamps
 *    show_dates.cast_notified_at, stamps the undigested show_date_change_log
 *    'cancelled' row's digested_at, returns { notified: 2 }.
 *  - A coarse requireRole(['admin','producer']) gate runs BEFORE any
 *    admin-client show_dates lookup (mirrors open-offer-tier): an
 *    authenticated caller with no admin/producer role anywhere is rejected
 *    with 403 and the show_dates table is never queried (no existence
 *    oracle). The org-scoped requireOrgRole check still runs afterward.
 */
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG = "00000000-0000-0000-0000-0000000000a1";
const DATE = "10000000-0000-0000-0000-000000000d01";
const PRODUCER = "11111111-1111-1111-1111-111111111111";
const ARTIST_1 = "22222222-2222-2222-2222-222222222221";
const ARTIST_2 = "22222222-2222-2222-2222-222222222222";
const USER_1 = "33333333-3333-3333-3333-333333333331";
const USER_2 = "33333333-3333-3333-3333-333333333332";

const SHOW_DATE_JOIN = { date: "2026-09-01", shows: { program: "TJE", sub_program: "Matinee" }, cities: { name: "Berlin" } };

function cancelledBookings() {
  return [
    { id: "b1", artist_id: ARTIST_1, artists: { id: ARTIST_1, name: "Alice", email: "a@t.com", user_id: USER_1 }, show_dates: SHOW_DATE_JOIN },
    { id: "b2", artist_id: ARTIST_2, artists: { id: ARTIST_2, name: "Bob", email: "b@t.com", user_id: USER_2 }, show_dates: SHOW_DATE_JOIN },
  ];
}

function producerReq(body: Record<string, unknown> = { show_date_id: DATE }) {
  return makeRequest({ method: "POST", headers: { Authorization: "Bearer producer-jwt" }, body });
}

Deno.test("notify-cast: OPTIONS → preflight", async () => {
  const { deps } = makeFakeDeps({});
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("notify-cast: inserts a notification per held cast member, stamps markers, returns notified count", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: PRODUCER },
    tables: {
      show_dates: { data: { id: DATE, org_id: ORG }, error: null },
      org_memberships: { data: { role: "producer" }, error: null },
      bookings: { data: cancelledBookings(), error: null },
      show_date_change_log: { data: [], error: null },
    },
  });

  const res = await handle(producerReq(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.notified, 2);

  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  const rows = notifInsert?.args[0] as Array<Record<string, unknown>> | undefined;
  assertEquals(rows?.length, 2);
  for (const row of rows ?? []) {
    assertEquals(row.type, "schedule_change");
    assertEquals(row.title, "Booking cancelled");
    assertEquals(row.related_entity_type, "show_date");
    assertEquals(row.related_entity_id, DATE);
    assertEquals(row.org_id, ORG);
    // The message must carry the show + date — this is the SOLE cancellation
    // notice (digested_at is stamped so the 20:00 digest won't repeat it), so
    // a generic "this date" string would make two cancellations
    // indistinguishable in the bell. Matches send-confirmation-digest's
    // `Your booking for ${show} on ${date} was cancelled.` format.
    assertEquals(row.message, "Your booking for TJE — Matinee on 2026-09-01 was cancelled.");
  }
  const userIds = (rows ?? []).map((r) => r.user_id).sort();
  assertEquals(userIds, [USER_1, USER_2].sort());

  const showDateUpdate = calls.find((c) => c.table === "show_dates" && c.method === "update");
  assertEquals((showDateUpdate?.args[0] as { cast_notified_at?: string })?.cast_notified_at !== undefined, true);

  const changeLogUpdate = calls.find((c) => c.table === "show_date_change_log" && c.method === "update");
  assertEquals((changeLogUpdate?.args[0] as { digested_at?: string })?.digested_at !== undefined, true);
});

Deno.test("notify-cast: skips artists with no linked user_id", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: PRODUCER },
    tables: {
      show_dates: { data: { id: DATE, org_id: ORG }, error: null },
      org_memberships: { data: { role: "producer" }, error: null },
      bookings: {
        data: [
          { id: "b1", artist_id: ARTIST_1, artists: { id: ARTIST_1, name: "Alice", email: "a@t.com", user_id: USER_1 }, show_dates: SHOW_DATE_JOIN },
          { id: "b2", artist_id: ARTIST_2, artists: { id: ARTIST_2, name: "Bob", email: "b@t.com", user_id: null }, show_dates: SHOW_DATE_JOIN },
        ],
        error: null,
      },
      show_date_change_log: { data: [], error: null },
    },
  });

  const res = await handle(producerReq(), deps);
  const body = await res.json();
  assertEquals(body.notified, 1);
  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  const rows = notifInsert?.args[0] as Array<Record<string, unknown>> | undefined;
  assertEquals(rows?.length, 1);
  assertEquals(rows?.[0].user_id, USER_1);
});

Deno.test("notify-cast: caller lacking producer/admin role ANYWHERE → 403, rejected by the coarse gate BEFORE any show_dates lookup", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u-no-role" },
    tables: {
      // If the coarse gate were skipped/placed after the lookup, this seed
      // would make the date resolve fine and the request would proceed —
      // exactly the existence-oracle bug the coarse gate prevents.
      show_dates: { data: { id: DATE, org_id: ORG }, error: null },
      org_memberships: { data: null, error: null },
      platform_admins: { data: null, error: null },
    },
  });
  const res = await handle(producerReq(), deps);
  assertEquals(res.status, 403);
  // The coarse requireRole gate must fail (and return) before handle() ever
  // touches show_dates — proves there is no pre-auth existence oracle.
  const showDateCall = calls.find((c) => c.table === "show_dates");
  assertEquals(showDateCall, undefined);
});

Deno.test("notify-cast: no Bearer → 401", async () => {
  const { deps } = makeFakeDeps({
    tables: { show_dates: { data: { id: DATE, org_id: ORG }, error: null } },
  });
  const res = await handle(makeRequest({ method: "POST", body: { show_date_id: DATE } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("notify-cast: missing show_date_id → 400", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: PRODUCER },
    tables: { org_memberships: { data: { role: "producer" }, error: null } },
  });
  const res = await handle(producerReq({}), deps);
  assertEquals(res.status, 400);
});

Deno.test("notify-cast: unknown show_date_id → 404", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: PRODUCER },
    tables: {
      show_dates: { data: null, error: null },
      org_memberships: { data: { role: "producer" }, error: null },
    },
  });
  const res = await handle(producerReq(), deps);
  assertEquals(res.status, 404);
});

Deno.test("notify-cast: producer of a DIFFERENT org → 403 from the org-scoped gate (coarse gate alone is not enough)", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: PRODUCER },
    tables: {
      show_dates: { data: { id: DATE, org_id: ORG }, error: null },
      // Coarse requireRole (no org_id filter) matches the fallback entry and
      // passes — the caller IS a producer, just not of ORG. The org-scoped
      // requireOrgRole call (filters .eq('org_id', ORG)) matches the first
      // entry instead and gets null, so it must still reject.
      org_memberships: [
        { when: { org_id: ORG }, data: null },
        { data: { role: "producer" } },
      ],
      platform_admins: { data: null, error: null },
    },
  });
  const res = await handle(producerReq(), deps);
  assertEquals(res.status, 403);
});
