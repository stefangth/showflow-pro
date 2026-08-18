import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import {
  createFakeSupabase,
  type TableSeed,
  type RecordedCall,
} from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}
const calls = () => client.calls as RecordedCall[];

import { useBookingSetupStatus } from "./useBookingSetup";

beforeEach(() => {
  seed({
    app_settings: { data: [{ key: "booking_flow" }], error: null },
    shows: { data: [], error: null },
    show_dates: { data: [], error: null },
    show_cast_eligibility: { data: [], error: null },
    cast_city_priority: { data: [], error: null },
    artists: { data: null, error: null, count: 0 },
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
      artists: { data: null, error: null, count: 0 },
    });
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.steps.find((s) => s.key === "flow")!.done).toBe(false);
  });

  it("counts an archived-only org as configured, so slots is not dragged outstanding", async () => {
    // An archived show is excluded by activeShows (zero ACTIVE shows), but it still makes
    // hasAnyShows true — the org is not blank. With no active shows left to slot, the slots
    // step falls back to done rather than nagging an org that is simply between seasons.
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
      artists: { data: null, error: null, count: 0 },
    });
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.steps.find((s) => s.key === "slots")!.done).toBe(true);
  });

  it("marks the people step done once the org has at least one artist", async () => {
    seed({
      app_settings: { data: [{ key: "booking_flow" }], error: null },
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
      artists: { data: null, error: null, count: 4 },
    });
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.steps.find((s) => s.key === "people")!.done).toBe(true);
  });

  it("hands the roster size back so the rail can show it without a second read", async () => {
    seed({
      app_settings: { data: [{ key: "booking_flow" }], error: null },
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
      artists: { data: null, error: null, count: 9 },
    });
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.artistCount).toBe(9));
  });

  it("does not pay for the parked-roster read on every page that asks for readiness", async () => {
    // This hook runs on every admin and producer surface that shows setup state
    // (DashboardPage, ShowsBookingsPage, useModuleOnboardingRail, useDashboardFirstRun), so
    // it must never pay for a parked-roster head count nobody on this read is asking for.
    // `neq` is the parked query's signature: the readiness count eq's status = 'active',
    // a parked count would neq it.
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(calls().filter((c) => c.table === "artists" && c.method === "neq")).toHaveLength(0);
  });

  it("words the roster blocker as offers for an org whose flow opens tiers", async () => {
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // The seeded booking_flow row carries no artist_acceptance override, so the org runs
    // the shipped default: offers with acceptance.
    expect(result.current.status.steps.find((s) => s.key === "people")!.block).toBe("offers");
  });

  it("never tells a direct-book org an offer is blocked", async () => {
    // artist_acceptance false: this org books straight from the eligibility list and never
    // opens a tier, so the roster gap costs it the booking, not an offer.
    seed({
      app_settings: {
        data: [{ key: "booking_flow", org_id: "org-1", value: { artist_acceptance: false } }],
        error: null,
      },
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
      artists: { data: null, error: null, count: 0 },
    });
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.steps.find((s) => s.key === "people")!.block).toBe("booking");
    expect(result.current.status.steps.every((s) => s.block !== "offers")).toBe(true);
    // Wording only: the gate this org has to clear is unchanged.
    expect(result.current.status.canOffer).toBe(false);
  });

  it("keeps the people step outstanding on an empty roster", async () => {
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.steps.find((s) => s.key === "people")!.done).toBe(false);
    expect(result.current.status.canOffer).toBe(false);
  });

  it("reports the people step outstanding when the artist count cannot be read", async () => {
    // A failed read must never read as a filled roster: the step blocks offers, so a
    // false "done" would promise a tier could open when it cannot.
    seed({
      app_settings: { data: [{ key: "booking_flow" }], error: null },
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
      artists: { data: null, error: { message: "denied" } },
    });
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.steps.find((s) => s.key === "people")!.done).toBe(false);
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
      artists: { data: null, error: null, count: 0 },
    });
    const { result } = renderHookWithProviders(() => useBookingSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.steps.find((s) => s.key === "slots")!.done).toBe(false);
  });
});
