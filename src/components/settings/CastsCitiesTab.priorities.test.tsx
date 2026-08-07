import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";
import { createFakeSupabase, type FakeSupabase } from "@/test/supabaseFake";

// CastsCitiesTab imports the supabase singleton directly (no data-access layer for
// this tab yet) and useAllCities pulls currentOrg from AuthContext, so both need
// mocking. Modeled on SettingsPage.test.tsx's vi.hoisted client pattern.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1", name: "Test Org", slug: "test-org" }, hasRole: (r: string) => r === "producer" }),
}));

import { CastsCitiesTab } from "./CastsCitiesTab";

let fake: FakeSupabase;

/** Reseed the shared fake client. `show_cast_eligibility` uses the array-seed form so
 *  the existence-check query inside setShowCastPriority (which filters by city_id +
 *  cast_id) can be told "nothing exists yet" for a specific (city, cast) pair while the
 *  ladder-fetch query (which never filters by city_id/cast_id) still falls back to the
 *  seeded row. */
function seed(overrides: Record<string, unknown> = {}) {
  fake = createFakeSupabase({
    cities: { data: [
      { id: "city-1", name: "Berlin" },
      { id: "city-2", name: "Hamburg" },
    ], error: null },
    casts: { data: [
      { id: "cast-1", name: "Cast A" },
      { id: "cast-2", name: "Cast B" },
    ], error: null },
    cast_members: { data: [], error: null },
    cast_city_priority: { data: [
      { id: "ccp-1", city_id: "city-1", cast_id: "cast-1", priority: 1 },
    ], error: null },
    shows: { data: [
      { id: "show-1", program: "TJE", sub_program: "Berlin" },
    ], error: null },
    show_cast_eligibility: [
      { when: { city_id: "city-2", cast_id: "cast-1" }, data: [] },
      { data: [{ id: "sce-1", city_id: "city-1", cast_id: "cast-2", priority: 1 }] },
    ],
    ...overrides,
  });
  Object.keys(client).forEach((k) => delete client[k]);
  Object.assign(client, fake);
}

function renderTab(queryClient?: QueryClient) {
  return renderWithProviders(
    <MemoryRouter>
      <CastsCitiesTab currentOrgId="org-1" canEnter={true} />
    </MemoryRouter>,
    queryClient ? { queryClient } : undefined,
  );
}

async function openScopeSelect() {
  const trigger = await screen.findByRole("combobox", { name: "Priority scope" });
  fireEvent.click(trigger);
}

describe("CastsCitiesTab - scoped priority editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
  });

  it("shows the org-wide editor by default (regression)", async () => {
    renderTab();
    expect(await screen.findByText("Cast Priority by City")).toBeInTheDocument();
    // The seeded org-wide assignment (Berlin / Cast A / Tier 1) renders. "Remove
    // assignment" is unique to the org priority row (Casts card also shows "Cast A").
    const removeButton = await screen.findByLabelText("Remove assignment");
    const row = removeButton.closest("div")!;
    expect(within(row).getByText("Tier 1")).toBeInTheDocument();
    expect(within(row).getByText("Cast A")).toBeInTheDocument();
    // Show-scope helper copy must not appear in the default (org) scope.
    expect(screen.queryByText(/Overrides the organization default/i)).not.toBeInTheDocument();
  });

  it("shows the helper copy and the show's ladder rows once a show is selected", async () => {
    renderTab();
    await openScopeSelect();
    fireEvent.click(await screen.findByRole("option", { name: "TJE / Berlin" }));

    expect(
      await screen.findByText(
        "Overrides the organization default for this show only. Cities without show priorities keep the organization default.",
      ),
    ).toBeInTheDocument();
    // Ladder row from the show_cast_eligibility seed: Berlin / Cast B / Tier 1.
    // "Clear tier" is unique to the show-scope row (Casts card also shows "Cast B").
    const clearButton = await screen.findByRole("button", { name: /clear tier/i });
    const row = clearButton.closest("div")!;
    expect(within(row).getByText("Cast B")).toBeInTheDocument();
    expect(within(row).getByText("Tier 1")).toBeInTheDocument();
  });

  it("org-scopes the scope-select shows query (a multi-org member must not see another org's shows)", async () => {
    renderTab();
    // Calls-level pin: the fake's single-object seeds don't apply eq() filtering, so
    // seed data alone can't prove the org filter wasn't dropped (UI-leak regression).
    await waitFor(() =>
      expect(fake.calls).toContainEqual({ table: "shows", method: "eq", args: ["org_id", "org-1"] }),
    );
  });

  it("records an insert on show_cast_eligibility carrying priority when assigning a tier in show scope", async () => {
    renderTab();
    await openScopeSelect();
    fireEvent.click(await screen.findByRole("option", { name: "TJE / Berlin" }));
    await screen.findByText(/Overrides the organization default/i);

    fireEvent.click(screen.getByRole("combobox", { name: "City" }));
    fireEvent.click(await screen.findByRole("option", { name: "Hamburg" }));

    fireEvent.click(screen.getByRole("combobox", { name: "Cast" }));
    fireEvent.click(await screen.findByRole("option", { name: "Cast A" }));

    fireEvent.click(screen.getByRole("combobox", { name: "Tier" }));
    fireEvent.click(await screen.findByRole("option", { name: "Tier 2" }));

    fireEvent.click(screen.getByRole("button", { name: /assign/i }));

    await waitFor(() =>
      expect(fake.calls).toContainEqual({
        table: "show_cast_eligibility",
        method: "insert",
        args: [{ show_id: "show-1", city_id: "city-2", cast_id: "cast-1", org_id: "org-1", priority: 2 }],
      }),
    );
  });

  it("records an update setting priority null when Clear tier is clicked", async () => {
    renderTab();
    await openScopeSelect();
    fireEvent.click(await screen.findByRole("option", { name: "TJE / Berlin" }));

    const clearButton = await screen.findByRole("button", { name: /clear tier/i });
    fireEvent.click(clearButton);

    await waitFor(() =>
      expect(fake.calls).toContainEqual({
        table: "show_cast_eligibility",
        method: "update",
        args: [{ priority: null }],
      }),
    );
    expect(fake.calls).toContainEqual({ table: "show_cast_eligibility", method: "eq", args: ["id", "sce-1"] });
  });
});

describe("CastsCitiesTab - org-wide priority mutations also refresh the setup rail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
  });

  it("invalidates ['eligibility'] (same-client) alongside ['cast-city-priority'] when an org-wide assignment is added", async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    renderTab(queryClient);

    // The org-wide "Add assignment" city/cast/tier selects have no aria-label, so
    // target them positionally within the "Add assignment" section.
    const addSection = (await screen.findByText("Add assignment")).closest("div")!;
    const combos = within(addSection).getAllByRole("combobox");
    fireEvent.click(combos[0]); // City
    fireEvent.click(await screen.findByRole("option", { name: "Hamburg" }));
    fireEvent.click(combos[1]); // Cast
    fireEvent.click(await screen.findByRole("option", { name: "Cast A" }));

    // Exact match: "Assign" vs. the already-rendered "Remove assignment" button, which
    // also contains "assign" and would otherwise match a /assign/i regex ambiguously.
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() =>
      expect(fake.calls).toContainEqual({
        table: "cast_city_priority",
        method: "insert",
        args: [{ city_id: "city-2", cast_id: "cast-1", priority: 1, org_id: "org-1" }],
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["cast-city-priority"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eligibility"] });
  });

  it("invalidates ['eligibility'] (same-client) alongside ['cast-city-priority'] when an org-wide assignment is removed", async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    renderTab(queryClient);

    const removeButton = await screen.findByLabelText("Remove assignment");
    fireEvent.click(removeButton);

    await waitFor(() =>
      expect(fake.calls).toContainEqual({ table: "cast_city_priority", method: "delete", args: [] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["cast-city-priority"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eligibility"] });
  });
});
