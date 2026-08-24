import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { RetiredBoard } from "./RetiredBoard";
import type { GetRunningModel } from "@/lib/getRunning/tasks";

const dismissFn = vi.fn();
vi.mock("@/components/setup/useRailDismissed", () => ({
  useRailDismissed: () => [false, dismissFn, vi.fn()],
}));

function makeModel(over: Partial<GetRunningModel> = {}): GetRunningModel {
  return {
    phases: [],
    doneCount: 11,
    totalCount: 11,
    canFirstOffer: true,
    complete: true,
    bookingOn: true,
    hireOrdersOn: true,
    datesWithoutCity: 0,
    datesWithoutCityUnknown: false,
    ...over,
  };
}

function renderBoard(over: Partial<GetRunningModel> = {}) {
  return renderWithProviders(
    <MemoryRouter>
      <RetiredBoard model={makeModel(over)} orgId="org-1" />
    </MemoryRouter>,
  );
}

describe("RetiredBoard", () => {
  it("shows the running summary and progress count", () => {
    renderBoard();
    expect(screen.getByText("This workspace is running")).toBeInTheDocument();
    expect(screen.getByText("11 of 11")).toBeInTheDocument();
  });

  it("links How this org works to the Settings reference tab", () => {
    renderBoard();
    const link = screen.getByRole("link", { name: "How this org works" });
    expect(link).toHaveAttribute("href", "/settings?tab=how-it-works");
  });

  it("Hide from nav dismisses the getRunning rail", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Hide from nav" }));
    expect(dismissFn).toHaveBeenCalled();
  });

  it("renders both info cards", () => {
    renderBoard();
    expect(screen.getByText("Where it goes")).toBeInTheDocument();
    expect(screen.getByText("When it comes back")).toBeInTheDocument();
  });

  it("keeps the null-city advisory visible after retirement (with a /dates link)", () => {
    // A retired board can still have a stray city-less date; the advisory must not go dark.
    renderBoard({ datesWithoutCity: 2 });
    expect(screen.getByText(/2 dates have no city yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Fix on Dates/i })).toHaveAttribute("href", "/dates");
  });

  it("omits the advisory when every date has a city", () => {
    renderBoard({ datesWithoutCity: 0 });
    expect(screen.queryByText(/no city yet/i)).not.toBeInTheDocument();
  });

  // Same fail-open as the header: an unreadable count rendered as silence, which reads as
  // "nothing is missing" exactly when setup otherwise says it is done.
  it("says the count is unknown, rather than nothing, when the read failed", () => {
    renderBoard({ datesWithoutCity: 0, datesWithoutCityUnknown: true });
    expect(screen.getByText(/could not check which dates still need a city/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 dates have no city/i)).toBeNull();
  });
});
