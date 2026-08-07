import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useEntitlements", () => {
  const useFeature = vi.fn();
  return { useFeature, useModuleGate: (f: string) => ({ allow: useFeature(f), pending: false }) };
});

import { useFeature } from "@/hooks/useEntitlements";
import { BookingCardSection, BookingStatusSection } from "./ShowDateDetailSheet";

const CAST = [
  { id: "b1", status: "confirmed", is_understudy: false, artist: { id: "a1", name: "Ada Lovelace" } },
  { id: "b2", status: "soft_booked", is_understudy: true, artist: { id: "a2", name: "Grace Hopper" } },
];

function renderSection(overrides: Partial<Parameters<typeof BookingCardSection>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <BookingCardSection
      bookings={CAST as never}
      canManage
      showConfirm
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    >
      <div data-testid="offers" />
    </BookingCardSection>,
  );
  return { onConfirm, onCancel };
}

describe("ShowDateDetailSheet booking card gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the offers UI when booking_flow is on", () => {
    vi.mocked(useFeature).mockReturnValue(true);
    renderSection();
    expect(screen.getByTestId("offers")).toBeInTheDocument();
    expect(screen.queryByTestId("module-gate-booking_flow")).not.toBeInTheDocument();
  });

  it("replaces the offers UI with the gate and keeps the confirmed cast readable", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    renderSection();
    expect(screen.queryByTestId("offers")).not.toBeInTheDocument();
    expect(screen.getByTestId("module-gate-booking_flow")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  // I1(2): the assigned-artists card used to sit OUTSIDE the gate with live
  // Confirm/Cancel buttons. Post-RLS-floor those writes match zero rows and toast
  // the misleading "This booking changed" message, so the controls must be gone,
  // not merely disabled.
  it("entitled: the assigned-artists card carries its Confirm and Cancel controls", () => {
    vi.mocked(useFeature).mockReturnValue(true);
    renderSection();
    expect(screen.getByText("Assigned Artists")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(2);
  });

  it("unentitled: the cast stays visible but every write control is gone", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    renderSection();
    expect(screen.getByText("Assigned Artists")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("renders the cast exactly once in both states", () => {
    vi.mocked(useFeature).mockReturnValue(true);
    const on = render(
      <BookingCardSection
        bookings={CAST as never}
        canManage
        showConfirm
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      >
        <div data-testid="offers" />
      </BookingCardSection>,
    );
    expect(on.getAllByText("Ada Lovelace")).toHaveLength(1);
    on.unmount();

    vi.mocked(useFeature).mockReturnValue(false);
    renderSection();
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(1);
  });
});

describe("ShowDateDetailSheet booking status strip gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the funnel when booking_flow is on", () => {
    vi.mocked(useFeature).mockReturnValue(true);
    render(<BookingStatusSection bookings={[]} slots={null} upNextItems={[]} programLabel="Cats" />);
    expect(screen.getByLabelText("Booking funnel")).toBeInTheDocument();
  });

  it("renders nothing when booking_flow is off", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    const { container } = render(
      <BookingStatusSection bookings={[]} slots={null} upNextItems={[]} programLabel="Cats" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
