import { describe, it, expect, vi } from "vitest";
import {
  resolveSessionIdentity,
  computeAuthReady,
  type SessionIdentityHandlers,
} from "./sessionState";

function makeHandlers(over: Partial<SessionIdentityHandlers> = {}): SessionIdentityHandlers {
  return {
    loadIdentity: vi.fn(async () => {}),
    clearIdentity: vi.fn(),
    markResolved: vi.fn(),
    ...over,
  };
}

describe("resolveSessionIdentity", () => {
  it("does not mark resolved until identity has finished loading for a signed-in user", async () => {
    // The core race: guards read readiness to know when isSuperAdmin/currentOrg
    // are trustworthy. Marking resolved before loadIdentity settles would let a
    // guard act on empty identity (NoOrgScreen / wrong role gate flash).
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
    const markResolved = vi.fn((uid: string | null) => order.push(`resolved:${uid}`));
    const handlers = makeHandlers({ loadIdentity, markResolved });

    const done = resolveSessionIdentity({ user: { id: "user-1" } } as never, handlers);

    // Flush microtasks so execution reaches the awaited loadIdentity. Resolution
    // must still be pending here.
    await Promise.resolve();
    expect(loadIdentity).toHaveBeenCalledWith("user-1");
    expect(markResolved).not.toHaveBeenCalled();

    resolveIdentity();
    await done;

    // Marked resolved for the right user, strictly after identity finished loading.
    expect(markResolved).toHaveBeenCalledWith("user-1");
    expect(order).toEqual(["identity-loaded", "resolved:user-1"]);
  });

  it("clears identity (never loads it) and marks resolved null for a signed-out session", async () => {
    const handlers = makeHandlers();

    await resolveSessionIdentity(null, handlers);

    expect(handlers.clearIdentity).toHaveBeenCalledOnce();
    expect(handlers.loadIdentity).not.toHaveBeenCalled();
    expect(handlers.markResolved).toHaveBeenCalledWith(null);
  });

  it("still marks resolved if identity loading rejects", async () => {
    // A failed identity fetch must never strand the app on the spinner.
    const loadIdentity = vi.fn(async () => {
      throw new Error("boom");
    });
    const handlers = makeHandlers({ loadIdentity });

    await expect(
      resolveSessionIdentity({ user: { id: "u" } } as never, handlers),
    ).resolves.toBeUndefined();
    expect(handlers.markResolved).toHaveBeenCalledWith("u");
  });
});

describe("computeAuthReady", () => {
  it("is not ready until the initial session check has completed", () => {
    // Before bootstrap, guards must show the spinner — never redirect to /login
    // on a hard reload before the persisted session has been restored.
    expect(computeAuthReady(false, null, null)).toBe(false);
    expect(computeAuthReady(false, "user-1", "user-1")).toBe(false);
  });

  it("is ready for a bootstrapped signed-out session", () => {
    expect(computeAuthReady(true, null, null)).toBe(true);
  });

  it("is ready when identity is loaded for the current user", () => {
    expect(computeAuthReady(true, "user-1", "user-1")).toBe(true);
  });

  it("is NOT ready when a user is signed in but identity is not loaded for them", () => {
    // The flash window: `user` just became truthy (login / account switch) while
    // identity is still empty or belongs to a different user. Derived readiness
    // is false here in EVERY render until identity catches up — so the guard
    // shows the spinner instead of flashing NoOrgScreen / the wrong role gate,
    // regardless of auth-callback timing.
    expect(computeAuthReady(true, "user-1", null)).toBe(false);
    expect(computeAuthReady(true, "user-2", "user-1")).toBe(false);
  });

  it("is NOT ready mid-sign-out until identity is cleared", () => {
    // user already null, but identity still resolved for the old user.
    expect(computeAuthReady(true, null, "user-1")).toBe(false);
  });
});
