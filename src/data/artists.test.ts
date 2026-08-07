import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { anArtist } from "@/test/fixtures";
import {
  fetchMyArtist,
  fetchMyCancelledDateBookings,
  mergeArtistCancelledDates,
  fetchPendingInvitedArtistIds,
  fetchMyActiveBookedDates,
} from "./artists";
import { partialMock } from "@/test/castHelpers";
import type { CancelledDateEntry } from "./artists";

describe("fetchMyArtist", () => {
  it("queries the artists table by user_id and returns the row", async () => {
    const artist = anArtist({ user_id: "u1" });
    const fake = createFakeSupabase({ artists: { data: artist, error: null } });
    const result = await fetchMyArtist(fake as never, "u1", "org-1");
    expect(result).toEqual(artist);
    expect(fake.calls).toContainEqual({ table: "artists", method: "eq", args: ["user_id", "u1"] });
    expect(fake.calls).toContainEqual({ table: "artists", method: "maybeSingle", args: [] });
  });

  it("returns null when no row exists", async () => {
    const fake = createFakeSupabase({ artists: { data: null, error: null } });
    expect(await fetchMyArtist(fake as never, "u1", "org-1")).toBeNull();
  });

  it("throws when the query errors", async () => {
    const fake = createFakeSupabase({ artists: { data: null, error: { message: "boom" } } });
    await expect(fetchMyArtist(fake as never, "u1", "org-1")).rejects.toBeTruthy();
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

describe("fetchMyActiveBookedDates", () => {
  it("selects this artist's non-cancelled bookings joined to their show_date", async () => {
    const row = {
      show_date_id: "d1",
      status: "soft_booked",
      is_understudy: false,
      show_date: {
        id: "d1",
        date: "2026-01-01", // in the past relative to "today" in the app
        venue: "Hall",
        session_1: "19:00:00",
        session_2: null,
        session_3: null,
        show: { program: "X", sub_program: null },
      },
    };
    const fake = createFakeSupabase({ bookings: { data: [row], error: null } });
    const res = await fetchMyActiveBookedDates(fake as never, "a1");
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["artist_id", "a1"] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "neq", args: ["status", "cancelled"] });
    expect(res).toEqual([
      {
        id: "d1",
        date: "2026-01-01",
        venue: "Hall",
        session_1: "19:00:00",
        session_2: null,
        session_3: null,
        status: "soft_booked",
        is_understudy: false,
        show: { program: "X", sub_program: null },
      },
    ]);
  });

  it("carries is_understudy through for an understudy booking", async () => {
    const fake = createFakeSupabase({
      bookings: {
        data: [
          {
            show_date_id: "d2",
            status: "confirmed",
            is_understudy: true,
            show_date: {
              id: "d2",
              date: "2026-02-02",
              venue: null,
              session_1: null,
              session_2: null,
              session_3: null,
              show: null,
            },
          },
        ],
        error: null,
      },
    });
    const res = await fetchMyActiveBookedDates(fake as never, "a1");
    expect(res[0].is_understudy).toBe(true);
    expect(res[0].status).toBe("confirmed");
    expect(res[0].show).toBeNull();
  });

  it("drops rows whose joined show_date is missing", async () => {
    const fake = createFakeSupabase({
      bookings: {
        data: [{ show_date_id: "d1", status: "suggested", is_understudy: false, show_date: null }],
        error: null,
      },
    });
    expect(await fetchMyActiveBookedDates(fake as never, "a1")).toHaveLength(0);
  });

  it("throws when the query errors", async () => {
    const fake = createFakeSupabase({ bookings: { data: null, error: { message: "boom" } } });
    await expect(fetchMyActiveBookedDates(fake as never, "a1")).rejects.toBeTruthy();
  });
});

describe("mergeArtistCancelledDates", () => {
  it("appends cancelled entries not already present", () => {
    const merged = mergeArtistCancelledDates([{ id: "d2" }], [partialMock<CancelledDateEntry>({ id: "d1", status: "cancelled" })]);
    expect(merged.map((d) => d.id).sort()).toEqual(["d1", "d2"]);
  });
  it("does not duplicate a date already eligible", () => {
    expect(mergeArtistCancelledDates([{ id: "d1" }], [partialMock<CancelledDateEntry>({ id: "d1", status: "cancelled" })])).toHaveLength(1);
  });
});

describe("fetchPendingInvitedArtistIds", () => {
  it("calls the list_pending_invited_artists rpc with p_org and returns ids", async () => {
    const fake = createFakeSupabase({ "rpc:list_pending_invited_artists": { data: ["a1", "a2"], error: null } });
    const ids = await fetchPendingInvitedArtistIds(fake as never, "o1");
    expect(ids).toEqual(["a1", "a2"]);
    expect(fake.calls).toContainEqual({ table: "rpc:list_pending_invited_artists", method: "rpc", args: [{ p_org: "o1" }] });
  });

  it("returns [] when the rpc yields null", async () => {
    const fake = createFakeSupabase({ "rpc:list_pending_invited_artists": { data: null, error: null } });
    expect(await fetchPendingInvitedArtistIds(fake as never, "o1")).toEqual([]);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:list_pending_invited_artists": { data: null, error: { message: "boom" } } });
    await expect(fetchPendingInvitedArtistIds(fake as never, "o1")).rejects.toBeTruthy();
  });
});
