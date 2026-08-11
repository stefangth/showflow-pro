import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// vi.mock is hoisted above imports, so the factory can only read a vi.hoisted holder
// (not an outer const). Populate that holder with the fake after imports run.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  show_slots: {
    data: [{ id: "s1", name: "Leads", slot_count: 3, kind: "main", sort_order: 0 }],
    error: null,
  },
  show_slot_required_skills: { data: [{ slot_id: "s1", skill_id: "vocals" }], error: null },
}));

import { useShowSlots } from "./useShowSlots";

describe("useShowSlots", () => {
  beforeEach(() => { (client.calls as unknown[]).length = 0; });

  it("returns the show's slot drafts", async () => {
    const { result } = renderHookWithProviders(() => useShowSlots("sh1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: "s1", name: "Leads", count: 3, kind: "main", skillIds: ["vocals"] },
    ]);
    expect(client.calls).toContainEqual({ table: "show_slots", method: "eq", args: ["show_id", "sh1"] });
  });

  it("stays disabled without a showId", () => {
    const { result } = renderHookWithProviders(() => useShowSlots(undefined));
    expect(result.current.fetchStatus).toBe("idle");
  });
});
