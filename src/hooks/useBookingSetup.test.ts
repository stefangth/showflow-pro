import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

import { useBookingSetupStatus } from "./useBookingSetup";

beforeEach(() => {
  seed({
    app_settings: { data: [{ key: "booking_flow" }], error: null },
    shows: { data: [], error: null },
    show_dates: { data: [], error: null },
    show_cast_eligibility: { data: [], error: null },
    cast_city_priority: { data: [], error: null },
  });
});

describe("useBookingSetupStatus", () => {
  it("marks flow chosen when the org owns a booking_flow row", async () => {
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.steps.find((s) => s.key === "flow")!.done).toBe(true);
  });

  it("returns a not-loading, all-outstanding status for a null org", async () => {
    const { result } = renderHookWithProviders(() => useBookingSetupStatus(null));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.status.doneCount).toBe(0);
  });
});
