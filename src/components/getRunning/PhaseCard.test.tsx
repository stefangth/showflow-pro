import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { PhaseCard } from "./PhaseCard";
import type { GetRunningPhase, GetRunningTask } from "@/lib/getRunning/tasks";

function task(overrides: Partial<GetRunningTask> & Pick<GetRunningTask, "key" | "phase">): GetRunningTask {
  return {
    done: false,
    block: null,
    adminOnly: false,
    actionableByViewer: true,
    ...overrides,
  };
}

function makeBookablePhase(): GetRunningPhase {
  return {
    key: "bookable",
    tasks: [
      task({ key: "flow", phase: "bookable", done: true }),
      task({ key: "people", phase: "bookable", done: false, block: "booking" }),
      task({ key: "ladder", phase: "bookable", done: false, block: "offers" }),
      task({ key: "eligibility", phase: "bookable", done: true }),
      task({ key: "timing", phase: "bookable", done: false }),
      task({ key: "team", phase: "bookable", done: false, adminOnly: true }),
    ],
  };
}

describe("PhaseCard", () => {
  it("renders the bookable phase title and the blocking-first-offer status badge", () => {
    renderWithProviders(<PhaseCard phase={makeBookablePhase()} role="admin" onOpenTask={vi.fn()} />);

    expect(screen.getByText("Make it bookable")).toBeInTheDocument();
    expect(screen.getByText("Blocks your first offer")).toBeInTheDocument();
  });

  it("renders the amber blocking chip on the undone-and-blocking people task", () => {
    renderWithProviders(<PhaseCard phase={makeBookablePhase()} role="admin" onOpenTask={vi.fn()} />);

    const row = screen.getByTestId("task-row-people");
    expect(within(row).getByText("Blocks booking")).toBeInTheDocument();
  });

  it("renders the amber blocking chip for an offers-blocking task", () => {
    renderWithProviders(<PhaseCard phase={makeBookablePhase()} role="admin" onOpenTask={vi.fn()} />);

    const row = screen.getByTestId("task-row-ladder");
    expect(within(row).getByText("Blocks offers")).toBeInTheDocument();
  });

  it("calls onOpenTask('people') when the blocking task's button is clicked", () => {
    const onOpenTask = vi.fn();
    renderWithProviders(<PhaseCard phase={makeBookablePhase()} role="admin" onOpenTask={onOpenTask} />);

    const row = screen.getByTestId("task-row-people");
    fireEvent.click(within(row).getByRole("button"));

    expect(onOpenTask).toHaveBeenCalledWith("people");
  });

  it("renders the admin-only chip on the team task", () => {
    renderWithProviders(<PhaseCard phase={makeBookablePhase()} role="admin" onOpenTask={vi.fn()} />);

    const row = screen.getByTestId("task-row-team");
    expect(within(row).getByText("Admin only")).toBeInTheDocument();
  });

  it("renders the get_dates phase as a running summary row with both sub-checks", () => {
    const phase: GetRunningPhase = {
      key: "get_dates",
      tasks: [
        task({ key: "dates", phase: "get_dates", done: true }),
        task({ key: "slots", phase: "get_dates", done: true, block: "filling" }),
      ],
    };
    renderWithProviders(<PhaseCard phase={phase} role="admin" onOpenTask={vi.fn()} />);

    expect(screen.getByText("Get dates in")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Shows in, from Airtable, hourly")).toBeInTheDocument();
    expect(screen.getByText("Slots set on every show")).toBeInTheDocument();
  });

  it("renders the paperwork phase as three tiles with a blocks-issuing chip", () => {
    const phase: GetRunningPhase = {
      key: "paperwork",
      tasks: [
        task({ key: "letterhead", phase: "paperwork", done: false, block: "issuing" }),
        task({ key: "terms", phase: "paperwork", done: false, block: "issuing" }),
        task({ key: "countersign", phase: "paperwork", done: false }),
      ],
    };
    const onOpenTask = vi.fn();
    renderWithProviders(<PhaseCard phase={phase} role="admin" onOpenTask={onOpenTask} />);

    expect(screen.getByText("Paperwork")).toBeInTheDocument();
    expect(screen.getByText("Not blocking yet")).toBeInTheDocument();
    expect(screen.getByText("Letterhead")).toBeInTheDocument();
    expect(screen.getByText("Terms")).toBeInTheDocument();
    expect(screen.getByText("Countersignature")).toBeInTheDocument();
    expect(screen.getAllByText("Blocks issuing")).toHaveLength(2);

    fireEvent.click(screen.getByText("Letterhead"));
    expect(onOpenTask).toHaveBeenCalledWith("letterhead");
  });

  it("shows a Change link (not a primary button) for a done task", () => {
    const onOpenTask = vi.fn();
    renderWithProviders(<PhaseCard phase={makeBookablePhase()} role="admin" onOpenTask={onOpenTask} />);

    const row = screen.getByTestId("task-row-flow");
    const change = within(row).getByText("Change");
    fireEvent.click(change);
    expect(onOpenTask).toHaveBeenCalledWith("flow");
  });
});
