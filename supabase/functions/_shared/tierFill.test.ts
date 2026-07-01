import { assertEquals } from "./test-asserts.ts";
import {
  berlinDateKey,
  countAccepted,
  countPending,
  countPendingNotExpired,
  isFutureOrToday,
  requiredPrimarySlots,
} from "./tierFill.ts";

// ── requiredPrimarySlots ───────────────────────────────────────────────────────

Deno.test("tierFill: requiredPrimarySlots is main_cast_slots only (understudy ignored)", () => {
  assertEquals(requiredPrimarySlots({ main_cast_slots: 2, understudy_slots: 3 }), 2);
  assertEquals(requiredPrimarySlots({ main_cast_slots: 0, understudy_slots: 5 }), 0);
});

Deno.test("tierFill: requiredPrimarySlots returns null when main_cast_slots is null (unconfigured)", () => {
  assertEquals(requiredPrimarySlots({ main_cast_slots: null, understudy_slots: 1 }), null);
  assertEquals(requiredPrimarySlots({ main_cast_slots: null, understudy_slots: null }), null);
});

// ── counting across all sources ────────────────────────────────────────────────

Deno.test("tierFill: countAccepted counts soft_booked + confirmed across any tier (incl. manual null)", () => {
  const rows = [
    { status: "soft_booked", offer_tier: 1 },
    { status: "confirmed", offer_tier: null }, // manual booking counts
    { status: "suggested", offer_tier: 2 },
    { status: "cancelled", offer_tier: 1 },
  ];
  assertEquals(countAccepted(rows), 2);
});

Deno.test("tierFill: countPending counts only suggested", () => {
  const rows = [
    { status: "suggested" },
    { status: "suggested" },
    { status: "soft_booked" },
    { status: "cancelled" },
  ];
  assertEquals(countPending(rows), 2);
});

Deno.test("tierFill: countPendingNotExpired excludes lapsed suggested offers", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");
  const rows = [
    { status: "suggested", offer_expires_at: null }, // live
    { status: "suggested", offer_expires_at: "2026-06-02T12:00:00.000Z" }, // future → live
    { status: "suggested", offer_expires_at: "2026-05-31T12:00:00.000Z" }, // past → lapsed
    { status: "suggested", offer_expires_at: now.toISOString() }, // == now → lapsed (not > now)
    { status: "soft_booked", offer_expires_at: null }, // not suggested
  ];
  assertEquals(countPendingNotExpired(rows, now), 2);
});

// ── future-date filter ─────────────────────────────────────────────────────────

Deno.test("tierFill: berlinDateKey yields the Berlin calendar date", () => {
  // 2026-06-01T23:30:00Z is 2026-06-02 01:30 in Berlin (CEST) → next calendar day.
  assertEquals(berlinDateKey(new Date("2026-06-01T23:30:00.000Z")), "2026-06-02");
  // 2026-06-01T12:00:00Z is still 2026-06-01 in Berlin.
  assertEquals(berlinDateKey(new Date("2026-06-01T12:00:00.000Z")), "2026-06-01");
});

Deno.test("tierFill: isFutureOrToday — today and future pass, past fails", () => {
  const now = new Date("2026-06-01T12:00:00.000Z"); // Berlin: 2026-06-01
  assertEquals(isFutureOrToday("2026-06-01", now), true, "today passes");
  assertEquals(isFutureOrToday("2026-06-02", now), true, "future passes");
  assertEquals(isFutureOrToday("2026-05-31", now), false, "past fails");
  assertEquals(isFutureOrToday(null, now), false, "null date fails");
  assertEquals(isFutureOrToday(undefined, now), false, "undefined date fails");
});
