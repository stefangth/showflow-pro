import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchMyProfile, updateMyProfile } from "./profiles";

const aProfile = { user_id: "u1", display_name: "Ada", phone: "123", email: "ada@x.com", avatar_url: null };

describe("fetchMyProfile", () => {
  it("selects the profile row by user_id and returns it", async () => {
    const fake = createFakeSupabase({ profiles: { data: aProfile, error: null } });
    const result = await fetchMyProfile(fake as never, "u1");
    expect(result).toEqual(aProfile);
    expect(fake.calls).toContainEqual({ table: "profiles", method: "eq", args: ["user_id", "u1"] });
    expect(fake.calls).toContainEqual({ table: "profiles", method: "maybeSingle", args: [] });
  });

  it("returns null when there is no row", async () => {
    const fake = createFakeSupabase({ profiles: { data: null, error: null } });
    expect(await fetchMyProfile(fake as never, "u1")).toBeNull();
  });
});

describe("updateMyProfile", () => {
  it("updates display_name + phone scoped to the user_id", async () => {
    const fake = createFakeSupabase({ profiles: { data: null, error: null } });
    await updateMyProfile(fake as never, "u1", { display_name: "Ada L.", phone: "999" });
    expect(fake.calls).toContainEqual({ table: "profiles", method: "update", args: [{ display_name: "Ada L.", phone: "999" }] });
    expect(fake.calls).toContainEqual({ table: "profiles", method: "eq", args: ["user_id", "u1"] });
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ profiles: { data: null, error: { message: "boom" } } });
    await expect(updateMyProfile(fake as never, "u1", { display_name: "x" })).rejects.toBeTruthy();
  });
});
