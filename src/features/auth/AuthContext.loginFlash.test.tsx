import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { createTestQueryClient } from "@/test/queryClient";

// ── Controllable Supabase auth mock ────────────────────────────────────────
// AuthContext drives supabase.auth directly (onAuthStateChange / getSession),
// which supabaseFake does not model — so we stub the client here. The realtime
// channel calls are no-op'd. `fireAuth` lets the test deliver a SIGNED_IN event
// with the exact timing the real login flow has: user set synchronously, the
// identity load deferred to a later tick.

type AuthCb = (event: string, session: Session | null) => void;
let authCb: AuthCb | null = null;
const initialSession: { current: Session | null } = { current: null };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthCb) => {
        authCb = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      getSession: () => Promise.resolve({ data: { session: initialSession.current } }),
      signOut: () => Promise.resolve({ error: null }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
}));

// Identity fetches resolve immediately with a real org membership, so a resolved
// identity has a currentOrg (the flash is the window BEFORE this lands).
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

interface Snap { loading: boolean; hasUser: boolean; hasOrg: boolean; isSuperAdmin: boolean; }
const snaps: Snap[] = [];

function Recorder() {
  const { loading, user, currentOrg, isSuperAdmin } = useAuth();
  snaps.push({ loading, hasUser: !!user, hasOrg: !!currentOrg, isSuperAdmin });
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

/** The flash the guards would render: settled (not loading) + signed in + no org. */
const isFlash = (s: Snap) => !s.loading && s.hasUser && !s.hasOrg && !s.isSuperAdmin;

describe("AuthContext — no no-org flash on the login transition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    snaps.length = 0;
    authCb = null;
    initialSession.current = null;
    localStorage.clear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("never renders loading:false with a signed-in user before identity loads", async () => {
    // 1. Mount signed out; let getSession() settle (bootstrap).
    await act(async () => {
      renderProvider();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Baseline: bootstrapped + signed out ⇒ ready (loading false), no user.
    const afterBootstrap = snaps.at(-1)!;
    expect(afterBootstrap.loading).toBe(false);
    expect(afterBootstrap.hasUser).toBe(false);

    // 2. Sign in: this is the real flow's timing — the auth callback sets `user`
    //    synchronously and defers the identity load to setTimeout(0). We commit
    //    the render for that in-between state WITHOUT yet running the timer,
    //    which is exactly the post-`navigate` render where the flash appeared.
    const session = { user: { id: "user-1" } } as unknown as Session;
    act(() => {
      authCb!("SIGNED_IN", session);
    });

    // The critical render: user is set, identity not loaded yet. Derived
    // readiness must report loading:true here — not a settled no-org screen.
    const midTransition = snaps.at(-1)!;
    expect(midTransition.hasUser).toBe(true);
    expect(midTransition.hasOrg).toBe(false);
    expect(midTransition.loading).toBe(true);

    // 3. Let the deferred identity load run to completion.
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const settled = snaps.at(-1)!;
    expect(settled.loading).toBe(false);
    expect(settled.hasUser).toBe(true);
    expect(settled.hasOrg).toBe(true);

    // The invariant across every render: the guards were never handed a settled,
    // signed-in, org-less snapshot — so NoOrgScreen / the wrong role gate can't flash.
    expect(snaps.filter(isFlash)).toEqual([]);
  });
});
