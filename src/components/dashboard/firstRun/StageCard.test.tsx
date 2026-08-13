// src/components/dashboard/firstRun/StageCard.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StageCard } from "./StageCard";
import type { Stage, StageAction } from "@/lib/dashboard/stageChain.types";

function makeStage(overrides: Partial<Stage>): Stage {
  return {
    key: "stage",
    n: "01",
    variant: "plain",
    name: "Stage name",
    tag: "Tag",
    line: "Line copy.",
    running: false,
    badge: "",
    needs: "",
    metric: null,
    metricLabel: "",
    steps: [],
    ctaLabel: "",
    ctaIsPrimary: false,
    action: null,
    ...overrides,
  };
}

describe("StageCard", () => {
  it("renders a hot stage with a primary CTA and a hard docked step, and fires onAction on click", () => {
    const action: StageAction = { kind: "route", to: "/shows-bookings" };
    const stage = makeStage({
      key: "dates",
      n: "01",
      variant: "hot",
      name: "Dates",
      tag: "Shows and bookings",
      line: "Nothing downstream can mean anything until shows exist.",
      metric: "0",
      metricLabel: "dates in",
      steps: [
        {
          key: "shows",
          label: "Get your shows in",
          done: false,
          hard: true,
          hardLabel: "Blocks offers",
          soft: false,
          admin: false,
          hint: "",
        },
      ],
      ctaLabel: "Import dates",
      ctaIsPrimary: true,
      action,
    });
    const onAction = vi.fn();

    render(<StageCard stage={stage} onAction={onAction} />);

    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(screen.getByText("Import dates")).toBeInTheDocument();
    expect(screen.getByText("Get your shows in")).toBeInTheDocument();
    expect(screen.getByText("Blocks offers")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Import dates"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(action);
  });

  it("renders a dim stage with its badge and needs line and no primary button", () => {
    const stage = makeStage({
      key: "offer",
      n: "02",
      variant: "dim",
      name: "Offer",
      tag: "Booking flow",
      line: "One digest at 09:00h (Berlin, Germany), never a mail per date.",
      badge: "Waits",
      needs: "Needs dates for Ensemble A",
    });

    render(<StageCard stage={stage} onAction={vi.fn()} />);

    expect(screen.getByText("Waits")).toBeInTheDocument();
    expect(screen.getByText("Needs dates for Ensemble A")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
