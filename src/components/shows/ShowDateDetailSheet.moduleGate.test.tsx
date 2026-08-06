import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useEntitlements", () => ({ useFeature: vi.fn() }));

import { useFeature } from "@/hooks/useEntitlements";
import { BookingCardSection } from "./ShowDateDetailSheet";

const CAST = [
  { id: "b1", status: "confirmed", is_understudy: false, artist: { id: "a1", name: "Ada Lovelace" } },
];

describe("ShowDateDetailSheet booking card gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the offers UI when booking_flow is on", () => {
    vi.mocked(useFeature).mockReturnValue(true);
    render(<BookingCardSection bookings={CAST as never}>{<div data-testid="offers" />}</BookingCardSection>);
    expect(screen.getByTestId("offers")).toBeInTheDocument();
    expect(screen.queryByTestId("module-gate-booking_flow")).not.toBeInTheDocument();
  });

  it("replaces the offers UI with the gate and keeps the confirmed cast readable", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    render(<BookingCardSection bookings={CAST as never}>{<div data-testid="offers" />}</BookingCardSection>);
    expect(screen.queryByTestId("offers")).not.toBeInTheDocument();
    expect(screen.getByTestId("module-gate-booking_flow")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });
});
