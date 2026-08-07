import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/hooks/useAllCities", () => ({ useAllCities: () => ({ data: [{ id: "c1", name: "Hamburg" }] }) }));
vi.mock("@/hooks/useShows", () => ({ useShows: () => ({ data: [{ id: "s1", program: "Winterreise", sub_program: "Ensemble" }] }) }));

import { EligibilityStep } from "./EligibilityStep";
import type { LadderCoverageInputs } from "@/lib/bookings/setupStatus";

const uncovered: LadderCoverageInputs = {
  futurePairs: [{ showId: "s1", cityId: "c1" }],
  showPriorities: [], cityPriorities: [],
};

describe("EligibilityStep", () => {
  it("names the uncovered (show, city) pair", () => {
    renderWithProviders(
      <MemoryRouter><EligibilityStep coverage={uncovered} /></MemoryRouter>,
    );
    expect(screen.getByText(/Hamburg/)).toBeInTheDocument();
  });
});
