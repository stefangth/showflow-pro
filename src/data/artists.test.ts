import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { anArtist } from "@/test/fixtures";
import { fetchMyArtist } from "./artists";

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
