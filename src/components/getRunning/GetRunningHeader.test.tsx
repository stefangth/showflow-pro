import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { GetRunningHeader } from "./GetRunningHeader";
import type { GetRunningModel } from "@/lib/getRunning/tasks";

function makeModel(overrides: Partial<GetRunningModel> = {}): GetRunningModel {
  return {
    phases: [],
    doneCount: 3,
    totalCount: 11,
    canFirstOffer: false,
    complete: false,
    bookingOn: true,
    hireOrdersOn: true,
    ...overrides,
  };
}

describe("GetRunningHeader", () => {
  it("renders the progress card counts, tick segments, and module list", () => {
    renderWithProviders(<GetRunningHeader model={makeModel()} orgName="Nordstadt Produktionen" />);

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("of 11 done")).toBeInTheDocument();
    expect(screen.getAllByTestId("get-running-tick")).toHaveLength(11);
    expect(screen.getByText("Booking engine")).toBeInTheDocument();
    expect(screen.getByText("Hire orders")).toBeInTheDocument();
    expect(screen.getAllByText("On")).toHaveLength(2);
  });

  it("fills the first doneCount ticks and leaves the rest empty", () => {
    renderWithProviders(<GetRunningHeader model={makeModel()} orgName="Nordstadt Produktionen" />);
    const ticks = screen.getAllByTestId("get-running-tick");
    expect(ticks.slice(0, 3).every((t) => t.getAttribute("data-filled") === "true")).toBe(true);
    expect(ticks.slice(3).every((t) => t.getAttribute("data-filled") === "false")).toBe(true);
  });

  it("shows Off for a disabled module", () => {
    renderWithProviders(
      <GetRunningHeader model={makeModel({ hireOrdersOn: false })} orgName="Nordstadt Produktionen" />,
    );
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("renders the eyebrow with the org name and the footer note", () => {
    renderWithProviders(<GetRunningHeader model={makeModel()} orgName="Nordstadt Produktionen" />);
    expect(screen.getByText(/Nordstadt Produktionen · get running/)).toBeInTheDocument();
    expect(screen.getByText("Modules are switched on by your account manager.")).toBeInTheDocument();
  });
});
