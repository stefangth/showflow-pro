import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test/renderWithProviders";
import { AtRiskDateCard } from "./AtRiskDateCard";
import type { AtRiskDate } from "@/lib/autopilot/today";

function anAtRisk(overrides: Partial<AtRiskDate> = {}): AtRiskDate {
  return {
    kind: "at_risk",
    showDateId: "date-1",
    date: "2026-09-03",
    title: "Hamlet, Abend",
    where: "Thalia Theater, Hamburg",
    placesEmpty: 3,
    daysOut: 17,
    exhausted: false,
    nextCastName: "Ensemble Nord",
    nextCastFreeCount: 6,
    rosterCount: 14,
    rosterFreeCount: 9,
    nextTierNumber: 2,
    ...overrides,
  };
}

// Finding 2: `exhausted` was computed by `computeToday` and covered by its
// own tests, but the card never read it — a date Autopilot has genuinely run
// out of people for rendered the same resolution options as an ordinary
// at-risk date.
describe("AtRiskDateCard: exhausted", () => {
  it("shows the ordinary body and the openCast option for a non-exhausted date", () => {
    render(
      <AtRiskDateCard item={anAtRisk()} askTimeLabel="19:00" canAsk canBook onOpenNextCast={vi.fn()} onOpenDate={vi.fn()} />,
    );
    expect(screen.getByText(/Autopilot has asked everyone it can/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Do this" })).toBeInTheDocument();
  });

  it("never renders the openCast option when exhausted, even if nextCastName were somehow set", () => {
    render(
      <AtRiskDateCard
        item={anAtRisk({ exhausted: true, nextCastName: null })}
        askTimeLabel="19:00"
        canAsk
        canBook
        onOpenNextCast={vi.fn()}
        onOpenDate={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Do this" })).not.toBeInTheDocument();
  });

  it("swaps to the exhausted body copy when exhausted", () => {
    render(
      <AtRiskDateCard
        item={anAtRisk({ exhausted: true, nextCastName: null, nextCastFreeCount: 0 })}
        askTimeLabel="19:00"
        canAsk
        canBook
        onOpenNextCast={vi.fn()}
        onOpenDate={vi.fn()}
      />,
    );
    expect(screen.getByText(/Autopilot has nobody left it can ask/)).toBeInTheDocument();
    expect(screen.queryByText(/Autopilot has asked everyone it can/)).not.toBeInTheDocument();
  });

  it("swaps the pick-yourself note when the roster is also exhausted of free artists", () => {
    render(
      <AtRiskDateCard
        item={anAtRisk({ exhausted: true, nextCastName: null, nextCastFreeCount: 0, rosterFreeCount: 0 })}
        askTimeLabel="19:00"
        canAsk
        canBook
        onOpenNextCast={vi.fn()}
        onOpenDate={vi.fn()}
      />,
    );
    expect(screen.getByText(/Nobody on the roster is free that night either\./)).toBeInTheDocument();
    // The button is still offered — the Dates board still has other levers
    // (edit slots, add someone new to the roster) — but the "N free" claim
    // that would be false (0 free) must not render.
    expect(screen.getByRole("button", { name: "Open the date" })).toBeInTheDocument();
    expect(screen.queryByText(/artists on the roster, \d+ of them free/)).not.toBeInTheDocument();
  });

  it("still shows the ordinary pick-yourself note when exhausted but some roster artists remain free", () => {
    render(
      <AtRiskDateCard
        item={anAtRisk({ exhausted: true, nextCastName: null, nextCastFreeCount: 0, rosterFreeCount: 4 })}
        askTimeLabel="19:00"
        canAsk
        canBook
        onOpenNextCast={vi.fn()}
        onOpenDate={vi.fn()}
      />,
    );
    expect(screen.getByText(/14 artists on the roster, 4 of them free that night\./)).toBeInTheDocument();
  });
});
