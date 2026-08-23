import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { composeGetRunningV3, type GetRunningInputV3 } from "@/lib/getRunning/steps";
import type { BookingSetupStatus } from "@/lib/bookings/setupStatus";
import type { HireOrderSetupStatus } from "@/lib/hireOrders/setupStatus";
import { HeroCard } from "./HeroCard";
import { StillShutCard } from "./StillShutCard";
import { PhaseIconRail } from "./PhaseIconRail";
import { PhaseRow } from "./PhaseRow";

// Minimal booking/hire fixture builders, in the spirit of src/lib/getRunning/steps.test.ts,
// so every test below builds its model with the REAL composer rather than a hand-rolled
// object. `hire` here additionally lets a test flip `blocksIssue` per step (the shared
// steps.test.ts helper hardcodes it false), which is what lets a "first contract" gate
// actually go shut.
function booking(overrides: Partial<Record<string, boolean>> = {}): BookingSetupStatus {
  const keys = ["shows", "slots", "flow", "people", "ladder", "eligibility", "timing"];
  return {
    steps: keys.map((key) => ({ key, done: overrides[key] ?? true, block: null })),
    datesWithoutCity: 0,
  } as unknown as BookingSetupStatus;
}
function hire(overrides: Partial<Record<"letterhead" | "terms" | "countersign", boolean>> = {}): HireOrderSetupStatus {
  const keys = ["letterhead", "terms", "countersign"] as const;
  return {
    steps: keys.map((key) => {
      const done = overrides[key] ?? true;
      return { key, done, blocksIssue: !done };
    }),
  } as unknown as HireOrderSetupStatus;
}
const base: GetRunningInputV3 = {
  role: "admin",
  bookingOn: true,
  hireOrdersOn: true,
  booking: booking(),
  hire: hire(),
  datesDone: true,
  datesSource: "airtable",
  datesConnectDone: true,
  datesMapDone: true,
  datesCitiesDone: true,
  producerCount: 1,
  skillsDone: true,
  feeDone: false,
  documentDone: false,
  canManageShows: true,
  canEditScheduling: true,
  canEditBooking: true,
  canEditHire: true,
  canAddArtists: true,
  canInvite: true,
};

describe("HeroCard", () => {
  it("shows the next step title and calls onOpenNext", () => {
    // datesSource null -> get_dates phase not done -> nextStep is source (get_dates)
    const model = composeGetRunningV3({ ...base, datesSource: null, booking: booking({ slots: false }) });
    const onOpenNext = vi.fn();
    renderWithProviders(<HeroCard model={model} onOpenNext={onOpenNext} />);

    expect(model.nextStep).toEqual({ phase: "get_dates", key: "source" });
    expect(screen.getByText(/choose where your dates come from/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open this step/i }));
    expect(onOpenNext).toHaveBeenCalledWith("get_dates", "source");
  });
});

describe("StillShutCard", () => {
  it("shows both the first-ask and first-contract gates when neither is ready", () => {
    const model = composeGetRunningV3({
      ...base,
      datesSource: null,
      booking: booking({ slots: false }),
      hire: hire({ terms: false }),
    });
    renderWithProviders(<StillShutCard model={model} />);

    expect(screen.getByText(/your first ask is shut/i)).toBeInTheDocument();
    expect(screen.getByText(/your first contract is shut/i)).toBeInTheDocument();
  });

  it("shows nothing-else-is-shut once both gates are clear", () => {
    const model = composeGetRunningV3(base);
    renderWithProviders(<StillShutCard model={model} />);

    expect(screen.queryByText(/your first ask is shut/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/your first contract is shut/i)).not.toBeInTheDocument();
    expect(screen.getByText(/nothing else here is shut/i)).toBeInTheDocument();
  });
});

describe("PhaseIconRail", () => {
  it("renders one titled icon per step and fires onOpenStep on click", () => {
    const model = composeGetRunningV3(base);
    const phase = model.phases.find((p) => p.key === "bookable")!;
    const onOpenStep = vi.fn();
    renderWithProviders(<PhaseIconRail phase={phase} onOpenStep={onOpenStep} />);

    const rail = screen.getByTestId("phase-icon-rail-bookable");
    const buttons = within(rail).getAllByRole("button");
    expect(buttons).toHaveLength(phase.steps.length);
    expect(buttons[0]).toHaveAttribute("title", expect.stringMatching(/add your artists/i));

    fireEvent.click(buttons[0]);
    expect(onOpenStep).toHaveBeenCalledWith(phase.steps[0].key);
  });

  it("renders inert, non-clickable icons and never fires onOpenStep when locked", () => {
    const model = composeGetRunningV3({ ...base, booking: booking({ slots: false }) });
    const phase = model.phases.find((p) => p.key === "bookable")!;
    expect(phase.waitsOn).toBe("get_dates");
    const onOpenStep = vi.fn();
    renderWithProviders(<PhaseIconRail phase={phase} onOpenStep={onOpenStep} locked />);

    const rail = screen.getByTestId("phase-icon-rail-bookable");
    expect(within(rail).queryAllByRole("button")).toHaveLength(0);

    const firstIcon = rail.querySelector("[title]") as HTMLElement;
    expect(firstIcon.tagName).toBe("SPAN");
    fireEvent.click(firstIcon);
    expect(onOpenStep).not.toHaveBeenCalled();
  });
});

describe("PhaseRow", () => {
  it("shows Waits on Get dates in when the phase waits on get_dates", () => {
    const model = composeGetRunningV3({ ...base, booking: booking({ slots: false }) });
    const phase = model.phases.find((p) => p.key === "bookable")!;
    expect(phase.waitsOn).toBe("get_dates");
    const onOpen = vi.fn();
    renderWithProviders(<PhaseRow phase={phase} index={2} model={model} onOpen={onOpen} />);

    expect(screen.getByText(/waits on get dates in/i)).toBeInTheDocument();
  });

  it("shows Continue for an in-progress phase and calls onOpen when clicked", () => {
    const model = composeGetRunningV3({ ...base, booking: booking({ ladder: false }) });
    const phase = model.phases.find((p) => p.key === "bookable")!;
    const onOpen = vi.fn();
    renderWithProviders(<PhaseRow phase={phase} index={2} model={model} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onOpen).toHaveBeenCalledWith("bookable");
  });
});
