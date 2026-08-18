import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

// Mock the data-access layer (never `useAirtableConsole`'s internals), same pattern as
// `AirtableSyncTab.test.tsx` — the rail calls the REAL hook, which calls these REAL
// `src/data/*` modules, so mocking them here drives the hook through its real logic
// instead of re-implementing it in the test.
vi.mock("@/data/airtableSchema", () => ({
  fetchAirtableBases: vi.fn(() => Promise.resolve({ schemaAccessible: true, bases: [] })),
  fetchAirtableTables: vi.fn(() => Promise.resolve({ schemaAccessible: true, tables: [] })),
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

import { fetchAirtableKeyStatus, saveAirtableKey } from "@/data/airtableKey";
import { fetchAirtableSettings } from "@/data/airtableSettings";
import { fetchAirtableBases } from "@/data/airtableSchema";
import { upsertOrgSetting } from "@/data/settings";
import { AirtableConnectRail, type AirtableConnectStep } from "./AirtableConnectRail";

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

function connectedSettings(over: Record<string, unknown> = {}) {
  return { ...SETUP_DEFAULTS, airtable_base_id: "appA", airtable_table_name: "Events", ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(fetchAirtableKeyStatus).mockResolvedValue({ present: false, updatedAt: null });
  mock(fetchAirtableSettings).mockResolvedValue(SETUP_DEFAULTS);
  mock(saveAirtableKey).mockResolvedValue(undefined);
});

function renderRail(props: Partial<{
  orgId: string | null; readOnly: boolean; canTriggerSync: boolean; onConnected: () => void;
  initialStep: AirtableConnectStep; onLater: () => void;
}> = {}) {
  const onConnected = props.onConnected ?? vi.fn();
  const onLater = props.onLater ?? vi.fn();
  const result = renderWithProviders(
    <AirtableConnectRail
      orgId={props.orgId ?? "org-1"}
      readOnly={props.readOnly ?? false}
      canTriggerSync={props.canTriggerSync ?? true}
      onConnected={onConnected}
      initialStep={props.initialStep}
      onLater={onLater}
    />,
  );
  return { ...result, onConnected, onLater };
}

describe("AirtableConnectRail", () => {
  it("renders four numbered steps with the setup-wizard step labels", async () => {
    renderRail();
    const nav = await screen.findByRole("list");
    for (const label of ["Connect", "Base and table", "Map fields", "Link catalog"]) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
  });

  it("starts on the connect step when no key is saved", async () => {
    renderRail();
    expect(await screen.findByRole("heading", { level: 3, name: "Personal access token" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/^pat/)).toBeInTheDocument();
  });

  it("starts on the base-and-table step once a key is present but no base/table is set", async () => {
    mock(fetchAirtableKeyStatus).mockResolvedValue({ present: true, updatedAt: "2026-06-01T00:00:00Z" });
    renderRail();
    expect(await screen.findByRole("heading", { level: 3, name: "Base and table" })).toBeInTheDocument();
  });

  it("advances from connect to base-and-table after a token save", async () => {
    renderRail();
    const input = await screen.findByPlaceholderText(/^pat/);
    fireEvent.change(input, { target: { value: "patTOKEN123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    await waitFor(() => expect(saveAirtableKey).toHaveBeenCalledWith(expect.anything(), "org-1", "patTOKEN123"));
    expect(await screen.findByRole("heading", { level: 3, name: "Base and table" })).toBeInTheDocument();
  });

  it("shows Step 1 of 4 in the footer on the connect step", async () => {
    renderRail();
    expect(await screen.findByText("Step 1 of 4")).toBeInTheDocument();
  });

  it("calls onConnected when the last step's primary (Finish) is clicked", async () => {
    mock(fetchAirtableKeyStatus).mockResolvedValue({ present: true, updatedAt: "2026-06-01T00:00:00Z" });
    mock(fetchAirtableSettings).mockResolvedValue(connectedSettings());
    const { onConnected } = renderRail({ initialStep: "catalog" });

    fireEvent.click(await screen.findByRole("button", { name: "Finish" }));
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("disables Save and continue in the connect step when readOnly", async () => {
    renderRail({ readOnly: true });
    await screen.findByPlaceholderText(/^pat/);
    expect(screen.getByRole("button", { name: "Save and continue" })).toBeDisabled();
  });

  it("calls onLater when the footer's Later button is clicked", async () => {
    const { onLater } = renderRail();
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it("labels the base-and-table step's primary Continue, not Save and continue (it already autosaves)", async () => {
    mock(fetchAirtableKeyStatus).mockResolvedValue({ present: true, updatedAt: "2026-06-01T00:00:00Z" });
    renderRail();
    await screen.findByRole("heading", { level: 3, name: "Base and table" });
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save and continue" })).not.toBeInTheDocument();
  });

  it("stays on the base-and-table step after a table is autosaved (does not auto-jump to Map fields)", async () => {
    // Regression for the screen-11 review finding: selecting a table autosaves and flips
    // hasBaseTable true, but the active step must NOT reactively advance to "map" before the
    // visitor clicks Continue (or they'd skip the optional view input on this step).
    mock(fetchAirtableKeyStatus).mockResolvedValue({ present: true, updatedAt: "2026-06-01T00:00:00Z" });
    // Force the manual-input fallback (plain base/table Inputs with onBlur autosave).
    mock(fetchAirtableBases).mockResolvedValue({ schemaAccessible: false, bases: [] });
    // Stateful settings: upsertOrgSetting mutates it, so the invalidated refetch returns the
    // saved base/table and hasBaseTable flips true — exactly the mid-step reactivity the fix guards.
    const settingsState: Record<string, unknown> = { ...SETUP_DEFAULTS };
    mock(fetchAirtableSettings).mockImplementation(() => Promise.resolve({ ...settingsState }));
    mock(upsertOrgSetting).mockImplementation((_c: unknown, _o: unknown, key: string, value: unknown) => {
      settingsState[key] = value;
      return Promise.resolve();
    });

    renderRail();
    const baseInput = await screen.findByPlaceholderText("app1234567890");
    fireEvent.blur(baseInput, { target: { value: "appManual" } });
    const tableInput = screen.getByPlaceholderText("Shows");
    fireEvent.blur(tableInput, { target: { value: "Events" } });

    // The base/table are now persisted and hasBaseTable is true; assert the rail is STILL on
    // the base-and-table step (footer "Step 2 of 4"), not auto-advanced to Map fields ("Step 3 of 4").
    await waitFor(() => expect(upsertOrgSetting).toHaveBeenCalledWith(expect.anything(), "org-1", "airtable_table_name", "Events"));
    expect(screen.getByRole("heading", { level: 3, name: "Base and table" })).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
    expect(screen.queryByText("Step 3 of 4")).not.toBeInTheDocument();
  });
});
