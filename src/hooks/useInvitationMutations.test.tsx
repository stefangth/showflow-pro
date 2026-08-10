import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";
import { createFakeSupabase } from "@/test/supabaseFake";

// Approved fake in a hoisted holder (vi.mock is hoisted above imports) — never a
// hand-rolled vi.mock chain. Every mutation resolves via the fake's functions.invoke /
// rpc defaults ({ data: null, error: null }), so we can assert the onSuccess wiring.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

Object.assign(client, createFakeSupabase({}));

import { useInvitationMutations } from "./useInvitationMutations";

describe("useInvitationMutations — cache invalidation", () => {
  beforeEach(() => {
    (client.calls as unknown[]).length = 0;
  });

  // Regression: resend stamps last_resent_at/resent_count server-side, and the People
  // row reads those from ['org-invitations']. If resend's onSuccess doesn't invalidate
  // (like create/revoke do), the "Resent …" meta stays stale in-session — the exact
  // coordination gap this feature closes.
  it("resend invalidates ['org-invitations'] on success so the resend meta refreshes", async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHookWithProviders(() => useInvitationMutations("org-1"), { queryClient });

    await result.current.resend.mutateAsync("inv1");

    await waitFor(() => expect(result.current.resend.isSuccess).toBe(true));
    expect(client.calls).toContainEqual({ table: "fn:resend-invitation", method: "invoke", args: [{ invitation_id: "inv1", app_origin: expect.any(String) }] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["org-invitations"] });
  });

  it("revoke also invalidates ['org-invitations'] (shared behavior control)", async () => {
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHookWithProviders(() => useInvitationMutations("org-1"), { queryClient });

    await result.current.revoke.mutateAsync("inv1");

    await waitFor(() => expect(result.current.revoke.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["org-invitations"] });
  });
});
