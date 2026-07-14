import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { TierTimeline } from "./TierTimeline";

const baseProps = {
  showDateId: "d1",
  cityId: "c1",
  dateLabel: "Mon 14 Jul 2026",
  flow: { artist_acceptance: true, offer_delivery: "digest" as const },
  canManage: true,
  hasSession: true,
  tiers: { priorities: [1], hasAdHoc: false },
  onOpenTier: vi.fn(),
  onCloseTier: vi.fn(),
  onPreviewTier: vi.fn(),
};

describe("TierTimeline", () => {
  it("renders an opened tier with its fill counts", () => {
    renderWithProviders(
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
    renderWithProviders(
      <TierTimeline
        {...baseProps}
        bookings={[]}
        openedTiers={[]}
        onPreviewTier={onPreviewTier}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /preview who gets offers/i }));
    expect(onPreviewTier).toHaveBeenCalledWith(1);
  });

  it("renders a direct-mode note instead of tier controls when artist_acceptance is off", () => {
    renderWithProviders(
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
    renderWithProviders(
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
    renderWithProviders(
      <TierTimeline {...baseProps} bookings={[]} openedTiers={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    expect(screen.getByText(/next daily offer digest/i)).toBeInTheDocument();
  });

  // Regression: only the trigger button checked openPending, so a double click on the
  // dialog's confirm could fire onOpenTier twice while the mutation was in flight.
  it("disables the confirm action while the open mutation is pending", () => {
    const props = { ...baseProps, bookings: [], openedTiers: [] };
    const { rerender } = renderWithProviders(<TierTimeline {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /open tier 1/i }));
    expect(screen.getByRole("button", { name: /^open offers$/i })).toBeEnabled();
    rerender(<TierTimeline {...props} openPending />);
    expect(screen.getByRole("button", { name: /^open offers$/i })).toBeDisabled();
  });
});
