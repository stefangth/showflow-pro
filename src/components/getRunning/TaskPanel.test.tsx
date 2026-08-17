import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { TaskPanel } from "./TaskPanel";
import type { GetRunningTask } from "@/lib/getRunning/tasks";

// The registry mounts the REAL FlowStep for the flow task. FlowStep reads booking flow
// data through react-query/Supabase, which this test has no interest in exercising --
// mocking the whole module to a probe (same pattern as SetupChecklistSheet.test.tsx)
// proves the registry wired the right editor in without paying for its data layer.
vi.mock("@/components/bookings/setup/FlowStep", () => ({
  FlowStep: () => <div data-testid="flow-step-probe">flow step probe</div>,
}));

function flowTask(overrides: Partial<GetRunningTask> = {}): GetRunningTask {
  return {
    key: "flow",
    phase: "bookable",
    done: false,
    block: null,
    adminOnly: false,
    actionableByViewer: true,
    ...overrides,
  };
}

describe("TaskPanel", () => {
  it("renders the choice eyebrow and the task title in the frame header", () => {
    renderWithProviders(<TaskPanel task={flowTask()} orgId="org-1" onClose={vi.fn()} />);

    expect(screen.getByText("Choice · sets everything downstream")).toBeInTheDocument();
    expect(screen.getByText("Booking flow")).toBeInTheDocument();
  });

  it("mounts the FlowStep editor via the registry for the flow task", () => {
    renderWithProviders(<TaskPanel task={flowTask()} orgId="org-1" onClose={vi.fn()} />);

    expect(screen.getByTestId("flow-step-probe")).toBeInTheDocument();
  });

  it("renders the footer note and calls onClose when Later is clicked", () => {
    const onClose = vi.fn();
    renderWithProviders(<TaskPanel task={flowTask()} orgId="org-1" onClose={onClose} />);

    expect(screen.getByText("Change is logged")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Later"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose from the header close control too", () => {
    const onClose = vi.fn();
    renderWithProviders(<TaskPanel task={flowTask()} orgId="org-1" onClose={onClose} />);

    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
