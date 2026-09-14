import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageProvider } from "@/features/i18n/LanguageContext";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const exportSpy = vi.fn().mockResolvedValue({ schema_version: 1 });
const deleteSpy = vi.fn().mockResolvedValue(undefined);
const setOrgEntitlementSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/data/platform", () => ({
  updateOrg: vi.fn().mockResolvedValue(undefined),
  exportOrgData: () => exportSpy(),
  deleteOrg: () => deleteSpy(),
  setOrgEntitlement: (...args: unknown[]) => setOrgEntitlementSpy(...args),
}));
const setOrgKindSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/data/orgs", () => ({
  setOrgKind: (...args: unknown[]) => setOrgKindSpy(...args),
}));
const refreshOrgsSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/features/auth/AuthContext", async (orig) => ({
  ...(await orig<typeof import("@/features/auth/AuthContext")>()),
  useAuth: () => ({ refreshOrgs: refreshOrgsSpy }),
}));
const fetchEntitlementsSpy = vi.fn().mockResolvedValue([
  { feature: "booking_flow", enabled: true },
  { feature: "hire_orders", enabled: false },
]);
vi.mock("@/data/entitlements", () => ({
  fetchEntitlements: (...args: unknown[]) => fetchEntitlementsSpy(...args),
}));
vi.mock("@/components/settings/permissions/PermissionsMatrix", () => ({
  PermissionsMatrix: (p: { orgId: string; mode: string }) => (
    <div data-testid="matrix" data-org={p.orgId} data-mode={p.mode} />
  ),
}));

import { EditOrgDialog } from "./EditOrgDialog";
import { toast } from "sonner";

const org = {
  org_id: "o1", name: "Acme", slug: "acme", status: "active",
  member_count: 0, active_artist_count: 0, bookings_30d: 0, last_activity_at: null,
  is_demo: false, org_kind: "production",
} as never;
const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <LanguageProvider>{ui}</LanguageProvider>
  </QueryClientProvider>
);

/** Same as wrap(), but also returns the QueryClient so a test can spy on invalidateQueries. */
function wrapWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, tree: <QueryClientProvider client={client}><LanguageProvider>{ui}</LanguageProvider></QueryClientProvider> };
}

describe("EditOrgDialog danger zone", () => {
  beforeEach(() => {
    exportSpy.mockClear(); deleteSpy.mockClear();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  it("exports org data", async () => {
    render(wrap(<EditOrgDialog org={org} onClose={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: /export org data/i }));
    await waitFor(() => expect(exportSpy).toHaveBeenCalled());
  });

  it("requires the org name before deleting", async () => {
    render(wrap(<EditOrgDialog org={org} onClose={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: /delete organization/i }));
    const confirm = await screen.findByRole("button", { name: /permanently delete/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Acme"), { target: { value: "Acme" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(deleteSpy).toHaveBeenCalled());
  });
});

describe("EditOrgDialog modules section", () => {
  beforeEach(() => {
    setOrgEntitlementSpy.mockClear();
    fetchEntitlementsSpy.mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
  });

  it("renders one labeled Switch per FEATURE_KEYS, seeded from fetchEntitlements", async () => {
    render(wrap(<EditOrgDialog org={org} onClose={() => {}} />));
    await waitFor(() => expect(fetchEntitlementsSpy).toHaveBeenCalledWith(expect.anything(), "o1"));
    const bookingEngine = await screen.findByRole("switch", { name: "Booking engine" });
    // Exact match: several new capability labels also contain "hire orders" case-insensitively
    // (e.g. "Issue hire orders"), which a loose regex would collide with.
    const hireOrders = screen.getByRole("switch", { name: "Hire orders" });
    expect(bookingEngine).toBeChecked();
    expect(hireOrders).not.toBeChecked();
    expect(screen.getByText(/Configurable offer, escalation and confirmation automation\./i)).toBeInTheDocument();
    expect(screen.getByText(/PDF engagement sheets with delivery and countersignature\./i)).toBeInTheDocument();
  });

  it("toggling a module calls setOrgEntitlement, invalidates platform + entitlements, and toasts", async () => {
    const { client, tree } = wrapWithClient(<EditOrgDialog org={org} onClose={() => {}} />);
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    render(tree);
    const hireOrders = await screen.findByRole("switch", { name: "Hire orders" });
    fireEvent.click(hireOrders);
    await waitFor(() => expect(setOrgEntitlementSpy).toHaveBeenCalledWith(expect.anything(), "o1", "hire_orders", true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Module updated"));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["platform"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["entitlements"] });
  });
});

describe("EditOrgDialog user rights section", () => {
  it("shows a summary and a button to manage all rights", async () => {
    render(wrap(<EditOrgDialog org={org} onClose={() => {}} />));
    expect(screen.getByText("User rights")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage all rights/i })).toBeInTheDocument();
    expect(screen.queryByTestId("matrix")).not.toBeInTheDocument();
  });

  it("opens the permissions matrix in platform mode for the org", async () => {
    render(wrap(<EditOrgDialog org={org} onClose={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: /manage all rights/i }));
    const m = await screen.findByTestId("matrix");
    expect(m).toHaveAttribute("data-org", "o1");
    expect(m).toHaveAttribute("data-mode", "platform");
  });
});

describe("EditOrgDialog workspace type", () => {
  beforeEach(() => {
    setOrgKindSpy.mockClear();
    refreshOrgsSpy.mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
  });

  it("shows the org's current workspace type", () => {
    render(wrap(<EditOrgDialog org={org} onClose={() => {}} />));
    expect(screen.getByRole("combobox", { name: /workspace type/i })).toHaveTextContent("Live production");
  });

  it("saves immediately on pick, invalidates platform, and toasts", async () => {
    const { client, tree } = wrapWithClient(<EditOrgDialog org={org} onClose={() => {}} />);
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    render(tree);

    fireEvent.click(screen.getByRole("combobox", { name: /workspace type/i }));
    fireEvent.click(await screen.findByRole("option", { name: /staffing agency/i }));

    await waitFor(() => expect(setOrgKindSpy).toHaveBeenCalledWith(expect.anything(), "o1", "staffing"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Workspace type updated"));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["platform"] });
  });

  it("refreshes the caller's own orgs after a workspace type change", async () => {
    render(wrap(<EditOrgDialog org={org} onClose={() => {}} />));

    fireEvent.click(screen.getByRole("combobox", { name: /workspace type/i }));
    fireEvent.click(await screen.findByRole("option", { name: /staffing agency/i }));

    await waitFor(() => expect(setOrgKindSpy).toHaveBeenCalled());
    await waitFor(() => expect(refreshOrgsSpy).toHaveBeenCalled());
  });
});
