import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seed(s: Record<string, unknown>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s as never));
}

import {
  useCastProductionFees,
  useUpsertCastProductionFee,
  useDeleteCastProductionFee,
} from "./useCastProductionFees";

const ORG_ID = "org-1";

beforeEach(() => {
  seed({
    cast_production_fees: {
      data: [
        { id: "f1", cast_id: "cast-1", show_id: "show-1", fee_amount: 500, currency: "EUR", fee_basis: "per_date" },
      ],
      error: null,
    },
  });
});

describe("useCastProductionFees", () => {
  it("fetches the org's cast-production fees", async () => {
    const { result } = renderHookWithProviders(() => useCastProductionFees(ORG_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([
      { id: "f1", cast_id: "cast-1", show_id: "show-1", fee_amount: 500, currency: "EUR", fee_basis: "per_date" },
    ]);
  });

  it("is disabled for a null orgId (no query fired)", async () => {
    const { result } = renderHookWithProviders(() => useCastProductionFees(null));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    const calls = (client.calls ?? []) as { table: string }[];
    expect(calls.some((c) => c.table === "cast_production_fees")).toBe(false);
  });

  it("useUpsertCastProductionFee invalidates the cast-production-fees query key", async () => {
    const { result, queryClient } = renderHookWithProviders(() => useUpsertCastProductionFee());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    result.current.mutate({
      orgId: ORG_ID, castId: "cast-1", showId: "show-1", feeAmount: 500, currency: "EUR", feeBasis: "per_date",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["cast-production-fees", ORG_ID] });
    expect(invalidateSpy).not.toHaveBeenCalledWith(expect.objectContaining({
      queryKey: expect.arrayContaining(["app-settings"]),
    }));
  });

  it("useDeleteCastProductionFee invalidates the cast-production-fees query key", async () => {
    const { result, queryClient } = renderHookWithProviders(() => useDeleteCastProductionFee());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    result.current.mutate({ id: "f1", orgId: ORG_ID });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["cast-production-fees", ORG_ID] });
  });
});
