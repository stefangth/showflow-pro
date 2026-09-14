import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ hasRole: () => true, currentOrg: { id: "org-1" } }) }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => true }));
// Stub the cast detail sheet: it pulls in EditorProvider/useEditorConfig which the
// bare test harness doesn't supply. We only need to assert CoveragePanel opens it
// with the clicked cast.
vi.mock("@/components/casts/CastDetailsSheet", () => ({
  CastDetailsSheet: ({ cast, open }: { cast: { name: string } | null; open: boolean }) =>
    open && cast ? <div data-testid="cast-detail-sheet">Sheet: {cast.name}</div> : null,
}));

Object.assign(
  client,
  createFakeSupabase({
    cities: {
      data: [
        { id: "city-1", name: "Berlin", org_id: "org-1" },
        { id: "city-2", name: "Hamburg", org_id: "org-1" },
      ],
      error: null,
    },
    casts: {
      data: [
        { id: "cast-1", name: "Cast A", org_id: "org-1" },
        { id: "cast-2", name: "Cast B", org_id: "org-1" },
      ],
      error: null,
    },
    cast_members: {
      data: [{ cast_id: "cast-1" }, { cast_id: "cast-1" }, { cast_id: "cast-2" }],
      error: null,
    },
    cast_city_priority: [
      {
        when: { org_id: "org-1" },
        data: [{ id: "p1", cast_id: "cast-1", city_id: "city-1", priority: 1 }],
        error: null,
      },
      { when: { city_id: "city-2", cast_id: "cast-2" }, data: [], error: null },
      { when: { city_id: "city-2", priority: 1 }, data: [], error: null },
    ],
    shows: { data: [{ id: "show-1", program: "Cinderella", sub_program: null }], error: null },
    show_dates: { data: [], error: null },
    show_cast_eligibility: { data: [], error: null },
  }),
);

import { CoveragePanel } from "./CoveragePanel";

describe("CoveragePanel", () => {
  describe("organization-default scope", () => {
    it("renders KPI values and per-city coverage status from the priority matrix", async () => {
      renderWithProviders(<CoveragePanel orgId="org-1" />);

      // Berlin: Tier 1 = Cast A (2 members) only -> "single" status. "Cast A" also
      // appears in the Casts card below the matrix, so assert there are at least two.
      expect((await screen.findAllByText("Cast A")).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("2 members")).toBeInTheDocument();
      expect(screen.getByText("Only one ask")).toBeInTheDocument();
      // Hamburg: no tiers filled -> "blocked" status.
      expect(screen.getByText("Nobody to ask")).toBeInTheDocument();

      const citiesKpi = screen.getByText("CITIES").parentElement!;
      expect(within(citiesKpi).getByText("2")).toBeInTheDocument();
      const blockedKpi = screen.getByText("ASKS BLOCKED").parentElement!;
      expect(within(blockedKpi).getByText("1")).toBeInTheDocument();
      const singleKpi = screen.getByText("SINGLE ASK").parentElement!;
      expect(within(singleKpi).getByText("1")).toBeInTheDocument();
      const overridesKpi = screen.getByText("Production overrides").parentElement!;
      expect(within(overridesKpi).getByText("0")).toBeInTheDocument();
    });

    // Regression: cast_city_priority.city_id and show_cast_eligibility.city_id are both
    // ON DELETE CASCADE, so a city with a configured tier ladder (Berlin: cast-1 @ Tier 1)
    // but zero upcoming shows must still block delete — usage/showsCount alone is not
    // "referenced."
    it("disables deleting a city that only has an org-default tier assigned (no upcoming shows)", async () => {
      renderWithProviders(<CoveragePanel orgId="org-1" />);

      expect(await screen.findByRole("button", { name: "Remove Berlin" })).toBeDisabled();
      expect(screen.getByText("used in the ask order")).toBeInTheDocument();

      // Hamburg has no tiers, no overrides, and no shows -> genuinely unreferenced.
      expect(screen.getByRole("button", { name: "Remove Hamburg" })).not.toBeDisabled();
      expect(screen.getByText("not used yet")).toBeInTheDocument();
    });

    it("opens a tier cell's popover and assigning a cast writes the org-default priority", async () => {
      renderWithProviders(<CoveragePanel orgId="org-1" />);

      // Hamburg has no tiers filled, so its Tier 1 cell is the only "Set tier 1" button.
      fireEvent.click(await screen.findByRole("button", { name: "Set ask 1" }));
      fireEvent.click(await screen.findByRole("button", { name: "Assign Cast B" }));

      await waitFor(() => {
        const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
        expect(calls).toContainEqual({
          table: "cast_city_priority",
          method: "insert",
          args: [{ org_id: "org-1", city_id: "city-2", cast_id: "cast-2", priority: 1 }],
        });
      });
    });
  });

    it("adds a city via the inline form (regression: form was dropped from CastsCitiesTab)", async () => {
      renderWithProviders(<CoveragePanel orgId="org-1" />);

      const input = await screen.findByPlaceholderText("New city name");
      fireEvent.change(input, { target: { value: "Munich" } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));

      await waitFor(() => {
        const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
        expect(calls).toContainEqual({
          table: "cities",
          method: "insert",
          args: [{ name: "Munich", org_id: "org-1" }],
        });
      });
    });

    it("opens the cast detail sheet when a cast row is clicked (regression: onOpenCast never wired)", async () => {
      renderWithProviders(<CoveragePanel orgId="org-1" />);

      // The Casts card lists each cast as a button; click the first one.
      const castButtons = await screen.findAllByText("Cast A");
      fireEvent.click(castButtons[castButtons.length - 1]);

      expect(await screen.findByTestId("cast-detail-sheet")).toHaveTextContent("Sheet: Cast A");
    });

  describe("per-show scope", () => {
    it("shows the org default for every city until the show has its own override", async () => {
      renderWithProviders(<CoveragePanel orgId="org-1" />);
      fireEvent.click(screen.getByRole("tab", { name: "Per production" }));

      expect(await screen.findAllByText("Org default")).not.toHaveLength(0);
      // Berlin still shows the inherited org-default cast.
      expect(screen.getByText("Cast A")).toBeInTheDocument();
    });

    it("assigning a cast for a city writes a show-level override, not the org default", async () => {
      renderWithProviders(<CoveragePanel orgId="org-1" />);
      fireEvent.click(screen.getByRole("tab", { name: "Per production" }));

      fireEvent.click(await screen.findByRole("button", { name: "Set ask 1" }));
      fireEvent.click(await screen.findByRole("button", { name: "Assign Cast B" }));

      await waitFor(() => {
        const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
        expect(calls).toContainEqual({
          table: "show_cast_eligibility",
          method: "insert",
          args: [{ show_id: "show-1", city_id: "city-2", cast_id: "cast-2", org_id: "org-1", priority: 1 }],
        });
      });
    });
  });
});
