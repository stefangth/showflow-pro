import { describe, it, expect } from "vitest";
import { deriveBookingGroups, computeInheritedCastIds, bookingStatusUpdate } from "./bookings";

type B = { artist_id: string; status: string; is_understudy: boolean };
const b = (o: Partial<B>): B => ({ artist_id: "a1", status: "suggested", is_understudy: false, ...o });

describe("deriveBookingGroups", () => {
  it("excludes cancelled bookings from every group", () => {
    const groups = deriveBookingGroups([
      b({ artist_id: "a1", status: "confirmed" }),
      b({ artist_id: "a2", status: "cancelled" }),
    ]);
    expect(groups.active).toHaveLength(1);
    expect(groups.bookedArtistIds.has("a2")).toBe(false);
  });

  it("splits main vs understudy", () => {
    const groups = deriveBookingGroups([
      b({ artist_id: "a1", is_understudy: false }),
      b({ artist_id: "a2", is_understudy: true }),
    ]);
    expect(groups.main.map((x) => x.artist_id)).toEqual(["a1"]);
    expect(groups.understudy.map((x) => x.artist_id)).toEqual(["a2"]);
  });

  it("counts confirmed main and understudy separately", () => {
    const groups = deriveBookingGroups([
      b({ artist_id: "a1", status: "confirmed", is_understudy: false }),
      b({ artist_id: "a2", status: "soft_booked", is_understudy: false }),
      b({ artist_id: "a3", status: "confirmed", is_understudy: true }),
      b({ artist_id: "a4", status: "cancelled", is_understudy: false }),
    ]);
    expect(groups.confirmedMainCount).toBe(1);
    expect(groups.confirmedUnderstudyCount).toBe(1);
  });

  it("handles null/undefined input", () => {
    expect(deriveBookingGroups(null).active).toEqual([]);
    expect(deriveBookingGroups(undefined).bookedArtistIds.size).toBe(0);
  });
});

describe("computeInheritedCastIds", () => {
  it("returns eligibility ids minus overrides", () => {
    const result = computeInheritedCastIds(["c1", "c2", "c3"], new Set(["c2"]));
    expect([...result].sort()).toEqual(["c1", "c3"]);
  });
  it("handles null eligibility", () => {
    expect(computeInheritedCastIds(null, new Set(["c1"])).size).toBe(0);
  });
});

describe("bookingStatusUpdate", () => {
  const now = new Date("2026-06-01T10:00:00.000Z");
  it("stamps confirmed_at when confirming", () => {
    expect(bookingStatusUpdate("confirmed", now)).toEqual({
      status: "confirmed",
      confirmed_at: now.toISOString(),
    });
  });
  it("stamps cancelled_at when cancelling", () => {
    expect(bookingStatusUpdate("cancelled", now)).toEqual({
      status: "cancelled",
      cancelled_at: now.toISOString(),
    });
  });
  it("stamps no timestamp for soft_booked (characterizes current behavior — does NOT clear stale stamps)", () => {
    expect(bookingStatusUpdate("soft_booked", now)).toEqual({ status: "soft_booked" });
  });
});
