import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
const { canRef } = vi.hoisted(() => ({ canRef: { value: true } }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canRef.value }));
// Rehearsal makes an edge call; stub it out for the shell test.
vi.mock("./RehearsalBlock", () => ({ RehearsalBlock: () => null }));
// FlowStep (the default-open step) reads useBookingFlow, which calls useAuth() for
// currentOrg. Real AuthContext requires an AuthProvider this shell test doesn't wrap.
// Same stub FlowStep.test.tsx and RehearsalBlock.test.tsx use for the same reason.
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: undefined }),
  useFlowTimes: () => ({ data: undefined }),
}));

import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

import { BookingSetupRail } from "./BookingSetupRail";

beforeEach(() => {
  localStorage.clear();
  canRef.value = true;
  seed({
    app_settings: { data: [], error: null },
    shows: { data: [], error: null },
    show_dates: { data: [], error: null },
    show_cast_eligibility: { data: [], error: null },
    cast_city_priority: { data: [], error: null },
  });
});

describe("BookingSetupRail", () => {
  it("renders the five steps with a blocking chip on ladder and slots", async () => {
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText("Booking flow")).toBeInTheDocument();
    expect(screen.getByText("Slots per show")).toBeInTheDocument();
    expect(screen.getByText("Cast priorities per city")).toBeInTheDocument();
    expect(screen.getByText("Who is eligible")).toBeInTheDocument();
    expect(screen.getByText("Response window and digests")).toBeInTheDocument();
    expect(screen.getByText("Blocks offers")).toBeInTheDocument();
    expect(screen.getByText("Blocks filling")).toBeInTheDocument();
  });

  it("shows the waiting card to a viewer who cannot edit booking settings", async () => {
    canRef.value = false;
    // Force an offers-blocking gap so a non-editor is shown the card at all.
    seed({
      app_settings: { data: [], error: null },
      shows: { data: [], error: null },
      show_dates: { data: [{ show_id: "s1", city_id: "c1" }], error: null },
      show_cast_eligibility: { data: [], error: null },
      cast_city_priority: { data: [], error: null },
    });
    renderWithProviders(<MemoryRouter><BookingSetupRail orgId="org-1" /></MemoryRouter>);
    expect(await screen.findByText(/Waiting on your admin/i)).toBeInTheDocument();
    expect(screen.queryByText("Blocks filling")).not.toBeInTheDocument();
  });
});
