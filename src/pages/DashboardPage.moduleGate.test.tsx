import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("@/hooks/useEntitlements", () => ({ useFeature: vi.fn() }));
import { useFeature } from "@/hooks/useEntitlements";
import { ProducerBookingSection } from "./DashboardPage";

describe("DashboardPage producer booking section", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the cards when booking_flow is on", () => {
    vi.mocked(useFeature).mockReturnValue(true);
    render(<ProducerBookingSection><div data-testid="cards" /></ProducerBookingSection>);
    expect(screen.getByTestId("cards")).toBeInTheDocument();
  });

  it("replaces them with the gate notice when off", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    render(<ProducerBookingSection><div data-testid="cards" /></ProducerBookingSection>);
    expect(screen.queryByTestId("cards")).not.toBeInTheDocument();
    expect(screen.getByTestId("module-gate-booking_flow")).toBeInTheDocument();
  });
});
