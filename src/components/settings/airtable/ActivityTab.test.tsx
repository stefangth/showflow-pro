import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ActivityTab } from "./ActivityTab";
import type { SyncLogSummary } from "@/data/airtableSync";

function makeRun(over: Partial<SyncLogSummary> = {}): SyncLogSummary {
  return {
    id: "log-1",
    sync_type: "airtable_poll",
    status: "success",
    records_processed: 10,
    imported_count: 8,
    new_count: 3,
    updated_count: 5,
    held_count: 0,
    error_details: null,
    synced_at: "2026-08-14T09:12:00.000Z",
    ...over,
  };
}

describe("ActivityTab", () => {
  it("renders an empty state when there are no runs", () => {
    renderWithProviders(<ActivityTab runs={[]} />);
    expect(screen.getByText("No runs yet.")).toBeInTheDocument();
  });

  it("tags each run with its source, distinguishing Airtable polls from Sheet imports", () => {
    const runs = [
      makeRun({ id: "log-airtable", sync_type: "airtable_poll" }),
      makeRun({ id: "log-sheet", sync_type: "sheet_import" }),
    ];
    renderWithProviders(<ActivityTab runs={runs} />);
    expect(screen.getByText("Airtable")).toBeInTheDocument();
    expect(screen.getByText("Sheet")).toBeInTheDocument();
  });
});
