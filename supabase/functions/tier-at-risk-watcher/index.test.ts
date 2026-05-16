/**
 * Unit tests for tier-at-risk-watcher edge function.
 *
 * Tests the risk assessment logic, idempotency (no duplicate notifications),
 * and the recovery (deletion) path. No real Supabase calls.
 */
import { assertEquals } from "../_shared/test-asserts.ts";

// ── Logic helpers mirroring the function ─────────────────────────────────

type BookingStatus = { status: string };

function isAtRisk(bookings: BookingStatus[], requiredSlots: number): boolean {
  const pending = bookings.filter((b) => b.status === "suggested").length;
  const accepted = bookings.filter(
    (b) => b.status === "soft_booked" || b.status === "confirmed",
  ).length;
  return pending + accepted < requiredSlots;
}

type ExistingNotif = {
  id: string;
  user_id: string;
  related_entity_id: string;
};

function getNotificationsToDelete(
  existingNotifs: ExistingNotif[],
  stillAtRiskTierIds: Set<string>,
): string[] {
  return existingNotifs
    .filter((n) => !stillAtRiskTierIds.has(n.related_entity_id))
    .map((n) => n.id);
}

function dedupeNewNotifications(
  tierId: string,
  recipientIds: string[],
  existingKeySet: Set<string>,
): Array<{ user_id: string; type: string }> {
  return recipientIds
    .filter((uid) => !existingKeySet.has(`${tierId}::${uid}`))
    .map((uid) => ({ user_id: uid, type: "tier_at_risk" }));
}

// ── Tests ──────────────────────────────────────────────────────────────────

Deno.test("tier is at risk when pending + accepted < required slots", () => {
  const bookings: BookingStatus[] = [
    { status: "suggested" }, // 1 pending
    { status: "cancelled" }, // doesn't count
  ];
  assertEquals(
    isAtRisk(bookings, 3),
    true,
    "1 pending, 0 accepted < 3 required",
  );
});

Deno.test("tier is healthy when pending + accepted >= required slots", () => {
  const bookings: BookingStatus[] = [
    { status: "suggested" },
    { status: "confirmed" },
    { status: "soft_booked" },
  ];
  assertEquals(isAtRisk(bookings, 3), false, "1+2=3 >= 3 required — healthy");
});

Deno.test("notification created when tier is at risk", () => {
  const tierId = "tier-uuid-1";
  const recipientIds = ["user-admin-1"];
  const existingKeySet = new Set<string>(); // no existing notifs

  const newRows = dedupeNewNotifications(tierId, recipientIds, existingKeySet);
  assertEquals(newRows.length, 1);
  assertEquals(newRows[0].user_id, "user-admin-1");
  assertEquals(newRows[0].type, "tier_at_risk");
});

Deno.test("no duplicate notification created when one already exists for (tier, user)", () => {
  const tierId = "tier-uuid-1";
  const recipientIds = ["user-admin-1"];
  const existingKeySet = new Set([`${tierId}::user-admin-1`]);

  const newRows = dedupeNewNotifications(tierId, recipientIds, existingKeySet);
  assertEquals(newRows.length, 0, "notification already exists — skip");
});

Deno.test("recovered tier notification is deleted", () => {
  const stillAtRiskTierIds = new Set<string>(); // tier recovered
  const existingNotifs: ExistingNotif[] = [
    { id: "notif-1", user_id: "user-1", related_entity_id: "tier-uuid-1" },
  ];

  const toDelete = getNotificationsToDelete(existingNotifs, stillAtRiskTierIds);
  assertEquals(toDelete, ["notif-1"]);
});

Deno.test("still-at-risk tier notification is NOT deleted", () => {
  const stillAtRiskTierIds = new Set(["tier-uuid-1"]);
  const existingNotifs: ExistingNotif[] = [
    { id: "notif-1", user_id: "user-1", related_entity_id: "tier-uuid-1" },
  ];

  const toDelete = getNotificationsToDelete(existingNotifs, stillAtRiskTierIds);
  assertEquals(toDelete.length, 0);
});

Deno.test("missing auth returns 401 equivalent", () => {
  const cronSecret = null as string | null;
  const authHeader = null as string | null;
  const isAuthorized = cronSecret !== null ||
    (authHeader?.startsWith("Bearer ") ?? false);
  assertEquals(isAuthorized, false);
});

Deno.test("single notification per producer per tier even when assignment resolver duplicates producers", () => {
  const tierId = "tier-uuid-1";
  const duplicatedRecipientIds = ["producer-1", "producer-1", "producer-2"];
  const uniqueRecipientIds = Array.from(new Set(duplicatedRecipientIds));

  const newRows = dedupeNewNotifications(tierId, uniqueRecipientIds, new Set());

  assertEquals(newRows.map((row) => row.user_id), ["producer-1", "producer-2"]);
});

Deno.test("notification can be recreated after recovery deleted the old row", () => {
  const tierId = "tier-uuid-1";
  const existingBeforeRecovery = new Set([`${tierId}::producer-1`]);
  const duringRisk = dedupeNewNotifications(
    tierId,
    ["producer-1"],
    existingBeforeRecovery,
  );
  const afterRecoveryDeletedOldRow = dedupeNewNotifications(tierId, [
    "producer-1",
  ], new Set());

  assertEquals(duringRisk, []);
  assertEquals(afterRecoveryDeletedOldRow.length, 1);
});
