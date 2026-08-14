import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  cast_members: {
    data: [{ id: "m1", artist_id: "a1", artist: { id: "a1", name: "Artist One", status: "active" } }],
    error: null,
  },
  artists: {
    data: [
      { id: "a1", name: "Artist One", status: "active" },
      { id: "a2", name: "Artist Two", status: "active" },
    ],
    error: null,
  },
  cities: {
    data: [
      { id: "city-1", name: "Berlin", org_id: "org-1" },
      { id: "city-2", name: "Munich", org_id: "org-1" },
      { id: "city-3", name: "Hamburg", org_id: "org-1" },
    ],
    error: null,
  },
  shows: {
    data: [{ id: "show-1", program: "Show One", sub_program: null }],
    error: null,
  },
  casts: {
    data: [
      { id: "c1", name: "Cast A" },
      { id: "c2", name: "Cast B" },
    ],
    error: null,
  },
  // Org-default offer order: Cast A (c1) is tier 1 in Berlin and tier 2 (after Cast B)
  // in Hamburg; neither cast is ranked in Munich.
  cast_city_priority: {
    data: [
      { id: "p1", cast_id: "c1", city_id: "city-1", priority: 1 },
      { id: "p2", cast_id: "c2", city_id: "city-3", priority: 1 },
      { id: "p3", cast_id: "c1", city_id: "city-3", priority: 2 },
    ],
    error: null,
  },
}));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ roles: ["producer"], currentOrg: { id: "org-1" } }),
}));
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));
vi.mock("@/features/editor/EditorContext", () => ({ useEditorConfig: () => ({ isEditorMode: false }) }));

import { useCan } from "@/hooks/useCapabilities";
import { CastDetailsSheet } from "./CastDetailsSheet";

const CAST = { id: "c1", name: "Cast A", description: null } as never;

describe("CastDetailsSheet", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(useCan).mockReturnValue(true); });

  it("manage_casts on: edit, remove, and add-member controls are enabled", async () => {
    renderWithProviders(<CastDetailsSheet cast={CAST} open onOpenChange={() => {}} />);
    expect(await screen.findByText("Artist One")).toBeInTheDocument();
    expect(screen.getByLabelText("Edit cast")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Artist One")).not.toBeDisabled();
    const candidateRow = screen.getByText("Artist Two").closest("div")!.parentElement!;
    expect(within(candidateRow).getByRole("button")).not.toBeDisabled();
  });

  it("manage_casts off: edit and add controls are disabled/absent, member list still reads", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderWithProviders(<CastDetailsSheet cast={CAST} open onOpenChange={() => {}} />);
    expect(await screen.findByText("Artist One")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit cast")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Remove Artist One")).toBeDisabled();
    const candidateRow = screen.getByText("Artist Two").closest("div")!.parentElement!;
    expect(within(candidateRow).getByRole("button")).toBeDisabled();
  });

  // Regression: switching away from Members must not break the City eligibility tab.
  it("City eligibility tab still renders the city x show grid", async () => {
    renderWithProviders(<CastDetailsSheet cast={CAST} open onOpenChange={() => {}} />);
    expect(await screen.findByText("Artist One")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /City eligibility/i }));
    expect(await screen.findByText("Show One")).toBeInTheDocument();
    expect(screen.getByText("Berlin")).toBeInTheDocument();
    expect(screen.getByText("Munich")).toBeInTheDocument();
  });

  // New: Offer order tab shows the org-default cast_city_priority placement of THIS
  // cast per city (read-only view; the coverage matrix in Settings owns the writes).
  it("Offer order tab shows per-city tier placement, notes, and a link to the coverage matrix", async () => {
    renderWithProviders(
      <MemoryRouter>
        <CastDetailsSheet cast={CAST} open onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Artist One")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Offer order/i }));

    // Berlin: Cast A is tier 1.
    const berlinRow = (await screen.findByText("Berlin")).closest("div")!.parentElement!;
    expect(within(berlinRow).getByText("Tier 1")).toBeInTheDocument();
    expect(within(berlinRow).getByText("Offered first here.")).toBeInTheDocument();

    // Munich: Cast A has no priority row at all.
    const munichRow = screen.getByText("Munich").closest("div")!.parentElement!;
    expect(within(munichRow).getByText("Not in order")).toBeInTheDocument();
    expect(within(munichRow).getByText("Never offered here.")).toBeInTheDocument();

    // Hamburg: Cast A is tier 2, behind Cast B at tier 1.
    const hamburgRow = screen.getByText("Hamburg").closest("div")!.parentElement!;
    expect(within(hamburgRow).getByText("Tier 2")).toBeInTheDocument();
    expect(within(hamburgRow).getByText("Offered after Cast B.")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Manage offer order in Settings, Casts and coverage/i })).toHaveAttribute(
      "href",
      "/settings?tab=casts-coverage",
    );
  });
});
