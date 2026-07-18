import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RangeStep } from "./RangeStep";
import type { SheetRange } from "@/lib/hireOrderImport/rangeSelection";
import type { RawSheet } from "@/lib/artistImport/parseSheet";

function sheetWithRows(rowCount: number): RawSheet {
  const rows: string[][] = [["Name"]];
  for (let i = 1; i <= rowCount; i++) rows.push([`Row ${i}`]);
  return { name: "Sheet1", rows };
}

/** RangeStep is a controlled component (range/onRangeChange) — this harness
 *  closes the loop with local state so a real re-render happens on each edit,
 *  same as it would inside HireOrderImportDialog. */
function Harness({ sheets, initialRange }: { sheets: RawSheet[]; initialRange: SheetRange }) {
  const [range, setRange] = useState<SheetRange>(initialRange);
  return (
    <RangeStep sheets={sheets} sheetIndex={0} onSheetIndexChange={() => {}} range={range} onRangeChange={setRange} />
  );
}

describe("RangeStep picked-row entry", () => {
  it("reaches rows beyond the 200-row preview cap by number", () => {
    const sheets = [sheetWithRows(250)];
    render(<Harness sheets={sheets} initialRange={{ headerRow: 1, mode: "picked", picked: [] }} />);

    expect(screen.getByText(/0 rows selected/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/add rows by number/i), { target: { value: "205, 210-212" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    // Row 205 and 210-212 are past the 200-row rendered preview, so this can
    // only have worked through the parsed row-number entry, not a checkbox.
    expect(screen.getByText(/4 rows selected/)).toBeInTheDocument();
  });

  it("unions newly added rows with existing picks instead of replacing them", () => {
    const sheets = [sheetWithRows(10)];
    render(<Harness sheets={sheets} initialRange={{ headerRow: 1, mode: "picked", picked: [2] }} />);

    expect(screen.getByText(/1 row selected/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/add rows by number/i), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    expect(screen.getByText(/2 rows selected/)).toBeInTheDocument();
    // The originally-picked row 2's checkbox (inside the preview) stays checked.
    expect(screen.getByRole("checkbox", { name: /include row 2/i })).toBeChecked();
  });
});
