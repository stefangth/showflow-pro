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

  // A phase that is being worked on (some tasks done, nothing blocking) must read as a solid
  // card, not the dashed/ghosted "not started" treatment: the two are different visual states
  // (active vs dormant), so a half-done phase no longer clashes with the solid cards beside it.
  it("renders an in-progress phase (some done, nothing blocking) as a solid card", () => {
    const phase: GetRunningPhase = {
      key: "bookable",
      tasks: [
        task({ key: "flow", phase: "bookable", done: true }),
        task({ key: "people", phase: "bookable", done: true }),
        task({ key: "ladder", phase: "bookable", done: true }),
        task({ key: "eligibility", phase: "bookable", done: true }),
        task({ key: "timing", phase: "bookable", done: true }),
        task({ key: "team", phase: "bookable", done: false, adminOnly: true }),
      ],
    };
    renderWithProviders(<PhaseCard phase={phase} role="admin" onOpenTask={vi.fn()} />);
    const card = screen.getByTestId("phase-card-bookable");
    expect(card.className).toContain("bg-card");
    expect(card.className).not.toContain("border-dashed");
    expect(screen.getByText("Nothing blocking")).toBeInTheDocument();
  });

  it("renders a not-started phase (nothing done, nothing blocking) as a dashed, transparent card", () => {
    const phase: GetRunningPhase = {
      key: "bookable",
      tasks: [
        task({ key: "flow", phase: "bookable" }),
        task({ key: "people", phase: "bookable" }),
        task({ key: "ladder", phase: "bookable" }),
        task({ key: "eligibility", phase: "bookable" }),
        task({ key: "timing", phase: "bookable" }),
        task({ key: "team", phase: "bookable", adminOnly: true }),
      ],
    };
    renderWithProviders(<PhaseCard phase={phase} role="admin" onOpenTask={vi.fn()} />);
    const card = screen.getByTestId("phase-card-bookable");
    expect(card.className).toContain("border-dashed");
    expect(card.className).toContain("bg-transparent");
    expect(screen.getByText("Not started yet")).toBeInTheDocument();
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

  it("hides the Resolve link once the get_dates phase is complete", () => {
    const phase: GetRunningPhase = {
      key: "get_dates",
      tasks: [
        task({ key: "dates", phase: "get_dates", done: true }),
        task({ key: "slots", phase: "get_dates", done: true, block: "filling" }),
      ],
    };
    renderWithProviders(<PhaseCard phase={phase} role="admin" onOpenTask={vi.fn()} />);

    expect(screen.queryByText("Resolve")).not.toBeInTheDocument();
  });

  it("shows the Resolve link while the get_dates phase still has an outstanding task", () => {
    const onOpenTask = vi.fn();
    const phase: GetRunningPhase = {
      key: "get_dates",
      tasks: [
        task({ key: "dates", phase: "get_dates", done: true }),
        task({ key: "slots", phase: "get_dates", done: false, block: "filling" }),
      ],
    };
    renderWithProviders(<PhaseCard phase={phase} role="admin" onOpenTask={onOpenTask} />);

    fireEvent.click(screen.getByText("Resolve"));
    expect(onOpenTask).toHaveBeenCalledWith("slots");
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

  it("renders the All covered value chip on a done eligibility task", () => {
    renderWithProviders(<PhaseCard phase={makeBookablePhase()} role="admin" onOpenTask={vi.fn()} />);

    const row = screen.getByTestId("task-row-eligibility");
    expect(within(row).getByText("All covered")).toBeInTheDocument();
  });

  it("does not render the All covered chip on an undone or non-eligibility task", () => {
    renderWithProviders(<PhaseCard phase={makeBookablePhase()} role="admin" onOpenTask={vi.fn()} />);

    // flow is done but isn't eligibility, so it gets no value chip.
    const flowRow = screen.getByTestId("task-row-flow");
    expect(within(flowRow).queryByText("All covered")).not.toBeInTheDocument();
  });

  it("renders a Waits-on chip and an enabled View affordance instead of the done-task link when the viewer cannot act on it", () => {
    // Task 8: this used to be a disabled "Invite" link. Screen 03 names and attributes the
    // task instead of disabling it in place, so the done-task link is gone entirely for a
    // !actionableByViewer row, replaced by a "Waits on {admin}" chip and an enabled "View"
    // button that still opens the panel (read-only, not the "Invite" primary action).
    const onOpenTask = vi.fn();
    const phase: GetRunningPhase = {
      key: "bookable",
      tasks: [
        task({ key: "team", phase: "bookable", done: true, adminOnly: true, actionableByViewer: false }),
      ],
    };
    renderWithProviders(
      <PhaseCard phase={phase} role="producer" adminNames={["Maja Kern"]} onOpenTask={onOpenTask} />,
    );

    const row = screen.getByTestId("task-row-team");
    expect(within(row).queryByText("Invite")).not.toBeInTheDocument();
    expect(within(row).getByText("Waits on Maja Kern")).toBeInTheDocument();

    const view = within(row).getByRole("button", { name: "View" });
    expect(view).not.toBeDisabled();
    fireEvent.click(view);
    expect(onOpenTask).toHaveBeenCalledWith("team");
  });

  describe("producer-scoped board (screen 03)", () => {
    function makeProducerBookablePhase(): GetRunningPhase {
      return {
        key: "bookable",
        tasks: [
          task({ key: "people", phase: "bookable", done: false, block: "booking", actionableByViewer: true }),
          task({
            key: "ladder",
            phase: "bookable",
            done: false,
            block: "offers",
            adminOnly: true,
            actionableByViewer: false,
          }),
          task({ key: "team", phase: "bookable", done: false, adminOnly: true, actionableByViewer: false }),
        ],
      };
    }

    it("names the admin a producer's admin-only tasks wait on, with a View affordance instead of a primary CTA", () => {
      renderWithProviders(
        <PhaseCard
          phase={makeProducerBookablePhase()}
          role="producer"
          adminNames={["Maja Kern"]}
          onOpenTask={vi.fn()}
        />,
      );

      const ladderRow = screen.getByTestId("task-row-ladder");
      expect(within(ladderRow).getByText("Waits on Maja Kern")).toBeInTheDocument();
      expect(within(ladderRow).getByRole("button", { name: "View" })).toBeInTheDocument();
      // Never the primary CTA a blocking-and-actionable row would otherwise get.
      expect(within(ladderRow).queryByText("Rank here")).not.toBeInTheDocument();

      const teamRow = screen.getByTestId("task-row-team");
      expect(within(teamRow).getByText("Waits on Maja Kern")).toBeInTheDocument();
      expect(within(teamRow).getByRole("button", { name: "View" })).toBeInTheDocument();
    });

    it("falls back to a role-neutral name when no admin has a display name yet", () => {
      renderWithProviders(
        <PhaseCard phase={makeProducerBookablePhase()} role="producer" adminNames={[]} onOpenTask={vi.fn()} />,
      );

      const teamRow = screen.getByTestId("task-row-team");
      expect(within(teamRow).getByText("Waits on an admin")).toBeInTheDocument();
    });

    it("renders an actionable producer row exactly as the admin board would", () => {
      renderWithProviders(
        <PhaseCard
          phase={makeProducerBookablePhase()}
          role="producer"
          adminNames={["Maja Kern"]}
          onOpenTask={vi.fn()}
        />,
      );

      const peopleRow = screen.getByTestId("task-row-people");
      expect(within(peopleRow).queryByText(/Waits on/)).not.toBeInTheDocument();
      expect(within(peopleRow).getByText("Blocks booking")).toBeInTheDocument();
      // people is undone + blocking + actionable -> the primary CTA, same as admin.
      expect(within(peopleRow).getByRole("button", { name: "Add here" })).toBeInTheDocument();
    });

    it("never renders a Nudge control anywhere on the board (confirmed decision: nudge deferred)", () => {
      const { container } = renderWithProviders(
        <PhaseCard
          phase={makeProducerBookablePhase()}
          role="producer"
          adminNames={["Maja Kern"]}
          onOpenTask={vi.fn()}
        />,
      );
      expect(container.textContent).not.toMatch(/nudge/i);
    });

    it("gives the get_dates phase-header review link the same Waits-on/View treatment when the dates task isn't actionable", () => {
      const phase: GetRunningPhase = {
        key: "get_dates",
        tasks: [
          task({ key: "dates", phase: "get_dates", done: false, adminOnly: true, actionableByViewer: false }),
          task({ key: "slots", phase: "get_dates", done: true, block: "filling" }),
        ],
      };
      const onOpenTask = vi.fn();
      const { container } = renderWithProviders(
        <PhaseCard phase={phase} role="producer" adminNames={["Maja Kern"]} onOpenTask={onOpenTask} />,
      );

      expect(screen.queryByText("Review")).not.toBeInTheDocument();
      expect(screen.getByText("Waits on Maja Kern")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "View" }));
      expect(onOpenTask).toHaveBeenCalledWith("dates");
      expect(container.textContent).not.toMatch(/nudge/i);
    });

    it("attributes the get_dates summary slots gap instead of dropping the action when slots isn't actionable", () => {
      // Whole-phase admin-blocked: the header attributes `dates` ("Waits on {admin}" + View)
      // and the summary attributes the `slots` gap the same way, so neither reads as a dead
      // or absent control.
      const phase: GetRunningPhase = {
        key: "get_dates",
        tasks: [
          task({ key: "dates", phase: "get_dates", done: false, adminOnly: true, actionableByViewer: false }),
          task({ key: "slots", phase: "get_dates", done: false, block: "filling", adminOnly: true, actionableByViewer: false }),
        ],
      };
      renderWithProviders(
        <PhaseCard phase={phase} role="producer" adminNames={["Maja Kern"]} onOpenTask={vi.fn()} />,
      );

      expect(screen.queryByText("Resolve")).not.toBeInTheDocument();
      // Header (dates) + summary (slots) each attribute to the admin: two waits-on badges.
      expect(screen.getAllByText("Waits on Maja Kern")).toHaveLength(2);
    });

    it("attributes the slots gap when dates is actionable but slots is not (split-capability mixed state)", () => {
      // `dates` gates on manage_productions, `slots` on edit_scheduling. A producer can hold
      // the first but not the second: the header shows the actionable dates link, and the
      // summary must still attribute the slots gap ("Waits on {admin}") rather than silently
      // hiding it, which would leave a dead/absent control with no explanation.
      const phase: GetRunningPhase = {
        key: "get_dates",
        tasks: [
          task({ key: "dates", phase: "get_dates", done: false, adminOnly: false, actionableByViewer: true }),
          task({ key: "slots", phase: "get_dates", done: false, block: "filling", adminOnly: true, actionableByViewer: false }),
        ],
      };
      renderWithProviders(
        <PhaseCard phase={phase} role="producer" adminNames={["Maja Kern"]} onOpenTask={vi.fn()} />,
      );

      // dates is actionable, so the header shows its review link, not a waits-on badge.
      expect(screen.getByText("Review")).toBeInTheDocument();
      // slots is not actionable: no Resolve action, but a single waits-on attribution for it.
      expect(screen.queryByText("Resolve")).not.toBeInTheDocument();
      expect(screen.getByText("Waits on Maja Kern")).toBeInTheDocument();
    });

    it("gives a non-actionable paperwork tile the same Waits-on/View treatment instead of a whole-tile click", () => {
      // letterhead is also the first not-done paperwork task, so the phase HEADER renders
      // its own Waits-on/View pair too (FIX 2) — this test scopes to the tile itself
      // (`paperwork-tile-letterhead`) so it isn't tripped up by that second, header-level one.
      const phase: GetRunningPhase = {
        key: "paperwork",
        tasks: [
          task({
            key: "letterhead",
            phase: "paperwork",
            done: false,
            block: "issuing",
            adminOnly: true,
            actionableByViewer: false,
          }),
          task({ key: "terms", phase: "paperwork", done: false, block: "issuing" }),
          task({ key: "countersign", phase: "paperwork", done: false }),
        ],
      };
      const onOpenTask = vi.fn();
      renderWithProviders(
        <PhaseCard phase={phase} role="producer" adminNames={["Maja Kern"]} onOpenTask={onOpenTask} />,
      );

      const tile = screen.getByTestId("paperwork-tile-letterhead");
      expect(within(tile).getByText("Waits on Maja Kern")).toBeInTheDocument();
      fireEvent.click(within(tile).getByRole("button", { name: "View" }));
      expect(onOpenTask).toHaveBeenCalledWith("letterhead");

      // The remaining actionable tiles still work exactly as before (whole tile clickable).
      fireEvent.click(screen.getByText("Terms"));
      expect(onOpenTask).toHaveBeenCalledWith("terms");
    });

    it("swaps the paperwork header's Do-it-now link for the Waits-on/View pair when the first open task isn't actionable", () => {
      // FIX 2: the header must not say "Do it now" above a tile that itself says
      // "Waits on {admin}" — the header and the first not-done task's actionability must
      // agree.
      const phase: GetRunningPhase = {
        key: "paperwork",
        tasks: [
          task({
            key: "letterhead",
            phase: "paperwork",
            done: false,
            block: "issuing",
            adminOnly: true,
            actionableByViewer: false,
          }),
          task({ key: "terms", phase: "paperwork", done: false, block: "issuing" }),
        ],
      };
      const onOpenTask = vi.fn();
      renderWithProviders(
        <PhaseCard phase={phase} role="producer" adminNames={["Maja Kern"]} onOpenTask={onOpenTask} />,
      );

      const header = screen.getByText("Paperwork").parentElement as HTMLElement;
      expect(within(header).queryByText("Do it now")).not.toBeInTheDocument();
      expect(within(header).getByText("Waits on Maja Kern")).toBeInTheDocument();
      fireEvent.click(within(header).getByRole("button", { name: "View" }));
      expect(onOpenTask).toHaveBeenCalledWith("letterhead");
    });

    it("keeps the paperwork header's Do-it-now link when the first open task IS actionable", () => {
      const phase: GetRunningPhase = {
        key: "paperwork",
        tasks: [
          task({ key: "letterhead", phase: "paperwork", done: false, block: "issuing" }),
          task({
            key: "terms",
            phase: "paperwork",
            done: false,
            block: "issuing",
            adminOnly: true,
            actionableByViewer: false,
          }),
        ],
      };
      renderWithProviders(<PhaseCard phase={phase} role="admin" onOpenTask={vi.fn()} />);

      expect(screen.getByText("Do it now")).toBeInTheDocument();
    });
  });
});
