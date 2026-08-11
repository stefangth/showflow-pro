import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { TierTimeline } from "./TierTimeline";
import { TIER_CONCEPT_NOTE } from "@/lib/bookings/actionCopy";
import { ROUTES } from "@/config/app.config";

// TierTimeline now links to Settings, Documentation (ROUTES.SETTINGS?tab=docs) next to the
// tier picker, so every render needs a Router in scope.
function renderTimeline(ui: React.ReactElement) {
  return renderWithProviders(<MemoryRouter>{ui}</MemoryRouter>);
}

const baseProps = {
  showDateId: "d1",
  cityId: "c1",
  dateLabel: "Mon 14 Jul 2026",
  flow: { artist_acceptance: true, offer_delivery: "digest" as const },
  canManage: true,
  hasSession: true,
  tiers: { priorities: [1], hasAdHoc: false },
  skills: [] as { id: string; name: string }[],
  ladderSource: "org" as const,
  onOpenTier: vi.fn(),
  onCloseTier: vi.fn(),
  onPreviewTier: vi.fn(),
};

describe("TierTimeline", () => {
  it("renders an opened tier with its fill counts", () => {
    renderTimeline(
      <TierTimeline
        {...baseProps}
        bookings={[
          { status: "soft_booked", offer_tier: 1 },
          { status: "suggested", offer_tier: 1 },
        ]}
        openedTiers={[{ tier: 1, openedAt: "2026-07-01T00:00:00Z", closedAt: null }]}
      />,
    );
    expect(screen.getAllByText(/Tier 1/).length).toBeGreaterThan(0);
    expect(screen.getByText(/1 accepted/)).toBeInTheDocument();
    expect(screen.getByText(/1 pending/)).toBeInTheDocument();
  });

  it("fires onPreviewTier for the effective tier when Preview is clicked", () => {
    const onPreviewTier = vi.fn();
    renderTimeline(
      <TierTimeline
        {...baseProps}
        bookings={[]}
        openedTiers={[]}
        onPreviewTier={onPreviewTier}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /preview who gets offers/i }));
    expect(onPreviewTier).toHaveBeenCalledWith(1, []);
  });

  it("renders a direct-mode note instead of tier controls when artist_acceptance is off", () => {
    renderTimeline(
      <TierTimeline
        {...baseProps}
        flow={{ ...baseProps.flow, artist_acceptance: false }}
        bookings={[]}
        openedTiers={[]}
      />,
    );
    expect(screen.getByText(/direct booking/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /preview who gets offers/i })).not.toBeInTheDocument();
  });

  // Regression: the confirm dialog always claimed offers go out "in the next daily
  // offer digest", even for orgs whose flow emails offers the moment the tier opens.
  it("confirm copy reflects immediate offer delivery", () => {
    renderTimeline(
      <TierTimeline
        {...baseProps}
        flow={{ artist_acceptance: true, offer_delivery: "immediate" }}
        bookings={[]}
        openedTiers={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    expect(screen.getByText(/emailed the moment the tier opens/i)).toBeInTheDocument();
    expect(screen.queryByText(/daily offer digest/i)).not.toBeInTheDocument();
  });

  it("confirm copy mentions the daily digest for digest delivery", () => {
    renderTimeline(
      <TierTimeline {...baseProps} bookings={[]} openedTiers={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    expect(screen.getByText(/next daily offer digest/i)).toBeInTheDocument();
  });

  // Regression: only the trigger button checked openPending, so a double click on the
  // dialog's confirm could fire onOpenTier twice while the mutation was in flight.
  it("disables the confirm action while the open mutation is pending", () => {
    const props = { ...baseProps, bookings: [], openedTiers: [] };
    const { rerender } = renderTimeline(<TierTimeline {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    expect(screen.getByRole("button", { name: /^open offers$/i })).toBeEnabled();
    rerender(<MemoryRouter><TierTimeline {...props} openPending /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /^open offers$/i })).toBeDisabled();
  });

  it("renders the show-specific priorities hint only when ladderSource is show", () => {
    const { rerender } = renderTimeline(
      <TierTimeline {...baseProps} bookings={[]} openedTiers={[]} ladderSource="show" />,
    );
    expect(screen.getByText("Using show-specific priorities")).toBeInTheDocument();
    rerender(<MemoryRouter><TierTimeline {...baseProps} bookings={[]} openedTiers={[]} ladderSource="org" /></MemoryRouter>);
    expect(screen.queryByText("Using show-specific priorities")).not.toBeInTheDocument();
  });

  it("confirms opening the tier with the toggled skill filter ids", () => {
    const onOpenTier = vi.fn();
    renderTimeline(
      <TierTimeline
        {...baseProps}
        bookings={[]}
        openedTiers={[]}
        skills={[{ id: "s1", name: "Juggling" }]}
        onOpenTier={onOpenTier}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Juggling" }));
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /^open offers$/i }));
    expect(onOpenTier).toHaveBeenCalledWith(1, ["s1"]);
  });

  it("confirms opening the tier with an empty skill filter when no chips are toggled", () => {
    const onOpenTier = vi.fn();
    renderTimeline(
      <TierTimeline
        {...baseProps}
        bookings={[]}
        openedTiers={[]}
        skills={[{ id: "s1", name: "Juggling" }]}
        onOpenTier={onOpenTier}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /^open offers$/i }));
    expect(onOpenTier).toHaveBeenCalledWith(1, []);
  });

  // Regression: skillFilterIds carried over across tier selections, so a producer
  // who scoped tier 1 to a skill silently under-offered on tier 2 with the same filter.
  it("clears the skill filter when the tier selection changes", async () => {
    const onOpenTier = vi.fn();
    renderTimeline(
      <TierTimeline
        {...baseProps}
        bookings={[]}
        openedTiers={[]}
        tiers={{ priorities: [1, 2], hasAdHoc: false }}
        skills={[{ id: "s1", name: "Juggling" }]}
        onOpenTier={onOpenTier}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Juggling" }));
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Tier 2" }));
    fireEvent.click(screen.getByRole("button", { name: /open tier 2/i }));
    fireEvent.click(screen.getByRole("button", { name: /^open offers$/i }));
    expect(onOpenTier).toHaveBeenCalledWith(2, []);
  });

  it("includes the toggled skill's name in the confirm dialog cue when the tier is unchanged", () => {
    renderTimeline(
      <TierTimeline
        {...baseProps}
        bookings={[]}
        openedTiers={[]}
        skills={[{ id: "s1", name: "Juggling" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Juggling" }));
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    expect(screen.getByText(/Only artists with all of these skills receive offers: Juggling\./)).toBeInTheDocument();
  });

  // P3.4: point-of-action narration next to the tier picker, before a producer has ever
  // opened one — what a tier even IS, plus an escape hatch into the full explanation.
  it("states the tier concept and links to the docs, next to the tier picker", () => {
    renderTimeline(
      <TierTimeline {...baseProps} bookings={[]} openedTiers={[]} />,
    );
    expect(screen.getByText(TIER_CONCEPT_NOTE)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "How casts and tiers work" });
    expect(link).toHaveAttribute("href", `${ROUTES.SETTINGS}?tab=docs`);
  });
});
