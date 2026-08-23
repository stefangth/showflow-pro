import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

// Mock the data-access layer (never `useAirtableConsole`'s internals), same pattern as
// `MapStep.test.tsx` / `AirtableConnectRail.test.tsx` — `CitiesStep` calls the REAL
// `useAirtableConsole`, which calls these REAL `src/data/*` modules, so mocking them here
// drives the hook (and, downstream, `cityRows`) through its real derivation logic instead of
// re-implementing it in the test.
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
            {
              id: "f2",
              name: "City",
              type: "singleSelect",
              options: { choices: [{ name: "Berlin" }, { name: "Munich" }] },
            },
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
  importCitiesFromOptions: vi.fn(() => Promise.resolve()),
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

// useCan drives the read/write gate, same controllable-boolean pattern as MapStep.test.tsx.
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

import { useCan } from "@/hooks/useCapabilities";
import { fetchAirtableSettings } from "@/data/airtableSettings";
import { fetchCitiesForLinking, importCitiesFromOptions } from "@/data/cities";
import { CitiesStep } from "./CitiesStep";

type Fn = ReturnType<typeof vi.fn>;
const mock = (f: unknown) => f as Fn;

const BASE_SETTINGS = {
  airtable_sync_enabled: true,
  airtable_base_id: "base1",
  airtable_table_name: "Dates",
  airtable_view: "Grid view",
  airtable_poll_interval_minutes: 60,
};

function seedSettings() {
  mock(fetchAirtableSettings).mockResolvedValue({ ...BASE_SETTINGS, airtable_field_map: { date: "Date", city: "City" } });
}

function renderStep(onDone = vi.fn()) {
  const result = renderWithProviders(
    <MemoryRouter>
      <CitiesStep orgId="org-1" onDone={onDone} />
    </MemoryRouter>,
  );
  return { ...result, onDone };
}

describe("CitiesStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCan).mockReturnValue(true);
    mock(fetchCitiesForLinking).mockResolvedValue([]);
  });

  it("renders both unlinked cities with link/create controls and keeps Continue disabled", async () => {
    seedSettings();
    renderStep();

    // Coarse, name-free wait: the Berlin row has rendered before we do any name-scoped query.
    await screen.findByText("Berlin");

    expect(screen.getByText("Munich")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    expect(screen.getByText(/link or create every city/i)).toBeInTheDocument();
  });

  it("selecting every unresolved city and clicking the bulk-create button calls onBulkCreate for both", async () => {
    seedSettings();
    renderStep();

    await screen.findByText("Berlin");

    const selectButtons = screen.getAllByRole("button", { name: /^select /i });
    expect(selectButtons).toHaveLength(2);
    fireEvent.click(selectButtons[0]);
    fireEvent.click(selectButtons[1]);

    const bulkButton = await screen.findByRole("button", { name: /^create 2$/i });
    fireEvent.click(bulkButton);

    await waitFor(() => {
      expect(mock(importCitiesFromOptions)).toHaveBeenCalled();
    });
    const [, , toCreate] = mock(importCitiesFromOptions).mock.calls[0];
    const names = (toCreate as Array<{ name: string }>).map((row) => row.name).sort();
    expect(names).toEqual(["Berlin", "Munich"]);
  });

  it("shows the empty state with a manage-cities link and enables Continue when there are no city rows to resolve", async () => {
    mock(fetchAirtableSettings).mockResolvedValue({ ...BASE_SETTINGS, airtable_field_map: { date: "Date" } });
    const { onDone } = renderStep();

    expect(await screen.findByText(/no cities to resolve yet/i)).toBeInTheDocument();
    const continueBtn = screen.getByRole("button", { name: /continue/i });
    expect(continueBtn).toBeEnabled();
    const link = screen.getByRole("link", { name: /settings/i });
    expect(link.getAttribute("href")).toMatch(/\/settings/);

    fireEvent.click(continueBtn);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("is read only (link/create controls disabled) for a viewer without configure_airtable", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    seedSettings();
    renderStep();

    await screen.findByText("Berlin");
    const createButtons = screen.getAllByRole("button", { name: /^create$/i });
    for (const btn of createButtons) expect(btn).toBeDisabled();
  });
});
