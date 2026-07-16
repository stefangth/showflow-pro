import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import { FlowRail } from "./FlowRail";

const times = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };

function baseProps() {
  return {
    flow: BOOKING_FLOW_DEFAULTS,
    times,
    dirtyCount: 0,
    saving: false,
    onSave: () => {},
    onDiscard: () => {},
  };
}

describe("FlowRail change history", () => {
  it("shows a loading skeleton while the audit query is in flight", () => {
    renderWithProviders(<FlowRail {...baseProps()} audit={[]} isLoading isError={false} />);
    const history = screen.getByText("Change history").parentElement as HTMLElement;
    expect(history.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(screen.queryByText("No changes recorded yet.")).not.toBeInTheDocument();
  });

  it("shows a destructive alert when the audit query errors", () => {
    renderWithProviders(<FlowRail {...baseProps()} audit={[]} isLoading={false} isError />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load change history.");
    expect(screen.queryByText("No changes recorded yet.")).not.toBeInTheDocument();
  });

  it("shows the empty state only once loaded without error and genuinely empty", () => {
    renderWithProviders(<FlowRail {...baseProps()} audit={[]} isLoading={false} isError={false} />);
    expect(screen.getByText("No changes recorded yet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
