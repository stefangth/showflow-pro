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
vi.mock("@/data/airtableSync", () => ({
  fetchLatestSyncLog: vi.fn(() => Promise.resolve(null)),
  fetchHeldRecords: vi.fn(() => Promise.resolve([])),
}));

import { fetchAirtableBases } from "@/data/airtableSchema";
import { fetchLatestSyncLog, fetchHeldRecords } from "@/data/airtableSync";

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

describe("AirtableSyncTab — last sync report", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders summary counts and held records from the latest log", async () => {
    (fetchLatestSyncLog as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "log-1", status: "partial", imported_count: 3, new_count: 2, updated_count: 1, held_count: 1, error_details: null, synced_at: "2026-06-17T10:00:00Z",
    });
    (fetchHeldRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "r1", airtable_record_id: "recHELD", reason: "program 'X' not linked", created_at: "2026-06-17T10:00:00Z" },
    ]);
    renderTab();
    expect(await screen.findByText("Last sync report")).toBeInTheDocument();
    expect(await screen.findByText("program 'X' not linked")).toBeInTheDocument();
    expect(screen.getByText("recHELD")).toBeInTheDocument();
  });

  it("shows an empty state when the org has never synced", async () => {
    (fetchLatestSyncLog as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (fetchHeldRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText(/No sync has run yet/i)).toBeInTheDocument();
  });
});
