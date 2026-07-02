/**
 * Contract tests for send-confirmation-digest — exercises the REAL handle():
 * confirmations + schedule changes folded into one per-artist email, in-app
 * notifications for registered artists, and change-log stamping.
 *
 * now = 2026-06-01T18:00:00Z → Berlin 20:00 → matches the default
 * confirmation_digest_hour_berlin (20), so the org processes.
 */
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG = "00000000-0000-0000-0000-0000000000d1";
const NOW = new Date("2026-06-01T18:00:00Z");
const cronReq = () => makeRequest({ headers: { "X-Cron-Secret": "secret123" } });

// Two registered artists. A: a new confirmation + a session change. B: a cancellation.
const A_USER = "aaaa1111-0000-0000-0000-000000000000";
const B_USER = "bbbb2222-0000-0000-0000-000000000000";

function digestDeps() {
  return makeFakeDeps({
    now: NOW,
    tables: {
      app_settings: [{ when: { key: "cron_secret" }, data: { value: "secret123" } }],
      organizations: { data: [{ id: ORG }], error: null },
      bookings: [
        // confirmations query (.eq status=confirmed)
        { when: { status: "confirmed" }, data: [
          { id: "bk-conf-A", artist_id: "art-A", artists: { id: "art-A", name: "Ada", email: "ada@ex.com", user_id: A_USER },
            show_dates: { date: "2026-06-10", shows: { program: "Magic", sub_program: null }, cities: { name: "Berlin" } } },
        ] },
        // change-recipient query (.in show_date_id) — fallback (no `when`)
        { data: [
          { id: "bk-A2", artist_id: "art-A", show_date_id: "sd-change", status: "confirmed", cancellation_reason: null,
            artists: { id: "art-A", name: "Ada", email: "ada@ex.com", user_id: A_USER } },
          { id: "bk-B", artist_id: "art-B", show_date_id: "sd-cancel", status: "cancelled", cancellation_reason: "date_cancelled",
            artists: { id: "art-B", name: "Ben", email: "ben@ex.com", user_id: B_USER } },
        ] },
      ],
      show_date_change_log: { data: [
        { id: "cl-1", show_date_id: "sd-change", change_type: "session_retimed", session_slot: 1, old_value: "19:00:00", new_value: "20:00:00", created_at: "2026-06-01T10:00:00Z",
          show_dates: { date: "2026-06-12", status: "open", cancellation_reason: null, shows: { program: "Magic", sub_program: null }, cities: { name: "Berlin" } } },
        { id: "cl-2", show_date_id: "sd-cancel", change_type: "cancelled", session_slot: null, old_value: null, new_value: null, created_at: "2026-06-01T11:00:00Z",
          show_dates: { date: "2026-06-15", status: "cancelled", cancellation_reason: "Venue flooded", shows: { program: "Magic", sub_program: null }, cities: { name: "Hamburg" } } },
      ], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { resolve_user_contacts: { data: [
      { user_id: A_USER, email: "ada@login.com", display_name: "Ada L" },
      { user_id: B_USER, email: "ben@login.com", display_name: "Ben L" },
    ], error: null } },
  });
}

Deno.test("folds confirmations + schedule changes into one email per artist", async () => {
  const { deps, invokeCalls, calls } = digestDeps();
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);

  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 2);

  const aEmail = emails.find((e) => (e.body as any).recipient_email === "ada@login.com")!.body as any;
  assertEquals(aEmail.templateData.bookings.length, 1); // the confirmation
  assertEquals(aEmail.templateData.scheduleChanges.length, 1); // the retime
  assertEquals(aEmail.templateData.scheduleChanges[0].changes, "Session 1 now 20:00 (was 19:00)");
  assertEquals(aEmail.templateData.cancellations.length, 0);

  const bEmail = emails.find((e) => (e.body as any).recipient_email === "ben@login.com")!.body as any;
  assertEquals(bEmail.templateData.bookings.length, 0);
  assertEquals(bEmail.templateData.cancellations.length, 1);
  assertEquals(bEmail.templateData.cancellations[0].reason, "Venue flooded");

  // In-app notifications inserted for both registered artists.
  const notifInsert = calls.find((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(!!notifInsert, true);
  const rows = (notifInsert!.args[0] as any[]);
  assertEquals(rows.length, 2);
  assertEquals(rows.every((r) => r.type === "schedule_change"), true);

  // Change-log rows stamped digested.
  const stamped = calls.some((c) => c.table === "show_date_change_log" && c.method === "update");
  assertEquals(stamped, true);
});

Deno.test("C4: in-app notification insert fails → change log is NOT consumed (retried next run)", async () => {
  // The in-app notification is the reliable delivery channel for schedule changes. If its
  // insert fails, the change-log rows must NOT be stamped digested — otherwise the changes
  // are silently dropped. Seed the notifications table with an error to fail the insert.
  const { deps, calls } = makeFakeDeps({
    now: NOW,
    tables: {
      app_settings: [{ when: { key: "cron_secret" }, data: { value: "secret123" } }],
      organizations: { data: [{ id: ORG }], error: null },
      bookings: [
        { when: { status: "confirmed" }, data: [] },
        { data: [
          { id: "bk-B", artist_id: "art-B", show_date_id: "sd-cancel", status: "cancelled", cancellation_reason: "date_cancelled",
            artists: { id: "art-B", name: "Ben", email: "ben@ex.com", user_id: B_USER } },
        ] },
      ],
      show_date_change_log: { data: [
        { id: "cl-2", show_date_id: "sd-cancel", change_type: "cancelled", session_slot: null, old_value: null, new_value: null, created_at: "2026-06-01T11:00:00Z",
          show_dates: { date: "2026-06-15", status: "cancelled", cancellation_reason: null, shows: { program: "Magic", sub_program: null }, cities: { name: "Hamburg" } } },
      ], error: null },
      // Notification insert fails.
      notifications: { data: null, error: { message: "notifications insert failed" } },
    },
    rpcs: { resolve_user_contacts: { data: [{ user_id: B_USER, email: "ben@login.com", display_name: "Ben L" }], error: null } },
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  // Change-log rows must NOT be stamped because in-app delivery failed.
  const stamped = calls.some((c) => c.table === "show_date_change_log" && c.method === "update");
  assertEquals(stamped, false, "change log must not be consumed when in-app delivery failed");
});

Deno.test("an org with only schedule changes (no confirmations) is still processed", async () => {
  const { deps, invokeCalls } = makeFakeDeps({
    now: NOW,
    tables: {
      app_settings: [{ when: { key: "cron_secret" }, data: { value: "secret123" } }],
      organizations: { data: [{ id: ORG }], error: null },
      bookings: [
        { when: { status: "confirmed" }, data: [] },
        { data: [
          { id: "bk-B", artist_id: "art-B", show_date_id: "sd-cancel", status: "cancelled", cancellation_reason: "date_cancelled",
            artists: { id: "art-B", name: "Ben", email: "ben@ex.com", user_id: B_USER } },
        ] },
      ],
      show_date_change_log: { data: [
        { id: "cl-2", show_date_id: "sd-cancel", change_type: "cancelled", session_slot: null, old_value: null, new_value: null, created_at: "2026-06-01T11:00:00Z",
          show_dates: { date: "2026-06-15", status: "cancelled", cancellation_reason: null, shows: { program: "Magic", sub_program: null }, cities: { name: "Hamburg" } } },
      ], error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { resolve_user_contacts: { data: [{ user_id: B_USER, email: "ben@login.com", display_name: "Ben L" }], error: null } },
  });
  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);
  const emails = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(emails.length, 1);
  assertEquals((emails[0].body as any).recipient_email, "ben@login.com");
});
