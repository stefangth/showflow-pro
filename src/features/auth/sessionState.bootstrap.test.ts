import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { bootstrapAuth, type AuthBootstrapDeps } from "./sessionState";

const SESSION = { user: { id: "user-1" } } as unknown as Session;

function makeDeps(over: Partial<AuthBootstrapDeps> = {}): AuthBootstrapDeps {
  return {
    getSession: vi.fn(async () => SESSION),
    applySession: vi.fn(),
    resolve: vi.fn(async () => {}),
    degrade: vi.fn(),
    retries: 3,
    backoffMs: 100,
    timeoutMs: 1000,
    ...over,
  };
}

describe("bootstrapAuth", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("resolves identity on the first successful getSession, without retry or degrade", async () => {
    const deps = makeDeps();

    const p = bootstrapAuth(deps);
    await vi.runAllTimersAsync();
    await p;

    expect(deps.getSession).toHaveBeenCalledTimes(1);
    expect(deps.applySession).toHaveBeenCalledWith(SESSION);
    expect(deps.resolve).toHaveBeenCalledWith(SESSION);
    expect(deps.degrade).not.toHaveBeenCalled();
  });

  it("recovers from a transient getSession failure by retrying (multi-tab auth-lock stall)", async () => {
    // The actual production bug: a contended getSession() rejects because the
    // cross-tab auth Web Lock acquire timed out. The bootstrap must retry and
    // succeed rather than strand the route guards on the loading spinner.
    const getSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("NavigatorLockAcquireTimeoutError"))
      .mockResolvedValue(SESSION);
    const deps = makeDeps({ getSession });

    const p = bootstrapAuth(deps);
    await vi.runAllTimersAsync();
    await p;

    expect(getSession).toHaveBeenCalledTimes(2);
    expect(deps.resolve).toHaveBeenCalledWith(SESSION);
    expect(deps.degrade).not.toHaveBeenCalled();
  });

  it("degrades exactly once (never strands) when getSession keeps failing past all retries", async () => {
    const getSession = vi.fn(async () => {
      throw new Error("locked");
    });
    const deps = makeDeps({ getSession, retries: 3 });

    const p = bootstrapAuth(deps);
    await vi.runAllTimersAsync();
    await p;

    expect(getSession).toHaveBeenCalledTimes(4); // initial attempt + 3 retries
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.degrade).toHaveBeenCalledTimes(1);
  });

  it("treats a getSession that never settles as a failure and degrades (hang, not just reject)", async () => {
    // A truly deadlocked auth lock: getSession() neither resolves nor rejects.
    // The per-attempt timeout must fire so the app can never spin forever.
    const getSession = vi.fn(() => new Promise<Session | null>(() => {}));
    const deps = makeDeps({ getSession, retries: 2, timeoutMs: 500 });

    const p = bootstrapAuth(deps);
    await vi.runAllTimersAsync();
    await p;

    expect(getSession).toHaveBeenCalledTimes(3); // initial + 2 retries, each timed out
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.degrade).toHaveBeenCalledTimes(1);
  });

  it("does not apply a successful session once superseded mid-flight (no clobber of an auth event)", async () => {
    // The window between reading the session and applying it can now stretch
    // across retries; if a concurrent onAuthStateChange already resolved a
    // fresher state, this attempt must not re-apply its (possibly stale) result.
    const shouldAbort = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const deps = makeDeps({ shouldAbort });

    const p = bootstrapAuth(deps);
    await vi.runAllTimersAsync();
    await p;

    expect(deps.getSession).toHaveBeenCalledTimes(1);
    expect(deps.applySession).not.toHaveBeenCalled();
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.degrade).not.toHaveBeenCalled();
  });

  it("stops retrying and never degrades once superseded between attempts", async () => {
    // e.g. the provider unmounted, or an auth event resolved while a retry was
    // pending — the loop must abandon quietly, not keep hammering or degrade.
    const shouldAbort = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const getSession = vi.fn(async () => {
      throw new Error("locked");
    });
    const deps = makeDeps({ getSession, retries: 3, shouldAbort });

    const p = bootstrapAuth(deps);
    await vi.runAllTimersAsync();
    await p;

    expect(getSession).toHaveBeenCalledTimes(1); // aborted before the first retry
    expect(deps.degrade).not.toHaveBeenCalled();
  });
});
