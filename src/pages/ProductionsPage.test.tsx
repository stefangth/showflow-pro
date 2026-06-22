import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const reorderShows = vi.fn(() => Promise.resolve());
const archiveShow = vi.fn(() => Promise.resolve());
const deleteShow = vi.fn(() => Promise.resolve());
let role = "admin";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "u1" }, hasRole: (r: string) => r === role || r === "producer" }) }));
vi.mock("@/data/shows", async (orig) => ({ ...(await orig<typeof import("@/data/shows")>()), reorderShows: (...a: unknown[]) => reorderShows(...a), archiveShow: (...a: unknown[]) => archiveShow(...a), deleteShow: (...a: unknown[]) => deleteShow(...a) }));

const SHOWS = [
  { id: "s1", program: "Manual", sub_program: null, category: null, description: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null, sort_order: 1, dateCount: 0 },
  { id: "s2", program: "Synced", sub_program: null, category: null, description: null, status: "active", main_cast_slots: null, understudy_slots: null, airtable_program_key: "K", sort_order: 2, dateCount: 3 },
];
vi.mock("@/hooks/useShows", async (orig) => {
  const real = await orig<typeof import("@/hooks/useShows")>();
  return { ...real, useShows: () => ({ data: SHOWS, isLoading: false, isError: false }) };
});

import ProductionsPage from "./ProductionsPage";

describe("ProductionsPage", () => {
  beforeEach(() => { vi.clearAllMocks(); role = "admin"; });

  it("renders rows and an unconfigured badge for null slots", () => {
    renderWithProviders(<ProductionsPage />);
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("Synced")).toBeInTheDocument();
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
});
