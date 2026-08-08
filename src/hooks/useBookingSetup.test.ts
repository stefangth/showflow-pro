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

  it("does not mark flow chosen when the org's own booking_flow row is inactive", async () => {
    // Owning the row is not enough on its own: the flow must also be active.
    seed({
      app_settings: {
        data: [{ key: "booking_flow", org_id: "org-1", value: { active: false } }],
        error: null,
      },
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
    });
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.steps.find((s) => s.key === "flow")!.done).toBe(false);
  });

  it("filters an archived show out of the active set, leaving slots outstanding (no vacuous-done)", async () => {
    // An archived show is excluded by activeShows, so this org has zero ACTIVE shows.
    // With no vacuous-done, zero active shows is itself outstanding, not done, distinct
    // from the archived show's own unset slots never blocking the step.
    seed({
      app_settings: { data: [{ key: "booking_flow" }], error: null },
      shows: {
        data: [
          { id: "s1", program: "Archived show", sub_program: null, main_cast_slots: null, understudy_slots: null, status: "archived" },
        ],
        error: null,
      },
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
    });
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.steps.find((s) => s.key === "slots")!.done).toBe(false);
  });

  it("keeps the slots step outstanding for an active show with unset slots", async () => {
    seed({
      app_settings: { data: [{ key: "booking_flow" }], error: null },
      shows: {
        data: [
          { id: "s1", program: "Active show", sub_program: null, main_cast_slots: null, understudy_slots: null, status: "active" },
        ],
        error: null,
      },
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
    });
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.steps.find((s) => s.key === "slots")!.done).toBe(false);
  });
});
