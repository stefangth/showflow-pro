import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { GetRunningHeader } from "./GetRunningHeader";
import type { GetRunningModel, GetRunningTask } from "@/lib/getRunning/tasks";

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

function task(overrides: Partial<GetRunningTask> & Pick<GetRunningTask, "key">): GetRunningTask {
  return {
    phase: "bookable",
    done: false,
    block: null,
    adminOnly: false,
    actionableByViewer: true,
    ...overrides,
  };
}

/** A model whose single "bookable" phase holds exactly the given tasks — enough to drive
 *  the producer headline's yours/waits split, which reads straight off each task's own
 *  `done`/`actionableByViewer`. `complete`/`canFirstOffer` are derived the same way
 *  `composeGetRunning` derives them (mirrors src/lib/getRunning/tasks.ts), since
 *  `GetRunningHeader` falls back to those once nothing is left to be "yours" or "waiting". */
function modelWithTasks(tasks: GetRunningTask[]): GetRunningModel {
  return makeModel({
    phases: [{ key: "bookable", tasks }],
    doneCount: tasks.filter((t) => t.done).length,
    totalCount: tasks.length,
    complete: tasks.every((t) => t.done),
    canFirstOffer: tasks.filter((t) => t.block === "offers" || t.block === "booking").every((t) => t.done),
  });
}

describe("GetRunningHeader", () => {
  it("renders the progress card counts, tick segments, and module list", () => {
    renderWithProviders(<GetRunningHeader model={makeModel()} orgName="Nordstadt Produktionen" />);

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("of 11 done")).toBeInTheDocument();
    expect(screen.getAllByTestId("get-running-tick")).toHaveLength(11);
    expect(screen.getByText("Booking engine")).toBeInTheDocument();
    expect(screen.getByText("Contracts")).toBeInTheDocument();
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

  describe("producer headline (screen 03)", () => {
    const PRODUCER_BODY = "This is here so you know why Shows and Bookings looks empty, not so you can fix all of it.";

    it("reads every not-done task as the producer's own (producerYours) when nothing waits on an admin", () => {
      const model = modelWithTasks([
        task({ key: "people", done: false, actionableByViewer: true }),
        task({ key: "eligibility", done: false, actionableByViewer: true }),
      ]);
      renderWithProviders(
        <GetRunningHeader model={model} orgName="Nordstadt Produktionen" role="producer" adminNames={["Maja Kern"]} />,
      );

      expect(screen.getByText("2 tasks here are yours.")).toBeInTheDocument();
      expect(screen.getByText(PRODUCER_BODY)).toBeInTheDocument();
      expect(screen.queryByText(/waits on/i)).not.toBeInTheDocument();
    });

    it("concatenates producerYours and producerWaits when some tasks are the producer's and some wait on an admin", () => {
      const model = modelWithTasks([
        task({ key: "people", done: false, actionableByViewer: true }),
        task({ key: "ladder", done: false, adminOnly: true, actionableByViewer: false }),
      ]);
      renderWithProviders(
        <GetRunningHeader model={model} orgName="Nordstadt Produktionen" role="producer" adminNames={["Maja Kern"]} />,
      );

      expect(screen.getByText("One task here is yours. The other task waits on Maja Kern.")).toBeInTheDocument();
      expect(screen.getByText(PRODUCER_BODY)).toBeInTheDocument();
    });

    it("reads producerOnlyWaits when nothing left is the producer's own move", () => {
      const model = modelWithTasks([
        task({ key: "flow", done: true, actionableByViewer: true }),
        task({ key: "ladder", done: false, adminOnly: true, actionableByViewer: false }),
      ]);
      renderWithProviders(
        <GetRunningHeader model={model} orgName="Nordstadt Produktionen" role="producer" adminNames={["Maja Kern"]} />,
      );

      expect(screen.getByText("This one waits on Maja Kern.")).toBeInTheDocument();
      expect(screen.getByText(PRODUCER_BODY)).toBeInTheDocument();
    });

    it("falls back to a role-neutral admin name when no admin names are given", () => {
      const model = modelWithTasks([task({ key: "ladder", done: false, adminOnly: true, actionableByViewer: false })]);
      renderWithProviders(<GetRunningHeader model={model} orgName="Nordstadt Produktionen" role="producer" />);

      expect(screen.getByText("This one waits on an admin.")).toBeInTheDocument();
    });

    it("falls back to the role-neutral complete wording once every task is done (no undone task left to be either yours or waiting)", () => {
      // Every not-done task is necessarily either "yours" or "waits on {admin}" (the two
      // counts are exhaustive over `!task.done`), so the only way to reach yoursCount === 0
      // && waitsCount === 0 at all is for every task to be done -- which is exactly
      // `model.complete`. This falls through to the same role-neutral copy the admin board
      // shows once finished.
      const model = modelWithTasks([task({ key: "flow", done: true, actionableByViewer: true })]);
      renderWithProviders(
        <GetRunningHeader model={model} orgName="Nordstadt Produktionen" role="producer" adminNames={["Maja Kern"]} />,
      );

      expect(screen.getByText("Everything here is set up")).toBeInTheDocument();
      expect(screen.queryByText(/waits on/i)).not.toBeInTheDocument();
    });

    it("leaves the admin board's own headline untouched (role omitted)", () => {
      const model = modelWithTasks([task({ key: "ladder", done: false, adminOnly: true, actionableByViewer: true })]);
      renderWithProviders(<GetRunningHeader model={model} orgName="Nordstadt Produktionen" />);

      expect(screen.queryByText(/tasks here are yours|waits on/i)).not.toBeInTheDocument();
    });
  });
});
