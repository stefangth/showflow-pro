import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";
import { createFakeSupabase } from "@/test/supabaseFake";

// vi.mock is hoisted above imports, so the factory can only read a vi.hoisted holder
// (not an outer const). Populate that holder with the approved fake after imports run —
// NOT a hand-rolled vi.mock chain. Both hooks then hit the same seeded backend.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

Object.assign(
  client,
  createFakeSupabase({
    cities: [
      {
        when: { org_id: "org-1" },
        data: [{ id: "c1", name: "Berlin", org_id: "org-1", airtable_city_key: "BER" }],
        error: null,
      },
      {
        when: { org_id: "org-2" },
        data: [{ id: "c2", name: "Munich", org_id: "org-2", airtable_city_key: "MUC" }],
        error: null,
      },
    ],
  }),
);

import { useCities } from "./useCities";
import { useAllCities } from "./useAllCities";
import { useAuth } from "@/features/auth/AuthContext";

describe("city hooks — distinct keys per projection (H2 regression)", () => {
  beforeEach(() => {
    (client.calls as unknown[]).length = 0;
    vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-1" } } as never);
  });

  it("useCities (link) and useAllCities (full row) both fetch — distinct keys, no clobber", async () => {
    // ONE shared client — the whole point is that both hooks coexist in the same cache.
    const queryClient = createTestQueryClient();
    const link = renderHookWithProviders(() => useCities(), { queryClient });
    const all = renderHookWithProviders(() => useAllCities(), { queryClient });

    await waitFor(() => {
      expect(link.result.current.data).toBeDefined();
      expect(all.result.current.data).toBeDefined();
    });

    // Both hooks resolved org-1 data (the fake returns the seeded row regardless of
    // projection args, so equal data here is expected).
    expect(link.result.current.data).toEqual([
      { id: "c1", name: "Berlin", org_id: "org-1", airtable_city_key: "BER" },
    ]);
    expect(all.result.current.data).toEqual([
      { id: "c1", name: "Berlin", org_id: "org-1", airtable_city_key: "BER" },
    ]);

    // The load-bearing assertion: TWO separate fetches ran (distinct cache slots).
    // If both hooks shared a key, React Query would dedupe to a single queryFn run and
    // only ONE projection would ever execute. Distinct select() shapes prove otherwise.
    const selectArgs = (client.calls as { table: string; method: string; args: unknown[] }[])
      .filter((c) => c.table === "cities" && c.method === "select")
      .map((c) => c.args);
    expect(selectArgs).toContainEqual(["id, name, airtable_city_key"]); // link projection
    expect(selectArgs).toContainEqual(["*"]); // full-row projection
  });

  it("useAllCities scopes to the current org (org-2)", async () => {
    vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-2" } } as never);
    const { result } = renderHookWithProviders(() => useAllCities());
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([
      { id: "c2", name: "Munich", org_id: "org-2", airtable_city_key: "MUC" },
    ]);
    expect(client.calls).toContainEqual({ table: "cities", method: "eq", args: ["org_id", "org-2"] });
  });

  it("useAllCities respects the enabled flag", () => {
    const { result } = renderHookWithProviders(() => useAllCities(false));
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useAllCities stays disabled without a current org", () => {
    vi.mocked(useAuth).mockReturnValue({ currentOrg: null } as never);
    const { result } = renderHookWithProviders(() => useAllCities());
    expect(result.current.fetchStatus).toBe("idle");
  });
});
