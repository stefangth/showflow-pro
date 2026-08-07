import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CockpitRail, type CockpitRailProps } from "./CockpitRail";

const base: CockpitRailProps = {
  times: "14:00 / 19:30",
  venue: "Volksbühne",
  city: "Berlin",
  source: "airtable",
  castChips: [
    { label: "Aurora Cast", kind: "inherited" },
    { label: "Extra Cast", kind: "override" },
  ],
  skillChips: ["Pointe", "Partnering"],
  activity: [
    { iso: "2026-03-10T08:12:00Z", text: "Tier 2 opened" },
    { iso: "2026-03-09T09:00:00Z", text: "Marek Kowalczyk confirmed" },
  ],
  chatUnread: 3,
  chatPreview: "See you at the stage door",
  onEditSetup: vi.fn(),
};

describe("CockpitRail", () => {
  it("renders date facts: times, venue, city, and the Airtable source", () => {
    render(<CockpitRail {...base} />);
    expect(screen.getByText("14:00 / 19:30")).toBeInTheDocument();
    expect(screen.getByText("Volksbühne")).toBeInTheDocument();
    expect(screen.getByText("Berlin")).toBeInTheDocument();
    expect(screen.getByText(/airtable/i)).toBeInTheDocument();
  });

  it("renders every cast chip and skill chip", () => {
    render(<CockpitRail {...base} />);
    expect(screen.getByText("Aurora Cast")).toBeInTheDocument();
    expect(screen.getByText("Extra Cast")).toBeInTheDocument();
    expect(screen.getByText("Pointe")).toBeInTheDocument();
    expect(screen.getByText("Partnering")).toBeInTheDocument();
  });

  it("renders activity texts newest-first, in the order given", () => {
    render(<CockpitRail {...base} />);
    const list = screen.getByTestId("cockpit-activity");
    expect(within(list).getByText("Tier 2 opened")).toBeInTheDocument();
    expect(within(list).getByText("Marek Kowalczyk confirmed")).toBeInTheDocument();
    const text = list.textContent ?? "";
    expect(text.indexOf("Tier 2 opened")).toBeLessThan(text.indexOf("Marek Kowalczyk confirmed"));
  });

  it("omits the activity section when there are no events", () => {
    render(<CockpitRail {...base} activity={[]} />);
    expect(screen.queryByTestId("cockpit-activity")).not.toBeInTheDocument();
  });

  it("shows the unread badge and preview when there are unread messages", () => {
    render(<CockpitRail {...base} />);
    expect(screen.getByTestId("chat-unread")).toHaveTextContent("3");
    expect(screen.getByText("See you at the stage door")).toBeInTheDocument();
  });

  it("hides the unread badge when there are no unread messages", () => {
    render(<CockpitRail {...base} chatUnread={0} />);
    expect(screen.queryByTestId("chat-unread")).not.toBeInTheDocument();
  });

  it("fires onEditSetup when the Edit date setup button is clicked", () => {
    const onEditSetup = vi.fn();
    render(<CockpitRail {...base} onEditSetup={onEditSetup} />);
    fireEvent.click(screen.getByRole("button", { name: /edit date setup/i }));
    expect(onEditSetup).toHaveBeenCalledOnce();
  });
});
