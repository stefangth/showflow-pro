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
  it("renders date facts: times, venue + city on one line, and the Airtable source", () => {
    render(<CockpitRail {...base} />);
    expect(screen.getByText("14:00 / 19:30")).toBeInTheDocument();
    // Venue and city share a single map-pin line, matching the reference.
    expect(screen.getByText("Volksbühne, Berlin")).toBeInTheDocument();
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

  it("renders the Up next block (digest / auto-escalate) when items are provided", () => {
    render(<CockpitRail {...base} upNext={[
      { kind: "digest", tone: "violet", text: "Digest sends daily · 18:00" },
      { kind: "escalate", tone: "neutral", text: "Auto-escalate: off" },
    ]} />);
    expect(screen.getByText(/up next/i)).toBeInTheDocument();
    expect(screen.getByText("Digest sends daily · 18:00")).toBeInTheDocument();
    expect(screen.getByText("Auto-escalate: off")).toBeInTheDocument();
  });

  it("omits the Up next block when there are no items", () => {
    render(<CockpitRail {...base} upNext={[]} />);
    expect(screen.queryByText(/up next/i)).not.toBeInTheDocument();
  });

  it("renders read-only notes when provided", () => {
    render(<CockpitRail {...base} notes="Press night — reduced orchestra" />);
    expect(screen.getByText("Press night — reduced orchestra")).toBeInTheDocument();
  });

  it("with no chat preview, shows a neutral Chat affordance (never a false 'No messages yet') and navigates", () => {
    const onOpenChat = vi.fn();
    render(<CockpitRail {...base} chatUnread={0} chatPreview={null} onOpenChat={onOpenChat} />);
    expect(screen.queryByText(/no messages yet/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open the chat tab/i }));
    expect(onOpenChat).toHaveBeenCalledOnce();
  });

  it("renders a Details section with every custom field's label + formatted value", () => {
    render(
      <CockpitRail
        {...base}
        customFields={[
          { key: "budget_code", label: "Budget code", value: "OP-4471" },
          { key: "press_night", label: "Press night", value: "Yes" },
        ]}
      />,
    );
    expect(screen.getByText(/^details$/i)).toBeInTheDocument();
    expect(screen.getByText("Budget code")).toBeInTheDocument();
    expect(screen.getByText("OP-4471")).toBeInTheDocument();
    expect(screen.getByText("Press night")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("omits the Details section when there are no custom fields", () => {
    render(<CockpitRail {...base} customFields={[]} />);
    expect(screen.queryByText(/^details$/i)).not.toBeInTheDocument();
  });

  it("omits the Details section when customFields is not provided", () => {
    render(<CockpitRail {...base} />);
    expect(screen.queryByText(/^details$/i)).not.toBeInTheDocument();
  });
});

// "Anyone can be asked." was rendered on a date with zero eligible artists, where it reads
// as "you have people to ask". The unrestricted case has to state which of the two it is.
describe("CockpitRail eligibility copy", () => {
  const open = { ...base, castChips: [], skillChips: [] };

  it("says nobody is eligible yet when the unrestricted pool is empty", () => {
    render(<CockpitRail {...open} eligibleCount={0} />);
    expect(screen.getByText(/nobody can be asked yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Anyone can be asked.")).toBeNull();
  });

  it("states the eligible count when the unrestricted pool is not empty", () => {
    render(<CockpitRail {...open} eligibleCount={4} />);
    expect(screen.getByText(/4 artists can be asked/i)).toBeInTheDocument();
  });

  it("claims no count when the eligible pool is unknown to this viewer", () => {
    render(<CockpitRail {...open} eligibleCount={null} />);
    expect(screen.getByText(/no cast or skill restrictions/i)).toBeInTheDocument();
    expect(screen.queryByText(/\d+ artists? can be asked/i)).toBeNull();
    expect(screen.queryByText(/nobody can be asked/i)).toBeNull();
  });
});
