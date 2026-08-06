import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

const { canRef } = vi.hoisted(() => ({ canRef: { value: true } }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canRef.value }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { SetupRail } from "./SetupRail";

beforeEach(() => {
  localStorage.clear();
  canRef.value = true;
  seedClient({ app_settings: { data: [], error: null } });
});

describe("SetupRail", () => {
  it("shows all three steps, with a blocking chip on exactly two", async () => {
    renderWithProviders(<SetupRail orgId="org-1" />);
    expect(await screen.findByText("Letterhead")).toBeInTheDocument();
    expect(screen.getByText("Terms template")).toBeInTheDocument();
    expect(screen.getByText("Countersigning")).toBeInTheDocument();
    expect(screen.getAllByText("Blocks issue")).toHaveLength(2);
  });

  it("reports progress out of three", async () => {
    renderWithProviders(<SetupRail orgId="org-1" />);
    expect(await screen.findByText(/0 of 3/)).toBeInTheDocument();
  });

  it("renders the waiting card instead when the viewer cannot edit settings", async () => {
    canRef.value = false;
    renderWithProviders(<SetupRail orgId="org-1" />);
    expect(await screen.findByText(/An admin needs to finish setup/i)).toBeInTheDocument();
    expect(screen.queryByText("Blocks issue")).not.toBeInTheDocument();
  });

  it("renders nothing once the org is fully set up", async () => {
    // Array-form seed, matched on the `key` eq(): a single-object seed can't tell
    // three different app_settings keys apart (the fake doesn't filter by plain
    // eq()), so all three rows seeded together would collide, every query would
    // resolve to the first (letterhead) row, and the assertion below would pass
    // for the wrong reason -- the rail stuck loading-then-null forever, not
    // because setup was genuinely complete. See useHireOrderSetup.test.ts for the
    // same fix on the same underlying fake behavior.
    seedClient({
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{ key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } }],
        },
        {
          when: { key: "hire_order_terms" },
          data: [{ key: "hire_order_terms", org_id: "org-1", value: { templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "t1" } }],
        },
        {
          when: { key: "hire_order_countersign" },
          data: [{ key: "hire_order_countersign", org_id: "org-1", value: { mode: "electronic" } }],
        },
      ],
    });
    const { container, queryClient } = renderWithProviders(<SetupRail orgId="org-1" />);
    // The component renders null in BOTH the initial-loading state and the
    // genuinely-complete state, so asserting on an empty container right away
    // would pass trivially before the queries ever resolve. Wait for all three
    // underlying reads to settle first, then check the container is STILL empty.
    await waitFor(() => {
      expect(queryClient.getQueryState(["app-settings", "hire_order_letterhead", "org-1"])?.status).toBe("success");
      expect(queryClient.getQueryState(["app-settings", "hire_order_terms", "org-1"])?.status).toBe("success");
      expect(queryClient.getQueryState(["app-settings", "hire_order_countersign", "exists", "org-1"])?.status).toBe("success");
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when previously dismissed for this org", async () => {
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    const { container } = renderWithProviders(<SetupRail orgId="org-1" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
