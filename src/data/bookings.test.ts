import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { openOfferTier, fetchOfferTiers, fetchOpenedTiers, closeOfferTier, fetchPendingConfirmationsCount, fetchMyOpenOffersCount } from "./bookings";

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
});

describe("fetchOfferTiers", () => {
  it("returns priorities for the city and detects ad-hoc", async () => {
    const fake = createFakeSupabase({
      cast_city_priority: { data: [{ priority: 1 }, { priority: 2 }, { priority: 1 }], error: null },
      show_date_cast_eligibility: { data: [{ id: "x" }], error: null },
    });
    const res = await fetchOfferTiers(fake as never, { cityId: "c1", showDateId: "d1" });
    // Duplicates are intentionally preserved here — dedup is buildOfferTierOptions' job.
    expect(res).toEqual({ priorities: [1, 2, 1], hasAdHoc: true });
  });
  it("skips the priority query when there is no city", async () => {
    const fake = createFakeSupabase({ show_date_cast_eligibility: { data: [], error: null } });
    const res = await fetchOfferTiers(fake as never, { cityId: null, showDateId: "d1" });
    expect(res).toEqual({ priorities: [], hasAdHoc: false });
    expect(fake.calls.find((c) => c.table === "cast_city_priority")).toBeUndefined();
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
