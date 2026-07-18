import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const reorderShows = vi.fn((..._a: unknown[]) => Promise.resolve());
const archiveShow = vi.fn((..._a: unknown[]) => Promise.resolve());
const deleteShow = vi.fn((..._a: unknown[]) => Promise.resolve());
let role = "admin";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "u1" }, hasRole: (r: string) => r === role || r === "producer" }) }));
vi.mock("@/data/shows", async (orig) => ({ ...(await orig<typeof import("@/data/shows")>()), reorderShows: (...a: unknown[]) => reorderShows(...a), archiveShow: (...a: unknown[]) => archiveShow(...a), deleteShow: (...a: unknown[]) => deleteShow(...a) }));

const SHOWS = [
  { id: "s1", program: "Manual", sub_program: null, category: null, description: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null, sort_order: 1, dateCount: 0 },
  { id: "s2", program: "Imported", sub_program: null, category: null, description: null, status: "active", main_cast_slots: null, understudy_slots: null, airtable_program_key: "K", sort_order: 2, dateCount: 3 },
  { id: "s3", program: "TJE", sub_program: "Murder", category: null, description: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null, sort_order: 3, dateCount: 0 },
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
  beforeEach(() => { vi.clearAllMocks(); role = "admin"; });

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

  it("delete is enabled only for a manual, zero-date show", () => {
    renderWithProviders(<ProductionsPage />);
    expect(screen.getByTestId("delete-s1")).not.toBeDisabled(); // manual, 0 dates
    expect(screen.getByTestId("delete-s2")).toBeDisabled();     // synced + has dates
  });

  it("producers see no delete control", () => {
    role = "producer-only"; // hasRole('admin') === false
    renderWithProviders(<ProductionsPage />);
    expect(screen.queryByTestId("delete-s1")).not.toBeInTheDocument();
  });

  it("renders configured columns with headers and a date count", () => {
    renderWithProviders(<ProductionsPage />);
    // header label comes from the mocked getColumnLabel (returns the column id)
    expect(screen.getByText("shows.program")).toBeInTheDocument();
    expect(screen.getByText("_computed.date_count")).toBeInTheDocument();
    // date_count cell for the synced show (dateCount: 3)
    expect(screen.getByText(/3 dates/)).toBeInTheDocument();
  });
});
