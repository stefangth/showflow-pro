import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { openOfferTier, fetchOfferTiers, fetchOpenedTiers, closeOfferTier, dryRunOfferTier, fetchPendingConfirmationsCount, fetchMyOpenOffersCount, bulkConfirmSoftBooked, bulkDeclineSoftBooked, updateBookingStatusGuarded, respondToOffer, createBooking, fetchTierAttention } from "./bookings";

describe("openOfferTier", () => {
  it("sends snake_case body and returns offersCreated", async () => {
    const fake = createFakeSupabase({ "fn:open-offer-tier": { data: { offers_created: 2 }, error: null } });
    const res = await openOfferTier(fake as never, { showDateId: "d1", tier: 1 });
    expect(res).toEqual({ offersCreated: 2, message: undefined });
    expect(fake.calls).toContainEqual({ table: "fn:open-offer-tier", method: "invoke", args: [{ show_date_id: "d1", tier: 1 }] });
  });
  it("passes a benign message through", async () => {
    const fake = createFakeSupabase({ "fn:open-offer-tier": { data: { offers_created: 0, message: "No casts at tier 2 for this city" }, error: null } });
    const res = await openOfferTier(fake as never, { showDateId: "d1", tier: 2 });
    expect(res).toEqual({ offersCreated: 0, message: "No casts at tier 2 for this city" });
  });
  it("surfaces tier_tracking_warning when the edge fn flags it", async () => {
    const fake = createFakeSupabase({ "fn:open-offer-tier": { data: { offers_created: 1, tier_tracking_warning: true }, error: null } });
    const res = await openOfferTier(fake as never, { showDateId: "d1", tier: 1 });
    expect(res).toEqual({ offersCreated: 1, message: undefined, trackingWarning: true });
  });
  it("throws on transport error", async () => {
    const fake = createFakeSupabase({ "fn:open-offer-tier": { data: null, error: { message: "network" } } });
    await expect(openOfferTier(fake as never, { showDateId: "d1", tier: 1 })).rejects.toBeTruthy();
  });
  it("throws on a 200 body carrying { error }", async () => {
    const fake = createFakeSupabase({ "fn:open-offer-tier": { data: { error: "Show date is cancelled" }, error: null } });
    await expect(openOfferTier(fake as never, { showDateId: "d1", tier: 1 })).rejects.toThrow("Show date is cancelled");
  });
  it("passes skill_filter_ids only when non-empty", async () => {
    const fake = createFakeSupabase({ "fn:open-offer-tier": { data: { offers_created: 1 }, error: null } });
    await openOfferTier(fake as never, { showDateId: "d1", tier: 1, skillFilterIds: ["s1"] });
    expect(fake.calls).toContainEqual({
      table: "fn:open-offer-tier", method: "invoke",
      args: [{ show_date_id: "d1", tier: 1, skill_filter_ids: ["s1"] }],
    });
  });
  it("omits skill_filter_ids when the array is empty", async () => {
    const fake = createFakeSupabase({ "fn:open-offer-tier": { data: { offers_created: 1 }, error: null } });
    await openOfferTier(fake as never, { showDateId: "d1", tier: 1, skillFilterIds: [] });
    expect(fake.calls).toContainEqual({
      table: "fn:open-offer-tier", method: "invoke",
      args: [{ show_date_id: "d1", tier: 1 }],
    });
  });
});

describe("fetchOfferTiers", () => {
  it("returns priorities for the city and detects ad-hoc", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [{ priority: 1 }, { priority: 2 }, { priority: 1 }], error: null },
      show_date_cast_eligibility: { data: [{ id: "x" }], error: null },
    });
    const res = await fetchOfferTiers(fake as never, { showId: "sh1", cityId: "c1", showDateId: "d1" });
    // Duplicates are intentionally preserved here — dedup is buildOfferTierOptions' job.
    expect(res).toEqual({ priorities: [1, 2, 1], hasAdHoc: true, source: "org" });
  });
  it("skips the priority query when there is no city", async () => {
    const fake = createFakeSupabase({ show_date_cast_eligibility: { data: [], error: null } });
    const res = await fetchOfferTiers(fake as never, { showId: "sh1", cityId: null, showDateId: "d1" });
    expect(res).toEqual({ priorities: [], hasAdHoc: false, source: "org" });
    expect(fake.calls.find((c) => c.table === "cast_city_priority")).toBeUndefined();
    // A null city skips the show-ladder lookup too: ladders are per (show, city).
    expect(fake.calls.find((c) => c.table === "show_cast_eligibility")).toBeUndefined();
  });
  it("prefers show-scoped priorities and reports source", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: { data: [{ priority: 1 }, { priority: 2 }], error: null },
      show_date_cast_eligibility: { data: [], error: null },
    });
    const res = await fetchOfferTiers(fake as never, { showId: "sh1", cityId: "c1", showDateId: "d1" });
    expect(res).toEqual({ priorities: [1, 2], hasAdHoc: false, source: "show" });
    // The show ladder wins outright, so the org-wide fallback query must not fire.
    expect(fake.calls.find((c) => c.table === "cast_city_priority")).toBeUndefined();
    expect(fake.calls).toContainEqual({ table: "show_cast_eligibility", method: "eq", args: ["show_id", "sh1"] });
    expect(fake.calls).toContainEqual({ table: "show_cast_eligibility", method: "eq", args: ["city_id", "c1"] });
    // The fake can't apply .not() to seeded rows, so pin the filter call itself
    // (see fetchShowPriorityRows in src/data/eligibility.test.ts for the pattern).
    expect(fake.calls).toContainEqual({ table: "show_cast_eligibility", method: "not", args: ["priority", "is", null] });
  });
  it("falls back to the org city list with source org", async () => {
    const fake = createFakeSupabase({
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [{ priority: 1 }], error: null },
      show_date_cast_eligibility: { data: [], error: null },
    });
    const res = await fetchOfferTiers(fake as never, { showId: "sh1", cityId: "c1", showDateId: "d1" });
    expect(res).toEqual({ priorities: [1], hasAdHoc: false, source: "org" });
  });
});

describe("fetchOpenedTiers", () => {
  it("maps rows to camelCase", async () => {
    const fake = createFakeSupabase({
      show_date_offer_tiers: { data: [{ tier: 1, opened_at: "2026-07-01T00:00:00Z", closed_at: null }], error: null },
    });
    const res = await fetchOpenedTiers(fake as never, "d1");
    expect(res).toEqual([{ tier: 1, openedAt: "2026-07-01T00:00:00Z", closedAt: null }]);
  });
  it("throws on DB error", async () => {
    const fake = createFakeSupabase({ show_date_offer_tiers: { data: null, error: { message: "boom" } } });
    await expect(fetchOpenedTiers(fake as never, "d1")).rejects.toBeTruthy();
  });
});

describe("closeOfferTier", () => {
  it("sends body with withdraw and returns parsed result", async () => {
    const fake = createFakeSupabase({ "fn:close-offer-tier": { data: { closed: true, withdrawn: 3 }, error: null } });
    const res = await closeOfferTier(fake as never, { showDateId: "d1", tier: 2, withdraw: true });
    expect(res).toEqual({ closed: true, withdrawn: 3, message: undefined });
    expect(fake.calls).toContainEqual({ table: "fn:close-offer-tier", method: "invoke", args: [{ show_date_id: "d1", tier: 2, withdraw: true }] });
  });
  it("throws on a 200 body carrying { error }", async () => {
    const fake = createFakeSupabase({ "fn:close-offer-tier": { data: { error: "nope" }, error: null } });
    await expect(closeOfferTier(fake as never, { showDateId: "d1", tier: 1, withdraw: false })).rejects.toThrow("nope");
  });
  it("throws on transport error", async () => {
    const fake = createFakeSupabase({ "fn:close-offer-tier": { data: null, error: { message: "network" } } });
    await expect(closeOfferTier(fake as never, { showDateId: "d1", tier: 1, withdraw: false })).rejects.toBeTruthy();
  });
});

describe("fetchPendingConfirmationsCount", () => {
  it("counts soft_booked bookings for the org via a head count", async () => {
    const fake = createFakeSupabase({
      bookings: { data: null, count: 3, error: null },
    });
    const n = await fetchPendingConfirmationsCount(fake as never, "org-1");
    expect(n).toBe(3);
    // Server-side count: no row data transferred (head: true).
    expect(fake.calls).toContainEqual({ table: "bookings", method: "select", args: ["*", { count: "exact", head: true }] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["status", "soft_booked"] });
  });

  it("returns 0 when count is null", async () => {
    const fake = createFakeSupabase({ bookings: { data: null, count: null, error: null } });
    expect(await fetchPendingConfirmationsCount(fake as never, "org-1")).toBe(0);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ bookings: { data: null, error: { message: "boom" } } });
    await expect(fetchPendingConfirmationsCount(fake as never, "org-1")).rejects.toBeTruthy();
  });
});

describe("fetchMyOpenOffersCount", () => {
  it("counts suggested bookings for the artist via a head count", async () => {
    const fake = createFakeSupabase({
      bookings: { data: null, count: 2, error: null },
    });
    const n = await fetchMyOpenOffersCount(fake as never, "artist-1");
    expect(n).toBe(2);
    expect(fake.calls).toContainEqual({ table: "bookings", method: "select", args: ["*", { count: "exact", head: true }] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["artist_id", "artist-1"] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["status", "suggested"] });
  });

  it("returns 0 when count is null", async () => {
    const fake = createFakeSupabase({ bookings: { data: null, count: null, error: null } });
    expect(await fetchMyOpenOffersCount(fake as never, "artist-1")).toBe(0);
  });
});

const NOW = new Date("2026-07-02T12:00:00.000Z");

describe("bulkConfirmSoftBooked", () => {
  it("preconditions on soft_booked and reports rows actually confirmed", async () => {
    // Two ids requested but only one row still soft_booked → affected = 1.
    const fake = createFakeSupabase({ bookings: { data: [{ id: "b1" }], error: null } });
    const res = await bulkConfirmSoftBooked(fake as never, { ids: ["b1", "b2"], now: NOW });
    expect(res).toEqual({ affected: 1 });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "in", args: ["id", ["b1", "b2"]] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["status", "soft_booked"] });
    expect(fake.calls).toContainEqual({
      table: "bookings",
      method: "update",
      args: [{ status: "confirmed", confirmed_at: NOW.toISOString() }],
    });
  });

  it("reports 0 affected when every selected booking already moved on (stale ids)", async () => {
    const fake = createFakeSupabase({ bookings: { data: [], error: null } });
    const res = await bulkConfirmSoftBooked(fake as never, { ids: ["b1"], now: NOW });
    expect(res).toEqual({ affected: 0 });
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ bookings: { data: null, error: { message: "boom" } } });
    await expect(bulkConfirmSoftBooked(fake as never, { ids: ["b1"], now: NOW })).rejects.toBeTruthy();
  });
});

describe("bulkDeclineSoftBooked", () => {
  it("preconditions on soft_booked and stamps a producer_declined cancel", async () => {
    const fake = createFakeSupabase({ bookings: { data: [{ id: "b1" }], error: null } });
    const res = await bulkDeclineSoftBooked(fake as never, { ids: ["b1"], now: NOW });
    expect(res).toEqual({ affected: 1 });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["status", "soft_booked"] });
    expect(fake.calls).toContainEqual({
      table: "bookings",
      method: "update",
      args: [{ status: "cancelled", cancelled_at: NOW.toISOString(), cancellation_reason: "producer_declined" }],
    });
  });

  it("reports 0 affected for a stale selection", async () => {
    const fake = createFakeSupabase({ bookings: { data: [], error: null } });
    expect(await bulkDeclineSoftBooked(fake as never, { ids: ["b1"], now: NOW })).toEqual({ affected: 0 });
  });
});

describe("updateBookingStatusGuarded", () => {
  it("confirm requires the booking to be soft_booked", async () => {
    const fake = createFakeSupabase({ bookings: { data: [{ id: "b1" }], error: null } });
    const res = await updateBookingStatusGuarded(fake as never, { bookingId: "b1", status: "confirmed", now: NOW });
    expect(res).toEqual({ affected: 1 });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["id", "b1"] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["status", "soft_booked"] });
    expect(fake.calls).toContainEqual({
      table: "bookings",
      method: "update",
      args: [{ status: "confirmed", confirmed_at: NOW.toISOString() }],
    });
  });

  it("cancel guards against a no-op re-cancel via neq(status, cancelled)", async () => {
    const fake = createFakeSupabase({ bookings: { data: [{ id: "b1" }], error: null } });
    const res = await updateBookingStatusGuarded(fake as never, { bookingId: "b1", status: "cancelled", now: NOW });
    expect(res).toEqual({ affected: 1 });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "neq", args: ["status", "cancelled"] });
    expect(fake.calls).toContainEqual({
      table: "bookings",
      method: "update",
      args: [{ status: "cancelled", cancelled_at: NOW.toISOString() }],
    });
  });

  it("reports 0 affected when a stale confirm hits an already-cancelled booking", async () => {
    const fake = createFakeSupabase({ bookings: { data: [], error: null } });
    const res = await updateBookingStatusGuarded(fake as never, { bookingId: "b1", status: "confirmed", now: NOW });
    expect(res).toEqual({ affected: 0 });
  });
});

describe("respondToOffer", () => {
  it("accept requires the offer to still be suggested and sets soft_booked", async () => {
    const fake = createFakeSupabase({ bookings: { data: [{ id: "b1" }], error: null } });
    const res = await respondToOffer(fake as never, { bookingId: "b1", accept: true, now: NOW });
    expect(res).toEqual({ affected: 1 });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["status", "suggested"] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "update", args: [{ status: "soft_booked" }] });
  });

  it("decline stamps artist_declined", async () => {
    const fake = createFakeSupabase({ bookings: { data: [{ id: "b1" }], error: null } });
    const res = await respondToOffer(fake as never, { bookingId: "b1", accept: false, now: NOW });
    expect(res).toEqual({ affected: 1 });
    expect(fake.calls).toContainEqual({
      table: "bookings",
      method: "update",
      args: [{ status: "cancelled", cancelled_at: NOW.toISOString(), cancellation_reason: "artist_declined" }],
    });
  });

  it("reports 0 affected when the offer was withdrawn/expired (no longer suggested)", async () => {
    const fake = createFakeSupabase({ bookings: { data: [], error: null } });
    expect(await respondToOffer(fake as never, { bookingId: "b1", accept: true, now: NOW })).toEqual({ affected: 0 });
  });
});

describe("respondToOffer autoConfirm", () => {
  it("accept with autoConfirm writes confirmed + confirmed_at, still guarded on suggested", async () => {
    const fake = createFakeSupabase({ bookings: { data: [{ id: "b1" }], error: null } });
    const now = new Date("2026-07-14T10:00:00Z");
    const res = await respondToOffer(fake as never, { bookingId: "b1", accept: true, now, autoConfirm: true });
    expect(res).toEqual({ affected: 1 });
    const update = fake.calls.find((c) => c.table === "bookings" && c.method === "update");
    expect(update?.args[0]).toMatchObject({ status: "confirmed", confirmed_at: now.toISOString() });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["status", "suggested"] });
  });
  it("accept without autoConfirm keeps writing soft_booked", async () => {
    const fake = createFakeSupabase({ bookings: { data: [{ id: "b1" }], error: null } });
    await respondToOffer(fake as never, { bookingId: "b1", accept: true, now: new Date() });
    const update = fake.calls.find((c) => c.table === "bookings" && c.method === "update");
    expect(update?.args[0]).toMatchObject({ status: "soft_booked" });
  });
});

describe("createBooking", () => {
  const args = { showDateId: "d1", artistId: "a1", isUnderstudy: false, bookedBy: "u1", orgId: "org-1" };
  it("inserts soft_booked by default", async () => {
    const fake = createFakeSupabase({ bookings: { data: null, error: null } });
    await createBooking(fake as never, { ...args, confirmDirectly: false, now: new Date() });
    const insert = fake.calls.find((c) => c.table === "bookings" && c.method === "insert");
    expect(insert?.args[0]).toMatchObject({
      show_date_id: "d1", artist_id: "a1", status: "soft_booked", is_understudy: false,
      booked_by: "u1", org_id: "org-1",
    });
  });
  it("inserts confirmed with confirmed_at in direct mode", async () => {
    const fake = createFakeSupabase({ bookings: { data: null, error: null } });
    const now = new Date("2026-07-14T10:00:00Z");
    await createBooking(fake as never, { ...args, confirmDirectly: true, now });
    const insert = fake.calls.find((c) => c.table === "bookings" && c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ status: "confirmed", confirmed_at: now.toISOString() });
  });
});

describe("dryRunOfferTier", () => {
  it("invokes open-offer-tier with dry_run and maps the response", async () => {
    const fake = createFakeSupabase({
      "fn:open-offer-tier": {
        data: { dry_run: true, candidates: [{ id: "a1", name: "Lena" }], excluded: { already_booked: 1, blocked: 2, inactive: 0 } },
        error: null,
      },
    });
    const res = await dryRunOfferTier(fake as never, { showDateId: "d1", tier: 2 });
    expect(res.candidates).toEqual([{ id: "a1", name: "Lena" }]);
    // notEligible/missingSkills default to 0 when the edge fn omits them.
    expect(res.excluded).toEqual({ alreadyBooked: 1, blocked: 2, inactive: 0, notEligible: 0, missingSkills: 0 });
    expect(fake.calls).toContainEqual({
      table: "fn:open-offer-tier", method: "invoke",
      args: [{ show_date_id: "d1", tier: 2, dry_run: true }],
    });
  });
  it("maps the two new exclusion counts", async () => {
    const fake = createFakeSupabase({ "fn:open-offer-tier": { data: {
      dry_run: true, candidates: [],
      excluded: { already_booked: 1, blocked: 0, inactive: 0, not_eligible: 2, missing_skills: 3 },
    }, error: null } });
    const res = await dryRunOfferTier(fake as never, { showDateId: "d1", tier: 1 });
    expect(res.excluded).toEqual({ alreadyBooked: 1, blocked: 0, inactive: 0, notEligible: 2, missingSkills: 3 });
  });
  it("passes skill_filter_ids only when non-empty", async () => {
    const fake = createFakeSupabase({ "fn:open-offer-tier": { data: { dry_run: true, candidates: [], excluded: {} }, error: null } });
    await dryRunOfferTier(fake as never, { showDateId: "d1", tier: 1, skillFilterIds: ["s1", "s2"] });
    expect(fake.calls).toContainEqual({
      table: "fn:open-offer-tier", method: "invoke",
      args: [{ show_date_id: "d1", tier: 1, dry_run: true, skill_filter_ids: ["s1", "s2"] }],
    });
  });
});

describe("fetchTierAttention", () => {
  it("selects open tiers on upcoming org dates and maps rows", async () => {
    const fake = createFakeSupabase({
      show_date_offer_tiers: {
        data: [{
          tier: 1,
          show_date: {
            id: "d1", date: "2026-07-20", status: "open", custom: null,
            show: { program: "TJE", sub_program: "M", main_cast_slots: 2, understudy_slots: 1 },
            bookings: [{ status: "suggested", offer_tier: 1, offer_expires_at: null }],
          },
        }],
        error: null,
      },
    });
    const rows = await fetchTierAttention(fake as never, { orgId: "org-1", today: "2026-07-15" });
    expect(rows).toEqual([{
      showDateId: "d1", date: "2026-07-20", program: "TJE", subProgram: "M", custom: null,
      slots: { main_cast: 2, understudies: 1 }, tier: 1,
      bookings: [{ status: "suggested", offer_tier: 1, offer_expires_at: null }],
    }]);
    expect(fake.calls).toContainEqual({ table: "show_date_offer_tiers", method: "is", args: ["closed_at", null] });
    expect(fake.calls).toContainEqual({ table: "show_date_offer_tiers", method: "eq", args: ["show_date.org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "show_date_offer_tiers", method: "gte", args: ["show_date.date", "2026-07-15"] });
    expect(fake.calls).toContainEqual({ table: "show_date_offer_tiers", method: "neq", args: ["show_date.status", "cancelled"] });
  });
  it("returns [] for a null org without querying", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchTierAttention(fake as never, { orgId: null, today: "2026-07-15" })).toEqual([]);
    expect(fake.calls).toEqual([]);
  });
});
