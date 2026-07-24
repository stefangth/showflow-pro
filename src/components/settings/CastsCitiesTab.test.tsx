import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// CastsCitiesTab imports the supabase singleton directly and useAllCities pulls
// currentOrg from AuthContext, so both need mocking (mirrors
// CastsCitiesTab.priorities.test.tsx). This file covers the manage_cities
// capability gate specifically; the scoped-priority editor behavior is covered there.
const { client, authState } = vi.hoisted(() => ({
  client: {} as Record<string, unknown>,
  authState: { isAdmin: false },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  cities: { data: [{ id: "city-1", name: "Berlin" }], error: null },
  casts: { data: [{ id: "cast-1", name: "Cast A" }], error: null },
  cast_members: { data: [], error: null },
  cast_city_priority: { data: [{ id: "ccp-1", city_id: "city-1", cast_id: "cast-1", priority: 1 }], error: null },
  shows: { data: [], error: null },
}));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" }, hasRole: (r: string) => r === "admin" && authState.isAdmin }),
}));
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));

import { useCan } from "@/hooks/useCapabilities";
import { CastsCitiesTab } from "./CastsCitiesTab";

function renderTab() {
  return renderWithProviders(
    <MemoryRouter>
      <CastsCitiesTab currentOrgId="org-1" canEnter={true} />
    </MemoryRouter>,
  );
}

describe("CastsCitiesTab - manage_cities capability gate", () => {
  beforeEach(() => { vi.clearAllMocks(); authState.isAdmin = false; vi.mocked(useCan).mockReturnValue(true); });

  it("manage_cities on (producer): add-city enabled; remove-city stays admin-only", async () => {
    renderTab();
    // Deleting a city is admin-only server-side, so the control is disabled for a producer.
    expect(await screen.findByLabelText("Remove Berlin")).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("New city name"), { target: { value: "Hamburg" } });
    expect(screen.getByRole("button", { name: /add/i })).not.toBeDisabled();
  });

  it("admin: remove-city control is enabled", async () => {
    authState.isAdmin = true;
    renderTab();
    expect(await screen.findByLabelText("Remove Berlin")).not.toBeDisabled();
  });

  it("manage_cities off: add-city disabled, cities still read", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderTab();
    // The city row still renders (read-only floor) even with the capability off.
    expect(await screen.findByLabelText("Remove Berlin")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("New city name"), { target: { value: "Hamburg" } });
    expect(screen.getByRole("button", { name: /add/i })).toBeDisabled();
  });

  it("manage_cities off: the org-wide priority remove control is disabled, assignment still reads", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderTab();
    const removeButton = await screen.findByLabelText("Remove assignment");
    expect(removeButton).toBeDisabled();
    const row = removeButton.closest("div")!;
    expect(within(row).getByText("Cast A")).toBeInTheDocument();
  });
});
