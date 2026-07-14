import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { DryRunDialog } from "./DryRunDialog";

describe("DryRunDialog", () => {
  it("renders candidates, the excluded line, and fires onConfirm", () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <DryRunDialog
        open
        onOpenChange={() => {}}
        tier={2}
        result={{
          candidates: [{ id: "a1", name: "Lena" }],
          excluded: { alreadyBooked: 1, blocked: 2, inactive: 0 },
        }}
        loading={false}
        flow={{ offer_delivery: "digest" }}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText(/Opening tier 2 would send 1 offers/i)).toBeInTheDocument();
    expect(screen.getByText(/Excluded: 1 already booked · 2 blocked · 0 inactive/i)).toBeInTheDocument();
    expect(screen.getByText("Lena")).toBeInTheDocument();
    expect(screen.getByText(/next daily digest/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open tier 2 · send 1 offers/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables confirm and shows the message when the dry run isn't ready", () => {
    renderWithProviders(
      <DryRunDialog
        open
        onOpenChange={() => {}}
        tier={1}
        result={{ candidates: [], excluded: { alreadyBooked: 0, blocked: 0, inactive: 0 }, message: "No sessions configured for this date" }}
        loading={false}
        flow={{ offer_delivery: "immediate" }}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("No sessions configured for this date")).toBeInTheDocument();
    expect(screen.queryByText("Lena")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open tier 1/i })).toBeDisabled();
  });

  // Regression: a dry run with zero eligible candidates but no `message` (e.g. every
  // eligible artist is already booked, blocked, or inactive, so the tier itself is valid
  // but nobody would get an offer) left confirm enabled: the button read "send 0 offers"
  // yet a producer could still click it. hasMessage-only gating missed this plain-zero case.
  it("disables confirm when there are zero candidates, even without a message", () => {
    renderWithProviders(
      <DryRunDialog
        open
        onOpenChange={() => {}}
        tier={1}
        result={{ candidates: [], excluded: { alreadyBooked: 3, blocked: 0, inactive: 0 } }}
        loading={false}
        flow={{ offer_delivery: "digest" }}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /open tier 1 · send 0 offers/i })).toBeDisabled();
  });

  it("shows a loading state while the dry run is in flight", () => {
    renderWithProviders(
      <DryRunDialog
        open
        onOpenChange={() => {}}
        tier={1}
        result={null}
        loading
        flow={{ offer_delivery: "digest" }}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open tier 1/i })).toBeDisabled();
  });
});
