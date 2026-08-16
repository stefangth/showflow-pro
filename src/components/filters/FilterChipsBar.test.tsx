import { describe, it, expect, vi } from "vitest";
import { type ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FilterChipsBar, type FilterChipsBarProps } from "./FilterChipsBar";
import type { CustomFieldDefinition } from "@/data/customFields";
import type { CustomFilterState } from "@/lib/customFields";

// The chips' remove buttons use IconTooltip, which needs the app's global TooltipProvider.
const renderBar = (ui: ReactElement) => render(ui, { wrapper: TooltipProvider });

type Status = "open" | "partially_filled" | "fully_filled" | "cancelled" | "unconfigured";

const STATUS_OPTIONS = [
  { value: "open" as Status, label: "Open" },
  { value: "partially_filled" as Status, label: "Casting" },
  { value: "fully_filled" as Status, label: "Fully Filled" },
  { value: "cancelled" as Status, label: "Cancelled" },
  { value: "unconfigured" as Status, label: "Unconfigured" },
];

const programDef: CustomFieldDefinition = {
  id: "d1", org_id: "o", entity: "show_dates", key: "headliner", label: "Headliner",
  type: "select", source: "airtable", source_field: "Headliner",
  options: ["Carmen", "Coppelia"], filterable: true, sortable: false,
};

function baseProps(overrides: Partial<FilterChipsBarProps<Status>> = {}): FilterChipsBarProps<Status> {
  return {
    showStatus: true,
    statusValue: "all",
    statusOptions: STATUS_OPTIONS,
    onStatusChange: vi.fn(),
    showProgram: true,
    programOptions: ["Carmen", "Coppelia"],
    programs: [],
    onProgramsChange: vi.fn(),
    showTimeframe: true,
    timeframe: { from: null, to: null },
    onTimeframeChange: vi.fn(),
    filterableDefs: [programDef],
    customFilters: {},
    onCustomFilterChange: vi.fn(),
    onCustomFilterClear: vi.fn(),
    ...overrides,
  };
}

describe("FilterChipsBar", () => {
  it("renders no chips and only the Add filter control when nothing is active", () => {
    renderBar(<FilterChipsBar {...baseProps()} />);
    expect(screen.queryByTestId(/^filter-chip-/)).not.toBeInTheDocument();
    expect(screen.getByTestId("add-filter")).toBeInTheDocument();
  });

  it("renders a Status chip with the label + value and clears it via updateStatusFilter('all')", () => {
    const onStatusChange = vi.fn();
    renderBar(<FilterChipsBar {...baseProps({ statusValue: "fully_filled", onStatusChange })} />);
    const chip = screen.getByTestId("filter-chip-status");
    expect(chip).toHaveTextContent("Status: Fully Filled");
    fireEvent.click(chip.querySelector("button")!);
    expect(onStatusChange).toHaveBeenCalledWith("all");
  });

  it("renders one chip per selected program and removes only the clicked one", () => {
    const onProgramsChange = vi.fn();
    renderBar(<FilterChipsBar {...baseProps({ programs: ["Carmen", "Coppelia"], onProgramsChange })} />);
    expect(screen.getByTestId("filter-chip-program-Carmen")).toHaveTextContent("Carmen");
    expect(screen.getByTestId("filter-chip-program-Coppelia")).toHaveTextContent("Coppelia");
    fireEvent.click(screen.getByTestId("filter-chip-program-Carmen").querySelector("button")!);
    expect(onProgramsChange).toHaveBeenCalledWith(["Coppelia"]);
  });

  it("renders a Timeframe chip as a bare date range (no label prefix) and clears both bounds on remove", () => {
    const onTimeframeChange = vi.fn();
    renderBar(<FilterChipsBar {...baseProps({
      timeframe: { from: new Date("2026-08-01T00:00:00"), to: new Date("2026-08-31T00:00:00"), preset: "month" },
      onTimeframeChange,
    })} />);
    const chip = screen.getByTestId("filter-chip-timeframe");
    expect(chip).toHaveTextContent("01 Aug 2026 to 31 Aug 2026");
    fireEvent.click(chip.querySelector("button")!);
    expect(onTimeframeChange).toHaveBeenCalledWith({ from: null, to: null });
  });

  it("hides the timeframe filter entirely when showTimeframe is false, even with an active deep-linked range", () => {
    renderBar(<FilterChipsBar {...baseProps({
      showTimeframe: false,
      timeframe: { from: new Date("2026-08-01T00:00:00"), to: new Date("2026-08-31T00:00:00"), preset: "month" },
    })} />);
    expect(screen.queryByTestId("filter-chip-timeframe")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("add-filter"));
    expect(screen.queryByTestId("add-filter-option-timeframe")).not.toBeInTheDocument();
  });

  it("renders an active custom-field chip as 'Label: value' and clears it via the def-keyed callback", () => {
    const onCustomFilterClear = vi.fn();
    const customFilters: Record<string, CustomFilterState> = { "custom.headliner": { kind: "select", value: "Carmen" } };
    renderBar(<FilterChipsBar {...baseProps({ customFilters, onCustomFilterClear })} />);
    const chip = screen.getByTestId("filter-chip-custom-headliner");
    expect(chip).toHaveTextContent("Headliner: Carmen");
    fireEvent.click(chip.querySelector("button")!);
    expect(onCustomFilterClear).toHaveBeenCalledWith(programDef);
  });

  it("hides an active filter type from the Add filter menu, and lists the rest", () => {
    renderBar(<FilterChipsBar {...baseProps({ statusValue: "open" })} />);
    fireEvent.click(screen.getByTestId("add-filter"));
    expect(screen.queryByTestId("add-filter-option-status")).not.toBeInTheDocument();
    expect(screen.getByTestId("add-filter-option-program")).toBeInTheDocument();
    expect(screen.getByTestId("add-filter-option-timeframe")).toBeInTheDocument();
    expect(screen.getByTestId("add-filter-option-custom-headliner")).toBeInTheDocument();
  });

  it("respects canSee gating: a role that can't see status never gets the menu entry or a chip", () => {
    renderBar(<FilterChipsBar {...baseProps({ showStatus: false, statusValue: "open" })} />);
    expect(screen.queryByTestId("filter-chip-status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("add-filter"));
    expect(screen.queryByTestId("add-filter-option-status")).not.toBeInTheDocument();
  });

  it("picking Status from the Add filter menu sets it via onStatusChange", () => {
    const onStatusChange = vi.fn();
    renderBar(<FilterChipsBar {...baseProps({ onStatusChange })} />);
    fireEvent.click(screen.getByTestId("add-filter"));
    fireEvent.click(screen.getByTestId("add-filter-option-status"));
    fireEvent.click(screen.getByTestId("add-filter-status-fully_filled"));
    expect(onStatusChange).toHaveBeenCalledWith("fully_filled");
  });

  it("picking Program from the Add filter menu surfaces the existing ProgramFilter control", () => {
    renderBar(<FilterChipsBar {...baseProps()} />);
    fireEvent.click(screen.getByTestId("add-filter"));
    fireEvent.click(screen.getByTestId("add-filter-option-program"));
    // The real ProgramFilter component is now mounted inline (its own trigger button).
    expect(screen.getByText("All programs")).toBeInTheDocument();
  });

  it("picking the custom field from the Add filter menu surfaces its CustomFieldFilter control", () => {
    renderBar(<FilterChipsBar {...baseProps()} />);
    fireEvent.click(screen.getByTestId("add-filter"));
    fireEvent.click(screen.getByTestId("add-filter-option-custom-headliner"));
    expect(screen.getByLabelText("Headliner filter")).toBeInTheDocument();
  });
});
