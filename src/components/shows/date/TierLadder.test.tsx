import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { TierLadderRow } from "@/data/tierLadder";
import { TierLadder, type TierLadderProps } from "./TierLadder";

const ROWS: TierLadderRow[] = [
  {
    tier: 1,
    casts: [{ id: "cast-a", name: "Cast A" }],
    castTotal: 10,
    matchCount: 6,
    missingSkillCount: 0,
    blockedCount: 0,
    alreadyOfferedCount: 4,
  },
  {
    tier: 2,
    casts: [{ id: "cast-b", name: "Cast B" }],
    castTotal: 9,
    matchCount: 7,
    missingSkillCount: 0,
    blockedCount: 0,
    alreadyOfferedCount: 0,
  },
  {
    tier: 3,
    casts: [{ id: "cast-c", name: "Cast C" }],
    castTotal: 11,
    matchCount: 4,
    missingSkillCount: 7,
    blockedCount: 0,
    alreadyOfferedCount: 0,
  },
];

function renderLadder(overrides: Partial<TierLadderProps> = {}) {
  const onCloseTier = vi.fn();
  const utils = renderWithProviders(
    <TierLadder
      rows={ROWS}
      city="Berlin"
      openedTiers={[{ tier: 1, closed: false }]}
      statusByTier={[{ tier: 1, sent: 9, accepted: 4, pending: 3, cancelled: 2 }]}
      nextTier={2}
      onCloseTier={onCloseTier}
      {...overrides}
    />,
  );
  return { ...utils, onCloseTier };
}

describe("TierLadder", () => {
  it("renders the header and city-scoped subtitle", () => {
    renderLadder();
    expect(screen.getByText("WHO THIS DATE ASKS · SHOW-SPECIFIC")).toBeInTheDocument();
    expect(screen.getByText("Casts in priority order for Berlin")).toBeInTheDocument();
  });

  it("shows the opened tier's status line and a Close tier control", () => {
    renderLadder();
    expect(
      screen.getByText("9 asked · 4 said yes · 3 waiting · 2 cancelled"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close this round" })).toBeInTheDocument();
  });

  it("shows the next tier's match line and count badge, with no Close tier control", () => {
    renderLadder();
    expect(screen.getByText("7 of 9 artists match")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows a later tier's match line with its miss-skill detail", () => {
    renderLadder();
    expect(screen.getByText("4 of 11 artists match · 7 miss a required skill")).toBeInTheDocument();
  });

  it("renders Close tier only for the opened tier, and clicking it fires onCloseTier with that tier", () => {
    const { onCloseTier } = renderLadder();
    const closeButtons = screen.getAllByRole("button", { name: "Close this round" });
    expect(closeButtons).toHaveLength(1);

    fireEvent.click(closeButtons[0]);
    expect(onCloseTier).toHaveBeenCalledTimes(1);
    expect(onCloseTier).toHaveBeenCalledWith(1);
  });

  it("does not render Close tier for an opened tier that is already closed", () => {
    renderLadder({ openedTiers: [{ tier: 1, closed: true }] });
    expect(screen.queryByRole("button", { name: "Close this round" })).not.toBeInTheDocument();
    // Still shows the status line for the closed tier.
    expect(
      screen.getByText("9 asked · 4 said yes · 3 waiting · 2 cancelled"),
    ).toBeInTheDocument();
  });
});
