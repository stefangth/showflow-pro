import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { AirtableSyncTab } from "./AirtableSyncTab";

// Mock the data-access layer (tested separately) so the component's schema-load
// branch is controllable without touching the supabase singleton.
vi.mock("@/data/airtableSchema", () => ({
  fetchAirtableBases: vi.fn(),
  fetchAirtableTables: vi.fn(),
  fetchAirtableLinkedRecords: vi.fn(() => Promise.resolve({ schemaAccessible: true, records: [] })),
  fetchAirtableProgramPairs: vi.fn(() => Promise.resolve({ schemaAccessible: true, pairs: [] })),
}));
vi.mock("@/data/settings", () => ({
  fetchShowsForLinking: vi.fn(() => Promise.resolve([])),
  linkShowAirtableKey: vi.fn(),
  importShowsFromOptions: vi.fn(),
  upsertOrgSetting: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/data/airtableSettings", () => ({
  fetchAirtableSettings: vi.fn(() =>
    Promise.resolve({ airtable_sync_enabled: false, airtable_base_id: "", airtable_table_name: "", airtable_field_map: {}, airtable_view: "Grid view" }),
  ),
  AIRTABLE_SETTING_KEYS: ["airtable_sync_enabled", "airtable_base_id", "airtable_table_name", "airtable_field_map", "airtable_view"],
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
vi.mock("@/data/customFields", () => ({
  fetchCustomFieldDefs: vi.fn(() => Promise.resolve([])),
  upsertCustomFieldDef: vi.fn(() => Promise.resolve()),
  deleteCustomFieldDef: vi.fn(() => Promise.resolve()),
}));

import { fetchAirtableBases, fetchAirtableTables, fetchAirtableLinkedRecords, fetchAirtableProgramPairs } from "@/data/airtableSchema";
import { fetchAirtableKeyStatus } from "@/data/airtableKey";
import { fetchLatestSyncLog, fetchUnresolvedRecords } from "@/data/airtableSync";
import { fetchCitiesForLinking, mergeCities } from "@/data/cities";
import { upsertOrgSetting, fetchShowsForLinking, importShowsFromOptions } from "@/data/settings";
import { fetchAirtableSettings } from "@/data/airtableSettings";

function renderTab(initial: Record<string, unknown> = {}) {
  (fetchAirtableSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
    airtable_sync_enabled: false,
    airtable_base_id: "",
    airtable_table_name: "",
    airtable_field_map: {},
    airtable_view: "Grid view",
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

  it("field-mapping card shows Showflow-field vs Airtable-column headers", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appX", name: "Base" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({
      schemaAccessible: true,
      tables: [{ id: "tbl", name: "Events", fields: [{ id: "f1", name: "Datum", type: "date" }] }],
    });
    renderTab({ airtable_base_id: "appX", airtable_table_name: "Events" });
    expect(await screen.findByText("Showflow field")).toBeInTheDocument();
    expect(screen.getByText("Airtable column")).toBeInTheDocument();
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
    // The save-status pill renders in both the connection and field-mapping card
    // headers, so when the mapping card is visible there are two — assert ≥1.
    expect((await screen.findAllByText(/All changes saved/i)).length).toBeGreaterThan(0);
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
    const toggle = await screen.findByRole("switch");
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(await screen.findByText(/Couldn't save/i)).toBeInTheDocument();
    // Rollback: the optimistically-flipped toggle returns to off after the failed save.
    await waitFor(() => expect(screen.getByRole("switch")).not.toBeChecked());
  });

  it("offers 'Link to existing' for an unlinked program option", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appX", name: "Base" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({
      schemaAccessible: true,
      tables: [{
        id: "tbl", name: "Events",
        fields: [
          { id: "fS", name: "Sub", type: "singleSelect", options: { choices: [{ id: "c1", name: "TJE: Murder" }] } },
        ],
      }],
    });
    (fetchShowsForLinking as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "show-1", program: "Existing", sub_program: null, main_cast_slots: 2, understudy_slots: 1, airtable_program_key: null },
    ]);
    renderTab({ airtable_base_id: "appX", airtable_table_name: "Events", airtable_field_map: { sub_program: "Sub" } });

    expect(await screen.findByText("TJE: Murder")).toBeInTheDocument();
    const trigger = screen.getByLabelText("link or create show for TJE: Murder");
    fireEvent.click(trigger);
    // The combobox offers both "Create" and the existing unlinked show to link to.
    expect(await screen.findByText(/Create/)).toBeInTheDocument();
    expect(screen.getByText("Existing")).toBeInTheDocument();
  });

  it("creates a show inline from an unlinked program option", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appX", name: "Base" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({
      schemaAccessible: true,
      tables: [{ id: "tbl", name: "Events", fields: [{ id: "fS", name: "Sub", type: "singleSelect", options: { choices: [{ id: "c1", name: "TJE: Murder" }] } }] }],
    });
    (fetchShowsForLinking as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderTab({ airtable_base_id: "appX", airtable_table_name: "Events", airtable_field_map: { sub_program: "Sub" } });

    fireEvent.click(await screen.findByLabelText("link or create show for TJE: Murder"));
    fireEvent.click(await screen.findByText(/Create/));
    await waitFor(() =>
      expect(importShowsFromOptions).toHaveBeenCalledWith(
        expect.anything(), "org-1",
        [expect.objectContaining({ sub_program: "TJE: Murder", key: "TJE: Murder" })],
      ),
    );
  });

  it("links Programs at the composite grain when Program is mapped", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appX", name: "Base" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({
      schemaAccessible: true,
      tables: [{
        id: "tbl", name: "Events",
        fields: [
          { id: "fP", name: "Program", type: "singleSelect", options: { choices: [{ id: "p1", name: "TJE" }] } },
          { id: "fS", name: "Sub", type: "singleSelect", options: { choices: [{ id: "c1", name: "TJE: Murder" }] } },
        ],
      }],
    });
    (fetchAirtableProgramPairs as ReturnType<typeof vi.fn>).mockResolvedValue({
      schemaAccessible: true, pairs: [{ program: "TJE", sub_program: "TJE: Murder" }],
    });
    (fetchShowsForLinking as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderTab({ airtable_base_id: "appX", airtable_table_name: "Events", airtable_field_map: { program: "Program", sub_program: "Sub" } });

    // Composite display label "TJE – TJE: Murder" renders for the pair.
    expect(await screen.findByText("TJE – TJE: Murder")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchAirtableProgramPairs).toHaveBeenCalledWith(expect.anything(), "org-1", "appX", "Events", "Sub", "Program"),
    );
  });

  it("warns (not 'no options') when the key can't read records for program pairs", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appX", name: "Base" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({
      schemaAccessible: true,
      tables: [{
        id: "tbl", name: "Events",
        fields: [
          { id: "fP", name: "Program", type: "singleSelect", options: { choices: [{ id: "p1", name: "TJE" }] } },
          { id: "fS", name: "Sub", type: "singleSelect", options: { choices: [{ id: "c1", name: "TJE: Murder" }] } },
        ],
      }],
    });
    // Airtable 403 on the records endpoint → edge fn returns { schemaAccessible: false } (HTTP 200).
    (fetchAirtableProgramPairs as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: false });
    (fetchShowsForLinking as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderTab({ airtable_base_id: "appX", airtable_table_name: "Events", airtable_field_map: { program: "Program", sub_program: "Sub" } });

    expect(await screen.findByText(/can't read records/i)).toBeInTheDocument();
  });

  it("lists city options from a linked-record City field", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appX", name: "Base" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({
      schemaAccessible: true,
      tables: [{
        id: "tbl", name: "Events",
        fields: [{ id: "fCity", name: "City", type: "multipleRecordLinks", options: { linkedTableId: "tblCities" } }],
      }],
    });
    (fetchAirtableLinkedRecords as ReturnType<typeof vi.fn>).mockResolvedValue({
      schemaAccessible: true, records: [{ id: "recCity1", name: "Berlin" }],
    });
    renderTab({ airtable_base_id: "appX", airtable_table_name: "Events", airtable_field_map: { city: "City" } });

    expect(await screen.findByText("Berlin")).toBeInTheDocument();
  });
});

describe("AirtableSyncTab — Airtable view", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the optional view input once a key and table are set", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Base" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, tables: [{ id: "t", name: "Events", fields: [] }] });
    renderTab({ airtable_base_id: "appA", airtable_table_name: "Events" });
    expect(await screen.findByPlaceholderText("Grid view")).toBeInTheDocument();
  });

  it("hides the view input until a table is selected", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [] });
    renderTab(); // no table_name
    await screen.findByRole("button", { name: "Refresh from Airtable" });
    expect(screen.queryByPlaceholderText("Grid view")).not.toBeInTheDocument();
  });

  it("saves the view on blur only when it changed, incl. clearing to whole-table mode", async () => {
    (fetchAirtableKeyStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ present: true, updatedAt: null });
    (fetchAirtableBases as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Base" }] });
    (fetchAirtableTables as ReturnType<typeof vi.fn>).mockResolvedValue({ schemaAccessible: true, tables: [{ id: "t", name: "Events", fields: [] }] });
    renderTab({ airtable_base_id: "appA", airtable_table_name: "Events" }); // airtable_view defaults to "Grid view"

    const input = await screen.findByPlaceholderText("Grid view");
    // Unchanged blur → no airtable_view save.
    fireEvent.blur(input);
    expect(upsertOrgSetting).not.toHaveBeenCalledWith(expect.anything(), "org-1", "airtable_view", expect.anything());
    // Clearing the field saves "" (whole-table mode).
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await waitFor(() => expect(upsertOrgSetting).toHaveBeenCalledWith(expect.anything(), "org-1", "airtable_view", ""));
  });
});
