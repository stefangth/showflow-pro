import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor, act } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

import { useSheetImport } from "./useSheetImport";

const ORG_ID = "org-1";

describe("useSheetImport", () => {
  beforeEach(() => {
    seed({ app_settings: { data: [], error: null } });
  });

  it("loads the default settings when the org has none saved", async () => {
    const { result } = renderHookWithProviders(() => useSheetImport(ORG_ID));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings).toEqual({ url: "", map: {} });
    expect(result.current.result).toBeNull();
  });

  it("loads the org's saved settings when present", async () => {
    const saved = { url: "https://example.com/sheet.csv", map: { program: "Program", date: "Date" } };
    seed({ app_settings: { data: [{ org_id: ORG_ID, value: saved }], error: null } });

    const { result } = renderHookWithProviders(() => useSheetImport(ORG_ID));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings).toEqual(saved);
  });

  it("runImport surfaces the edge-function result and invalidates related domains", async () => {
    const importResult = { processed: 2, new_dates: 1, updated: 1, held: 0, tiers_opened: 1 };
    seed({
      app_settings: { data: [], error: null },
      "fn:import-sheet-dates": { data: importResult, error: null },
    });

    const { result, queryClient } = renderHookWithProviders(() => useSheetImport(ORG_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      result.current.runImport([
        { program: "ShowA", subProgram: "", date: "2026-01-01", city: "Berlin", session_1: "19:00", session_2: null, session_3: null, venue: null, rowIndex: 1 },
      ]);
    });

    await waitFor(() => expect(result.current.importing).toBe(false));
    expect(result.current.result).toEqual(importResult);

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(invalidatedKeys).toContainEqual(["sheet-import", ORG_ID]);
    expect(invalidatedKeys).toContainEqual(["show-dates"]);
    expect(invalidatedKeys).toContainEqual(["bookings"]);
  });

  it("saveSettings persists and invalidates the settings key", async () => {
    seed({ app_settings: { data: [], error: null } });

    const { result } = renderHookWithProviders(() => useSheetImport(ORG_ID));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.saveSettings({ url: "https://example.com/x.csv", map: { program: "Program", date: "Date" } });
    });

    await waitFor(() => expect(result.current.saving).toBe(false));
    expect((client as unknown as { calls: { table: string; method: string }[] }).calls).toContainEqual(
      expect.objectContaining({ table: "app_settings", method: "upsert" }),
    );
  });
});
