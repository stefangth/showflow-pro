import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";

describe("createFakeSupabase auth stub", () => {
  it("records signInWithPassword and returns the seeded result", async () => {
    const fake = createFakeSupabase({ "auth:signInWithPassword": { data: { user: { id: "u1" } }, error: null } });
    const res = await fake.auth.signInWithPassword({ email: "a@b.com", password: "x" });
    expect(res).toEqual({ data: { user: { id: "u1" } }, error: null });
    expect(fake.calls).toContainEqual({ table: "auth", method: "signInWithPassword", args: [{ email: "a@b.com", password: "x" }] });
  });

  it("records updateUser and resetPasswordForEmail with sensible defaults", async () => {
    const fake = createFakeSupabase();
    expect(await fake.auth.updateUser({ password: "new" })).toEqual({ data: { user: null }, error: null });
    expect(await fake.auth.resetPasswordForEmail("a@b.com", { redirectTo: "/r" })).toEqual({ data: {}, error: null });
    expect(fake.calls).toContainEqual({ table: "auth", method: "updateUser", args: [{ password: "new" }] });
    expect(fake.calls).toContainEqual({ table: "auth", method: "resetPasswordForEmail", args: ["a@b.com", { redirectTo: "/r" }] });
  });
});
