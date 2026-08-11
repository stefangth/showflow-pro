// src/components/dashboard/firstRun/DashboardFirstRun.test.tsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { DashboardFirstRun } from "./DashboardFirstRun";
import type { StageChainResult, QueueRow } from "@/lib/dashboard/stageChain.types";

function makeResult(overrides: Partial<StageChainResult> = {}): StageChainResult {
  return {
    eyebrow: "Halle Kollektiv · first run",
    headline: "34 dates landed. Four of them can be offered tonight.",
    body: "Stage 01 is running.",
    ghost: "Change the flow in Settings",
    hint: "Tier 1 goes out at 09:00 Berlin",
    progressLabel: "Set up · 2 of 7",
    progressHint: "The steps left sit in the stage they hold up.",
    hasSteps: true,
    ticks: [true, true, false, false, false, false, false],
    modules: [
      { label: "Booking flow", on: true },
      { label: "Hire orders", on: false },
    ],
    offFooters: ["Hire orders is off for this org. Ask your account manager to switch it on."],
    hasChain: true,
    chainTitle: "How a date will move",
    rulesBy: "Rules set by you · Settings · Booking flow",
    stages: [
      {
        key: "dates",
        n: "01",
        variant: "hot",
        name: "Dates",
        tag: "Shows and bookings",
        line: "Nothing downstream can mean anything until shows exist.",
        running: false,
        badge: "",
        needs: "",
        metric: "0",
        metricLabel: "dates in",
        steps: [],
        ctaLabel: "Set slots",
        ctaIsPrimary: true,
        action: { kind: "openSetup", feature: "booking_flow", step: "slots" },
      },
    ],
    sideTitle: "Nothing here blocks the rest of the app",
    sideBody: "Some steps above block the first booking. The app itself is open.",
    side: [
      { title: "See it as your artists do", where: "The pencil top right opens the editor bar." },
      { title: "Read what each role covers", where: "Settings · Docs" },
    ],
    queueTitle: "What this page becomes",
    queueHint: "Sample rows, shown once a module is on.",
    sample: true,
    queueOpacity: 0.55,
    nothingOn: false,
    ...overrides,
  };
}

function makeQueueRows(): QueueRow[] {
  return [
    {
      dot: "accent",
      title: "Nachtstück · 14 Aug confirmed",
      hint: "An accepted tier-1 offer, confirmed by a producer",
      when: "09:12",
      cta: "Open",
    },
    { dot: "faint", title: "30 dates waiting on slots", hint: "Set cast slots and tonight's digest includes them", when: "—", cta: "" },
  ];
}

describe("DashboardFirstRun", () => {
  it("renders the header, an off-footer, the chain title and a stage name, and routes the hot stage's CTA to onOpenSetup", () => {
    const onOpenSetup = vi.fn();
    renderWithProviders(
      <MemoryRouter>
        <DashboardFirstRun
          result={makeResult()}
          queueRows={makeQueueRows()}
          onOpenSetup={onOpenSetup}
          dismissed={false}
          onDismiss={vi.fn()}
          onUndismiss={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("34 dates landed. Four of them can be offered tonight.")).toBeInTheDocument();
    expect(
      screen.getByText("Hire orders is off for this org. Ask your account manager to switch it on."),
    ).toBeInTheDocument();
    expect(screen.getByText("How a date will move")).toBeInTheDocument();
    expect(screen.getByText("Dates")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Set slots"));
    expect(onOpenSetup).toHaveBeenCalledTimes(1);
    expect(onOpenSetup).toHaveBeenCalledWith("booking_flow", "slots");
  });

  it("fires onDismiss from the Hide control", () => {
    const onDismiss = vi.fn();
    renderWithProviders(
      <MemoryRouter>
        <DashboardFirstRun
          result={makeResult()}
          queueRows={makeQueueRows()}
          onOpenSetup={vi.fn()}
          dismissed={false}
          onDismiss={onDismiss}
          onUndismiss={vi.fn()}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Hide"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("when dismissed, renders only the collapsed chip and its open control calls onUndismiss", () => {
    const onUndismiss = vi.fn();
    renderWithProviders(
      <MemoryRouter>
        <DashboardFirstRun
          result={makeResult()}
          queueRows={makeQueueRows()}
          onOpenSetup={vi.fn()}
          dismissed
          onDismiss={vi.fn()}
          onUndismiss={onUndismiss}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Set up · 2 of 7")).toBeInTheDocument();
    expect(screen.getByText("Pick up where you left off")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Resume"));
    expect(onUndismiss).toHaveBeenCalledTimes(1);

    expect(screen.queryByText("34 dates landed. Four of them can be offered tonight.")).not.toBeInTheDocument();
    expect(screen.queryByText("How a date will move")).not.toBeInTheDocument();
  });
});
