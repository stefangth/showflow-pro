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

function makeModel(): GetRunningModel {
  return {
    phases: [],
    doneCount: 11,
    totalCount: 11,
    canFirstOffer: true,
    complete: true,
    bookingOn: true,
    hireOrdersOn: true,
    datesWithoutCity: 0,
  };
}

function renderBoard() {
  return renderWithProviders(
    <MemoryRouter>
      <RetiredBoard model={makeModel()} orgId="org-1" />
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
});
