import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// The tab and its dependency hooks (useCapabilityMatrix, useEntitlements, useOrgMembers,
// useSettingsAudit via ChangeLogDialog) all read `currentOrg` from useAuth and hit the
// shared supabase client. Seed via createFakeSupabase + the hoisted client-swap idiom
// (mirrors BookingFlowTab.test.tsx) rather than mocking the data-access functions
// directly, so the write path (setOrgCapability/clearOrgCapability) is exercised for
// real against the fake client and asserted on its recorded calls.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

Object.assign(
  client,
  createFakeSupabase({
    org_capabilities: [{ when: { org_id: "org1" }, data: [], error: null }],
    org_capability_policies: [{ when: { org_id: "org1" }, data: [], error: null }],
    org_entitlements: [
      { when: { org_id: "org1" }, data: [{ feature: "hire_orders", enabled: true }], error: null },
    ],
  }),
);

import { useAuth } from "@/features/auth/AuthContext";
import { RolesRightsTab } from "./RolesRightsTab";

type RecordedCall = { table: string; method: string; args: unknown[] };

function calls(): RecordedCall[] {
  return client.calls as RecordedCall[];
}

describe("RolesRightsTab", () => {
  beforeEach(() => {
    (client.calls as unknown[]).length = 0;
    vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org1" } } as never);
  });

  it("shows Standard as the active preset for registry-default seeded data", async () => {
    renderWithProviders(<RolesRightsTab orgId="org1" />);

    // Wait for the matrix query to resolve (a single findBy*, not a role+name query
    // inside a retry loop) before asserting on the now-settled preset tab.
    await screen.findByRole("switch", { name: "Manage casts" });
    expect(screen.getByRole("tab", { name: "Standard" })).toHaveAttribute("aria-selected", "true");
  });

  it("stages a toggle then applies it as a batched write", async () => {
    renderWithProviders(<RolesRightsTab orgId="org1" />);

    const toggle = await screen.findByRole("switch", { name: "Manage casts" });
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();

    fireEvent.click(toggle);

    // Staged count -> 1, Apply enabled, diff sentence updates.
    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
    expect(screen.getByText(/1 right differs from Standard/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(
        calls().some(
          (c) =>
            c.table === "org_capabilities" &&
            c.method === "upsert" &&
            (c.args[0] as Record<string, unknown>).capability === "producer_can_manage_casts" &&
            (c.args[0] as Record<string, unknown>).enabled === false,
        ),
      ).toBe(true),
    );

    // Staged cleared after a successful apply.
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled());
  });

  it("labels the preset-diff line against the selected preset, not the stored baseline", async () => {
    renderWithProviders(<RolesRightsTab orgId="org1" />);

    await screen.findByRole("switch", { name: "Manage casts" });

    // Selecting Full stages every off-by-default right on -- desired now
    // matches Full exactly, so the diff line (which describes desired vs the
    // clicked preset) must say so, even though the STAGED CHANGES panel still
    // shows a real count of changes to apply against the stored org state.
    fireEvent.click(screen.getByRole("tab", { name: "Full" }));

    expect(screen.getByRole("tab", { name: "Full" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Matches the Full baseline exactly.")).toBeInTheDocument();

    const stagedPanel = screen.getByText("STAGED CHANGES").parentElement;
    expect(stagedPanel).not.toBeNull();
    expect(stagedPanel?.textContent).toContain("9");
    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();

    // Toggling one right back off makes desired diverge from Full by one, and
    // the active preset tab flips to Custom -- but the diff line keeps
    // labeling the divergence against Full, the preset the user last clicked.
    fireEvent.click(screen.getByRole("switch", { name: "Delete productions" }));

    expect(screen.getByRole("tab", { name: "Custom" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/1 right differs from Full\./)).toBeInTheDocument();
  });

  it("routes a sensitive toggle through the confirm dialog before writing", async () => {
    renderWithProviders(<RolesRightsTab orgId="org1" />);

    const toggle = await screen.findByRole("switch", { name: "Delete productions" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Not written yet: the confirm dialog must gate the write first.
    expect(calls().some((c) => c.table === "org_capabilities" && c.method === "upsert")).toBe(false);
    expect(await screen.findByText("Confirm sensitive changes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(
        calls().some(
          (c) =>
            c.table === "org_capabilities" &&
            c.method === "upsert" &&
            (c.args[0] as Record<string, unknown>).capability === "producer_can_hard_delete_productions" &&
            (c.args[0] as Record<string, unknown>).enabled === true,
        ),
      ).toBe(true),
    );
  });
});
