import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

// Same data-access mocking pattern as `AirtableConnectRail.test.tsx` /
// `AirtableConnectionSummary.test.tsx` — `AirtableConnect` calls the REAL
// `useAirtableConsole` hook (both directly, to decide rail-vs-summary, and again inside
// whichever child it renders), which calls these REAL `src/data/*` modules.
vi.mock("@/data/airtableSchema", () => ({
  fetchAirtableBases: vi.fn(() => Promise.resolve({ schemaAccessible: true, bases: [{ id: "appA", name: "Spielplan 2026" }] })),
  fetchAirtableTables: vi.fn(() => Promise.resolve({ schemaAccessible: true, tables: [{ id: "tbl1", name: "Shows", fields: [] }] })),
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
  triggerAirtableSyncNow: vi.fn(),
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

import { fetchAirtableBases } from "@/data/airtableSchema";
import { fetchAirtableKeyStatus } from "@/data/airtableKey";
import { fetchAirtableSettings } from "@/data/airtableSettings";
import { AirtableConnect } from "./AirtableConnect";

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
  return { ...SETUP_DEFAULTS, airtable_base_id: "appA", airtable_table_name: "Shows", ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(fetchAirtableKeyStatus).mockResolvedValue({ present: false, updatedAt: null });
  mock(fetchAirtableSettings).mockResolvedValue(SETUP_DEFAULTS);
  mock(fetchAirtableBases).mockResolvedValue({ schemaAccessible: true, bases: [{ id: "appA", name: "Spielplan 2026" }] });
});

function renderConnect(onLater = vi.fn()) {
  return {
    onLater,
    ...renderWithProviders(<AirtableConnect orgId="org-1" readOnly={false} canTriggerSync={true} onLater={onLater} />),
  };
}

describe("AirtableConnect (screen 11, final-review fix: linear rail walk)", () => {
  it("an already-connected org renders the collapsed summary", async () => {
    mock(fetchAirtableKeyStatus).mockResolvedValue({ present: true, updatedAt: "2026-06-01T00:00:00Z" });
    mock(fetchAirtableSettings).mockResolvedValue(connectedSettings());

    renderConnect();

    // Summary chrome, keyed by its distinct h2 (rail's is "Connect a base in four steps").
    expect(await screen.findByRole("heading", { level: 2, name: "Connect Airtable" })).toBeInTheDocument();
    expect(screen.getByText("Token")).toBeInTheDocument();
    expect(screen.getByText("Map fields")).toBeInTheDocument();
    // Rail-only chrome must not have mounted.
    expect(screen.queryByRole("heading", { level: 3, name: "Personal access token" })).not.toBeInTheDocument();
  });

  it("a disconnected org renders the rail and stays on it through the linear walk — the base/table step's autosave does not collapse to the summary mid-walk", async () => {
    // Key already saved (step 1 done), but no base/table yet, and the Airtable schema
    // isn't readable (no `schema.bases:read` scope) — this puts step 2 into its "fallback"
    // manual-entry mode (plain <Input>s, saved onBlur) rather than the schema-driven
    // <Select>s, which is easier to drive deterministically in jsdom while exercising the
    // exact same `onSaveSettings` autosave path the bug was in.
    mock(fetchAirtableKeyStatus).mockResolvedValue({ present: true, updatedAt: "2026-06-01T00:00:00Z" });
    mock(fetchAirtableBases).mockResolvedValue({ schemaAccessible: false, bases: [] });

    renderConnect();

    expect(await screen.findByRole("heading", { level: 2, name: "Connect a base in four steps" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 3, name: "Base and table" })).toBeInTheDocument();

    const baseIdInput = screen.getByPlaceholderText("app1234567890");
    fireEvent.change(baseIdInput, { target: { value: "appA" } });
    fireEvent.blur(baseIdInput);

    // Base alone isn't `hasBaseTable` yet — still the rail, still on step 2.
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Connect a base in four steps" })).toBeInTheDocument());

    const tableNameInput = await screen.findByPlaceholderText("Shows");
    fireEvent.change(tableNameInput, { target: { value: "Shows" } });
    fireEvent.blur(tableNameInput);

    // `hasBaseTable` is now true (base + table both set) — before this fix, `AirtableConnect`
    // re-derived `connected` on every render and collapsed straight to the summary here,
    // skipping steps 3 (Map fields) and 4 (Link catalog). The latched mode keeps it on the rail.
    await waitFor(() => {
      expect(screen.queryByRole("heading", { level: 2, name: "Connect Airtable" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { level: 2, name: "Connect a base in four steps" })).toBeInTheDocument();
  });
});
