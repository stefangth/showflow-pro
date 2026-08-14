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
    // override (Berlin Producer) - both are notified for a Berlin-scoped query since every
    // matching owner is notified, not just the most specific. Macbeth has no assignment at
    // all -> the no-owner banner. Orphan Play has an assignment but no matching show at all
    // (renamed/deleted program, free-text with no FK) - it must still render as a group.
    show_assignments: {
      data: [
        { id: "sa-1", producer_user_id: "u1", program: "Hamlet", sub_program: null, city_id: null },
        { id: "sa-2", producer_user_id: "u2", program: "Hamlet", sub_program: null, city_id: "city-1" },
        { id: "sa-3", producer_user_id: "u1", program: "Orphan Play", sub_program: null, city_id: null },
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

  it("groups owners by program with scope badges per row", async () => {
    renderWithProviders(<OwnershipPanel orgId="org-1" />);

    expect((await screen.findAllByText("Producer One")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Berlin Producer").length).toBeGreaterThanOrEqual(1);
    // Every row gets a neutral scope label reflecting its own specificity - no row is
    // singled out as a "winner". "City" and "Program" also label the routing-check
    // selects, so scope to "at least one" rather than a single exact match.
    expect(screen.queryByText("Wins first")).not.toBeInTheDocument();
    expect(screen.getAllByText("City").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Program").length).toBeGreaterThanOrEqual(1);
  });

  it("shows a no-owner warning banner for a program with zero assignments", async () => {
    renderWithProviders(<OwnershipPanel orgId="org-1" />);

    expect(await screen.findByText(/has no owner/)).toBeInTheDocument();
    expect(screen.getAllByText(/Macbeth/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/routes to admins only/)).toBeInTheDocument();
  });

  it("renders an orphan-program group for an assignment whose program has no matching show", async () => {
    renderWithProviders(<OwnershipPanel orgId="org-1" />);

    expect((await screen.findAllByText("Orphan Play")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/not in the current catalog/)).toBeInTheDocument();
    // The orphan program's owner still renders like any other row.
    expect((await screen.findAllByText("Producer One")).length).toBeGreaterThanOrEqual(1);
  });

  it("notifies every owner whose scope matches, not a single winner", async () => {
    renderWithProviders(<OwnershipPanel orgId="org-1" />);

    // Default scope (Hamlet / Any sub-program / Any city) only matches the program-only owner.
    expect(await screen.findByText(/Every owner whose scope covers this show is notified\./)).toBeInTheDocument();
    const notifiedHeading = screen.getByText("Notified");
    expect(notifiedHeading.parentElement).toHaveTextContent("Producer One");

    // Selects render without an accessible name; routing-check order is Program, Sub-program, City.
    fireEvent.click(screen.getAllByRole("combobox")[2]);
    fireEvent.click(await screen.findByRole("option", { name: "Berlin" }));

    // Scoping to Berlin now matches BOTH the program-only owner and the Berlin-scoped
    // owner - both must appear in the notified set, since the routing engine notifies the
    // full union of matching scopes.
    await screen.findAllByText("Berlin Producer");
    expect(notifiedHeading.parentElement).toHaveTextContent("Producer One");
    expect(notifiedHeading.parentElement).toHaveTextContent("Berlin Producer");
    // The admins-fallback line only appears when nothing matches.
    expect(screen.queryByText(/fallback recipients when no owner matches/)).not.toBeInTheDocument();
  });

  it("falls back to admins-only when no assignment matches the routing-check scope", async () => {
    renderWithProviders(<OwnershipPanel orgId="org-1" />);

    // Macbeth has no owner at all.
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    fireEvent.click(await screen.findByRole("option", { name: "Macbeth" }));

    expect(await screen.findByText("Admins only")).toBeInTheDocument();
    expect(screen.getByText(/No owner covers this show\. Notifications fall back to the admins\./)).toBeInTheDocument();
    expect(screen.getByText(/Admins are the fallback recipients when no owner matches\./)).toBeInTheDocument();
  });

  it("gates the assign-owner and remove controls on manage_ownership", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderWithProviders(<OwnershipPanel orgId="org-1" />);

    expect((await screen.findAllByText("Producer One")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: /assign owner/i })[0]).toBeDisabled();
    expect(screen.getAllByLabelText("Remove owner")[0]).toBeDisabled();
  });
});
