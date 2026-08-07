import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/hooks/useAllCities", () => ({ useAllCities: () => ({ data: [{ id: "c1", name: "Hamburg" }] }) }));

import { LadderStep } from "./LadderStep";
import type { LadderCoverageInputs } from "@/lib/bookings/setupStatus";

describe("LadderStep", () => {
  it("shows the ranked-count copy when the org list has a tier-1 cast", () => {
    const coverage: LadderCoverageInputs = {
      futurePairs: [{ showId: "s1", cityId: "c1" }],
      showPriorities: [],
      cityPriorities: [{ cityId: "c1", castId: "k1", priority: 1 }],
    };
    renderWithProviders(
      <MemoryRouter><LadderStep coverage={coverage} /></MemoryRouter>,
    );
    expect(screen.getByText(/1 tier ranked/)).toBeInTheDocument();
  });

  it("does not claim 'no casts ranked' when only a show-scoped tier-1 row covers the city", () => {
    // The org-wide list is empty for this city, but a show-scoped row covers it at tier 1.
    // resolveCoverage/EligibilityStep treat this city as covered, so LadderStep must not
    // contradict that with "No casts ranked." or "nothing at tier 1."
    const coverage: LadderCoverageInputs = {
      futurePairs: [{ showId: "s1", cityId: "c1" }],
      showPriorities: [{ showId: "s1", cityId: "c1", castId: "k9", priority: 1 }],
      cityPriorities: [],
    };
    renderWithProviders(
      <MemoryRouter><LadderStep coverage={coverage} /></MemoryRouter>,
    );
    expect(screen.getByText(/Ranked per show/)).toBeInTheDocument();
    expect(screen.queryByText(/No casts ranked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing at tier 1/)).not.toBeInTheDocument();
  });
});
