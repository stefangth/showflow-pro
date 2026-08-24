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
  nonEmptyCastIds: ["nord"],
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
      // Both casts have a member: an EMPTY cast cannot cover a (show, city) pair, so the
      // picker greys those out and linking one would leave the gap standing.
      cast_members: { data: [{ cast_id: "nord", org_id: "org-1" }, { cast_id: "sued", org_id: "org-1" }], error: null },
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

  it("shows one card per production: Fully covered with its cast chip, and a gap card with Link a cast", async () => {
    renderPanel(COVERAGE);

    // One card per PRODUCTION, not per (show, city) pair.
    expect(await screen.findByText("Carmen")).toBeInTheDocument();
    expect(await screen.findByText("Die Zauberflöte")).toBeInTheDocument();

    // Carmen's Hamburg date is covered by the org-wide "nord" ladder → Fully covered
    // with the covering cast surfaced as an accent chip.
    expect(screen.getByText("Fully covered")).toBeInTheDocument();
    // "Nord Ensemble" now shows both as the covering-cast chip AND in the "Your casts"
    // roster list (casts are visible even when tied to no city-with-a-date), so assert at
    // least one occurrence rather than a single unique node.
    expect(screen.getAllByText("Nord Ensemble").length).toBeGreaterThan(0);

    // Die Zauberflöte's Leipzig date has no tier-1 cast → a "1 gap" badge, the
    // uncovered-city hint, and the dashed Link a cast affordance. "1 gap" appears
    // twice: the header total and this production's own badge (the sole gap).
    expect(screen.getAllByText("1 gap")).toHaveLength(2);
    expect(screen.getByText(/no cast in leipzig yet/i)).toBeInTheDocument();
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
      nonEmptyCastIds: ["nord"],
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
        cast_members: { data: [{ cast_id: "nord", org_id: "org-1" }, { cast_id: "sued", org_id: "org-1" }], error: null },
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

  it("does not call onDone when a null-city future date keeps eligibility outstanding, even after the last city gap is linked", async () => {
    // A future date with no city set keeps the board's eligibility.done false
    // (computeBookingSetupStatus requires `!hasNullCity`). Closing the last city-scoped
    // gap must therefore NOT advance/close the panel — otherwise the board still flags
    // the task and the admin has to reopen it. (Ladder has no such dependency.)
    const withNullCity: LadderCoverageInputs = {
      futurePairs: [
        { showId: "show-1", cityId: "ham" },
        { showId: "show-2", cityId: "lei" },
        { showId: "show-1", cityId: null },
      ],
      showPriorities: [],
      cityPriorities: [{ cityId: "ham", castId: "nord", priority: 1 }],
      nonEmptyCastIds: ["nord"],
    };
    const onDone = vi.fn();
    renderPanel(withNullCity, onDone);

    // The null-city footnote renders for exactly this case.
    expect(await screen.findByText(/no city set/i)).toBeInTheDocument();

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

    // The city-scoped gap is closed, but a null-city date remains: the panel must hold.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onDone).not.toHaveBeenCalled();
  });

  it("null-city-only backlog: shows datesNeedCity, suppresses the duplicate nullCityNote, keeps the roster", async () => {
    renderPanel({ futurePairs: [{ showId: "show-1", cityId: null }], showPriorities: [], cityPriorities: [], nonEmptyCastIds: [] });
    // Await the async roster (casts query) so the sync assertions see a settled DOM.
    expect(await screen.findByText("Nord Ensemble")).toBeInTheDocument();
    expect(screen.getByText(/no city set yet/i)).toBeInTheDocument();
    // The pre-existing nullCityNote must NOT also render (it would say the same thing twice).
    expect(screen.queryByText(/Fix the date to include it/i)).not.toBeInTheDocument();
    // And the all-covered UnlocksNote reassurance is suppressed in this state too.
    expect(screen.queryByText(/has a first group with members/i)).not.toBeInTheDocument();
  });

  /**
   * The gap surfaces correctly here (this panel uses the real `resolveCoverage`), but the
   * reason it printed did not: "No cast in Hamburg yet" is false when a cast IS ranked first
   * and merely has nobody in it. Worse, the picker happily offered another empty cast, whose
   * link would write cleanly, toast "Cast linked", and leave the gap exactly where it was.
   */
  describe("a first-group cast with no members", () => {
    const EMPTY_TIER1: LadderCoverageInputs = {
      futurePairs: [{ showId: "show-1", cityId: "ham" }],
      showPriorities: [],
      cityPriorities: [{ cityId: "ham", castId: "nord", priority: 1 }],
      nonEmptyCastIds: [],
    };

    it("says the ranked cast is empty rather than that no cast is ranked", async () => {
      renderPanel(EMPTY_TIER1);
      await screen.findByText("Carmen");

      expect(screen.getByText(/ranked first in hamburg has no members/i)).toBeInTheDocument();
      expect(screen.queryByText(/no cast in hamburg yet/i)).toBeNull();
    });

    it("will not offer an empty cast as the fix", async () => {
      Object.assign(
        client,
        createFakeSupabase({
          shows: { data: SHOWS, error: null },
          show_dates: { data: [], error: null },
          cities: { data: [{ id: "ham", name: "Hamburg", org_id: "org-1", airtable_city_key: null }], error: null },
          casts: {
            data: [
              { id: "nord", name: "Nord Ensemble", org_id: "org-1" },
              { id: "sued", name: "Süd Ensemble", org_id: "org-1" },
            ],
            error: null,
          },
          cast_members: { data: [{ cast_id: "nord", org_id: "org-1" }], error: null },
          show_cast_eligibility: { data: [], error: null },
        }),
      );
      renderPanel({
        futurePairs: [{ showId: "show-1", cityId: "ham" }],
        showPriorities: [],
        cityPriorities: [],
        nonEmptyCastIds: ["nord"],
      });

      fireEvent.click(await screen.findByRole("button", { name: /link a cast/i }));

      expect(await screen.findByRole("button", { name: /süd ensemble/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /nord ensemble/i })).toBeEnabled();
      expect(screen.getByText(/casts with no members are greyed out/i)).toBeInTheDocument();
    });
  });
});
