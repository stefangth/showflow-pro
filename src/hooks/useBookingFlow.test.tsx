import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/data/settings", () => ({
  fetchBookingFlow: vi.fn(() => Promise.resolve({ ...BOOKING_FLOW_DEFAULTS })),
  fetchFlowTimes: vi.fn(),
}));
vi.mock("@/data/customFields", () => ({ fetchCustomFieldDefs: vi.fn() }));
// currentOrg null: the no-active-org shell state (e.g. a super-admin bypassing the
// org gate), the same state an explicit `null` override models.
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: null }),
}));

import { useBookingFlow } from "./useBookingFlow";
import { fetchBookingFlow } from "@/data/settings";

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe("useBookingFlow", () => {
  it("fetches the flow for an explicit org", async () => {
    const { result } = renderHook(() => useBookingFlow("org-1"), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(fetchBookingFlow).toHaveBeenCalledWith(expect.anything(), "org-1");
  });

  // A null org has no flow to fetch: fetchBookingFlow(client, null) reads the PLATFORM
  // default settings row and returns a flow belonging to no org. Callers that pass null
  // (AcceptInvitePage before its invites resolve, the setup panels for a super-admin
  // outside any org) all discard that result, so the read was pure waste — one stray
  // app_settings query on first mount and on the bounce-to-login path.
  it("does not fetch for an explicit null org", async () => {
    const { result } = renderHook(() => useBookingFlow(null), { wrapper: makeWrapper() });
    // A disabled query also must not report isLoading forever — callers fold this into
    // "ready" gates (AcceptInvitePage's nextStepReady), which would otherwise never open.
    expect(result.current.isLoading).toBe(false);
    await Promise.resolve();
    expect(fetchBookingFlow).not.toHaveBeenCalled();
  });

  it("does not fetch when no override is given and the shell has no active org", async () => {
    const { result } = renderHook(() => useBookingFlow(), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(false);
    await Promise.resolve();
    expect(fetchBookingFlow).not.toHaveBeenCalled();
  });
});
