import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  changeMyPassword,
  fetchMyHasPassword,
  fetchMyProfile,
  requestPasswordReauthentication,
  requestPasswordReset,
  setMyPassword,
  setNewPassword,
  updateMyProfile,
} from "./profiles";

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

describe("password methods", () => {
  it.each([false, true])("returns my_has_password result %s", async (hasPassword) => {
    const fake = createFakeSupabase({ "rpc:my_has_password": { data: hasPassword, error: null } });
    await expect(fetchMyHasPassword(fake as never)).resolves.toBe(hasPassword);
    expect(fake.calls).toContainEqual({ table: "rpc:my_has_password", method: "rpc", args: [undefined] });
  });

  it("propagates my_has_password RPC errors", async () => {
    const error = { message: "rpc failed" };
    const fake = createFakeSupabase({ "rpc:my_has_password": { data: null, error } });
    await expect(fetchMyHasPassword(fake as never)).rejects.toBe(error);
  });

  it("sets a password without signing in again", async () => {
    const fake = createFakeSupabase({ "auth:updateUser": { data: { user: { id: "u1" } }, error: null } });
    await setMyPassword(fake as never, "new-secret");
    expect(fake.calls).toContainEqual({ table: "auth", method: "updateUser", args: [{ password: "new-secret" }] });
    expect(fake.calls.some((call) => call.method === "signInWithPassword")).toBe(false);
  });

  it("changes the password atomically with Supabase's verified current_password attribute", async () => {
    const fake = createFakeSupabase({ "auth:updateUser": { data: { user: { id: "u1" } }, error: null } });
    await changeMyPassword(fake as never, { password: "new-secret", currentPassword: "old-secret" });
    expect(fake.calls).toContainEqual({
      table: "auth",
      method: "updateUser",
      args: [{ password: "new-secret", current_password: "old-secret" }],
    });
    expect(fake.calls.some((call) => call.method === "signInWithPassword")).toBe(false);
  });

  it("changes a password with a reauthentication nonce and omits undefined keys", async () => {
    const fake = createFakeSupabase({ "auth:updateUser": { data: { user: { id: "u1" } }, error: null } });
    await changeMyPassword(fake as never, { password: "new-secret", nonce: "123456" });
    expect(fake.calls).toContainEqual({ table: "auth", method: "updateUser", args: [{ password: "new-secret", nonce: "123456" }] });
  });

  it("requests reauthentication", async () => {
    const fake = createFakeSupabase({ "auth:reauthenticate": { data: {}, error: null } });
    await requestPasswordReauthentication(fake as never);
    expect(fake.calls).toContainEqual({ table: "auth", method: "reauthenticate", args: [] });
  });

  it.each([
    ["setup", (fake: ReturnType<typeof createFakeSupabase>) => setMyPassword(fake as never, "new-secret")],
    ["change", (fake: ReturnType<typeof createFakeSupabase>) => changeMyPassword(fake as never, { password: "new-secret", currentPassword: "old-secret" })],
    ["reauthentication", (fake: ReturnType<typeof createFakeSupabase>) => requestPasswordReauthentication(fake as never)],
  ])("propagates %s auth errors", async (_name, invoke) => {
    const error = { message: "auth failed" };
    const method = _name === "reauthentication" ? "reauthenticate" : "updateUser";
    const fake = createFakeSupabase({ [`auth:${method}`]: { data: null, error } });
    await expect(invoke(fake)).rejects.toBe(error);
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
