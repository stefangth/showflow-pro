import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { TierTimeline } from "./TierTimeline";
import i18n from "@/i18n";
import { tierConceptNote } from "@/lib/bookings/actionCopy";
import { ROUTES } from "@/config/app.config";
import type { TierLadderRow } from "@/data/tierLadder";

// TierTimeline now hosts the three Offers-tab cards (design 1e) and still links to
// Settings, Documentation in its tier-concept note, so every render needs a Router.
function renderTimeline(ui: React.ReactElement) {
  return renderWithProviders(<MemoryRouter>{ui}</MemoryRouter>);
}

const NEXT_ROW: TierLadderRow = {
  tier: 1,
  casts: [],
  castTotal: 3,
  matchCount: 2,
  missingSkillCount: 0,
  blockedCount: 0,
  alreadyOfferedCount: 0,
};

// Un-annotated (like the old baseProps) so vi.fn() callbacks stay assignable; the
// JSX spread checks the shape against TierTimelineProps at each call site. Only the
// discriminated-union literals need `as const`.
const baseProps = {
  showDateId: "d1",
  dateLabel: "Mon 14 Jul 2026",
  flow: { artist_acceptance: true, offer_delivery: "digest" as const },
  bookings: [] as { status: string; offer_tier: number | null }[],
  canManage: true,
  hasSession: true,
  ladderSource: "org" as const,
  skills: [] as { id: string; name: string }[],
  openedTiers: [] as { tier: number; openedAt: string; closedAt: string | null }[],
  onOpenTier: vi.fn(),
  onCloseTier: vi.fn(),
  onPreviewTier: vi.fn(),
  // design 1e cards
  show: "Aurora",
  slots: [],
  showSkillIds: [] as string[],
  dateSkillIds: [] as string[],
  droppedSkillIds: [] as string[],
  onResetSkills: vi.fn(),
  onEditSkills: vi.fn(),
  ladderRows: [NEXT_ROW],
  cityName: "Berlin",
  statusByTier: [] as { tier: number; sent: number; accepted: number; pending: number; cancelled: number }[],
  nextTier: 1 as number | null,
  dateFilled: false,
  nextTierTarget: { kind: "tier" as const, tier: 1 },
  nextTierCounts: NEXT_ROW as TierLadderRow | null,
  requiredSkillNames: [] as string[],
  requiredSkillIds: [] as string[],
  candidates: [] as { id: string; name: string }[],
};

describe("TierTimeline", () => {
  it("mounts the three cockpit cards in tiered mode", () => {
    renderTimeline(
      <TierTimeline
        {...baseProps}
        openedTiers={[{ tier: 1, openedAt: "2026-07-01T00:00:00Z", closedAt: null }]}
        statusByTier={[{ tier: 1, sent: 2, accepted: 1, pending: 1, cancelled: 0 }]}
      />,
    );
    expect(screen.getByText("Skills required on this date")).toBeInTheDocument();
    expect(screen.getByText(/NEXT ASK/)).toBeInTheDocument();
    expect(screen.getByText("WHO THIS DATE ASKS · PRODUCTION-SPECIFIC")).toBeInTheDocument();
  });

  it("opens the confirm dialog from the hero and fires onOpenTier for the next tier", () => {
    const onOpenTier = vi.fn();
    renderTimeline(<TierTimeline {...baseProps} onOpenTier={onOpenTier} />);
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /^start asking$/i }));
    expect(onOpenTier).toHaveBeenCalledWith(1, []);
  });

  it("fires onPreviewTier for the next tier when 'See the N artists' is clicked", () => {
    const onPreviewTier = vi.fn();
    renderTimeline(<TierTimeline {...baseProps} onPreviewTier={onPreviewTier} />);
    fireEvent.click(screen.getByRole("button", { name: /see the 2 artists/i }));
    expect(onPreviewTier).toHaveBeenCalledWith(1, []);
  });

  it("renders a direct-mode note instead of the cockpit when artist_acceptance is off", () => {
    renderTimeline(
      <TierTimeline {...baseProps} flow={{ artist_acceptance: false, offer_delivery: "digest" }} />,
    );
    expect(screen.getByText(/direct booking/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open tier 1/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Skills required on this date")).not.toBeInTheDocument();
  });

  // Regression: the confirm dialog always claimed offers go out "in the next daily
  // offer digest", even for orgs whose flow emails offers the moment the tier opens.
  it("confirm copy reflects immediate offer delivery", () => {
    renderTimeline(
      <TierTimeline {...baseProps} flow={{ artist_acceptance: true, offer_delivery: "immediate" }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    expect(screen.getByText(/emailed the moment the tier opens/i)).toBeInTheDocument();
    expect(screen.queryByText(/daily offer digest/i)).not.toBeInTheDocument();
  });

  it("confirm copy mentions the daily digest for digest delivery", () => {
    renderTimeline(<TierTimeline {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    expect(screen.getByText(/next daily offer digest/i)).toBeInTheDocument();
  });

  // Regression: only the trigger button checked openPending, so a double click on the
  // dialog's confirm could fire onOpenTier twice while the mutation was in flight.
  it("disables the confirm action while the open mutation is pending", () => {
    const { rerender } = renderTimeline(<TierTimeline {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    expect(screen.getByRole("button", { name: /^start asking$/i })).toBeEnabled();
    rerender(<MemoryRouter><TierTimeline {...baseProps} openPending /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /^start asking$/i })).toBeDisabled();
  });

  it("renders the show-specific priorities hint only when ladderSource is show", () => {
    const { rerender } = renderTimeline(<TierTimeline {...baseProps} ladderSource="show" />);
    expect(screen.getByText("Using production-specific priorities")).toBeInTheDocument();
    rerender(<MemoryRouter><TierTimeline {...baseProps} ladderSource="org" /></MemoryRouter>);
    expect(screen.queryByText("Using production-specific priorities")).not.toBeInTheDocument();
  });

  it("opens with the toggled narrow-skill ids", () => {
    const onOpenTier = vi.fn();
    renderTimeline(
      <TierTimeline {...baseProps} skills={[{ id: "s1", name: "Juggling" }]} onOpenTier={onOpenTier} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /narrow this ask/i }));
    fireEvent.click(screen.getByRole("button", { name: "Juggling" }));
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /^start asking$/i }));
    expect(onOpenTier).toHaveBeenCalledWith(1, ["s1"]);
  });

  it("opens with an empty skill filter when no narrow chip is toggled", () => {
    const onOpenTier = vi.fn();
    renderTimeline(
      <TierTimeline {...baseProps} skills={[{ id: "s1", name: "Juggling" }]} onOpenTier={onOpenTier} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /^start asking$/i }));
    expect(onOpenTier).toHaveBeenCalledWith(1, []);
  });

  // Regression: skillFilterIds carried over across tier selections; the narrow cue
  // in the (non-cast) tier confirm copy must still name the toggled skill.
  it("names the toggled narrow skill in the tier confirm dialog cue", () => {
    renderTimeline(<TierTimeline {...baseProps} skills={[{ id: "s1", name: "Juggling" }]} />);
    fireEvent.click(screen.getByRole("button", { name: /narrow this ask/i }));
    fireEvent.click(screen.getByRole("button", { name: "Juggling" }));
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    expect(
      screen.getByText(/Only artists with all of these skills receive offers: Juggling\./),
    ).toBeInTheDocument();
  });

  // C3.4 cast-aware copy: when the next tier resolves to a single cast, the confirm
  // dialog names the cast and its match count rather than the bare tier noun.
  it("uses cast-aware confirm copy when the next tier resolves to a single cast", () => {
    renderTimeline(
      <TierTimeline
        {...baseProps}
        nextTierTarget={{ kind: "cast", tier: 1, cast: { id: "cast-a", name: "Cast A" } }}
        nextTierCounts={{ ...NEXT_ROW, castTotal: 5, matchCount: 4 }}
        requiredSkillNames={["Vocals"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open offers to cast a/i }));
    expect(screen.getByText("Open offers to Cast A?")).toBeInTheDocument();
    expect(screen.getByText(/4 of the 5 artists in Cast A get an offer/)).toBeInTheDocument();
  });

  it("closing an opened tier from the ladder fires onCloseTier through the withdraw dialog", () => {
    const onCloseTier = vi.fn();
    renderTimeline(
      <TierTimeline
        {...baseProps}
        nextTier={null}
        openedTiers={[{ tier: 1, openedAt: "2026-07-01T00:00:00Z", closedAt: null }]}
        statusByTier={[{ tier: 1, sent: 2, accepted: 1, pending: 1, cancelled: 0 }]}
        bookings={[{ status: "suggested", offer_tier: 1 }]}
        onCloseTier={onCloseTier}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close this round/i }));
    fireEvent.click(screen.getByRole("button", { name: /withdraw unanswered offers/i }));
    expect(onCloseTier).toHaveBeenCalledWith(1, true);
  });

  it("fires the required-skills reset and edit callbacks", () => {
    const onResetSkills = vi.fn();
    const onEditSkills = vi.fn();
    renderTimeline(
      <TierTimeline
        {...baseProps}
        skills={[{ id: "s1", name: "Juggling" }, { id: "s2", name: "Dance" }]}
        showSkillIds={["s1"]}
        dateSkillIds={["s2"]}
        onResetSkills={onResetSkills}
        onEditSkills={onEditSkills}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset to computed" }));
    expect(onResetSkills).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEditSkills).toHaveBeenCalledTimes(1);
  });

  // P3.4: point-of-action narration — what a tier even IS, plus an escape hatch
  // into the full explanation.
  it("states the tier concept and links to the docs", () => {
    renderTimeline(<TierTimeline {...baseProps} />);
    expect(screen.getByText(tierConceptNote(i18n.getFixedT("en", "bookingCopy")))).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "How casts and rounds work" });
    expect(link).toHaveAttribute("href", ROUTES.HELP);
  });
});
