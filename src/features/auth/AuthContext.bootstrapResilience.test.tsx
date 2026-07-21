import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { createTestQueryClient } from "@/test/queryClient";

// jsdom here runs with an opaque document URL, so it exposes no localStorage;
// AuthContext reads/writes it (currentOrg persistence). Minimal in-memory stub.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    },
  });
}

// Controllable Supabase auth mock. The bug is in the initial-session bootstrap
// (`getSession`), so `getSession` is a per-test vi.fn — we never fire an
// onAuthStateChange event, isolating recovery to the bootstrap path alone.
const SESSION = { user: { id: "user-1" } } as unknown as Session;
const getSessionMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () => getSessionMock(),
      signOut: () => Promise.resolve({ error: null }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
}));

vi.mock("@/data/orgs", () => ({
  fetchMyMemberships: vi.fn(async () => [
    { org_id: "org-1", role: "artist", organizations: { id: "org-1", name: "Acme", slug: "acme", status: "active" } },
  ]),
}));
vi.mock("@/data/platform", () => ({
  fetchIsSuperAdmin: vi.fn(async () => false),
  fetchAllOrgs: vi.fn(async () => []),
}));

import { AuthProvider, useAuth } from "./AuthContext";

interface Snap { loading: boolean; hasUser: boolean; hasOrg: boolean; }
const snaps: Snap[] = [];

function Recorder() {
  const { loading, user, currentOrg } = useAuth();
  snaps.push({ loading, hasUser: !!user, hasOrg: !!currentOrg });
  return null;
}

function renderProvider() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthProvider>
        <Recorder />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("AuthContext — bootstrap survives a stalled auth lock (endless-spinner regression)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    snaps.length = 0;
    getSessionMock.mockReset();
    localStorage.clear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("recovers when the first getSession fails (multi-tab lock timeout), then succeeds", async () => {
    // Reproduces the reported bug: a logged-in tab whose first session read is
    // blocked by the cross-tab auth Web Lock. The old bootstrap awaited it once
    // with no catch, so `loading` stayed true forever. It must now retry and
    // land the user in the app.
    getSessionMock
      .mockRejectedValueOnce(new Error("NavigatorLockAcquireTimeoutError"))
      .mockResolvedValue({ data: { session: SESSION } });

    await act(async () => {
      renderProvider();
    });
    // Advance past the retry backoff (default first backoff is 800ms) so the
    // second getSession lands the user in the app.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    const settled = snaps.at(-1)!;
    expect(settled.loading).toBe(false);
    expect(settled.hasUser).toBe(true);
    expect(settled.hasOrg).toBe(true);
    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });

  it("degrades to signed-out (never an endless spinner) when getSession never recovers", async () => {
    getSessionMock.mockRejectedValue(new Error("locked"));

    await act(async () => {
      renderProvider();
    });
    // Advance past every retry backoff (800 + 1600 + 2400ms) to exhaustion.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    const settled = snaps.at(-1)!;
    // The load-bearing guarantee: the guards leave the spinner. Signed-out here
    // (login screen), not a permanent loading:true.
    expect(settled.loading).toBe(false);
    expect(settled.hasUser).toBe(false);
  });
});
