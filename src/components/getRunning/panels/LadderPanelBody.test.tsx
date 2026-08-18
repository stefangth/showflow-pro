import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import type { LadderCoverageInputs } from "@/lib/bookings/setupStatus";

// Approved fake in a hoisted holder (vi.mock is hoisted above imports) — never a
// hand-rolled vi.mock chain, per TeamPanelBody.test.tsx / DatesPanelBody.test.tsx.
// LadderPanelBody calls the REAL useAllCities + fetchCasts/fetchCastMemberCounts +
// setCastCityPriority (src/data/casts.ts), all of which read/write the shared supabase
// singleton, so the fake stands in for that singleton.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

const TEST_ORG = { id: "org-1", name: "Test Org", slug: "test-org", status: "active", is_demo: false };

// Hamburg already has a tier-1 (cast "nord"); Leipzig has a future date but no tier-1 —
// exactly the "one ranked, one not" seam the brief asks this test to cover.
const COVERAGE: LadderCoverageInputs = {
  futurePairs: [
    { showId: "show-1", cityId: "ham" },
    { showId: "show-2", cityId: "lei" },
  ],
  showPriorities: [],
  cityPriorities: [{ cityId: "ham", castId: "nord", priority: 1 }],
};

function seed() {
  Object.assign(
    client,
    createFakeSupabase({
      cities: {
        data: [
          { id: "ham", name: "Hamburg", org_id: "org-1", airtable_city_key: null },
          { id: "lei", name: "Leipzig", org_id: "org-1", airtable_city_key: null },
        ],
        error: null,
      },
      casts: {
        data: [
          { id: "nord", name: "Nord Ensemble", org_id: "org-1" },
          { id: "sued", name: "Süd Ensemble", org_id: "org-1" },
        ],
        error: null,
      },
      cast_members: { data: [], error: null },
      // Empty on both selects setCastCityPriority runs (city+cast, then city+priority) —
      // so it falls straight to a plain insert, no bump-out branch.
      cast_city_priority: { data: [], error: null },
    }),
  );
}

import { LadderPanelBody } from "./LadderPanelBody";

function renderPanel(onDone = vi.fn()) {
  return renderWithProviders(
    <LadderPanelBody orgId="org-1" coverage={COVERAGE} onDone={onDone} />,
    { authOverrides: { currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" } },
  );
}

describe("LadderPanelBody", () => {
  beforeEach(() => {
    seed();
  });

  it("shows the tier-1 chip for a ranked city and a picker for an unranked one", async () => {
    renderPanel();

    expect(await screen.findByText("Nord Ensemble")).toBeInTheDocument();
    expect(screen.getByText("Hamburg")).toBeInTheDocument();
    expect(screen.getByText("Leipzig")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pick tier 1/i })).toBeInTheDocument();
  });

  it("writes cast_city_priority when a tier-1 cast is picked for an unranked city", async () => {
    const onDone = vi.fn();
    renderPanel(onDone);

    const pickButton = await screen.findByRole("button", { name: /pick tier 1/i });
    fireEvent.click(pickButton);

    const option = await screen.findByRole("button", { name: /süd ensemble/i });
    fireEvent.click(option);

    await waitFor(() => {
      expect(client.calls as unknown[]).toContainEqual({
        table: "cast_city_priority",
        method: "insert",
        args: [{ org_id: "org-1", city_id: "lei", cast_id: "sued", priority: 1 }],
      });
    });

    // Hamburg already had a tier 1, so ranking Leipzig leaves zero unranked cities —
    // the panel should advance the board.
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
