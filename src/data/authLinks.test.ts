import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { requestLoginLink } from "./authLinks";

describe("requestLoginLink", () => {
  it("invokes send-login-link with email + app_origin", async () => {
    const fake = createFakeSupabase({ "fn:send-login-link": { data: { ok: true }, error: null } });
    await requestLoginLink(fake as never, "user@x.com", "https://app.showflow.pro");
    expect(fake.calls).toContainEqual({
      table: "fn:send-login-link",
      method: "invoke",
      args: [{ email: "user@x.com", app_origin: "https://app.showflow.pro" }],
    });
  });

  it("forwards a redirect_path when given, and omits the key when not", async () => {
    const fake = createFakeSupabase({ "fn:send-login-link": { data: { ok: true }, error: null } });
    await requestLoginLink(fake as never, "user@x.com", "https://app.showflow.pro", "/accept-invite?token=x");
    expect(fake.calls).toContainEqual({
      table: "fn:send-login-link",
      method: "invoke",
      args: [{ email: "user@x.com", app_origin: "https://app.showflow.pro", redirect_path: "/accept-invite?token=x" }],
    });
  });

  it("throws on a transport error", async () => {
    const fake = createFakeSupabase({ "fn:send-login-link": { data: null, error: { message: "network" } } });
    await expect(
      requestLoginLink(fake as never, "user@x.com", "https://app.showflow.pro"),
    ).rejects.toBeTruthy();
  });
});
