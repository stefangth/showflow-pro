import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { useBookingFlowProvenance } from "./useBookingFlowProvenance";

// This hook composes two OTHER hooks that each import the `supabase` singleton directly
// (useSettingsAudit, useOrgAdminNames), rather than taking a client as a parameter — so
// there is no clean seam to hand them a `createFakeSupabase()` fake without hand-rolling
// a `vi.mock('@/integrations/supabase/client')` chain, which this project avoids. Instead
// we seed the exact query keys those hooks resolve to directly into the QueryClient, with
// `staleTime: Infinity` so a fresh mount never triggers a background refetch (which would
// otherwise hit the real client against a Supabase instance that may not be running).
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));

const AUDIT_KEY = ["app-settings", "audit", "org-1", "booking_flow"];
const ADMIN_NAMES_KEY = ["org-admins", "names", "org-1"];

function makeQueryClient() {
  // Deliberately NOT `createTestQueryClient()` (staleTime: 0): that would mark seeded
  // data stale immediately and react-query would refetch it on mount, invoking the real
  // queryFn against the (unmocked) supabase singleton.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
}

describe("useBookingFlowProvenance", () => {
  it("admin: surfaces the newest booking_flow audit row", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(AUDIT_KEY, [
      {
        id: "audit-2",
        key: "booking_flow",
        actor: "u2",
        actorName: "Nadia Okonkwo",
        old_value: null,
        new_value: {},
        created_at: "2026-07-20T09:00:00Z",
      },
      {
        id: "audit-1",
        key: "booking_flow",
        actor: "u1",
        actorName: "Tom Reeve",
        old_value: null,
        new_value: {},
        created_at: "2026-07-14T10:00:00Z",
      },
    ]);

    const { result } = renderHookWithProviders(() => useBookingFlowProvenance("admin"), {
      queryClient,
    });

    expect(result.current).toEqual({
      byYou: true,
      actorName: "Nadia Okonkwo",
      changedAt: "2026-07-20T09:00:00Z",
    });
  });

  it("admin: reports no provenance when nothing has ever been audited, without erroring", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(AUDIT_KEY, []);

    const { result } = renderHookWithProviders(() => useBookingFlowProvenance("admin"), {
      queryClient,
    });

    expect(result.current).toEqual({ byYou: true, actorName: null, changedAt: null });
  });

  it("producer: names the org's first admin, with no timestamp (the audit table is admin-only RLS)", () => {
    const queryClient = makeQueryClient();
    // A producer's read of the audit log resolves empty under RLS, not an error — seed it
    // that way so the (unconditionally-called) useSettingsAudit hook has no reason to
    // refetch, and assert it plays no part in the producer's result below.
    queryClient.setQueryData(AUDIT_KEY, []);
    queryClient.setQueryData(ADMIN_NAMES_KEY, ["Nadia Okonkwo", "Tom Reeve"]);

    const { result } = renderHookWithProviders(() => useBookingFlowProvenance("producer"), {
      queryClient,
    });

    expect(result.current).toEqual({ byYou: false, actorName: "Nadia Okonkwo", changedAt: null });
  });

  it("artist: same shape as producer, first admin name with no timestamp", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(AUDIT_KEY, []);
    queryClient.setQueryData(ADMIN_NAMES_KEY, ["Nadia Okonkwo"]);

    const { result } = renderHookWithProviders(() => useBookingFlowProvenance("artist"), {
      queryClient,
    });

    expect(result.current).toEqual({ byYou: false, actorName: "Nadia Okonkwo", changedAt: null });
  });

  it("producer: null actorName when the org has no named admins yet, rather than throwing", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(AUDIT_KEY, []);
    queryClient.setQueryData(ADMIN_NAMES_KEY, []);

    const { result } = renderHookWithProviders(() => useBookingFlowProvenance("producer"), {
      queryClient,
    });

    expect(result.current).toEqual({ byYou: false, actorName: null, changedAt: null });
  });
});
