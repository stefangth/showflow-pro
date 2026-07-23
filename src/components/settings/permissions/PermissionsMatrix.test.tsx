import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/data/platform", () => ({ setOrgCapability: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/data/capabilities", () => ({
  setOrgCapabilityPolicy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/useCapabilities", () => ({ useCapabilityMatrix: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { setOrgCapability } from "@/data/platform";
import { setOrgCapabilityPolicy } from "@/data/capabilities";
import { useCapabilityMatrix } from "@/hooks/useCapabilities";
import { PermissionsMatrix } from "./PermissionsMatrix";
import { CAPABILITY_DEFS, CAPABILITY_REGISTRY } from "@/lib/capabilities";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
}
function allCells() {
  return CAPABILITY_DEFS.map((def) => ({ def, effective: def.defaultEnabled, locked: false, source: "registry", policyLocked: false }));
}

beforeEach(() => vi.clearAllMocks());

describe("PermissionsMatrix", () => {
  it("hides hire-order rows when the module is off", () => {
    vi.mocked(useCapabilityMatrix).mockReturnValue({ cells: allCells(), isLoading: false });
    render(<PermissionsMatrix orgId="org-1" mode="org" moduleEnabled={() => false} />, { wrapper: wrap() });
    expect(screen.queryByText(CAPABILITY_REGISTRY["producer_can_issue_hire_orders"].label)).not.toBeInTheDocument();
    expect(screen.getByText(CAPABILITY_REGISTRY["producer_can_manage_casts"].label)).toBeInTheDocument();
  });

  it("org mode: toggling a standard right writes immediately", async () => {
    vi.mocked(useCapabilityMatrix).mockReturnValue({ cells: allCells(), isLoading: false });
    render(<PermissionsMatrix orgId="org-1" mode="org" moduleEnabled={() => true} />, { wrapper: wrap() });
    const row = screen.getByTestId(`cap-row-producer_can_manage_casts`);
    fireEvent.click(within(row).getByRole("switch"));
    await waitFor(() => expect(setOrgCapability).toHaveBeenCalledWith(expect.anything(), "org-1", "producer_can_manage_casts", false));
  });

  it("org mode: a sensitive right requires confirmation before writing", async () => {
    vi.mocked(useCapabilityMatrix).mockReturnValue({ cells: allCells(), isLoading: false });
    render(<PermissionsMatrix orgId="org-1" mode="org" moduleEnabled={() => true} />, { wrapper: wrap() });
    const row = screen.getByTestId(`cap-row-producer_can_hard_delete_productions`);
    fireEvent.click(within(row).getByRole("switch"));
    expect(setOrgCapability).not.toHaveBeenCalled(); // not yet
    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(setOrgCapability).toHaveBeenCalledWith(expect.anything(), "org-1", "producer_can_hard_delete_productions", true));
  });

  it("platform mode: lock button writes a policy patch", async () => {
    vi.mocked(useCapabilityMatrix).mockReturnValue({ cells: allCells(), isLoading: false });
    render(<PermissionsMatrix orgId="org-1" mode="platform" moduleEnabled={() => true} />, { wrapper: wrap() });
    const row = screen.getByTestId(`cap-row-producer_can_rename_org`);
    fireEvent.click(within(row).getByRole("button", { name: /lock/i }));
    await waitFor(() => expect(setOrgCapabilityPolicy).toHaveBeenCalledWith(expect.anything(), "org-1", "producer_can_rename_org", { locked: true }));
  });
});
