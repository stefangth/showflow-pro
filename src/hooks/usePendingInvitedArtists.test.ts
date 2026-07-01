import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// vi.mock is hoisted above imports, so the factory can only read a vi.hoisted holder
// (not an outer const). Populate that holder with the fake after imports run.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({ "rpc:list_pending_invited_artists": { data: ["a1", "a2"], error: null } }));

import { usePendingInvitedArtists } from "./usePendingInvitedArtists";

describe("usePendingInvitedArtists", () => {
  beforeEach(() => { (client.calls as unknown[]).length = 0; });

  it("returns the pending ids for an org", async () => {
    const { result } = renderHookWithProviders(() => usePendingInvitedArtists("o1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(["a1", "a2"]);
    expect(client.calls).toContainEqual({ table: "rpc:list_pending_invited_artists", method: "rpc", args: [{ p_org: "o1" }] });
  });

  it("stays disabled without an orgId", () => {
    const { result } = renderHookWithProviders(() => usePendingInvitedArtists(null));
    expect(result.current.fetchStatus).toBe("idle");
  });
});
