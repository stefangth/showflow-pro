import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { AirtableSyncTab } from "./AirtableSyncTab";

// Mock the data-access layer (tested separately) so the component's schema-load,
// sync-log and key-status branches are controllable without touching the supabase
// singleton. This suite targets the REBUILT status-first console (StatusHeader +
// ConsoleTabs + sub-tabs + a Manage-connection dialog), not the old stacked form.
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
    Promise.resolve({
      airtable_sync_enabled: false, airtable_base_id: "", airtable_table_name: "",
      airtable_field_map: {}, airtable_view: "Grid view", airtable_poll_interval_minutes: 60,
    }),
  ),
  AIRTABLE_SETTING_KEYS: ["airtable_sync_enabled", "airtable_base_id", "airtable_table_name", "airtable_field_map", "airtable_view", "airtable_poll_interval_minutes"],
}));
vi.mock("@/data/cities", () => ({
  fetchCitiesForLinking: vi.fn(() => Promise.resolve([])),
  linkCityAirtableKey: vi.fn(),
  importCitiesFromOptions: vi.fn(),
  mergeCities: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/data/airtableSync", () => ({
  fetchLatestSyncLog: vi.fn(() => Promise.resolve(null)),
  fetchRecentSyncLogs: vi.fn(() => Promise.resolve([])),
  fetchUnresolvedRecords: vi.fn(() => Promise.resolve([])),
  triggerAirtableSyncNow: vi.fn(() =>
    Promise.resolve({ ok: true, orgs_synced: 1, result: { processed: 0, new_dates: 0, updated: 0, held: 0, tiers_opened: 0 } }),
  ),
}));
vi.mock("@/data/airtableKey", () => ({
  fetchAirtableKeyStatus: vi.fn(() => Promise.resolve({ present: false, updatedAt: null })),
  saveAirtableKey: vi.fn(() => Promise.resolve()),
  deleteAirtableKey: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/data/customFields", () => ({
  fetchCustomFieldDefs: vi.fn(() => Promise.resolve([])),
  upsertCustomFieldDef: vi.fn(() => Promise.resolve()),
  deleteCustomFieldDef: vi.fn(() => Promise.resolve()),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { fetchAirtableBases, fetchAirtableTables, fetchAirtableProgramPairs, fetchAirtableLinkedRecords } from "@/data/airtableSchema";
import { fetchAirtableKeyStatus, saveAirtableKey } from "@/data/airtableKey";
import { fetchLatestSyncLog, fetchRecentSyncLogs, fetchUnresolvedRecords, triggerAirtableSyncNow } from "@/data/airtableSync";
import { fetchCitiesForLinking } from "@/data/cities";
import { upsertOrgSetting, fetchShowsForLinking } from "@/data/settings";
import { fetchAirtableSettings } from "@/data/airtableSettings";
import { fetchCustomFieldDefs } from "@/data/customFields";

type Fn = ReturnType<typeof vi.fn>;
const mock = (f: unknown) => f as Fn;

const SETUP_DEFAULTS = {
  airtable_sync_enabled: false,
  airtable_base_id: "",
  airtable_table_name: "",
  airtable_field_map: {},
  airtable_view: "Grid view",
  airtable_poll_interval_minutes: 60,
};

/** A fully-connected settings object (key present + base + table set). */
function connectedSettings(over: Record<string, unknown> = {}) {
  return { ...SETUP_DEFAULTS, airtable_base_id: "appA", airtable_table_name: "Events", ...over };
}

function renderTab(
  settings: Record<string, unknown> = {},
  props: { readOnly?: boolean; canTriggerSync?: boolean } = {},
) {
  mock(fetchAirtableSettings).mockResolvedValue({ ...SETUP_DEFAULTS, ...settings });
  return renderWithProviders(
    <AirtableSyncTab orgId="org-1" readOnly={props.readOnly} canTriggerSync={props.canTriggerSync} />,
  );
}

/** Mark the API key present and load a base + a single "Events" table with the given fields. */
function connect(fields: Array<{ id: string; name: string; type: string; options?: unknown }> = []) {
  mock(fetchAirtableKeyStatus).mockResolvedValue({ present: true, updatedAt: "2026-06-22T17:44:00Z" });
  mock(fetchAirtableBases).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Base A" }] });
  mock(fetchAirtableTables).mockResolvedValue({ schemaAccessible: true, tables: [{ id: "tbl", name: "Events", fields }] });
}

const syncLog = (over: Record<string, unknown> = {}) => ({
  id: "log-1", status: "success", records_processed: 5, imported_count: 3,
  new_count: 2, updated_count: 1, held_count: 0, error_details: null,
  synced_at: "2026-06-17T10:00:00Z", ...over,
});

// Clean defaults every test: vi.clearAllMocks() resets call history but NOT
// implementations, so re-seed each mock's resolved value so a value set in one
// test can't leak into the next.
beforeEach(() => {
  vi.clearAllMocks();
  mock(fetchAirtableKeyStatus).mockResolvedValue({ present: false, updatedAt: null });
  mock(fetchAirtableBases).mockResolvedValue({ schemaAccessible: true, bases: [] });
  mock(fetchAirtableTables).mockResolvedValue({ schemaAccessible: true, tables: [] });
  mock(fetchAirtableProgramPairs).mockResolvedValue({ schemaAccessible: true, pairs: [] });
  mock(fetchAirtableLinkedRecords).mockResolvedValue({ schemaAccessible: true, records: [] });
  mock(fetchLatestSyncLog).mockResolvedValue(null);
  mock(fetchRecentSyncLogs).mockResolvedValue([]);
  mock(fetchUnresolvedRecords).mockResolvedValue([]);
  mock(fetchShowsForLinking).mockResolvedValue([]);
  mock(fetchCitiesForLinking).mockResolvedValue([]);
  mock(fetchCustomFieldDefs).mockResolvedValue([]);
  mock(upsertOrgSetting).mockResolvedValue(undefined);
  mock(saveAirtableKey).mockResolvedValue(undefined);
  mock(triggerAirtableSyncNow).mockResolvedValue({
    ok: true, orgs_synced: 1, result: { processed: 0, new_dates: 0, updated: 0, held: 0, tiers_opened: 0 },
  });
});

describe("AirtableSyncTab — setup wizard", () => {
  it("renders the four-step setup wizard when no key is saved", async () => {
    renderTab();
    expect(await screen.findByText("Connect a base in four steps")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/^pat/)).toBeInTheDocument();
    // No console shell (StatusHeader / tabs) in setup mode.
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("enables and fires Save-and-continue only once a token is typed", async () => {
    renderTab();
    const input = await screen.findByPlaceholderText(/^pat/);
    // Empty token → the button is inert.
    expect(screen.getByRole("button", { name: "Save and continue" })).toBeDisabled();

    fireEvent.change(input, { target: { value: "patTOKEN123" } });
    const save = screen.getByRole("button", { name: "Save and continue" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(saveAirtableKey).toHaveBeenCalledWith(expect.anything(), "org-1", "patTOKEN123"),
    );
  });

  it("disables Save-and-continue when readOnly in setup mode", async () => {
    renderTab({}, { readOnly: true });
    await screen.findByText("Connect a base in four steps");
    expect(screen.getByRole("button", { name: "Save and continue" })).toBeDisabled();
    expect(screen.getByPlaceholderText(/^pat/)).toBeDisabled();
  });
});

describe("AirtableSyncTab — console shell", () => {
  it("renders the status headline and the four console tabs when connected", async () => {
    connect();
    renderTab(connectedSettings());
    // latest === null → healthy mode.
    expect(await screen.findByText("Syncing normally")).toBeInTheDocument();
    for (const name of ["Overview", "Field mapping", "Catalog links", "Activity"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("switches to the Field-mapping tab (mapping headers) and the Activity tab (run history)", async () => {
    connect([{ id: "f1", name: "Datum", type: "date" }]);
    renderTab(connectedSettings());

    fireEvent.click(await screen.findByText("Field mapping"));
    expect(await screen.findByText("ShowFlow field")).toBeInTheDocument();
    expect(screen.getByText("Airtable column")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Activity"));
    expect(await screen.findByText("Run history")).toBeInTheDocument();
  });

  it("autosaves the Sync master switch without a global Save click", async () => {
    connect();
    renderTab(connectedSettings());
    const toggle = await screen.findByRole("switch");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(upsertOrgSetting).toHaveBeenCalledWith(expect.anything(), "org-1", "airtable_sync_enabled", true),
    );
  });
});

describe("AirtableSyncTab — sync-now gating", () => {
  it("disables Sync now when canTriggerSync is false (live mode, sync enabled)", async () => {
    connect();
    mock(fetchLatestSyncLog).mockResolvedValue(syncLog({ held_count: 1, status: "partial" }));
    renderTab(connectedSettings({ airtable_sync_enabled: true }), { canTriggerSync: false });

    const syncNow = await screen.findByRole("button", { name: "Sync now" });
    expect(syncNow).toBeDisabled();
    // trigger_sync is independent of configure_airtable: the switch stays editable.
    expect(screen.getByRole("switch")).toBeEnabled();
  });

  it("enables Sync now when canTriggerSync is true and sync is on with a key saved", async () => {
    connect();
    mock(fetchLatestSyncLog).mockResolvedValue(syncLog({ held_count: 1, status: "partial" }));
    renderTab(connectedSettings({ airtable_sync_enabled: true }), { canTriggerSync: true });

    const syncNow = await screen.findByRole("button", { name: "Sync now" });
    await waitFor(() => expect(syncNow).toBeEnabled());
  });
});

describe("AirtableSyncTab — read-only floor", () => {
  it("shows the read-only banner and disables the Sync switch when readOnly", async () => {
    connect();
    renderTab(connectedSettings({ airtable_sync_enabled: true }), { readOnly: true });
    expect(await screen.findByText(/View only/i)).toBeInTheDocument();
    const toggle = await screen.findByRole("switch");
    expect(toggle).toBeDisabled();
    // The read floor still surfaces the real (on) value.
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("hides the Manage-connection control on the Overview tab when readOnly", async () => {
    connect();
    renderTab(connectedSettings(), { readOnly: true });
    await screen.findByText(/View only/i);
    expect(screen.queryByRole("button", { name: "Manage connection" })).not.toBeInTheDocument();
  });

  it("leaves the Sync switch enabled when readOnly is false", async () => {
    connect();
    renderTab(connectedSettings());
    expect(await screen.findByRole("switch")).toBeEnabled();
  });
});

describe("AirtableSyncTab — manage connection dialog", () => {
  it("reveals base/table controls, the schema refresh, and the sub-hour warning", async () => {
    connect();
    renderTab(connectedSettings({ airtable_poll_interval_minutes: 30 }));

    fireEvent.click(await screen.findByText("Manage connection"));
    expect(await screen.findByRole("button", { name: "Refresh from Airtable" })).toBeInTheDocument();
    expect(screen.getByText("Frequent syncs can hit Airtable limits")).toBeInTheDocument();
    expect(
      screen.getByText(/only pick a frequency under one hour if your airtable workspace is on a paid plan/i),
    ).toBeInTheDocument();
  });

  it("does not show the sub-hour warning at an hourly interval", async () => {
    connect();
    renderTab(connectedSettings({ airtable_poll_interval_minutes: 60 }));
    fireEvent.click(await screen.findByText("Manage connection"));
    await screen.findByRole("button", { name: "Refresh from Airtable" });
    expect(screen.queryByText("Frequent syncs can hit Airtable limits")).not.toBeInTheDocument();
  });
});

describe("AirtableSyncTab — attention panel", () => {
  it("surfaces 'Needs your attention' when the latest run held an unlinked program", async () => {
    connect();
    mock(fetchLatestSyncLog).mockResolvedValue(syncLog({ status: "partial", held_count: 1 }));
    mock(fetchUnresolvedRecords).mockResolvedValue([
      { id: "r1", airtable_record_id: "recHELD", reason: "program 'Murder' not linked", created_at: "2026-06-17T10:00:00Z", action: "held_unresolved" },
    ]);
    renderTab(connectedSettings());

    expect(await screen.findByText("Needs your attention")).toBeInTheDocument();
    expect(screen.getByText("1 program option has no catalog production")).toBeInTheDocument();
  });

  it("omits the 'next run at X' clause when the latest run is a manual Sheet import", async () => {
    connect();
    mock(fetchLatestSyncLog).mockResolvedValue(
      syncLog({ status: "partial", held_count: 1, sync_type: "sheet_import" }),
    );
    mock(fetchUnresolvedRecords).mockResolvedValue([
      { id: "r1", airtable_record_id: "recHELD", reason: "program 'Murder' not linked", created_at: "2026-06-17T10:00:00Z", action: "held_unresolved" },
    ]);
    renderTab(connectedSettings());

    expect(await screen.findByText("Needs your attention")).toBeInTheDocument();
    expect(screen.getByText("Resolving these releases the held records on the next import.")).toBeInTheDocument();
    expect(screen.queryByText(/on the next run at/)).not.toBeInTheDocument();
  });
});

describe("AirtableSyncTab — activity tab", () => {
  it("lists a run row from the recent-logs feed", async () => {
    connect();
    mock(fetchRecentSyncLogs).mockResolvedValue([
      syncLog({ id: "run-a", status: "partial", records_processed: 7, held_count: 2 }),
    ]);
    renderTab(connectedSettings());

    fireEvent.click(await screen.findByText("Activity"));
    expect(await screen.findByText("Run history")).toBeInTheDocument();
    // The run's status badge renders in the history table.
    expect(screen.getByText("partial")).toBeInTheDocument();
  });
});

describe("AirtableSyncTab — catalog links", () => {
  it("offers a Create / link affordance for an unlinked program option", async () => {
    connect([
      { id: "fS", name: "Sub", type: "singleSelect", options: { choices: [{ id: "c1", name: "TJE: Murder" }] } },
    ]);
    mock(fetchShowsForLinking).mockResolvedValue([]);
    renderTab(connectedSettings({ airtable_field_map: { sub_program: "Sub" } }));

    fireEvent.click(await screen.findByText("Catalog links"));
    expect(await screen.findByText("TJE: Murder")).toBeInTheDocument();
    // The per-row combobox to link to an existing show, plus an explicit Create button.
    expect(screen.getByLabelText("link or create show for TJE: Murder")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create/ })).toBeInTheDocument();
  });
});
