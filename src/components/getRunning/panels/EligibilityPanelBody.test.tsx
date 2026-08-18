import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import type { LadderCoverageInputs } from "@/lib/bookings/setupStatus";

// Approved fake in a hoisted holder (vi.mock is hoisted above imports) — never a
// hand-rolled vi.mock chain, per LadderPanelBody.test.tsx / TeamPanelBody.test.tsx.
// EligibilityPanelBody calls the REAL useShows + useAllCities + fetchCasts/
// fetchCastMemberCounts + setShowCastPriority (src/data/eligibility.ts), all of which
// read/write the shared supabase singleton, so the fake stands in for that singleton.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

const TEST_ORG = { id: "org-1", name: "Test Org", slug: "test-org", status: "active", is_demo: false };

// Hamburg (show "Carmen") is covered by the org-wide city ladder (tier 1 "nord");
// Leipzig (show "Die Zauberflöte") has a future date but no tier-1 cast anywhere
// (no show override, no city default) — exactly the "one covered, one gap" seam
// the brief asks this test to cover.
const COVERAGE: LadderCoverageInputs = {
  futurePairs: [
    { showId: "show-1", cityId: "ham" },
    { showId: "show-2", cityId: "lei" },
  ],
  showPriorities: [],
  cityPriorities: [{ cityId: "ham", castId: "nord", priority: 1 }],
};

const SHOWS = [
  { id: "show-1", org_id: "org-1", program: "Carmen", sub_program: null },
  { id: "show-2", org_id: "org-1", program: "Die Zauberflöte", sub_program: null },
];

function seed() {
  Object.assign(
    client,
    createFakeSupabase({
      shows: { data: SHOWS, error: null },
      show_dates: { data: [], error: null },
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
      // Empty on setShowCastPriority's existence select, so it falls straight to a
      // plain insert, no update-existing branch.
      show_cast_eligibility: { data: [], error: null },
    }),
  );
}

import { EligibilityPanelBody } from "./EligibilityPanelBody";

function renderPanel(coverage: LadderCoverageInputs, onDone = vi.fn()) {
  return renderWithProviders(
    <EligibilityPanelBody orgId="org-1" coverage={coverage} onDone={onDone} />,
    { authOverrides: { currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" } },
  );
}

describe("EligibilityPanelBody", () => {
  beforeEach(() => {
    seed();
  });

  it("shows a Covered badge for the covered pair and Link a cast for the gap", async () => {
    renderPanel(COVERAGE);

    expect(await screen.findByText(/Carmen · Hamburg/)).toBeInTheDocument();
    expect(await screen.findByText(/Die Zauberflöte · Leipzig/)).toBeInTheDocument();
    expect(screen.getByText("Covered")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /link a cast/i })).toBeInTheDocument();
  });

  it("writes show_cast_eligibility when a cast is linked to the last remaining gap, and calls onDone", async () => {
    const onDone = vi.fn();
    renderPanel(COVERAGE, onDone);

    const linkButton = await screen.findByRole("button", { name: /link a cast/i });
    fireEvent.click(linkButton);

    const option = await screen.findByRole("button", { name: /süd ensemble/i });
    fireEvent.click(option);

    await waitFor(() => {
      expect(client.calls as unknown[]).toContainEqual({
        table: "show_cast_eligibility",
        method: "insert",
        args: [{ show_id: "show-2", city_id: "lei", cast_id: "sued", org_id: "org-1", priority: 1 }],
      });
    });

    // Hamburg was already covered, so linking Leipzig leaves zero gaps — the panel
    // should advance the board.
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("does not call onDone after closing only one of several still-open gaps", async () => {
    // Three (show, city) pairs: Hamburg/Carmen already covered, Leipzig/Zauberflöte
    // AND Stuttgart/Boheme both still gaps. Closing just the Leipzig gap must not
    // advance the board — Stuttgart is still uncovered.
    const multiGapCoverage: LadderCoverageInputs = {
      futurePairs: [
        { showId: "show-1", cityId: "ham" },
        { showId: "show-2", cityId: "lei" },
        { showId: "show-3", cityId: "stu" },
      ],
      showPriorities: [],
      cityPriorities: [{ cityId: "ham", castId: "nord", priority: 1 }],
    };
    Object.assign(
      client,
      createFakeSupabase({
        shows: {
          data: [
            ...SHOWS,
            { id: "show-3", org_id: "org-1", program: "La Boheme", sub_program: null },
          ],
          error: null,
        },
        show_dates: { data: [], error: null },
        cities: {
          data: [
            { id: "ham", name: "Hamburg", org_id: "org-1", airtable_city_key: null },
            { id: "lei", name: "Leipzig", org_id: "org-1", airtable_city_key: null },
            { id: "stu", name: "Stuttgart", org_id: "org-1", airtable_city_key: null },
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
        show_cast_eligibility: { data: [], error: null },
      }),
    );

    const onDone = vi.fn();
    renderPanel(multiGapCoverage, onDone);

    // Two gap rows (Leipzig, Stuttgart) — link the first, which is Leipzig's.
    const linkButtons = await screen.findAllByRole("button", { name: /link a cast/i });
    expect(linkButtons).toHaveLength(2);
    fireEvent.click(linkButtons[0]);

    const option = await screen.findByRole("button", { name: /süd ensemble/i });
    fireEvent.click(option);

    await waitFor(() => {
      expect(client.calls as unknown[]).toContainEqual({
        table: "show_cast_eligibility",
        method: "insert",
        args: [{ show_id: "show-2", city_id: "lei", cast_id: "sued", org_id: "org-1", priority: 1 }],
      });
    });

    // Let any pending onSuccess microtasks settle, then assert onDone did not fire —
    // Stuttgart/La Boheme is still an uncovered gap.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onDone).not.toHaveBeenCalled();
  });
});
