import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { TierLadderRow } from "@/data/tierLadder";
import { NextOfferHero, type NextOfferHeroProps } from "./NextOfferHero";

const CAST_B = { id: "cast-b", name: "Cast B" };

const CAST_COUNTS: TierLadderRow = {
  tier: 2,
  casts: [CAST_B],
  castTotal: 9,
  matchCount: 7,
  missingSkillCount: 1,
  blockedCount: 1,
  alreadyOfferedCount: 1,
};

const CANDIDATES = [
  { id: "1", name: "Marta Feld" },
  { id: "2", name: "Jonas Trier" },
];

function renderHero(overrides: Partial<NextOfferHeroProps> = {}) {
  const onOpen = vi.fn();
  const onSeeArtists = vi.fn();
  const onNarrow = vi.fn();
  const onToggleNarrowSkill = vi.fn();
  const utils = renderWithProviders(
    <NextOfferHero
      target={{ kind: "cast", tier: 2, cast: CAST_B }}
      counts={CAST_COUNTS}
      candidates={CANDIDATES}
      requiredSkillNames={["Vocals"]}
      onOpen={onOpen}
      onSeeArtists={onSeeArtists}
      onNarrow={onNarrow}
      onToggleNarrowSkill={onToggleNarrowSkill}
      {...overrides}
    />,
  );
  return { ...utils, onOpen, onSeeArtists, onNarrow, onToggleNarrowSkill };
}

describe("NextOfferHero", () => {
  it("names the cast in the title, headcount, and body sentence; primary button opens offers to the cast", () => {
    const { onOpen } = renderHero();

    expect(screen.getByText("Cast B")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(
      screen.getByText("7 of 9 artists in Cast B have Vocals. 1 blocked, 1 already booked or offered."),
    ).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Open offers to Cast B (7 artists)" });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("falls back to the tier label for a multi-cast next tier", () => {
    renderHero({
      target: { kind: "tier", tier: 2 },
      counts: { ...CAST_COUNTS, casts: [CAST_B, { id: "cast-c", name: "Cast C" }] },
    });

    expect(screen.getByText("Tier 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open tier 2" })).toBeInTheDocument();
  });

  it("labels ad-hoc casts (tier 99) by name instead of Tier 99", () => {
    renderHero({ target: { kind: "tier", tier: 99 }, counts: { ...CAST_COUNTS, tier: 99 } });

    expect(screen.getByText("Ad-hoc casts")).toBeInTheDocument();
    expect(screen.getByText("NEXT OFFER · TIER 99")).toBeInTheDocument();
  });

  it("shows the eyebrow with the next tier number", () => {
    renderHero();
    expect(screen.getByText("NEXT OFFER · TIER 2")).toBeInTheDocument();
  });

  it("omits the already-booked-or-offered clause when the next tier is 1, keeping only the blocked count", () => {
    renderHero({
      target: { kind: "cast", tier: 1, cast: CAST_B },
      counts: { ...CAST_COUNTS, tier: 1, alreadyOfferedCount: 0 },
    });

    expect(
      screen.getByText("7 of 9 artists in Cast B have Vocals. 1 blocked."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/already booked or offered/)).not.toBeInTheDocument();
  });

  it("renders an avatar row naming candidates, with an overflow count past four", () => {
    renderHero({
      candidates: [
        { id: "1", name: "Marta Feld" },
        { id: "2", name: "Jonas Trier" },
        { id: "3", name: "Alex Kim" },
        { id: "4", name: "Sam Lee" },
        { id: "5", name: "Robin Vance" },
        { id: "6", name: "Dana Cole" },
      ],
    });

    expect(
      screen.getByText("Marta Feld, Jonas Trier, Alex Kim, Sam Lee and 2 more"),
    ).toBeInTheDocument();
  });

  it("shows the exclusion line with both counts joined by a middot", () => {
    renderHero();
    expect(screen.getByText("1 miss a required skill · 1 blocked on this date")).toBeInTheDocument();
  });

  it("omits the exclusion line when both counts are zero", () => {
    renderHero({ counts: { ...CAST_COUNTS, missingSkillCount: 0, blockedCount: 0 } });
    expect(screen.queryByText(/miss a required skill/)).not.toBeInTheDocument();
    expect(screen.queryByText(/blocked on this date/)).not.toBeInTheDocument();
  });

  it("omits only the missing-skill half when it is zero", () => {
    renderHero({ counts: { ...CAST_COUNTS, missingSkillCount: 0 } });
    expect(screen.queryByText(/miss a required skill/)).not.toBeInTheDocument();
    expect(screen.getByText("1 blocked on this date")).toBeInTheDocument();
  });

  it("clicking See the N artists fires onSeeArtists", () => {
    const { onSeeArtists } = renderHero();
    fireEvent.click(screen.getByRole("button", { name: "See the 7 artists" }));
    expect(onSeeArtists).toHaveBeenCalledTimes(1);
  });

  it("clicking Narrow this offer fires onNarrow and hides the chips until narrowActive is true", () => {
    const { onNarrow } = renderHero({
      narrowSkills: [{ id: "dance", name: "Dance" }],
      narrowSkillIds: [],
    });
    expect(screen.queryByText("Dance")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Narrow this offer" }));
    expect(onNarrow).toHaveBeenCalledTimes(1);
  });

  it("renders narrow-skill chips when narrowActive, and toggling one fires onToggleNarrowSkill", () => {
    const { onToggleNarrowSkill } = renderHero({
      narrowActive: true,
      narrowSkills: [{ id: "dance", name: "Dance" }],
      narrowSkillIds: [],
    });

    const chip = screen.getByRole("button", { name: "Dance" });
    fireEvent.click(chip);
    expect(onToggleNarrowSkill).toHaveBeenCalledWith("dance");
  });
});
