import type React from "react";
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
// The probe also mirrors FlowStep's real footer-portal behavior: it reads the frame's
// TaskPanelFooterContext and portals its primary action into the footer slot when one is
// provided, else falls back to an inline action -- so the tests below can assert the slot
// actually mounts and receives the portal.
vi.mock("@/components/bookings/setup/FlowStep", async () => {
  const { useContext } = await import("react");
  const { createPortal } = await import("react-dom");
  // Leaf module — importing TaskPanel here would deadlock (frame → registry → this mock).
  const { TaskPanelFooterContext } = await import("@/components/getRunning/TaskPanelFooterContext");
  return {
    FlowStep: () => {
      const footerSlot = useContext(TaskPanelFooterContext);
      const action = (
        <button type="button" data-testid={footerSlot ? "flow-footer-action" : "flow-inline-action"}>
          Use preset
        </button>
      );
      return (
        <div data-testid="flow-step-probe">
          flow step probe
          {footerSlot ? createPortal(action, footerSlot) : action}
        </div>
      );
    },
  };
});

// Same probe treatment for TermsStep so the eyebrow-variant tests below don't pay for the
// real terms editor's data layer.
vi.mock("@/components/hireOrders/setup/TermsStep", () => ({
  TermsStep: () => <div data-testid="terms-step-probe">terms step probe</div>,
}));

function termsTask(overrides: Partial<GetRunningTask> = {}): GetRunningTask {
  return {
    key: "terms",
    phase: "paperwork",
    done: false,
    block: "issuing",
    adminOnly: false,
    actionableByViewer: true,
    ...overrides,
  };
}

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

function renderPanel(ui: React.ReactElement) {
  return renderWithProviders(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("TaskPanel", () => {
  it("renders the feature breadcrumb eyebrow as a deep link, plus the task title", () => {
    renderPanel(<TaskPanel task={flowTask()} orgId="org-1" onClose={vi.fn()} />);

    const crumb = screen.getByRole("link", { name: /Settings › Booking engine/ });
    expect(crumb).toHaveAttribute("href", "/settings?tab=booking");
    expect(screen.getByText("Booking flow")).toBeInTheDocument();
  });

  it("mounts the FlowStep editor via the registry for the flow task", () => {
    renderPanel(<TaskPanel task={flowTask()} orgId="org-1" onClose={vi.fn()} />);

    expect(screen.getByTestId("flow-step-probe")).toBeInTheDocument();
  });

  it("renders the footer note and calls onClose when Later is clicked", () => {
    const onClose = vi.fn();
    renderPanel(<TaskPanel task={flowTask()} orgId="org-1" onClose={onClose} />);

    expect(screen.getByText("Change is logged")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Later"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose from the header close control too", () => {
    const onClose = vi.fn();
    renderPanel(<TaskPanel task={flowTask()} orgId="org-1" onClose={onClose} />);

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

      // Non-actionable: the breadcrumb is plain text, not a deep link (the home is
      // admin-only / would bounce a producer); WaitsOnPanelBody carries the safe link below.
      expect(screen.getByText("Settings › Booking engine")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Settings › Booking engine/ })).not.toBeInTheDocument();
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

  // The eyebrow now names where the setting LIVES (question 1), stable across the task's
  // own done/outstanding state: an outstanding and a done terms panel both read "Settings ›
  // Contracts", so the crumb never goes stale the way the old "· blocks issuing" clause did.
  it("shows the contracts breadcrumb for a terms doc (deep-linking to the hire-orders tab), outstanding or done", () => {
    const { unmount } = renderPanel(<TaskPanel task={termsTask()} orgId="org-1" onClose={vi.fn()} />);
    // The contracts crumb is a real deep link to the hire-orders settings tab, not bare /settings.
    expect(screen.getByRole("link", { name: /Settings › Contracts/ })).toHaveAttribute(
      "href",
      "/settings?tab=hire-orders",
    );
    unmount();

    renderPanel(<TaskPanel task={termsTask({ done: true })} orgId="org-1" onClose={vi.fn()} />);
    expect(screen.getByRole("link", { name: /Settings › Contracts/ })).toBeInTheDocument();
  });

  it("still mounts the registry editor for an actionable task (unchanged from before this fix)", () => {
    renderPanel(<TaskPanel task={flowTask()} orgId="org-1" onClose={vi.fn()} />);

    expect(screen.getByTestId("flow-step-probe")).toBeInTheDocument();
    expect(screen.queryByText(/waits on/i)).not.toBeInTheDocument();
  });

  // The footer slot lets an editor mounted in the scroll body portal its primary action
  // into the frame's pinned footer, so a verbose editor can't push it below the fold. The
  // probe portals when a slot is provided and falls back inline otherwise, so seeing the
  // footer action (and NOT the inline one) proves the frame supplied a live slot node.
  describe("footer action slot", () => {
    it("provides a slot the editor portals its primary action into, beside Later", () => {
      renderPanel(<TaskPanel task={flowTask()} orgId="org-1" onClose={vi.fn()} />);

      const action = screen.getByTestId("flow-footer-action");
      expect(action).toBeInTheDocument();
      // Not the inline fallback -> the context handed the editor a real footer node.
      expect(screen.queryByTestId("flow-inline-action")).not.toBeInTheDocument();
      // The portaled action lands in the footer row alongside Later, not in the scroll body.
      expect(screen.getByText("Later").closest("div")).toContainElement(action);
      expect(screen.getByTestId("task-panel-scroll")).not.toContainElement(action);
    });
  });

  // The scroll cue is a bottom fade that must appear ONLY while the body actually overflows
  // and is not scrolled to the bottom -- otherwise it washes out the last line of short
  // content. jsdom reports zero layout, so overflow is simulated by overriding the scroll
  // element's measurements and firing scroll.
  describe("scroll cue", () => {
    it("hides on non-overflowing content and shows/hides with overflow position", () => {
      renderPanel(<TaskPanel task={flowTask()} orgId="org-1" onClose={vi.fn()} />);
      const scroll = screen.getByTestId("task-panel-scroll");

      // Mount: jsdom reports zero for every measurement, so nothing overflows -> no cue.
      expect(screen.queryByTestId("task-panel-scroll-cue")).not.toBeInTheDocument();

      // Content taller than the viewport, scrolled to the top -> more below -> cue shows.
      Object.defineProperty(scroll, "scrollHeight", { value: 500, configurable: true });
      Object.defineProperty(scroll, "clientHeight", { value: 100, configurable: true });
      Object.defineProperty(scroll, "scrollTop", { value: 0, configurable: true });
      fireEvent.scroll(scroll);
      expect(screen.getByTestId("task-panel-scroll-cue")).toBeInTheDocument();

      // Scrolled to the bottom -> nothing more below -> cue hides again.
      Object.defineProperty(scroll, "scrollTop", { value: 400, configurable: true });
      fireEvent.scroll(scroll);
      expect(screen.queryByTestId("task-panel-scroll-cue")).not.toBeInTheDocument();
    });
  });
});
