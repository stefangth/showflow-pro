import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const exportSpy = vi.fn().mockResolvedValue({ schema_version: 1 });
const deleteSpy = vi.fn().mockResolvedValue(undefined);
const setOrgEntitlementSpy = vi.fn().mockResolvedValue(undefined);
const setOrgCapabilitySpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/data/platform", () => ({
  updateOrg: vi.fn().mockResolvedValue(undefined),
  exportOrgData: () => exportSpy(),
  deleteOrg: () => deleteSpy(),
  setOrgEntitlement: (...args: unknown[]) => setOrgEntitlementSpy(...args),
  setOrgCapability: (...args: unknown[]) => setOrgCapabilitySpy(...args),
}));
const fetchEntitlementsSpy = vi.fn().mockResolvedValue([
  { feature: "booking_flow", enabled: true },
  { feature: "hire_orders", enabled: false },
]);
vi.mock("@/data/entitlements", () => ({
  fetchEntitlements: (...args: unknown[]) => fetchEntitlementsSpy(...args),
}));
const fetchCapabilitiesSpy = vi.fn().mockResolvedValue([]);
vi.mock("@/data/capabilities", () => ({
  fetchCapabilities: (...args: unknown[]) => fetchCapabilitiesSpy(...args),
}));

import { EditOrgDialog } from "./EditOrgDialog";
import { toast } from "sonner";
import { CAPABILITY_REGISTRY } from "@/lib/capabilities";

const org = { org_id: "o1", name: "Acme", slug: "acme", status: "active" } as never;
const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

/** Same as wrap(), but also returns the QueryClient so a test can spy on invalidateQueries. */
function wrapWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, tree: <QueryClientProvider client={client}>{ui}</QueryClientProvider> };
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
    const bookingFlow = await screen.findByRole("switch", { name: /booking flow/i });
    // Exact match: several new capability labels also contain "hire orders" case-insensitively
    // (e.g. "Issue hire orders"), which a loose regex would collide with.
    const hireOrders = screen.getByRole("switch", { name: "Hire orders" });
    expect(bookingFlow).toBeChecked();
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
  beforeEach(() => {
    setOrgCapabilitySpy.mockClear();
    fetchCapabilitiesSpy.mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
  });

  it("renders the User rights section with a Switch per capability", async () => {
    render(wrap(<EditOrgDialog org={org} onClose={() => {}} />));
    await waitFor(() => expect(fetchCapabilitiesSpy).toHaveBeenCalledWith(expect.anything(), "o1"));
    expect(screen.getByText("User rights")).toBeInTheDocument();
    // producer_can_rename_org defaults to off (sensitive right), unlike producer_can_invite
    // which now defaults on (see src/lib/capabilities.ts).
    const producerCanRenameOrg = await screen.findByRole("switch", {
      name: CAPABILITY_REGISTRY.producer_can_rename_org.label,
    });
    expect(producerCanRenameOrg).not.toBeChecked();
  });

  it("toggling a capability calls setOrgCapability, invalidates capabilities, and toasts", async () => {
    render(wrap(<EditOrgDialog org={org} onClose={() => {}} />));
    const producerCanRenameOrg = await screen.findByRole("switch", {
      name: CAPABILITY_REGISTRY.producer_can_rename_org.label,
    });
    fireEvent.click(producerCanRenameOrg);
    await waitFor(() =>
      expect(setOrgCapabilitySpy).toHaveBeenCalledWith(expect.anything(), "o1", "producer_can_rename_org", true),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("User rights updated"));
  });
});
