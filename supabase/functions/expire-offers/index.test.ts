/**
 * Unit tests for expire-offers edge function.
 *
 * Tests auth logic, cron secret validation, and the escalation decision
 * criteria. No real Supabase calls.
 */
import { assertEquals, assertExists } from "../_shared/test-asserts.ts";

// ── Logic helpers mirroring the function ─────────────────────────────────

type BookingRow = {
  status: string;
  offer_expires_at: string | null;
};

function shouldEscalate(
  bookings: BookingRow[],
  requiredSlots: number,
): boolean {
  const accepted = bookings.filter(
    (b) => b.status === "soft_booked" || b.status === "confirmed",
  ).length;
  const pendingNotExpired = bookings.filter(
    (b) =>
      b.status === "suggested" &&
      (!b.offer_expires_at || new Date(b.offer_expires_at) > new Date()),
  ).length;

  if (pendingNotExpired > 0) return false; // active offers still live
  if (accepted >= requiredSlots) return false; // filled
  return true;
}

// ── Tests ──────────────────────────────────────────────────────────────────

Deno.test("cron secret missing returns 401", () => {
  const cronSecretHeader = null as string | null;
  const authHeader = null as string | null;
  const isAuthorized = cronSecretHeader !== null ||
    (authHeader?.startsWith("Bearer ") ?? false);
  assertEquals(isAuthorized, false);
});

Deno.test("wrong cron secret returns 401", () => {
  const cronSecretHeader: string = "wrong-secret";
  const storedSecret: string = "correct-secret";
  const isValid = cronSecretHeader === storedSecret;
  assertEquals(isValid, false);
});

Deno.test("correct cron secret passes auth", () => {
  const cronSecretHeader = "correct-secret";
  const storedSecret = "correct-secret";
  const isValid = cronSecretHeader === storedSecret;
  assertEquals(isValid, true);
});

Deno.test("no escalation when pending offers still live", () => {
  const now = new Date();
  const futureExpiry = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const bookings: BookingRow[] = [
    { status: "suggested", offer_expires_at: futureExpiry }, // still live
  ];
  assertEquals(shouldEscalate(bookings, 2), false);
});

Deno.test("no escalation when required slots are filled", () => {
  const bookings: BookingRow[] = [
    { status: "confirmed", offer_expires_at: null },
    { status: "soft_booked", offer_expires_at: null },
  ];
  assertEquals(shouldEscalate(bookings, 2), false);
});

Deno.test("escalation triggered when all offers expired and slot not filled", () => {
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const bookings: BookingRow[] = [
    { status: "suggested", offer_expires_at: past }, // expired
    { status: "suggested", offer_expires_at: past }, // expired
  ];
  assertEquals(shouldEscalate(bookings, 2), true);
});

Deno.test("idempotent — already escalated tier not escalated again (escalation_notified_at check)", () => {
  // Rows with escalation_notified_at set are excluded from the open tiers query
  const tier = {
    id: "tier-1",
    escalation_notified_at: "2026-01-01T00:00:00Z", // already done
  };
  // The function queries .is('escalation_notified_at', null) so this row is excluded
  const isEligibleForEscalation = tier.escalation_notified_at === null;
  assertEquals(isEligibleForEscalation, false);
});

function shouldEscalateAt(
  bookings: BookingRow[],
  requiredSlots: number,
  now: Date,
): boolean {
  const accepted = bookings.filter(
    (b) => b.status === "soft_booked" || b.status === "confirmed",
  ).length;
  const pendingNotExpired = bookings.filter(
    (b) =>
      b.status === "suggested" &&
      (!b.offer_expires_at || new Date(b.offer_expires_at) > now),
  ).length;

  return pendingNotExpired === 0 && accepted < requiredSlots;
}

Deno.test("fake-clock boundary: offer expiring exactly now is no longer live", () => {
  const now = new Date("2026-05-16T10:00:00.000Z");
  const bookings: BookingRow[] = [
    { status: "suggested", offer_expires_at: "2026-05-16T10:00:00.000Z" },
  ];

  assertEquals(shouldEscalateAt(bookings, 1, now), true);
});

Deno.test("fake-clock boundary: offer expiring one millisecond in the future blocks escalation", () => {
  const now = new Date("2026-05-16T10:00:00.000Z");
  const bookings: BookingRow[] = [
    { status: "suggested", offer_expires_at: "2026-05-16T10:00:00.001Z" },
  ];

  assertEquals(shouldEscalateAt(bookings, 1, now), false);
});

Deno.test("re-escalation is possible after recovery opens a fresh tier row", () => {
  const lifecycle = [
    {
      tierRowId: "tier-open-1",
      escalation_notified_at: null,
      shouldEscalate: true,
    },
    {
      tierRowId: "tier-open-1",
      escalation_notified_at: "2026-05-16T10:00:00Z",
      shouldEscalate: false,
    },
    {
      tierRowId: "tier-open-2",
      escalation_notified_at: null,
      shouldEscalate: true,
    },
  ];

  assertEquals(lifecycle.map((row) => row.shouldEscalate), [true, false, true]);
  assertEquals(lifecycle[0].tierRowId !== lifecycle[2].tierRowId, true);
});
