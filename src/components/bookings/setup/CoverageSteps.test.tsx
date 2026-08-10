import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/hooks/useAllCities", () => ({ useAllCities: () => ({ data: [{ id: "c1", name: "Hamburg" }] }) }));
vi.mock("@/hooks/useShows", () => ({ useShows: () => ({ data: [{ id: "s1", program: "Winterreise", sub_program: "Ensemble" }] }) }));

// Real, fully normalized flows from the shipped presets, held in a hoisted ref: the panel's
// opening line states what an unmatched (show, city) costs THIS org, and the two flows have
// opposite answers, so a one-field partial would prove nothing.
const { flowRef, flowOrgSpy } = vi.hoisted(() => ({
  flowRef: { value: null as unknown },
  flowOrgSpy: vi.fn(),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: (orgId?: string | null) => { flowOrgSpy(orgId); return { data: flowRef.value }; },
}));

import { EligibilityStep } from "./EligibilityStep";
import { ROUTES } from "@/config/app.config";
import { BOOKING_FLOW_DEFAULTS, applyPreset } from "@/lib/bookingFlow";
import type { LadderCoverageInputs } from "@/lib/bookings/setupStatus";

const uncovered: LadderCoverageInputs = {
  futurePairs: [{ showId: "s1", cityId: "c1" }],
  showPriorities: [], cityPriorities: [],
};

beforeEach(() => {
  flowOrgSpy.mockClear();
  flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "classic");
});

describe("EligibilityStep", () => {
  it("names the uncovered (show, city) pair", () => {
    renderWithProviders(
      <MemoryRouter><EligibilityStep coverage={uncovered} orgId="org-1" /></MemoryRouter>,
    );
    expect(screen.getByText(/Hamburg/)).toBeInTheDocument();
  });

  it("offers the concept explanation next to the edit link, deep-linked to Documentation", () => {
    // Same house vocabulary as LadderStep, same escape hatch.
    renderWithProviders(
      <MemoryRouter><EligibilityStep coverage={uncovered} orgId="org-1" /></MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /how casts and tiers work, in the app logic guide/i })).toHaveAttribute(
      "href",
      `${ROUTES.SETTINGS}?tab=docs`,
    );
  });

  it("reads the flow for the org it was handed, not for whatever org the shell is on", () => {
    renderWithProviders(
      <MemoryRouter><EligibilityStep coverage={uncovered} orgId="org-9" /></MemoryRouter>,
    );
    expect(flowOrgSpy).toHaveBeenCalledWith("org-9");
  });

  it("tells an offers org that an unmatched pair opens to nobody", () => {
    renderWithProviders(
      <MemoryRouter><EligibilityStep coverage={uncovered} orgId="org-1" /></MemoryRouter>,
    );
    expect(screen.getByText(/a tier opens to nobody/)).toBeInTheDocument();
  });

  it("tells a direct-book org the opposite, which is what actually happens to it", () => {
    // "Without a match the tier opens to nobody" was printed to every org. For a
    // direct-book org it is backwards: useEligibleArtists returns artistIds null ("no
    // restriction") and deriveDirectBookList then hands the picker every active artist.
    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    renderWithProviders(
      <MemoryRouter><EligibilityStep coverage={uncovered} orgId="org-1" /></MemoryRouter>,
    );
    expect(screen.getByText(/your whole active roster/)).toBeInTheDocument();
    expect(screen.queryByText(/opens to nobody/)).not.toBeInTheDocument();
  });

  it("narrates no consequence at all while the flow is still being read", () => {
    flowRef.value = undefined;
    renderWithProviders(
      <MemoryRouter><EligibilityStep coverage={uncovered} orgId="org-1" /></MemoryRouter>,
    );
    expect(screen.getByText("Which casts belong to a show in a city.")).toBeInTheDocument();
  });
});
