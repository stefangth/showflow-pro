import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BOOKING_FLOW_TEMPLATE_DEFAULTS, type BookingFlowTemplates } from "@/lib/bookingFlow";
import { FlowPresets } from "./FlowPresets";

describe("FlowPresets", () => {
  it("shows the Custom chip inline on the selected template and has no Custom tile", () => {
    render(<FlowPresets active="fasttrack" customized onSelect={vi.fn()} />);
    const fastTrack = screen.getByRole("button", { name: /autopilot/i });
    expect(fastTrack).toHaveTextContent("Custom");
    expect(screen.queryByText("Your own combination of the steps below.")).not.toBeInTheDocument();
  });

  it("greys out every template when editing is not allowed", () => {
    render(<FlowPresets active="off" disabled onSelect={vi.fn()} />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });

  it("describes the current platform template values instead of a seeded preset", () => {
    const templates: BookingFlowTemplates = {
      ...BOOKING_FLOW_TEMPLATE_DEFAULTS,
      fasttrack: {
        flow: {
          ...BOOKING_FLOW_TEMPLATE_DEFAULTS.fasttrack.flow,
          auto_open_tier1: false,
          offer_delivery: "digest",
          producer_confirmation: true,
        },
        times: {
          ...BOOKING_FLOW_TEMPLATE_DEFAULTS.fasttrack.times,
          windowHours: 72,
          offerDigestHour: 7,
        },
      },
    };
    render(<FlowPresets active="fasttrack" templates={templates} onSelect={vi.fn()} />);

    const fastTrack = screen.getByRole("button", { name: /autopilot/i });
    expect(fastTrack).toHaveTextContent("You send each ask yourself");
    expect(fastTrack).toHaveTextContent("07:00h (Berlin, Germany) daily send");
    expect(fastTrack).toHaveTextContent("answer by 72 h");
    expect(fastTrack).toHaveTextContent("you get the last word");
    expect(fastTrack).not.toHaveTextContent("immediate offers");
  });
});
