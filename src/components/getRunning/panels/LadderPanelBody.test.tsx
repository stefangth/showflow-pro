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

// useCan("manage_casts") gates the inline create-cast form. Mock it to a controllable flag
// so both the granted and revoked states are deterministic (the real resolver would need
// seeded org capability rows). Other actions pass through as granted -- the panel only asks
// for manage_casts.
const capState = vi.hoisted(() => ({ canManageCasts: true }));
vi.mock("@/hooks/useCapabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useCapabilities")>();
  return {
    ...actual,
    useCan: (action: string) => (action === "manage_casts" ? capState.canManageCasts : true),
  };
});

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
  nonEmptyCastIds: ["nord"],
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
      // Both casts have a member: an EMPTY cast cannot cover a city (resolveCoverage
      // requires a staffed tier 1), so the picker greys those out and ranking one would
      // not close the gap.
      cast_members: { data: [{ cast_id: "nord", org_id: "org-1" }, { cast_id: "sued", org_id: "org-1" }], error: null },
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
    capState.canManageCasts = true;
    seed();
  });

  it("shows the tier-1 chip for a ranked city and a picker for an unranked one", async () => {
    renderPanel();

    // "Nord Ensemble" now appears both as the ranked city's tier-1 chip AND in the "Your
    // casts" roster list (the fix for casts made outside a city-with-dates being invisible),
    // so assert at least one occurrence rather than a single unique node.
    expect((await screen.findAllByText("Nord Ensemble")).length).toBeGreaterThan(0);
    expect(screen.getByText("Hamburg")).toBeInTheDocument();
    expect(screen.getByText("Leipzig")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pick the first group/i })).toBeInTheDocument();
    // The roster list names the cast's standing: Nord ranks first in Hamburg.
    expect(screen.getByText("First group in Hamburg")).toBeInTheDocument();
  });

  it("writes cast_city_priority when a tier-1 cast is picked for an unranked city", async () => {
    const onDone = vi.fn();
    renderPanel(onDone);

    const pickButton = await screen.findByRole("button", { name: /pick the first group/i });
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

  it("does not call onDone after ranking only one of several still-unranked cities", async () => {
    // Three cities with dates: Hamburg already ranked, Leipzig AND Stuttgart both still
    // unranked. Ranking just Leipzig must not advance the board — Stuttgart is still a gap.
    const multiUnrankedCoverage: LadderCoverageInputs = {
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
        cast_city_priority: { data: [], error: null },
      }),
    );

    const onDone = vi.fn();
    renderWithProviders(
      <LadderPanelBody orgId="org-1" coverage={multiUnrankedCoverage} onDone={onDone} />,
      { authOverrides: { currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" } },
    );

    // Two unranked rows (Leipzig, Stuttgart) — pick the first, which is Leipzig's.
    const pickButtons = await screen.findAllByRole("button", { name: /pick the first group/i });
    expect(pickButtons).toHaveLength(2);
    fireEvent.click(pickButtons[0]);

    const option = await screen.findByRole("button", { name: /süd ensemble/i });
    fireEvent.click(option);

    await waitFor(() => {
      expect(client.calls as unknown[]).toContainEqual({
        table: "cast_city_priority",
        method: "insert",
        args: [{ org_id: "org-1", city_id: "lei", cast_id: "sued", priority: 1 }],
      });
    });

    // Let any pending onSuccess microtasks settle, then assert onDone did not fire —
    // Stuttgart is still an unranked gap.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onDone).not.toHaveBeenCalled();
  });

  it("does not call onDone when adding tier 2 to an already fully ranked city set", async () => {
    // Regression for the bug where unrankedCityIds is already [] once every city has a
    // tier 1, so the old `remaining.length === 0` check fired trivially on EVERY later
    // write — including an "Add tier 2" click on an already-ranked city, which would
    // re-close/advance the panel on every subsequent tier-2 pick.
    const fullyRankedCoverage: LadderCoverageInputs = {
      futurePairs: [
        { showId: "show-1", cityId: "ham" },
        { showId: "show-2", cityId: "lei" },
      ],
      showPriorities: [],
      cityPriorities: [
        { cityId: "ham", castId: "nord", priority: 1 },
        { cityId: "lei", castId: "sued", priority: 1 },
      ],
      nonEmptyCastIds: ["nord", "sued"],
    };

    const onDone = vi.fn();
    renderWithProviders(
      <LadderPanelBody orgId="org-1" coverage={fullyRankedCoverage} onDone={onDone} />,
      { authOverrides: { currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" } },
    );

    // Fully ranked: no "Pick tier 1" affordance anywhere, only "Add tier 2".
    expect(screen.queryByRole("button", { name: /pick the first group/i })).not.toBeInTheDocument();
    const addTierButtons = await screen.findAllByRole("button", { name: /add group 2/i });
    fireEvent.click(addTierButtons[0]);

    const option = await screen.findByRole("button", { name: /süd ensemble/i });
    fireEvent.click(option);

    await waitFor(() => {
      expect(client.calls as unknown[]).toContainEqual({
        table: "cast_city_priority",
        method: "insert",
        args: [{ org_id: "org-1", city_id: "ham", cast_id: "sued", priority: 2 }],
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onDone).not.toHaveBeenCalled();
  });

  // The inline "create cast" form (task 7): capability-gated, submit-guarded, and it clears
  // and stays open on success so a run of casts can be seeded quickly.
  describe("inline create-cast form", () => {
    it("shows the form for a user with manage_casts", () => {
      renderPanel();

      expect(screen.getByText("New cast")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /create cast/i })).toBeInTheDocument();
    });

    it("hides the form for a user without manage_casts", () => {
      capState.canManageCasts = false;
      renderPanel();

      expect(screen.queryByText("New cast")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /create cast/i })).not.toBeInTheDocument();
    });

    it("disables submit until a name is entered, then creates the cast and clears the field", async () => {
      renderPanel();

      const submit = screen.getByRole("button", { name: /create cast/i });
      expect(submit).toBeDisabled();

      const input = screen.getByPlaceholderText("Cast name");
      fireEvent.change(input, { target: { value: "Touring Cast" } });
      expect(submit).toBeEnabled();

      fireEvent.click(submit);

      await waitFor(() => {
        const calls = client.calls as unknown as {
          table: string;
          method: string;
          args: Record<string, unknown>[];
        }[];
        const insert = calls.find((c) => c.table === "casts" && c.method === "insert");
        expect(insert?.args[0]).toMatchObject({ org_id: "org-1", name: "Touring Cast", description: "" });
      });

      // Stays open and clears the field on success (seed-a-run-of-casts UX).
      await waitFor(() =>
        expect((screen.getByPlaceholderText("Cast name") as HTMLInputElement).value).toBe(""),
      );
    });
  });

  /**
   * The audit's own reproduction org: two casts, no cast members, and the empty cast ranked
   * first. `resolveCoverage` requires a STAFFED tier 1, so the board's `coverage` step is
   * correctly red — while this panel, which computed its own parallel `priority === 1` view,
   * printed "0 unranked", an accent chip naming the empty cast, and "Every city with dates
   * has a first group". A blocking body reporting itself resolved, with no way for `onDone`
   * to ever fire.
   */
  describe("a tier-1 cast with no members", () => {
    const EMPTY_TIER1: LadderCoverageInputs = {
      futurePairs: [{ showId: "show-1", cityId: "ham" }],
      showPriorities: [],
      cityPriorities: [{ cityId: "ham", castId: "nord", priority: 1 }],
      // The whole point: `nord` IS ranked first in Hamburg, and has nobody in it.
      nonEmptyCastIds: [],
    };

    function renderEmptyTier1() {
      Object.assign(
        client,
        createFakeSupabase({
          cities: { data: [{ id: "ham", name: "Hamburg", org_id: "org-1", airtable_city_key: null }], error: null },
          casts: {
            data: [
              { id: "nord", name: "Nord Ensemble", org_id: "org-1" },
              { id: "sued", name: "Süd Ensemble", org_id: "org-1" },
            ],
            error: null,
          },
          cast_members: { data: [], error: null },
          cast_city_priority: { data: [], error: null },
        }),
      );
      return renderWithProviders(
        <LadderPanelBody orgId="org-1" coverage={EMPTY_TIER1} onDone={vi.fn()} />,
        { authOverrides: { currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" } },
      );
    }

    it("counts the city as not covered instead of reporting zero gaps", async () => {
      renderEmptyTier1();
      await screen.findByText("Hamburg");

      expect(screen.getByText("1 not covered")).toBeInTheDocument();
      expect(screen.queryByText("0 not covered")).toBeNull();
    });

    it("does not claim every city has a first group, and says the group is empty", async () => {
      renderEmptyTier1();
      await screen.findByText("Hamburg");

      expect(screen.queryByText(/has a first group with members\.$/i)).toBeNull();
      expect(screen.getByText(/first group has no members/i)).toBeInTheDocument();
      // And it names the actual fix, rather than "Rank Hamburg too" for a ranked city.
      expect(screen.getByText(/add members to the first group in hamburg/i)).toBeInTheDocument();
    });

    it("will not let an empty cast be picked as the first group", async () => {
      Object.assign(
        client,
        createFakeSupabase({
          cities: { data: [{ id: "lei", name: "Leipzig", org_id: "org-1", airtable_city_key: null }], error: null },
          casts: {
            data: [
              { id: "nord", name: "Nord Ensemble", org_id: "org-1" },
              { id: "sued", name: "Süd Ensemble", org_id: "org-1" },
            ],
            error: null,
          },
          cast_members: { data: [{ cast_id: "nord", org_id: "org-1" }], error: null },
          cast_city_priority: { data: [], error: null },
        }),
      );
      renderWithProviders(
        <LadderPanelBody
          orgId="org-1"
          coverage={{
            futurePairs: [{ showId: "show-1", cityId: "lei" }],
            showPriorities: [],
            cityPriorities: [],
            nonEmptyCastIds: ["nord"],
          }}
          onDone={vi.fn()}
        />,
        { authOverrides: { currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" } },
      );

      fireEvent.click(await screen.findByRole("button", { name: /pick the first group/i }));

      // Süd has nobody in it: ranking it would write cleanly and leave the gap standing.
      expect(await screen.findByRole("button", { name: /süd ensemble/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /nord ensemble/i })).toBeEnabled();
    });
  });

  describe("empty states (no city with a future date)", () => {
    const renderWith = (coverage: LadderCoverageInputs) =>
      renderWithProviders(
        <LadderPanelBody orgId="org-1" coverage={coverage} onDone={vi.fn()} />,
        { authOverrides: { currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" } },
      );

    it("shows the datesNeedCity copy (not the all-covered reassurance) when future dates exist but all lack a city", async () => {
      renderWith({ futurePairs: [{ showId: "show-1", cityId: null }], showPriorities: [], cityPriorities: [], nonEmptyCastIds: [] });
      // Await the async roster (casts query) so the sync assertions below see a settled DOM.
      expect(await screen.findByText("Nord Ensemble")).toBeInTheDocument();
      expect(screen.getByText(/no city set yet/i)).toBeInTheDocument();
      // The contradictory UnlocksNote reassurance must be suppressed in this state.
      expect(screen.queryByText(/has a first group/i)).not.toBeInTheDocument();
    });

    it("shows the no-future-dates copy when there are no future dates at all", async () => {
      renderWith({ futurePairs: [], showPriorities: [], cityPriorities: [], nonEmptyCastIds: [] });
      expect(await screen.findByText(/No city has a future date yet/i)).toBeInTheDocument();
    });
  });
});
