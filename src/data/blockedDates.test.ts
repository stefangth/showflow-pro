import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchBlockedArtistIds } from "./blockedDates";

describe("blockedDates data-access", () => {
  it("fetchBlockedArtistIds returns the artist ids blocked on the date", async () => {
    const fake = createFakeSupabase({
      blocked_dates: { data: [{ artist_id: "a1" }, { artist_id: "a2" }], error: null },
    });
    const res = await fetchBlockedArtistIds(fake as never, { date: "2026-07-20", orgId: "org-1" });
    expect(res).toEqual(new Set(["a1", "a2"]));
    expect(fake.calls).toContainEqual({ table: "blocked_dates", method: "eq", args: ["date", "2026-07-20"] });
    expect(fake.calls).toContainEqual({ table: "blocked_dates", method: "select", args: ["artist_id"] });
  });

  it("fetchBlockedArtistIds returns an empty set when nobody is blocked", async () => {
    const fake = createFakeSupabase({ blocked_dates: { data: [], error: null } });
    expect(await fetchBlockedArtistIds(fake as never, { date: "2026-07-20", orgId: "org-1" })).toEqual(new Set());
  });

  it("fetchBlockedArtistIds throws on a query error", async () => {
    const fake = createFakeSupabase({
      blocked_dates: { data: null, error: { message: "boom" } },
    });
    await expect(fetchBlockedArtistIds(fake as never, { date: "2026-07-20", orgId: "org-1" })).rejects.toBeTruthy();
  });
});
