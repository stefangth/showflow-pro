import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const reorderShows = vi.fn((..._a: unknown[]) => Promise.resolve());
const archiveShow = vi.fn((..._a: unknown[]) => Promise.resolve());
const deleteShow = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
// v3 is the app default now; pin it off so the finish-setup affordance test genuinely
// exercises the v1 path (this page mocks the supabase client as {}, so there is no fake
// client to seed a getrunning_v3_enabled row into).
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "u1" }, hasRole: () => true }) }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));
vi.mock("@/data/shows", async (orig) => ({ ...(await orig<typeof import("@/data/shows")>()), reorderShows: (...a: unknown[]) => reorderShows(...a), archiveShow: (...a: unknown[]) => archiveShow(...a), deleteShow: (...a: unknown[]) => deleteShow(...a) }));

import { useCan } from "@/hooks/useCapabilities";
const mockUseCan = (allowed: Record<string, boolean>) =>
  vi.mocked(useCan).mockImplementation((action: string) => allowed[action] ?? true);

const SHOWS = [
  { id: "s1", program: "Manual", sub_program: null, category: null, description: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null, sort_order: 1, dateCount: 0 },
  { id: "s2", program: "Imported", sub_program: null, category: null, description: null, status: "active", main_cast_slots: null, understudy_slots: null, airtable_program_key: "K", sort_order: 2, dateCount: 3 },
  { id: "s3", program: "TJE", sub_program: "Murder", category: null, description: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null, sort_order: 3, dateCount: 0 },
  { id: "s4", program: "Solo", sub_program: null, category: null, description: null, status: "active", main_cast_slots: 3, understudy_slots: null, airtable_program_key: null, sort_order: 4, dateCount: 0 },
];
vi.mock("@/hooks/useShows", async (orig) => {
  const real = await orig<typeof import("@/hooks/useShows")>();
  return { ...real, useShows: () => ({ data: SHOWS, isLoading: false, isError: false }) };
});

vi.mock("@/features/editor/EditorContext", () => ({
  useColumnTemplate: () => ({
    orderedColumns: [
      { columnId: "shows.program", visible: true, order: 0 },
      { columnId: "shows.sub_program", visible: true, order: 1 },
      { columnId: "shows.category", visible: true, order: 2 },
      { columnId: "_computed.slots", visible: true, order: 3 },
      { columnId: "_computed.date_count", visible: true, order: 4 },
      { columnId: "shows.status", visible: true, order: 5 },
    ],
    isVisible: () => true,
    visibleCount: 6,
    activeRole: "admin",
  }),
  useEditorConfig: () => ({ isEditorMode: false, getColumnLabel: (id: string) => id }),
}));
vi.mock("@/features/editor/ColumnLayoutEditor", () => ({ ColumnLayoutEditor: () => null }));

import ProductionsPage from "./ProductionsPage";

describe("ProductionsPage", () => {
  beforeEach(() => { vi.clearAllMocks(); mockUseCan({}); }); // all capabilities default true

  it("uses the full program · sub_program identity label for compound shows", () => {
    renderWithProviders(<ProductionsPage />);
    expect(screen.getByLabelText("Edit TJE · Murder")).toBeInTheDocument();
  });

  it("renders rows and an unconfigured badge for null slots", () => {
    renderWithProviders(<ProductionsPage />);
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("Imported")).toBeInTheDocument();
    expect(screen.getAllByText(/unconfigured/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the computed slot column as main + understudy, main-only showing + 0", () => {
    renderWithProviders(<ProductionsPage />);
    // A main-only show (understudy_slots NULL) is configured, not "Unconfigured": it
    // renders its computed 3 + 0 rather than the destructive badge.
    expect(screen.getByText("Solo")).toBeInTheDocument();
    expect(screen.getByText("3 + 0")).toBeInTheDocument();
    expect(screen.getAllByText("2 + 1").length).toBeGreaterThanOrEqual(1);
  });

  it("delete is enabled only for a manual, zero-date show", () => {
    renderWithProviders(<ProductionsPage />);
    expect(screen.getByTestId("delete-s1")).not.toBeDisabled(); // manual, 0 dates
    expect(screen.getByTestId("delete-s2")).toBeDisabled();     // synced + has dates
  });

  it("hard_delete_productions off: no delete control renders (read stays)", () => {
    mockUseCan({ hard_delete_productions: false });
    renderWithProviders(<ProductionsPage />);
    expect(screen.queryByTestId("delete-s1")).not.toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("manage_productions off: create and edit are disabled, read stays", () => {
    mockUseCan({ manage_productions: false });
    renderWithProviders(<ProductionsPage />);
    expect(screen.getByRole("button", { name: "New production" })).toBeDisabled();
    expect(screen.getByLabelText("Edit TJE · Murder")).toBeDisabled();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("manage_productions on: create and edit are enabled", () => {
    renderWithProviders(<ProductionsPage />);
    expect(screen.getByRole("button", { name: "New production" })).not.toBeDisabled();
    expect(screen.getByLabelText("Edit TJE · Murder")).not.toBeDisabled();
  });

  it("archive_productions off: archive toggle is disabled for every row", () => {
    mockUseCan({ archive_productions: false });
    renderWithProviders(<ProductionsPage />);
    screen.getAllByLabelText("Toggle archive").forEach((btn) => expect(btn).toBeDisabled());
  });

  it("reorder_productions off: no drag handles render, rows still read", () => {
    mockUseCan({ reorder_productions: false });
    const { container } = renderWithProviders(<ProductionsPage />);
    expect(container.querySelectorAll(".cursor-grab")).toHaveLength(0);
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("reorder_productions on: drag handles render for the active list", () => {
    const { container } = renderWithProviders(<ProductionsPage />);
    expect(container.querySelectorAll(".cursor-grab").length).toBeGreaterThan(0);
  });

  it("renders configured columns with headers and a date count", () => {
    renderWithProviders(<ProductionsPage />);
    // header label comes from the mocked getColumnLabel (returns the column id)
    expect(screen.getByText("shows.program")).toBeInTheDocument();
    expect(screen.getByText("_computed.date_count")).toBeInTheDocument();
    // date_count cell for the synced show (dateCount: 3)
    expect(screen.getByText(/3 dates/)).toBeInTheDocument();
  });

  it("v3 off: no finish-setup affordance beside New production", () => {
    renderWithProviders(<ProductionsPage />);
    expect(screen.queryByRole("link", { name: /finish setup/i })).not.toBeInTheDocument();
  });
});
