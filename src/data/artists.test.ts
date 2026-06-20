import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { anArtist } from "@/test/fixtures";
import { fetchMyArtist, fetchMyCancelledDateBookings, mergeArtistCancelledDates } from "./artists";

describe("fetchMyArtist", () => {
  it("queries the artists table by user_id and returns the row", async () => {
    const artist = anArtist({ user_id: "u1" });
    const fake = createFakeSupabase({ artists: { data: artist, error: null } });
    const result = await fetchMyArtist(fake as never, "u1");
    expect(result).toEqual(artist);
    expect(fake.calls).toContainEqual({ table: "artists", method: "eq", args: ["user_id", "u1"] });
    expect(fake.calls).toContainEqual({ table: "artists", method: "maybeSingle", args: [] });
  });

  it("returns null when no row exists", async () => {
    const fake = createFakeSupabase({ artists: { data: null, error: null } });
    expect(await fetchMyArtist(fake as never, "u1")).toBeNull();
  });

  it("throws when the query errors", async () => {
    const fake = createFakeSupabase({ artists: { data: null, error: { message: "boom" } } });
    await expect(fetchMyArtist(fake as never, "u1")).rejects.toBeTruthy();
  });
});

describe("fetchMyCancelledDateBookings", () => {
  it("selects this artist's date_cancelled bookings joined to the cancelled date", async () => {
    const row = {
      show_date_id: "d1",
      show_date: {
        id: "d1",
        date: "2026-07-01",
        venue: "Hall",
        session_1: "19:00:00",
        status: "cancelled",
        cancellation_reason: "Venue flooded",
        show: { program: "X", sub_program: null },
      },
    };
    const fake = createFakeSupabase({ bookings: { data: [row], error: null } });
    const res = await fetchMyCancelledDateBookings(fake as never, "a1");
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["artist_id", "a1"] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["cancellation_reason", "date_cancelled"] });
    expect(res[0].cancellation_reason).toBe("Venue flooded");
  });

  it("drops rows whose joined show_date isn't cancelled (or is missing)", async () => {
    const fake = createFakeSupabase({
      bookings: {
        data: [
          { show_date_id: "d1", show_date: { id: "d1", status: "open", cancellation_reason: null } },
          { show_date_id: "d2", show_date: null },
        ],
        error: null,
      },
    });
    expect(await fetchMyCancelledDateBookings(fake as never, "a1")).toHaveLength(0);
  });

  it("throws when the query errors", async () => {
    const fake = createFakeSupabase({ bookings: { data: null, error: { message: "boom" } } });
    await expect(fetchMyCancelledDateBookings(fake as never, "a1")).rejects.toBeTruthy();
  });
});

describe("mergeArtistCancelledDates", () => {
  it("appends cancelled entries not already present", () => {
    const merged = mergeArtistCancelledDates([{ id: "d2" } as any], [{ id: "d1", status: "cancelled" } as any]);
    expect(merged.map((d) => d.id).sort()).toEqual(["d1", "d2"]);
  });
  it("does not duplicate a date already eligible", () => {
    expect(mergeArtistCancelledDates([{ id: "d1" } as any], [{ id: "d1", status: "cancelled" } as any])).toHaveLength(1);
  });
});
