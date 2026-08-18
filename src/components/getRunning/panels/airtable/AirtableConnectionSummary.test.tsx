import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

// Same data-access mocking pattern as `AirtableSyncTab.test.tsx` / `AirtableConnectRail.test.tsx`
// — the summary calls the REAL `useAirtableConsole` hook, driven through these REAL
// `src/data/*` modules rather than mocked at the hook level.
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
      airtable_sync_enabled: true, airtable_base_id: "appA", airtable_table_name: "Shows",
      airtable_field_map: { date: "Termin", program: "Produktion" }, airtable_view: "Grid view",
      airtable_poll_interval_minutes: 60,
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
  fetchAirtableKeyStatus: vi.fn(() => Promise.resolve({ present: true, updatedAt: "2026-08-01T00:00:00Z" })),
  saveAirtableKey: vi.fn(() => Promise.resolve()),
  deleteAirtableKey: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/data/customFields", () => ({
  fetchCustomFieldDefs: vi.fn(() => Promise.resolve([])),
  upsertCustomFieldDef: vi.fn(() => Promise.resolve()),
  deleteCustomFieldDef: vi.fn(() => Promise.resolve()),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { AirtableConnectionSummary } from "./AirtableConnectionSummary";

function renderSummary(onEditStep = vi.fn()) {
  return {
    onEditStep,
    ...renderWithProviders(
      <AirtableConnectionSummary orgId="org-1" readOnly={false} canTriggerSync={true} onEditStep={onEditStep} />,
    ),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("AirtableConnectionSummary", () => {
  it("renders the four collapsed group rows", async () => {
    renderSummary();
    expect(await screen.findByText("Token")).toBeInTheDocument();
    expect(screen.getByText("Base and table")).toBeInTheDocument();
    expect(screen.getByText("Map fields")).toBeInTheDocument();
    expect(screen.getByText("Link catalog")).toBeInTheDocument();
  });

  it("shows the mapped-of-required count on the Map fields row", async () => {
    renderSummary();
    // requiredMappedCount counts 9 slots; the seeded field map fills 2 (date, program).
    expect(await screen.findByText("2 of 9 required")).toBeInTheDocument();
  });

  it("calls onEditStep with the right key from Replace / Change / Map sessions", async () => {
    const onEditStep = vi.fn();
    renderSummary(onEditStep);

    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Map sessions" }));

    expect(onEditStep).toHaveBeenNthCalledWith(1, "connect");
    expect(onEditStep).toHaveBeenNthCalledWith(2, "baseTable");
    expect(onEditStep).toHaveBeenNthCalledWith(3, "map");
  });

  it("hides every row affordance when readOnly", async () => {
    renderWithProviders(
      <AirtableConnectionSummary orgId="org-1" readOnly canTriggerSync={false} onEditStep={vi.fn()} />,
    );
    await screen.findByText("Token");
    expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Map sessions" })).not.toBeInTheDocument();
  });
});
