import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { partialMock } from "@/test/castHelpers";

import { TokenStep, BaseTableStep } from "./connectSteps";
import type { AirtableSettings } from "@/data/airtableSettings";
import type { AirtableBase, AirtableTable } from "@/data/airtableSchema";

describe("TokenStep", () => {
  it("renders the token input", async () => {
    renderWithProviders(<TokenStep value="" onChange={vi.fn()} canWrite />);
    expect(await screen.findByPlaceholderText(/^pat/)).toBeInTheDocument();
  });
});

describe("BaseTableStep", () => {
  const bases: AirtableBase[] = [{ id: "appA", name: "Base A" }];
  const tables: AirtableTable[] = [{ id: "tblA", name: "Table A", fields: [] }];
  const settings = partialMock<AirtableSettings>({ airtable_base_id: "", airtable_table_name: "", airtable_view: "" });

  it("renders the base and table selectors", async () => {
    renderWithProviders(
      <BaseTableStep
        canWrite
        keyPresent
        settings={settings}
        onSaveSettings={vi.fn()}
        schemaState="accessible"
        fallbackCause={null as unknown as never}
        isSchemaPending={false}
        refreshSchema={vi.fn()}
        bases={bases}
        tables={tables}
      />,
    );
    expect(await screen.findByText("Base")).toBeInTheDocument();
    expect(screen.getByText("Table")).toBeInTheDocument();
  });
});
