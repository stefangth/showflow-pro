import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { AirtableSyncTab } from "./AirtableSyncTab";

// Mock the data-access layer (tested separately) so the component's schema-load
// branch is controllable without touching the supabase singleton.
vi.mock("@/data/airtableSchema", () => ({
  fetchAirtableBases: vi.fn(),
  fetchAirtableTables: vi.fn(),
}));
vi.mock("@/data/settings", () => ({
  fetchShowsForLinking: vi.fn(() => Promise.resolve([])),
  linkShowAirtableKey: vi.fn(),
  importShowsFromOptions: vi.fn(),
}));
vi.mock("@/data/cities", () => ({
  fetchCitiesForLinking: vi.fn(() => Promise.resolve([])),
  linkCityAirtableKey: vi.fn(),
  importCitiesFromOptions: vi.fn(),
}));

import { fetchAirtableBases } from "@/data/airtableSchema";

function renderTab(initial: Record<string, unknown> = {}) {
  const draft: Record<string, unknown> = { ...initial };
  const get = (k: string, fb?: unknown) => draft[k] ?? fb;
  const set = (k: string, v: unknown) => { draft[k] = v; };
  return renderWithProviders(<AirtableSyncTab orgId="org-1" get={get} set={set} />);
}

describe("AirtableSyncTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the connection card with typed base/table inputs by default", () => {
    renderTab();
    expect(screen.getByText("Airtable Sync")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("app1234567890")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Shows")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load from Airtable" })).toBeInTheDocument();
  });

  it("shows the scope banner + typed fallback when the key can't read schema", async () => {
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: false });
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Load from Airtable" }));
    await waitFor(() => expect(screen.getByText(/schema\.bases:read/)).toBeInTheDocument());
    // typed inputs remain available
    expect(screen.getByPlaceholderText("app1234567890")).toBeInTheDocument();
  });

  it("shows the Base selector label once schema is accessible", async () => {
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Fever Berlin" }] });
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Load from Airtable" }));
    await waitFor(() => expect(screen.getByText("Base")).toBeInTheDocument());
  });

  it("hides field-mapping and catalog-links until a table is selected", () => {
    renderTab();
    expect(screen.queryByText("Field mapping")).not.toBeInTheDocument();
    expect(screen.queryByText("Catalog links")).not.toBeInTheDocument();
  });
});
