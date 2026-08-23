import { describe, it, expect, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

import { useHireOrderExtraSetup } from "./useHireOrderExtraSetup";

describe("useHireOrderExtraSetup", () => {
  it("reports feeDone/documentDone from the org's own app_settings rows", async () => {
    seed({
      app_settings: {
        data: [{ key: "hire_order_defaults" }],
        error: null,
      },
    });

    const { result } = renderHookWithProviders(() => useHireOrderExtraSetup("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.feeDone).toBe(true);
    expect(result.current.status.documentDone).toBe(false);
  });

  it("is not loading and reports both false for a null org (no fetch)", async () => {
    seed({});
    const { result } = renderHookWithProviders(() => useHireOrderExtraSetup(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status).toEqual({ feeDone: false, documentDone: false });
  });
});
