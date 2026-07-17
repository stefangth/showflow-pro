import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// HireOrdersTab and its cards read `currentOrg` from useAuth and hit the shared supabase
// client directly (resolveOrgSetting/upsertOrgSetting, useFeature/useEntitlements,
// useSettingsAudit): same shape as BookingFlowTab.test.tsx / SettingsPage.test.tsx.
// A fake client built with createFakeSupabase (never a hand-rolled vi.mock chain) is
// swapped in via the vi.hoisted holder pattern; useAuth is a vi.fn() so each test can
// select which org (entitled / not entitled) is active.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

Object.assign(
  client,
  createFakeSupabase({
    // Every card resolves its own key via resolveOrgSetting({ ... }.eq("key", key)...); the
    // fake doesn't filter on `.eq("key", ...)` for a single-object seed, so an empty array
    // here means every card falls back to its own default, exactly what these tests need
    // to exercise the seeded HIRE_ORDER_DEFAULT_TERMS and the "manual" countersign default.
    app_settings: { data: [], error: null },
    settings_audit_log: { data: [], error: null },
    profiles: { data: [], error: null },
    org_entitlements: [
      { when: { org_id: "org-on" }, data: [{ feature: "hire_orders", enabled: true }], error: null },
      { when: { org_id: "org-off" }, data: [{ feature: "hire_orders", enabled: false }], error: null },
    ],
  }),
);

import { useAuth } from "@/features/auth/AuthContext";
import { HireOrdersTab } from "./HireOrdersTab";

function authAs(orgId: string) {
  vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: orgId, name: "Test Org", slug: "test-org" } } as never);
}

describe("HireOrdersTab", () => {
  it("renders all five cards when the org is entitled", async () => {
    authAs("org-on");
    renderWithProviders(<HireOrdersTab />);
    await screen.findByText("Letterhead");
    expect(screen.getByText("Order defaults")).toBeInTheDocument();
    expect(screen.getByText("Numbering")).toBeInTheDocument();
    expect(screen.getByText("Terms")).toBeInTheDocument();
    expect(screen.getByText("Countersign mode")).toBeInTheDocument();
  });

  it("renders nothing when the org is not entitled to hire_orders", async () => {
    authAs("org-off");
    const { queryClient } = renderWithProviders(<HireOrdersTab />);
    await waitFor(() =>
      expect(queryClient.getQueryState(["entitlements", "org-off"])?.status).toBe("success"),
    );
    expect(screen.queryByText("Letterhead")).not.toBeInTheDocument();
    expect(screen.queryByText("Countersign mode")).not.toBeInTheDocument();
  });

  it("persists the letterhead legal name via upsertOrgSetting on Save", async () => {
    authAs("org-on");
    renderWithProviders(<HireOrdersTab />);
    const legalName = await screen.findByLabelText("Legal name");
    fireEvent.change(legalName, { target: { value: "Aurora Productions GmbH" } });
    fireEvent.click(screen.getByRole("button", { name: "Save letterhead" }));

    await waitFor(() => {
      const calls = client.calls as { table: string; method: string; args: unknown[] }[];
      const upsertCall = calls.find((c) => c.table === "app_settings" && c.method === "upsert");
      expect(upsertCall).toBeDefined();
      const payload = upsertCall!.args[0] as { org_id: string; key: string; value: { legal_name: string } };
      expect(payload.org_id).toBe("org-on");
      expect(payload.key).toBe("hire_order_letterhead");
      expect(payload.value.legal_name).toBe("Aurora Productions GmbH");
    });
  });

  it("offers exactly manual and documenso countersign options, manual by default", async () => {
    authAs("org-on");
    renderWithProviders(<HireOrdersTab />);
    await screen.findByText("Countersign mode");
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(screen.getByRole("radio", { name: /manual/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /documenso/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /manual/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /documenso/i })).toHaveAttribute("aria-checked", "false");
  });

  it("shows the Documenso note only once documenso is selected, and keeps it selectable", async () => {
    authAs("org-on");
    renderWithProviders(<HireOrdersTab />);
    await screen.findByText("Countersign mode");
    expect(screen.queryByText(/connect documenso in a later step/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /documenso/i }));
    expect(screen.getByText(/connect documenso in a later step\. manual marking stays available\./i)).toBeInTheDocument();
  });

  it("lists three terms variant sub-editors (lean, standard, full) seeded with default clauses, and supports add/remove", async () => {
    authAs("org-on");
    renderWithProviders(<HireOrdersTab />);
    await screen.findByText("Terms");

    expect(screen.getByText("Lean")).toBeInTheDocument();
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("Full")).toBeInTheDocument();

    // Seeded from HIRE_ORDER_DEFAULT_TERMS: lean starts empty, standard has 4, full has 4.
    const leanSection = screen.getByText("Lean").closest("div")!.parentElement as HTMLElement;
    const standardSection = screen.getByText("Standard").closest("div")!.parentElement as HTMLElement;
    expect(within(leanSection).queryAllByLabelText(/lean clause \d+ title/i)).toHaveLength(0);
    expect(within(standardSection).getAllByLabelText(/standard clause \d+ title/i)).toHaveLength(4);

    // Add a clause row to Lean.
    fireEvent.click(within(leanSection).getByRole("button", { name: /add clause/i }));
    expect(within(leanSection).getAllByLabelText(/lean clause \d+ title/i)).toHaveLength(1);

    // Remove a clause row from Standard.
    fireEvent.click(within(standardSection).getByRole("button", { name: /remove standard clause 1/i }));
    expect(within(standardSection).getAllByLabelText(/standard clause \d+ title/i)).toHaveLength(3);
  });
});
