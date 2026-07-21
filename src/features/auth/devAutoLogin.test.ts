import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { maybeDevAutoLogin, type DevAutoLoginAuth, type DevAutoLoginConfig } from "./devAutoLogin";

/** A recording fake of the `supabase.auth` slice the helper uses. */
function makeAuth(session: unknown = null) {
  return {
    getSession: vi.fn(async () => ({ data: { session } })),
    signInWithPassword: vi.fn(async () => ({ error: null })),
  } as unknown as DevAutoLoginAuth & {
    getSession: ReturnType<typeof vi.fn>;
    signInWithPassword: ReturnType<typeof vi.fn>;
  };
}

const CREDS: DevAutoLoginConfig = { optedIn: true, email: "dev@example.com", password: "secret" };

describe("maybeDevAutoLogin", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("does nothing (no session probe, no sign-in) when not opted in", async () => {
    const auth = makeAuth();
    await maybeDevAutoLogin(auth, { ...CREDS, optedIn: false });
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("warns and skips sign-in when credentials are missing", async () => {
    const auth = makeAuth();
    await maybeDevAutoLogin(auth, { optedIn: true, email: "", password: "" });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("does not sign in when a session already exists (never overrides a real login)", async () => {
    const auth = makeAuth({ user: { id: "u1" } });
    await maybeDevAutoLogin(auth, CREDS);
    expect(auth.getSession).toHaveBeenCalled();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs in with the dev credentials when opted in and there is no session", async () => {
    const auth = makeAuth(null);
    await maybeDevAutoLogin(auth, CREDS);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "dev@example.com", password: "secret" });
  });

  it("warns but does not throw when the sign-in fails", async () => {
    const auth = makeAuth(null);
    (auth.signInWithPassword as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ error: { message: "bad creds" } });
    await maybeDevAutoLogin(auth, CREDS);
    expect(warn).toHaveBeenCalled();
  });
});
