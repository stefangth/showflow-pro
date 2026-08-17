import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

  // FIX 1 (review): every reused editor the registry can mount is either a mutable form
  // with no read-only mode (FlowStep among them) or assumes a capability its viewer may
  // lack. A producer who opens a panel for a task they cannot act on must never reach that
  // editor at all -- landing there would be a dead end (RLS 403s the save, surfaced as a
  // bare error toast). The frame renders a read-only "waits on {admin}" body instead.
  describe("a task the viewer cannot act on (actionableByViewer: false)", () => {
    it("never mounts the registry editor", () => {
      renderWithProviders(
        <MemoryRouter>
          <TaskPanel task={flowTask({ adminOnly: true, actionableByViewer: false })} orgId="org-1" onClose={vi.fn()} />
        </MemoryRouter>,
      );

      expect(screen.queryByTestId("flow-step-probe")).not.toBeInTheDocument();
    });

    it("renders the read-only Waits-on chip and body instead, naming the real org admin", () => {
      renderWithProviders(
        <MemoryRouter>
          <TaskPanel task={flowTask({ adminOnly: true, actionableByViewer: false })} orgId="org-1" onClose={vi.fn()} />
        </MemoryRouter>,
      );

      expect(screen.getByText("Waits on an admin")).toBeInTheDocument();
      expect(screen.getByText("Set by an admin. Waits on an admin.")).toBeInTheDocument();
      // No mutable control of any kind in the body -- just the chip, the sentence, and
      // (for a task with a natural Settings destination) a deep-link.
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByText(/^Save/)).not.toBeInTheDocument();
    });

    it("still mounts the header (eyebrow/title/description) and the frame's own footer unchanged", () => {
      renderWithProviders(
        <MemoryRouter>
          <TaskPanel task={flowTask({ adminOnly: true, actionableByViewer: false })} orgId="org-1" onClose={vi.fn()} />
        </MemoryRouter>,
      );

      expect(screen.getByText("Choice · sets everything downstream")).toBeInTheDocument();
      expect(screen.getByText("Booking flow")).toBeInTheDocument();
      expect(screen.getByText("Change is logged")).toBeInTheDocument();
      expect(screen.getByText("Later")).toBeInTheDocument();
    });

    it("links to the matching Settings section for a task with a natural deep-link target", () => {
      renderWithProviders(
        <MemoryRouter>
          <TaskPanel task={flowTask({ adminOnly: true, actionableByViewer: false })} orgId="org-1" onClose={vi.fn()} />
        </MemoryRouter>,
      );

      const link = screen.getByRole("link", { name: "Change booking flow in Settings, Booking engine" });
      expect(link).toHaveAttribute("href", "/settings?tab=booking");
    });

    it("omits the Settings link for a task with no natural deep-link target (e.g. team)", () => {
      const teamTask: GetRunningTask = {
        key: "team",
        phase: "bookable",
        done: false,
        block: null,
        adminOnly: true,
        actionableByViewer: false,
      };
      renderWithProviders(
        <MemoryRouter>
          <TaskPanel task={teamTask} orgId="org-1" onClose={vi.fn()} />
        </MemoryRouter>,
      );

      expect(screen.getByText("Waits on an admin")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  it("still mounts the registry editor for an actionable task (unchanged from before this fix)", () => {
    renderWithProviders(<TaskPanel task={flowTask()} orgId="org-1" onClose={vi.fn()} />);

    expect(screen.getByTestId("flow-step-probe")).toBeInTheDocument();
    expect(screen.queryByText(/waits on/i)).not.toBeInTheDocument();
  });
});
