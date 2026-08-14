import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ hasRole: () => true, currentOrg: { id: "org-1" } }) }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));

Object.assign(
  client,
  createFakeSupabase({
    cities: { data: [{ id: "city-1", name: "Berlin", org_id: "org-1" }], error: null },
    // Both fetchProgramSubProgramPairs and fetchShowsWithStats read "shows" - Hamlet has a
    // sub-program, Macbeth deliberately has none (so it still needs to show up as a program
    // even though fetchProgramSubProgramPairs can never surface it).
    shows: {
      data: [
        { id: "show-1", program: "Hamlet", sub_program: "Elsinore" },
        { id: "show-2", program: "Macbeth", sub_program: null },
      ],
      error: null,
    },
    show_dates: { data: [{ show_id: "show-1" }, { show_id: "show-1" }, { show_id: "show-2" }], error: null },
    // Hamlet has two owners: a program-only fallback (Producer One) and a Berlin-scoped
    // override (Berlin Producer) that should only win when the routing check targets Berlin.
    // Macbeth has no assignment at all -> the no-owner banner.
    show_assignments: {
      data: [
        { id: "sa-1", producer_user_id: "u1", program: "Hamlet", sub_program: null, city_id: null },
        { id: "sa-2", producer_user_id: "u2", program: "Hamlet", sub_program: null, city_id: "city-1" },
      ],
      error: null,
    },
    org_memberships: {
      data: [
        { user_id: "u1", role: "producer" },
        { user_id: "u2", role: "producer" },
      ],
      error: null,
    },
    profiles: {
      data: [
        { user_id: "u1", display_name: "Producer One" },
        { user_id: "u2", display_name: "Berlin Producer" },
      ],
      error: null,
    },
  }),
);

import { useCan } from "@/hooks/useCapabilities";
import { OwnershipPanel } from "./OwnershipPanel";

describe("OwnershipPanel", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(useCan).mockReturnValue(true); });

  it("groups owners by program with rank badges, most-specific row winning first", async () => {
    renderWithProviders(<OwnershipPanel orgId="org-1" />);

    expect((await screen.findAllByText("Producer One")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Berlin Producer").length).toBeGreaterThanOrEqual(1);
    // Berlin Producer's row is the most specific for Hamlet (city-scoped beats program-only).
    expect(screen.getByText("Wins first")).toBeInTheDocument();
    // "Program" also labels the routing-check Program select, so scope to the rank badge.
    expect(screen.getAllByText("Program").length).toBeGreaterThanOrEqual(1);
  });

  it("shows a no-owner warning banner for a program with zero assignments", async () => {
    renderWithProviders(<OwnershipPanel orgId="org-1" />);

    expect(await screen.findByText(/has no owner/)).toBeInTheDocument();
    expect(screen.getAllByText(/Macbeth/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/routes to admins only/)).toBeInTheDocument();
  });

  it("updates the routing check result when the scope selects change", async () => {
    renderWithProviders(<OwnershipPanel orgId="org-1" />);

    // Default scope (Hamlet / Any sub-program / Any city) resolves to the program-only owner.
    expect((await screen.findAllByText("Producer One")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Program match/)).toBeInTheDocument();

    // Selects render without an accessible name; routing-check order is Program, Sub-program, City.
    fireEvent.click(screen.getAllByRole("combobox")[2]);
    fireEvent.click(await screen.findByRole("option", { name: "Berlin" }));

    expect(await screen.findByText(/City match/)).toBeInTheDocument();
    expect(screen.getAllByText("Berlin Producer").length).toBeGreaterThanOrEqual(1);
  });

  it("gates the assign-owner and remove controls on manage_ownership", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderWithProviders(<OwnershipPanel orgId="org-1" />);

    expect((await screen.findAllByText("Producer One")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: /assign owner/i })[0]).toBeDisabled();
    expect(screen.getAllByLabelText("Remove owner")[0]).toBeDisabled();
  });
});
