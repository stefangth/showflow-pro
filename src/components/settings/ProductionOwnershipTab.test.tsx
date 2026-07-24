import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  show_assignments: {
    data: [{ id: "sa-1", producer_user_id: "u1", program: "Hamlet", sub_program: null, city_id: null }],
    error: null,
  },
  shows: { data: [{ program: "Hamlet", sub_program: "Elsinore" }], error: null },
  org_memberships: { data: [{ user_id: "u1", role: "producer" }], error: null },
  profiles: { data: [{ user_id: "u1", display_name: "Producer One" }], error: null },
}));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));

import { useCan } from "@/hooks/useCapabilities";
import { ProductionOwnershipTab } from "./ProductionOwnershipTab";

describe("ProductionOwnershipTab", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(useCan).mockReturnValue(true); });

  it("manage_ownership on: Add and Remove controls are enabled", async () => {
    renderWithProviders(<ProductionOwnershipTab currentOrgId="org-1" canEnter />);
    expect(await screen.findByText(/Hamlet/)).toBeInTheDocument();
    expect(screen.getByLabelText("Remove assignment")).not.toBeDisabled();

    // Selects render without an accessible name; the form order is Producer, Program,
    // Sub-program, City (see ProductionOwnershipTab.tsx).
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    fireEvent.click(await screen.findByRole("option", { name: "Producer One" }));
    fireEvent.click(screen.getAllByRole("combobox")[1]);
    fireEvent.click(await screen.findByRole("option", { name: "Hamlet" }));

    expect(screen.getByRole("button", { name: /add/i })).not.toBeDisabled();
  });

  it("manage_ownership off: Add and Remove controls are disabled, assignments still read", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderWithProviders(<ProductionOwnershipTab currentOrgId="org-1" canEnter />);
    expect(await screen.findByText(/Hamlet/)).toBeInTheDocument();
    expect(screen.getByLabelText("Remove assignment")).toBeDisabled();

    // Selects render without an accessible name; the form order is Producer, Program,
    // Sub-program, City (see ProductionOwnershipTab.tsx).
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    fireEvent.click(await screen.findByRole("option", { name: "Producer One" }));
    fireEvent.click(screen.getAllByRole("combobox")[1]);
    fireEvent.click(await screen.findByRole("option", { name: "Hamlet" }));

    expect(screen.getByRole("button", { name: /add/i })).toBeDisabled();
  });
});
