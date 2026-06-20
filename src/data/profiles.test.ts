import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchMyProfile, updateMyProfile, updateMyPassword, requestPasswordReset, setNewPassword } from "./profiles";

const aProfile = { user_id: "u1", display_name: "Ada", phone: "123" };

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

describe("updateMyPassword", () => {
  it("verifies the current password then updates to the new one", async () => {
    const fake = createFakeSupabase({
      "auth:signInWithPassword": { data: { user: { id: "u1" } }, error: null },
      "auth:updateUser": { data: { user: { id: "u1" } }, error: null },
    });
    await updateMyPassword(fake as never, { email: "ada@x.com", currentPassword: "old", newPassword: "newpass12" });
    expect(fake.calls).toContainEqual({ table: "auth", method: "signInWithPassword", args: [{ email: "ada@x.com", password: "old" }] });
    expect(fake.calls).toContainEqual({ table: "auth", method: "updateUser", args: [{ password: "newpass12" }] });
  });

  it("rejects with a clear message when the current password is wrong (and never updates)", async () => {
    const fake = createFakeSupabase({
      "auth:signInWithPassword": { data: { user: null }, error: { message: "Invalid login credentials" } },
    });
    await expect(
      updateMyPassword(fake as never, { email: "ada@x.com", currentPassword: "bad", newPassword: "newpass12" }),
    ).rejects.toThrow(/current password is incorrect/i);
    expect(fake.calls.find((c) => c.method === "updateUser")).toBeUndefined();
  });
});

describe("requestPasswordReset", () => {
  it("calls resetPasswordForEmail with the redirect", async () => {
    const fake = createFakeSupabase({ "auth:resetPasswordForEmail": { data: {}, error: null } });
    await requestPasswordReset(fake as never, "ada@x.com", "https://app/reset-password");
    expect(fake.calls).toContainEqual({ table: "auth", method: "resetPasswordForEmail", args: ["ada@x.com", { redirectTo: "https://app/reset-password" }] });
  });
});

describe("setNewPassword", () => {
  it("calls updateUser with the new password", async () => {
    const fake = createFakeSupabase({ "auth:updateUser": { data: { user: { id: "u1" } }, error: null } });
    await setNewPassword(fake as never, "brandnewpass");
    expect(fake.calls).toContainEqual({ table: "auth", method: "updateUser", args: [{ password: "brandnewpass" }] });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "auth:updateUser": { data: { user: null }, error: { message: "weak" } } });
    await expect(setNewPassword(fake as never, "x")).rejects.toBeTruthy();
  });
});
