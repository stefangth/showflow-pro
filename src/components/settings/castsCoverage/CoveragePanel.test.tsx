import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ hasRole: () => true, currentOrg: { id: "org-1" } }) }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => true }));

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
      expect(screen.getByText("Single tier")).toBeInTheDocument();
      // Hamburg: no tiers filled -> "blocked" status.
      expect(screen.getByText("Offers blocked")).toBeInTheDocument();

      const citiesKpi = screen.getByText("CITIES").parentElement!;
      expect(within(citiesKpi).getByText("2")).toBeInTheDocument();
      const blockedKpi = screen.getByText("OFFERS BLOCKED").parentElement!;
      expect(within(blockedKpi).getByText("1")).toBeInTheDocument();
      const singleKpi = screen.getByText("SINGLE TIER").parentElement!;
      expect(within(singleKpi).getByText("1")).toBeInTheDocument();
      const overridesKpi = screen.getByText("SHOW OVERRIDES").parentElement!;
      expect(within(overridesKpi).getByText("0")).toBeInTheDocument();
    });

    it("opens a tier cell's popover and assigning a cast writes the org-default priority", async () => {
      renderWithProviders(<CoveragePanel orgId="org-1" />);

      // Hamburg has no tiers filled, so its Tier 1 cell is the only "Set tier 1" button.
      fireEvent.click(await screen.findByRole("button", { name: "Set tier 1" }));
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

  describe("per-show scope", () => {
    it("shows the org default for every city until the show has its own override", async () => {
      renderWithProviders(<CoveragePanel orgId="org-1" />);
      fireEvent.click(screen.getByRole("tab", { name: "Per show" }));

      expect(await screen.findAllByText("Org default")).not.toHaveLength(0);
      // Berlin still shows the inherited org-default cast.
      expect(screen.getByText("Cast A")).toBeInTheDocument();
    });

    it("assigning a cast for a city writes a show-level override, not the org default", async () => {
      renderWithProviders(<CoveragePanel orgId="org-1" />);
      fireEvent.click(screen.getByRole("tab", { name: "Per show" }));

      fireEvent.click(await screen.findByRole("button", { name: "Set tier 1" }));
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
