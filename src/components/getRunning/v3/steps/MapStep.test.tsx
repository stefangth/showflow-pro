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

import { useCan } from "@/hooks/useCapabilities";
import { fetchAirtableSettings } from "@/data/airtableSettings";
import { MapStep } from "./MapStep";

type Fn = ReturnType<typeof vi.fn>;
const mock = (f: unknown) => f as Fn;

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

    await waitFor(() => expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

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
});
