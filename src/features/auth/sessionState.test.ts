import { describe, it, expect, vi } from "vitest";
import {
  resolveSessionIdentity,
  shouldRaiseLoading,
  type SessionIdentityHandlers,
} from "./sessionState";

function makeHandlers(over: Partial<SessionIdentityHandlers> = {}): SessionIdentityHandlers {
  return {
    loadIdentity: vi.fn(async () => {}),
    clearIdentity: vi.fn(),
    setLoading: vi.fn(),
    ...over,
  };
}

describe("resolveSessionIdentity", () => {
  it("does not clear loading until identity has finished loading for a signed-in user", async () => {
    // The core race: route guards read `loading` to know when
    // isSuperAdmin/currentOrg are trustworthy. Clearing it before loadIdentity
    // resolves makes /platform bounce to the no-org screen on a hard load.
    const order: string[] = [];
    let resolveIdentity!: () => void;
    const loadIdentity = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveIdentity = () => {
            order.push("identity-loaded");
            res();
          };
        }),
    );
    const setLoading = vi.fn((v: boolean) => {
      if (!v) order.push("loading-cleared");
    });
    const handlers = makeHandlers({ loadIdentity, setLoading });

    const done = resolveSessionIdentity({ user: { id: "user-1" } } as never, handlers);

    // Flush microtasks so execution reaches the awaited loadIdentity. Loading
    // must still be pending here.
    await Promise.resolve();
    expect(loadIdentity).toHaveBeenCalledWith("user-1");
    expect(setLoading).not.toHaveBeenCalled();

    resolveIdentity();
    await done;

    expect(setLoading).toHaveBeenCalledWith(false);
    // Loading is cleared strictly after identity finishes loading.
    expect(order).toEqual(["identity-loaded", "loading-cleared"]);
  });

  it("clears identity (never loads it) and loading for a signed-out session", async () => {
    const handlers = makeHandlers();

    await resolveSessionIdentity(null, handlers);

    expect(handlers.clearIdentity).toHaveBeenCalledOnce();
    expect(handlers.loadIdentity).not.toHaveBeenCalled();
    expect(handlers.setLoading).toHaveBeenCalledWith(false);
  });

  it("still clears loading if identity loading rejects", async () => {
    // A failed identity fetch must never strand the app on the spinner.
    const loadIdentity = vi.fn(async () => {
      throw new Error("boom");
    });
    const handlers = makeHandlers({ loadIdentity });

    await expect(
      resolveSessionIdentity({ user: { id: "u" } } as never, handlers),
    ).resolves.toBeUndefined();
    expect(handlers.setLoading).toHaveBeenCalledWith(false);
  });
});

describe("shouldRaiseLoading", () => {
  it("raises loading when a signed-in user's identity is not loaded yet", () => {
    // The post-login race: after a signed-out resolve cleared `loading` to
    // false, a fresh sign-in makes `user` truthy while identity is still empty.
    // Guards must see the spinner (loading:true), not a stale identity, until
    // the deferred loadIdentity runs — otherwise NoOrgScreen / the wrong role
    // gate flashes on the way to the dashboard.
    expect(shouldRaiseLoading({ user: { id: "user-1" } } as never, null)).toBe(true);
  });

  it("raises loading when the signed-in user differs from the loaded identity", () => {
    // Account switch within a live tab: identity is loaded for a different user.
    expect(shouldRaiseLoading({ user: { id: "user-2" } } as never, "user-1")).toBe(true);
  });

  it("does not raise loading for a background event on the already-loaded user", () => {
    // TOKEN_REFRESHED / USER_UPDATED fire for the same user whose identity is
    // already loaded — re-raising `loading` would flash a full-app spinner.
    expect(shouldRaiseLoading({ user: { id: "user-1" } } as never, "user-1")).toBe(false);
  });

  it("does not raise loading for a signed-out session", () => {
    // Sign-out sets user:null; the guards redirect to /login, no spinner needed.
    expect(shouldRaiseLoading(null, "user-1")).toBe(false);
    expect(shouldRaiseLoading(null, null)).toBe(false);
  });
});
