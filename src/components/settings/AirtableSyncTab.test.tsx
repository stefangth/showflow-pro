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
  upsertOrgSetting: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/data/airtableSettings", () => ({
  fetchAirtableSettings: vi.fn(() =>
    Promise.resolve({ airtable_sync_enabled: false, airtable_base_id: "", airtable_table_name: "", airtable_field_map: {} }),
  ),
  AIRTABLE_SETTING_KEYS: ["airtable_sync_enabled", "airtable_base_id", "airtable_table_name", "airtable_field_map"],
}));
vi.mock("@/data/cities", () => ({
  fetchCitiesForLinking: vi.fn(() => Promise.resolve([])),
  linkCityAirtableKey: vi.fn(),
  importCitiesFromOptions: vi.fn(),
  mergeCities: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/data/airtableSync", () => ({
  fetchLatestSyncLog: vi.fn(() => Promise.resolve(null)),
  fetchUnresolvedRecords: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/data/airtableKey", () => ({
  fetchAirtableKeyStatus: vi.fn(() => Promise.resolve({ present: false, updatedAt: null })),
  saveAirtableKey: vi.fn(),
  deleteAirtableKey: vi.fn(),
}));

import { fetchAirtableBases, fetchAirtableTables } from "@/data/airtableSchema";
import { fetchAirtableKeyStatus } from "@/data/airtableKey";
import { fetchLatestSyncLog, fetchUnresolvedRecords } from "@/data/airtableSync";
import { fetchCitiesForLinking, mergeCities } from "@/data/cities";
import { upsertOrgSetting } from "@/data/settings";
import { fetchAirtableSettings } from "@/data/airtableSettings";

function renderTab(initial: Record<string, unknown> = {}) {
  (fetchAirtableSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
    airtable_sync_enabled: false,
    airtable_base_id: "",
    airtable_table_name: "",
    airtable_field_map: {},
    ...initial,
  });
  return renderWithProviders(<AirtableSyncTab orgId="org-1" />);
}

describe("AirtableSyncTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gates the schema refresh behind a saved key, with a hint", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: false, updatedAt: null });
    renderTab();
    expect(screen.getByText("Airtable Sync")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh from Airtable" })).toBeDisabled());
    expect(screen.getByText(/Save an API key first/i)).toBeInTheDocument();
    expect(fetchAirtableBases).not.toHaveBeenCalled();
  });

  it("shows a saved-key status with Replace and Delete when a key exists", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: "2026-06-22T17:44:00Z" });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [] });
    renderTab();
    expect(await screen.findByText("Key saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete/ })).toBeInTheDocument();
  });

  it("auto-loads bases on mount when a key is present (no click)", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Fever Berlin" }] });
    renderTab();
    await waitFor(() => expect(fetchAirtableBases).toHaveBeenCalledWith(expect.anything(), "org-1"));
    expect(await screen.findByText("Base")).toBeInTheDocument();
  });

  it("shows the scope banner + typed fallback when the key can't read schema", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: false });
    renderTab();
    await waitFor(() => expect(screen.getByText(/schema\.bases:read/)).toBeInTheDocument());
    expect(screen.getByPlaceholderText("app1234567890")).toBeInTheDocument();
  });

  it("auto-loads tables for a base already saved in settings", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Fever Berlin" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, tables: [{ id: "tbl1", name: "Events", fields: [] }] });
    renderTab({ airtable_base_id: "appA" });
    await waitFor(() => expect(fetchAirtableTables).toHaveBeenCalledWith(expect.anything(), "org-1", "appA"));
  });

  it("drops to manual entry when a base's tables can't be read (per-base 403)", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Fever Berlin" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: false });
    renderTab({ airtable_base_id: "appA" });
    await waitFor(() => expect(screen.getByPlaceholderText("app1234567890")).toBeInTheDocument());
    expect(screen.getByText(/this specific base/i)).toBeInTheDocument();
    expect(screen.queryByText(/schema\.bases:read/)).not.toBeInTheDocument();
  });

  it("drops to manual entry when the tables fetch throws (network/edge error)", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Fever Berlin" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
    renderTab({ airtable_base_id: "appA" });
    await waitFor(() => expect(screen.getByPlaceholderText("app1234567890")).toBeInTheDocument());
    expect(screen.getByText(/Couldn't reach Airtable/i)).toBeInTheDocument();
    expect(screen.queryByText(/schema\.bases:read/)).not.toBeInTheDocument();
  });

  it("hides field-mapping and catalog-links until a table is selected", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: false, updatedAt: null });
    renderTab();
    expect(screen.queryByText(/Field mapping/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Catalog links/)).not.toBeInTheDocument();
  });
});

describe("AirtableSyncTab — last sync report", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders summary counts and held records from the latest log", async () => {
    (fetchLatestSyncLog as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "log-1", status: "partial", imported_count: 3, new_count: 2, updated_count: 1, held_count: 1, error_details: null, synced_at: "2026-06-17T10:00:00Z",
    });
    (fetchUnresolvedRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "r1", airtable_record_id: "recHELD", reason: "program 'X' not linked", created_at: "2026-06-17T10:00:00Z", action: "held_unresolved" },
    ]);
    renderTab();
    expect(await screen.findByText("Last sync report")).toBeInTheDocument();
    expect(await screen.findByText("Held records")).toBeInTheDocument();
    expect(await screen.findByText("program 'X' not linked")).toBeInTheDocument();
    expect(screen.getByText("recHELD")).toBeInTheDocument();
  });

  it("renders errored records in their own subsection", async () => {
    (fetchLatestSyncLog as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "log-3", status: "partial", imported_count: 0, new_count: 0, updated_count: 0, held_count: 0, error_details: "1 record(s) errored", synced_at: "2026-06-17T10:00:00Z",
    });
    (fetchUnresolvedRecords as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "e1", airtable_record_id: "recERR", reason: "insert failed: duplicate key", created_at: "2026-06-17T10:00:00Z", action: "error" },
    ]);
    renderTab();
    expect(await screen.findByText("Errored records")).toBeInTheDocument();
    expect(await screen.findByText("insert failed: duplicate key")).toBeInTheDocument();
    expect(screen.getByText("recERR")).toBeInTheDocument();
  });

  it("renders error_details when present", async () => {
    (fetchLatestSyncLog as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "log-2", status: "partial", imported_count: 0, new_count: 0, updated_count: 0, held_count: 0,
      error_details: "2 record(s) errored", synced_at: "2026-06-17T10:00:00Z",
    });
    (fetchUnresolvedRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText("2 record(s) errored")).toBeInTheDocument();
  });

  it("shows an empty state when the org has never synced", async () => {
    (fetchLatestSyncLog as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (fetchUnresolvedRecords as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText(/No sync has run yet/i)).toBeInTheDocument();
  });
});

describe("AirtableSyncTab — duplicate cities", () => {
  beforeEach(() => vi.clearAllMocks());

  it("surfaces a duplicate group and merges on confirm", async () => {
    (fetchCitiesForLinking as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "c-a", name: "Berlin", airtable_city_key: "berlin" },
      { id: "c-b", name: "berlin", airtable_city_key: null },
    ]);
    renderTab({ airtable_table_name: "Events", airtable_field_map: { city: "City" } });
    expect(await screen.findByText(/Duplicate cities/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));          // dialog trigger
    fireEvent.click(await screen.findByRole("button", { name: "Merge cities" })); // confirm action
    await waitFor(() => expect(mergeCities).toHaveBeenCalledWith(expect.anything(), "c-a", ["c-b"]));
  });

  it("shows nothing when there are no duplicates", async () => {
    (fetchCitiesForLinking as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "c-a", name: "Berlin", airtable_city_key: "berlin" },
    ]);
    renderTab({ airtable_table_name: "Events", airtable_field_map: { city: "City" } });
    await waitFor(() => expect(screen.queryByText(/Duplicate cities/i)).not.toBeInTheDocument());
  });
});

describe("AirtableSyncTab — autosave", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists a field-mapping change immediately and shows saved status", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Base A" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({
      schemaAccessible: true,
      tables: [{ id: "tbl1", name: "Events", fields: [{ id: "fld1", name: "Show Date", type: "date" }] }],
    });
    renderTab({ airtable_base_id: "appA", airtable_table_name: "Events" });

    const dateSelect = await screen.findByRole("combobox", { name: /^Date$/i });
    fireEvent.click(dateSelect);
    fireEvent.click(await screen.findByRole("option", { name: "Show Date" }));

    await waitFor(() =>
      expect(upsertOrgSetting).toHaveBeenCalledWith(
        expect.anything(),
        "org-1",
        "airtable_field_map",
        expect.objectContaining({ date: "Show Date" }),
      ),
    );
    expect(await screen.findByText(/All changes saved/i)).toBeInTheDocument();
  });

  it("autosaves the enable toggle without a global Save click", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [] });
    renderTab();
    fireEvent.click(await screen.findByRole("switch"));
    await waitFor(() =>
      expect(upsertOrgSetting).toHaveBeenCalledWith(expect.anything(), "org-1", "airtable_sync_enabled", true),
    );
  });

  it("surfaces an error and rolls back when a save fails", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [] });
    (upsertOrgSetting as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));
    renderTab();
    fireEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByText(/Couldn't save/i)).toBeInTheDocument();
  });
});
