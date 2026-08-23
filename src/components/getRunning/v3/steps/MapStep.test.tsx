import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

// Mock the data-access layer (never `useAirtableConsole`'s internals), same pattern as
// `AirtableConnectRail.test.tsx` / `AirtableSyncTab.test.tsx` — `MapStep` calls the REAL
// `useAirtableConsole`, which calls these REAL `src/data/*` modules, so mocking them here
// drives the hook (and, downstream, `isDatesMapComplete`) through its real logic instead of
// re-implementing either in the test.
vi.mock("@/data/airtableSchema", () => ({
  fetchAirtableBases: vi.fn(() => Promise.resolve({ schemaAccessible: true, bases: [{ id: "base1", name: "My Base" }] })),
  fetchAirtableTables: vi.fn(() =>
    Promise.resolve({
      schemaAccessible: true,
      tables: [
        {
          id: "tbl1",
          name: "Dates",
          fields: [
            { id: "f1", name: "Date", type: "date" },
            { id: "f2", name: "Sub Program", type: "singleLineText" },
          ],
        },
      ],
    }),
  ),
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
  fetchAirtableSettings: vi.fn(),
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
  fetchAirtableKeyStatus: vi.fn(() => Promise.resolve({ present: true, updatedAt: null })),
  saveAirtableKey: vi.fn(() => Promise.resolve()),
  deleteAirtableKey: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/data/customFields", () => ({
  fetchCustomFieldDefs: vi.fn(() => Promise.resolve([])),
  upsertCustomFieldDef: vi.fn(() => Promise.resolve()),
  deleteCustomFieldDef: vi.fn(() => Promise.resolve()),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

// useCan drives the read/write gate, same controllable-boolean pattern as ConnectStep.test.tsx.
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

// useDatesSource + useSheetImport are mocked directly (not driven through a fake
// supabase client, which this suite doesn't set up at all): MapStep now branches on
// `source`, and the sheet branch needs a controllable `settings`/`parsed`/`loadSheet`,
// same reasoning as ConnectStep.test.tsx's sheet-branch mocks. Every existing
// Airtable-branch test below leaves `useDatesSource` at its default (null source), so
// they exercise the exact same code path as before this file's sheet additions.
vi.mock("@/hooks/useDatesSource", () => ({ useDatesSource: vi.fn() }));
vi.mock("@/hooks/useSheetImport", () => ({ useSheetImport: vi.fn() }));

import { useCan } from "@/hooks/useCapabilities";
import { useDatesSource } from "@/hooks/useDatesSource";
import { useSheetImport } from "@/hooks/useSheetImport";
import { fetchAirtableSettings } from "@/data/airtableSettings";
import { MapStep } from "./MapStep";

type Fn = ReturnType<typeof vi.fn>;
const mock = (f: unknown) => f as Fn;

type SheetImportMock = ReturnType<typeof useSheetImport>;

function seedSheetImport(overrides: Partial<SheetImportMock> = {}) {
  const base: SheetImportMock = {
    settings: { url: "", map: {} },
    isLoading: false,
    saveSettings: vi.fn(),
    saving: false,
    loadHeaders: vi.fn(() => Promise.resolve([])),
    loadSheet: vi.fn(() => Promise.resolve({ headers: [], rows: [] })),
    parsed: null,
    runImport: vi.fn(),
    importing: false,
    result: null,
  };
  const value = { ...base, ...overrides };
  vi.mocked(useSheetImport).mockReturnValue(value);
  return value;
}

const BASE_SETTINGS = {
  airtable_sync_enabled: true,
  airtable_base_id: "base1",
  airtable_table_name: "Dates",
  airtable_view: "Grid view",
  airtable_poll_interval_minutes: 60,
};

function seedSettings(fieldMap: Record<string, string | null>) {
  mock(fetchAirtableSettings).mockResolvedValue({ ...BASE_SETTINGS, airtable_field_map: fieldMap });
}

function renderStep(onDone = vi.fn()) {
  const result = renderWithProviders(
    <MemoryRouter>
      <MapStep orgId="org-1" onDone={onDone} />
    </MemoryRouter>,
  );
  return { ...result, onDone };
}

describe("MapStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCan).mockReturnValue(true);
    vi.mocked(useDatesSource).mockReturnValue({ source: null, isLoading: false, save: vi.fn(), saving: false });
    seedSheetImport();
  });

  it("renders the mapping table and keeps Continue disabled while a required field (sub_program) is unmapped", async () => {
    seedSettings({ date: "Date" });
    renderStep();

    expect(await screen.findByText("Dates")).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
    expect(screen.getByLabelText("Sub-program")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    expect(screen.getByText(/map the date and sub-program fields/i)).toBeInTheDocument();
  });

  it("enables Continue and calls onDone once date + sub_program are both mapped, even with every other field left unmapped", async () => {
    seedSettings({ date: "Date", sub_program: "Sub Program" });
    const { onDone } = renderStep();

    const continueBtn = screen.getByRole("button", { name: /continue/i });
    await waitFor(() => expect(continueBtn).toBeEnabled());
    fireEvent.click(continueBtn);

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("renders the slots-fold callout with a link to the Productions step", async () => {
    seedSettings({ date: "Date", sub_program: "Sub Program" });
    renderStep();

    await screen.findByText("Dates");
    const link = screen.getByRole("link", { name: /productions/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toMatch(/\/productions/);
  });

  it("is read only (mapping selects disabled) for a viewer without configure_airtable", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    seedSettings({ date: "Date", sub_program: "Sub Program" });
    renderStep();

    expect(await screen.findByLabelText("Date")).toBeDisabled();
  });

  describe("sheet source", () => {
    beforeEach(() => {
      vi.mocked(useDatesSource).mockReturnValue({ source: "sheet", isLoading: false, save: vi.fn(), saving: false });
    });

    it("prompts to go back to Connect when no sheet URL is saved yet", async () => {
      seedSheetImport({ settings: { url: "", map: {} } });
      renderStep();

      expect(await screen.findByText(/go back to connect/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    });

    it("loads headers on mount when a URL is saved but nothing is cached, then renders the mapping selects", async () => {
      const loadSheet = vi.fn(() => Promise.resolve({ headers: ["Program", "Date", "City"], rows: [] }));
      seedSheetImport({ settings: { url: "https://docs.google.com/spreadsheets/d/x", map: {} }, loadSheet });
      renderStep();

      await waitFor(() => expect(loadSheet).toHaveBeenCalledWith("https://docs.google.com/spreadsheets/d/x"));
    });

    it("renders the mapping selects from cached headers and keeps Continue disabled until program + date are mapped", async () => {
      seedSheetImport({
        settings: { url: "https://docs.google.com/spreadsheets/d/x", map: {} },
        parsed: { headers: ["Program", "Date", "City"], rows: [] },
      });
      renderStep();

      expect(await screen.findByLabelText("Production")).toBeInTheDocument();
      expect(screen.getByLabelText("Date")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
      expect(screen.getByText(/map the production and date columns/i)).toBeInTheDocument();
    });

    it("enables Continue and calls onDone once program + date are both mapped via saveSettings", async () => {
      const saveSettings = vi.fn();
      seedSheetImport({
        settings: { url: "https://docs.google.com/spreadsheets/d/x", map: { program: "Program", date: "Date" } },
        parsed: { headers: ["Program", "Date", "City"], rows: [] },
        saveSettings,
      });
      const { onDone } = renderStep();

      const continueBtn = await screen.findByRole("button", { name: /continue/i });
      expect(continueBtn).toBeEnabled();
      fireEvent.click(continueBtn);
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("is read only (mapping selects disabled) for a viewer without configure_airtable", async () => {
      vi.mocked(useCan).mockReturnValue(false);
      seedSheetImport({
        settings: { url: "https://docs.google.com/spreadsheets/d/x", map: { program: "Program", date: "Date" } },
        parsed: { headers: ["Program", "Date", "City"], rows: [] },
      });
      renderStep();

      expect(await screen.findByLabelText("Production")).toBeDisabled();
    });
  });
});
