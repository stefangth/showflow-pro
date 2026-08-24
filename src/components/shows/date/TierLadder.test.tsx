import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { TierLadderRow } from "@/data/tierLadder";
import { TierLadder, type TierLadderProps, type NextAsk } from "./TierLadder";

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
      filled={false}
      headlineCount={null}
      noNextCast={false}
      nextAsk={null}
      onCloseTier={onCloseTier}
      {...overrides}
    />,
  );
  return { ...utils, onCloseTier };
}

function makeNextAsk(overrides: Partial<NextAsk> = {}): NextAsk {
  return {
    target: { kind: "cast" as const, tier: 2, cast: { id: "cast-b", name: "Cast B" } },
    counts: ROWS[1],
    candidates: [{ id: "a1", name: "Marta Feld" }],
    requiredSkillNames: ["Piano"],
    onOpen: vi.fn(),
    onSeeArtists: vi.fn(),
    onNarrow: vi.fn(),
    narrowActive: false,
    narrowSkills: [],
    narrowSkillIds: [],
    onToggleNarrowSkill: vi.fn(),
    ...overrides,
  };
}

describe("TierLadder", () => {
  it("renders the header and city-scoped subtitle", () => {
    renderLadder();
    expect(screen.getByText("WHO THIS DATE ASKS · PRODUCTION-SPECIFIC")).toBeInTheDocument();
    expect(screen.getByText("Casts in priority order for Berlin")).toBeInTheDocument();
  });

  it("shows an open round's pending line and a Close control", () => {
    renderLadder();
    // Open (opened, not closed, date not filled): concise pending line, not the
    // full sent/accepted/pending/cancelled breakdown.
    expect(screen.getByText("3 pending")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close this round" })).toBeInTheDocument();
  });

  it("shows the next round's match line", () => {
    renderLadder();
    expect(screen.getByText("7 of 9 artists match")).toBeInTheDocument();
  });

  it("shows a later round's match line with its miss-skill detail", () => {
    renderLadder();
    expect(screen.getByText("4 of 11 artists match · 7 miss a required skill")).toBeInTheDocument();
  });

  it("clicking Close fires onCloseTier with the open round's tier", () => {
    const { onCloseTier } = renderLadder();
    fireEvent.click(screen.getByRole("button", { name: "Close this round" }));
    expect(onCloseTier).toHaveBeenCalledTimes(1);
    expect(onCloseTier).toHaveBeenCalledWith(1);
  });

  it("a closed round on an unfilled date reads Closed (purple), not Filled, and has no Close control", () => {
    renderLadder({ openedTiers: [{ tier: 1, closed: true }], filled: false });
    expect(screen.getByText("Closed · 4 accepted")).toBeInTheDocument();
    expect(screen.queryByText(/^Filled/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Close/ })).not.toBeInTheDocument();
  });

  it("an opened round turns green (Filled) only once the date's parts are filled", () => {
    renderLadder({ openedTiers: [{ tier: 1, closed: true }], filled: true });
    expect(screen.getByText("Filled · 4 accepted")).toBeInTheDocument();
    expect(screen.queryByText(/^Closed/)).not.toBeInTheDocument();
  });

  it("shows an open round's expiry time when the caller supplies one", () => {
    renderLadder({ statusByTier: [{ tier: 1, sent: 9, accepted: 4, pending: 3, cancelled: 2, expiresLabel: "17:00" }] });
    expect(screen.getByText("3 pending · expires 17:00")).toBeInTheDocument();
  });

  it("renders the ready-to-ask headline count when given", () => {
    renderLadder({ headlineCount: 7 });
    expect(screen.getByText("Ready to ask")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("peeks an empty next round when no next cast is set up and the date is unfilled", () => {
    renderLadder({ noNextCast: true });
    expect(screen.getByText("Next round")).toBeInTheDocument();
    expect(screen.getByText("No next cast set up")).toBeInTheDocument();
  });

  it("hides the empty peek once the date is filled", () => {
    renderLadder({ noNextCast: true, filled: true, openedTiers: [{ tier: 1, closed: true }] });
    expect(screen.queryByText("No next cast set up")).not.toBeInTheDocument();
  });

  it("puts the Open action on the next round and fires onOpen", () => {
    const nextAsk = makeNextAsk();
    renderLadder({ nextAsk });
    const openBtn = screen.getByRole("button", { name: "Open offers" });
    fireEvent.click(openBtn);
    expect(nextAsk.onOpen).toHaveBeenCalledTimes(1);
    // The next ask's body sentence renders beneath the strip.
    expect(screen.getByText(/Cast B/)).toBeInTheDocument();
  });

  it("disables Open when the next round has no matching artists", () => {
    const nextAsk = makeNextAsk({ counts: { ...ROWS[1], matchCount: 0 } });
    renderLadder({ nextAsk });
    expect(screen.getByRole("button", { name: "Open offers" })).toBeDisabled();
  });
});
