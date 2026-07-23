import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// vi.mock is hoisted above imports, so the factory can only read a vi.hoisted holder
// (not an outer const). Populate that holder with the fake after imports run.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  org_invitations: { data: [{ id: "inv1", artist_id: "a1", email: "a1@x.com" }], error: null },
}));

import { usePendingArtistInvitations } from "./usePendingArtistInvitations";

describe("usePendingArtistInvitations", () => {
  beforeEach(() => { (client.calls as unknown[]).length = 0; });

  it("returns the pending artist invitations for an org", async () => {
    const { result } = renderHookWithProviders(() => usePendingArtistInvitations("o1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "inv1", artistId: "a1", email: "a1@x.com" }]);
    expect(client.calls).toContainEqual({ table: "org_invitations", method: "eq", args: ["org_id", "o1"] });
    expect(client.calls).toContainEqual({ table: "org_invitations", method: "eq", args: ["status", "pending"] });
    expect(client.calls).toContainEqual({ table: "org_invitations", method: "eq", args: ["role", "artist"] });
  });

  it("stays disabled without an orgId", () => {
    const { result } = renderHookWithProviders(() => usePendingArtistInvitations(null));
    expect(result.current.fetchStatus).toBe("idle");
  });
});
