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
          excluded: { alreadyBooked: 1, blocked: 2, inactive: 0, notEligible: 0, missingSkills: 0 },
          excludedDetail: [],
          excludedDetailTruncated: false,
        }}
        loading={false}
        flow={{ offer_delivery: "digest" }}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText(/Opening round 2 would send 1 asks/i)).toBeInTheDocument();
    expect(screen.getByText(/Excluded: 1 already booked · 2 not free · 0 inactive/i)).toBeInTheDocument();
    expect(screen.getByText("Lena")).toBeInTheDocument();
    expect(screen.getByText(/next daily send/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open round 2 · send 1 asks/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables confirm and shows the message when the dry run isn't ready", () => {
    renderWithProviders(
      <DryRunDialog
        open
        onOpenChange={() => {}}
        tier={1}
        result={{ candidates: [], excluded: { alreadyBooked: 0, blocked: 0, inactive: 0, notEligible: 0, missingSkills: 0 }, excludedDetail: [], excludedDetailTruncated: false, message: "No sessions configured for this date" }}
        loading={false}
        flow={{ offer_delivery: "immediate" }}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("No sessions configured for this date")).toBeInTheDocument();
    expect(screen.queryByText("Lena")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open round 1/i })).toBeDisabled();
  });

  // Regression: a dry run with zero eligible candidates but no `message` (e.g. every
  // eligible artist is already booked, not free, or inactive, so the round itself is valid
  // but nobody would get asked) left confirm enabled: the button read "send 0 asks"
  // yet a producer could still click it. hasMessage-only gating missed this plain-zero case.
  it("disables confirm when there are zero candidates, even without a message", () => {
    renderWithProviders(
      <DryRunDialog
        open
        onOpenChange={() => {}}
        tier={1}
        result={{ candidates: [], excluded: { alreadyBooked: 3, blocked: 0, inactive: 0, notEligible: 0, missingSkills: 0 }, excludedDetail: [], excludedDetailTruncated: false }}
        loading={false}
        flow={{ offer_delivery: "digest" }}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /open round 1 · send 0 asks/i })).toBeDisabled();
  });

  // Regression: the confirm button ignored the open-round mutation's pending state,
  // so a fast double click could open the round twice.
  it("disables confirm while the open-tier mutation is pending", () => {
    renderWithProviders(
      <DryRunDialog
        open
        onOpenChange={() => {}}
        tier={2}
        result={{
          candidates: [{ id: "a1", name: "Lena" }],
          excluded: { alreadyBooked: 0, blocked: 0, inactive: 0, notEligible: 0, missingSkills: 0 },
          excludedDetail: [],
          excludedDetailTruncated: false,
        }}
        loading={false}
        flow={{ offer_delivery: "digest" }}
        confirmPending
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /open round 2 · send 1 asks/i })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: /open round 1/i })).toBeDisabled();
  });

  // Regression: when the dry-run query FAILS (e.g. the open-offer-tier edge function
  // is unavailable / 503s), the dialog used to fall through to its zero-candidates body
  // and render a confident "send 0 asks" with all-zero exclusion counts, indistinguishable
  // from a genuine "nobody is eligible" result. A failed check must read as an error, not 0.
  it("shows an error state instead of a false '0 asks' when the dry run fails", () => {
    renderWithProviders(
      <DryRunDialog
        open
        onOpenChange={() => {}}
        tier={1}
        result={null}
        loading={false}
        error
        flow={{ offer_delivery: "digest" }}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText(/couldn't check who gets asked/i)).toBeInTheDocument();
    // The failure must NOT masquerade as a real zero-eligibility result.
    expect(screen.queryByText(/Excluded:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/would send 0 asks/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open round 1/i })).toBeDisabled();
  });

  it("fires onRetry from the error state", () => {
    const onRetry = vi.fn();
    renderWithProviders(
      <DryRunDialog
        open
        onOpenChange={() => {}}
        tier={1}
        result={null}
        loading={false}
        error
        onRetry={onRetry}
        flow={{ offer_delivery: "digest" }}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the not-eligible and missing-skills exclusion rows", () => {
    renderWithProviders(
      <DryRunDialog
        open
        onOpenChange={() => {}}
        tier={1}
        result={{
          candidates: [],
          excluded: { alreadyBooked: 0, blocked: 0, inactive: 0, notEligible: 2, missingSkills: 1 },
          excludedDetail: [],
          excludedDetailTruncated: false,
        }}
        loading={false}
        flow={{ offer_delivery: "digest" }}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("Can't be asked for this show: 2")).toBeInTheDocument();
    expect(screen.getByText("Missing required skills: 1")).toBeInTheDocument();
  });
});
