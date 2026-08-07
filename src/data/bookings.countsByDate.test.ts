import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { fetchBookingCountsByDate } from "./bookings";

describe("fetchBookingCountsByDate per-status buckets", () => {
  it("buckets confirmed/accepted(soft_booked)/pending(suggested) by main vs understudy, ignores cancelled", async () => {
    const client = createFakeSupabase({
      bookings: { data: [
        { show_date_id: "d1", status: "confirmed",   is_understudy: false },
        { show_date_id: "d1", status: "confirmed",   is_understudy: true  },
        { show_date_id: "d1", status: "soft_booked", is_understudy: false },
        { show_date_id: "d1", status: "suggested",   is_understudy: false },
        { show_date_id: "d1", status: "cancelled",   is_understudy: false },
      ], error: null },
    });
    const map = await fetchBookingCountsByDate(asSupabase(client), "org-1");
    expect(map.get("d1")).toEqual({
      confirmedMain: 1, confirmedUs: 1,
      acceptedMain: 1, acceptedUs: 0,
      pendingMain: 1, pendingUs: 0,
      total: 4, // non-cancelled only
    });
  });

  it("returns an empty map for a null org", async () => {
    const client = createFakeSupabase({});
    expect((await fetchBookingCountsByDate(asSupabase(client), null)).size).toBe(0);
  });
});
