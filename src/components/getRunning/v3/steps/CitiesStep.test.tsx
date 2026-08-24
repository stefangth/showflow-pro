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
// The step now also reads the org's future, non-cancelled dates that carry no city (the
// manual/sheet paths never produce Airtable `cityRows`, so that read is what makes the step
// able to clear its own block). Mocked at the data-access layer, same rule as the Airtable
// modules above: the REAL `useDatesMissingCity`/`useUpdateShowDate` hooks run.
vi.mock("@/data/showDates", () => ({
  fetchUpcomingDatesWithoutCity: vi.fn(() => Promise.resolve([])),
  createShowDate: vi.fn(),
  updateShowDate: vi.fn(() => Promise.resolve()),
  cancelShowDate: vi.fn(),
  deleteShowDate: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

// useCan drives the read/write gate, same controllable-boolean pattern as MapStep.test.tsx.
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

// useDatesSource + useSheetImport are mocked directly, same reasoning as
// MapStep.test.tsx's sheet-branch mocks: CitiesStep now branches on `source`, and the
// sheet branch needs a controllable `settings`/`parsed`/`result`/`runImport`. Every
// existing Airtable-branch test below leaves `useDatesSource` at its default (null
// source), so they exercise the exact same code path as before this file's sheet
// additions.
vi.mock("@/hooks/useDatesSource", () => ({ useDatesSource: vi.fn() }));
vi.mock("@/hooks/useSheetImport", () => ({ useSheetImport: vi.fn() }));

import { useCan } from "@/hooks/useCapabilities";
import { useDatesSource } from "@/hooks/useDatesSource";
import { useSheetImport } from "@/hooks/useSheetImport";
import { fetchAirtableSettings } from "@/data/airtableSettings";
import { fetchCitiesForLinking, importCitiesFromOptions } from "@/data/cities";
import { fetchUpcomingDatesWithoutCity, updateShowDate } from "@/data/showDates";
import { CitiesStep } from "./CitiesStep";

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
    importError: null,
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

function seedSettings() {
  mock(fetchAirtableSettings).mockResolvedValue({ ...BASE_SETTINGS, airtable_field_map: { date: "Date", city: "City" } });
}

const TEST_ORG = { id: "org-1", name: "Org", suspended_at: null } as never;

/** `hasAnyDates` reaches the step as a prop (from `BookingSetupStatus`), so the seed is a
 *  plain variable read at render time rather than another mocked module. */
let dateCount = 1;
function seedDateCount(n: number) {
  dateCount = n;
}
/** The booking-status read having FAILED (as opposed to still loading), which reaches the
 *  step as `hasAnyDates = null` + `statusError = true`. */
let statusError = false;
function seedStatusError(failed: boolean) {
  statusError = failed;
}

type MissingCityRow = { id: string; date: string; venue?: string | null; program?: string };
function seedDatesWithoutCity(rows: MissingCityRow[]) {
  mock(fetchUpcomingDatesWithoutCity).mockResolvedValue(
    rows.map((r) => ({
      id: r.id,
      date: r.date,
      venue: r.venue ?? null,
      show: { program: r.program ?? "Hamlet", sub_program: null },
    })),
  );
}

function renderStep(onDone = vi.fn()) {
  const result = renderWithProviders(
    <MemoryRouter>
      <CitiesStep
        orgId="org-1"
        onDone={onDone}
        hasAnyDates={statusError ? null : dateCount > 0}
        statusError={statusError}
      />
    </MemoryRouter>,
    { authOverrides: { currentOrg: TEST_ORG } },
  );
  return { ...result, onDone };
}

describe("CitiesStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCan).mockReturnValue(true);
    vi.mocked(useDatesSource).mockReturnValue({ source: null, isLoading: false, save: vi.fn(), saving: false });
    seedSheetImport();
    mock(fetchCitiesForLinking).mockResolvedValue([]);
    seedDateCount(1);
    seedStatusError(false);
    seedDatesWithoutCity([]);
  });

  describe("dates that have no city", () => {
    it("lists dates that have no city instead of claiming there is nothing to resolve", async () => {
      seedDatesWithoutCity([{ id: "d1", date: "2026-09-04", venue: "Stadthalle" }]);
      renderStep();

      expect(await screen.findByText(/stadthalle/i)).toBeInTheDocument();
      expect(screen.queryByText(/no cities to resolve yet/i)).not.toBeInTheDocument();
    });

    it("keeps Continue disabled while a date still has no city", async () => {
      seedDatesWithoutCity([{ id: "d1", date: "2026-09-04", venue: "Stadthalle" }]);
      renderStep();

      await screen.findByText(/stadthalle/i);
      expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    });

    it("writes the picked city through updateShowDate", async () => {
      seedDatesWithoutCity([{ id: "d1", date: "2026-09-04", venue: "Stadthalle" }]);
      mock(fetchCitiesForLinking).mockResolvedValue([{ id: "c1", name: "Berlin", airtable_city_key: null }]);
      renderStep();

      await screen.findByText(/stadthalle/i);
      fireEvent.click(screen.getByRole("combobox"));
      fireEvent.click(await screen.findByRole("option", { name: "Berlin" }));

      await waitFor(() => expect(mock(updateShowDate)).toHaveBeenCalled());
      const [, id, patch] = mock(updateShowDate).mock.calls[0];
      expect(id).toBe("d1");
      expect(patch).toEqual({ city_id: "c1" });
    });

    // Both reads fail CLOSED. A failed missing-city read reports 0 unresolved dates and a
    // failed date-count read reports "no dates", so believing either restores the dead end
    // this step exists to close: Continue enabled over a block that is still standing.
    it("shows an error (not the resolved note) and keeps Continue disabled when the dates read fails", async () => {
      mock(fetchUpcomingDatesWithoutCity).mockRejectedValue(new Error("boom"));
      renderStep();

      expect(await screen.findByText(/could not check which dates/i)).toBeInTheDocument();
      expect(screen.queryByText(/no cities to resolve yet/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    });

    it("shows an error (not a no-dates state) and keeps Continue disabled when the date-count read fails", async () => {
      seedStatusError(true);
      renderStep();

      expect(await screen.findByText(/could not check which dates/i)).toBeInTheDocument();
      expect(screen.queryByText(/no dates yet/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    });

    // An Airtable org reaches "dates with no city" routinely (airtable-poll only HOLDS a
    // record when the city field is mapped, non-empty and unlinkable), and resolving those
    // rows needs catalog cities to exist. Hiding the catalog would strand the org, since
    // Continue requires both the rows resolved AND every imported cityRow linked.
    it("renders the imported-city catalog beneath the row list, not instead of it", async () => {
      seedSettings();
      seedDatesWithoutCity([{ id: "d1", date: "2026-09-04", venue: "Stadthalle" }]);
      renderStep();

      expect(await screen.findByText(/stadthalle/i)).toBeInTheDocument();
      expect(screen.getByText("Berlin")).toBeInTheDocument();
      expect(screen.getByText("Munich")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    });

    it("shows a no-dates state, not a resolved state, when the org has no dates", async () => {
      seedDatesWithoutCity([]);
      seedDateCount(0);
      renderStep();

      expect(await screen.findByText(/no dates yet/i)).toBeInTheDocument();
      expect(screen.queryByText(/no cities to resolve yet/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    });
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

  // Fix #2 (correctness): while the console's own queries (key-status, settings) are still
  // in flight, the step must not render the "no cities" empty state with Continue already
  // enabled — that would let a visitor click through before real unresolved Airtable cities
  // have had a chance to appear. It should show a loading placeholder instead, Continue
  // disabled, until the console reports `ready`.
  it("shows a loading state (not the empty state) and keeps Continue disabled while the console is still loading", async () => {
    let resolveSettings!: (value: typeof BASE_SETTINGS & { airtable_field_map: Record<string, string> }) => void;
    mock(fetchAirtableSettings).mockReturnValue(
      new Promise((resolve) => {
        resolveSettings = resolve;
      }),
    );

    renderStep();

    // Still loading: neither the empty state nor the resolved catalog has rendered, and
    // Continue must not be clickable yet.
    expect(screen.queryByText(/no cities to resolve yet/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    resolveSettings({ ...BASE_SETTINGS, airtable_field_map: { date: "Date" } });

    expect(await screen.findByText(/no cities to resolve yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
  });

  it("is read only (link/create controls disabled) for a viewer without configure_airtable", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    seedSettings();
    renderStep();

    await screen.findByText("Berlin");
    const createButtons = screen.getAllByRole("button", { name: /^create$/i });
    for (const btn of createButtons) expect(btn).toBeDisabled();
  });

  describe("sheet source", () => {
    beforeEach(() => {
      vi.mocked(useDatesSource).mockReturnValue({ source: "sheet", isLoading: false, save: vi.fn(), saving: false });
    });

    it("shows the Import dates now action and keeps Continue disabled before any import has run", async () => {
      seedSheetImport({ settings: { url: "https://docs.google.com/spreadsheets/d/x", map: { program: "Program", date: "Date" } } });
      renderStep();

      expect(await screen.findByRole("button", { name: /import dates now/i })).toBeEnabled();
      expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
      expect(screen.getByText(/nothing imported yet/i)).toBeInTheDocument();
    });

    it("clicking Import dates now maps the cached parsed sheet and runs the import", async () => {
      const runImport = vi.fn();
      seedSheetImport({
        settings: { url: "https://docs.google.com/spreadsheets/d/x", map: { program: "Program", date: "Date" } },
        parsed: { headers: ["Program", "Date"], rows: [{ Program: "ShowA", Date: "2026-01-01" }] },
        runImport,
      });
      renderStep();

      fireEvent.click(await screen.findByRole("button", { name: /import dates now/i }));

      await waitFor(() => expect(runImport).toHaveBeenCalledTimes(1));
      const rows = runImport.mock.calls[0][0];
      expect(rows).toEqual([
        expect.objectContaining({ program: "ShowA", date: "2026-01-01", rowIndex: 1 }),
      ]);
    });

    it("shows the result KPIs and enables Continue once new dates or updates landed", async () => {
      seedSheetImport({
        settings: { url: "https://docs.google.com/spreadsheets/d/x", map: { program: "Program", date: "Date" } },
        result: { processed: 2, new_dates: 1, updated: 1, held: 0, tiers_opened: 1 },
      });
      const { onDone } = renderStep();

      expect(await screen.findByText("2")).toBeInTheDocument();
      const continueBtn = screen.getByRole("button", { name: /continue/i });
      expect(continueBtn).toBeEnabled();
      fireEvent.click(continueBtn);
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("keeps Continue disabled and shows the held note when a run held every row", async () => {
      seedSheetImport({
        settings: { url: "https://docs.google.com/spreadsheets/d/x", map: { program: "Program", date: "Date" } },
        result: { processed: 2, new_dates: 0, updated: 0, held: 2, tiers_opened: 0 },
      });
      renderStep();

      expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
      expect(await screen.findByText(/held rows need a city, date, or production/i)).toBeInTheDocument();
      const link = screen.getByRole("link", { name: /settings/i });
      expect(link.getAttribute("href")).toMatch(/\/settings/);
    });

    it("shows an error note (and no notYet placeholder) when runImport's mutation has failed", async () => {
      seedSheetImport({
        settings: { url: "https://docs.google.com/spreadsheets/d/x", map: { program: "Program", date: "Date" } },
        importError: new Error("boom"),
      });
      renderStep();

      expect(await screen.findByText(/import failed/i)).toBeInTheDocument();
      expect(screen.queryByText(/nothing imported yet/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    });

    it("is read only (Import button disabled) for a viewer without configure_airtable", async () => {
      vi.mocked(useCan).mockReturnValue(false);
      seedSheetImport({ settings: { url: "https://docs.google.com/spreadsheets/d/x", map: { program: "Program", date: "Date" } } });
      renderStep();

      // The sheet import trigger is gated on `configure_airtable` too (mirrors the
      // Airtable branch's canWrite-disabled controls): capability, not just map
      // completeness, decides whether the action is enabled.
      expect(await screen.findByRole("button", { name: /import dates now/i })).toBeDisabled();
    });
  });
});
