import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
    // The eyebrow must ride the --amber-600 var, which lifts to #F2B23C on a dark
    // card; Tailwind's built-in amber-600 stays #d97706 and fails contrast there.
    expect(screen.getByText("Waiting on your admin").className).toContain("var(--amber-600)");
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

  it("shows the rail again after switching to an org that never dismissed it", async () => {
    // The route does not remount on switchOrg, so a dismissal read once at mount
    // would hide the rail for the rest of the session on every other org, i.e. on
    // exactly the newly provisioned org that needs it.
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    const { container, rerender } = renderWithProviders(<SetupRail orgId="org-1" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());

    rerender(<SetupRail orgId="org-2" />);
    expect(await screen.findByText("Letterhead")).toBeInTheDocument();
  });

  it("renders nothing for a producer once nothing blocks issuing", async () => {
    // Letterhead and terms set, no countersign row. Countersign never blocks issuing,
    // so telling a producer an admin must "finish setup before anything can be sent"
    // would be false and would never clear.
    canRef.value = false;
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
        { when: { key: "hire_order_countersign" }, data: [] },
      ],
    });
    const { container, queryClient } = renderWithProviders(<SetupRail orgId="org-1" />);
    await waitFor(() => {
      expect(queryClient.getQueryState(["app-settings", "hire_order_letterhead", "org-1"])?.status).toBe("success");
      expect(queryClient.getQueryState(["app-settings", "hire_order_terms", "org-1"])?.status).toBe("success");
      expect(queryClient.getQueryState(["app-settings", "hire_order_countersign", "exists", "org-1"])?.status).toBe("success");
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("styles the blocking chip with the design-system amber tokens", async () => {
    // bg-amber-100 / text-amber-600 resolve to Tailwind's built-in palette, which
    // carries no dark-mode override; the --amber-* vars in index.css do.
    renderWithProviders(<SetupRail orgId="org-1" />);
    const chip = (await screen.findAllByText("Blocks issue"))[0];
    expect(chip.className).toContain("var(--amber-100)");
    expect(chip.className).toContain("var(--amber-600)");
  });

  it("opens the step named by initialStep", async () => {
    renderWithProviders(<SetupRail orgId="org-1" initialStep="terms" />);
    const termsToggle = await screen.findByRole("button", { name: /Terms template/ });
    expect(termsToggle).toHaveAttribute("aria-expanded", "true");
  });

  it("associates each disclosure button with the panel it expands", async () => {
    renderWithProviders(<SetupRail orgId="org-1" />);
    const button = (await screen.findByText("Letterhead")).closest("button") as HTMLButtonElement;
    const panelId = button.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(panelId!)).toBeInTheDocument();
  });
});
