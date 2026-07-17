import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ switchOrg: vi.fn() }) }));
// These child components pull in their own data-access modules; stub them out
// so this test only exercises OrganizationsTab's own row rendering + chips.
vi.mock("./NewOrgDialog", () => ({ NewOrgDialog: () => null }));
vi.mock("./EditOrgDialog", () => ({ EditOrgDialog: () => null }));
vi.mock("./OrgInvitePopover", () => ({ OrgInvitePopover: () => null }));
vi.mock("./OrgMembersPopover", () => ({ OrgMembersPopover: () => null }));

const fetchPlatformOrgStatsSpy = vi.fn();
const fetchAllOrgEntitlementsSpy = vi.fn();
vi.mock("@/data/platform", () => ({
  fetchPlatformOrgStats: (...args: unknown[]) => fetchPlatformOrgStatsSpy(...args),
  fetchAllOrgEntitlements: (...args: unknown[]) => fetchAllOrgEntitlementsSpy(...args),
  setOrgStatus: vi.fn().mockResolvedValue(undefined),
}));

import { OrganizationsTab } from "./OrganizationsTab";

const ORG_STAT = (org_id: string, name: string, slug: string) => ({
  org_id, name, slug, status: "active",
  member_count: 1, active_artist_count: 1, bookings_30d: 0, last_activity_at: null,
});

const wrap = (ui: React.ReactNode) => renderWithProviders(<MemoryRouter>{ui}</MemoryRouter>);

describe("OrganizationsTab module chips", () => {
  beforeEach(() => {
    fetchPlatformOrgStatsSpy.mockReset();
    fetchAllOrgEntitlementsSpy.mockReset();
  });

  it("renders a chip per enabled feature, grouped by org", async () => {
    fetchPlatformOrgStatsSpy.mockResolvedValue([
      ORG_STAT("o1", "Acme", "acme"),
      ORG_STAT("o2", "Beta", "beta"),
    ]);
    fetchAllOrgEntitlementsSpy.mockResolvedValue([
      { org_id: "o1", feature: "booking_flow", enabled: true },
      { org_id: "o1", feature: "hire_orders", enabled: true },
      { org_id: "o2", feature: "hire_orders", enabled: false },
      // o2 has no booking_flow row at all -> falls back to the registry default (enabled).
    ]);
    wrap(<OrganizationsTab />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());

    const acmeRow = screen.getByText("Acme").closest("tr")!;
    expect(within(acmeRow).getByText("BF")).toBeInTheDocument();
    expect(within(acmeRow).getByText("HO")).toBeInTheDocument();

    const betaRow = screen.getByText("Beta").closest("tr")!;
    expect(within(betaRow).getByText("BF")).toBeInTheDocument();
    expect(within(betaRow).queryByText("HO")).not.toBeInTheDocument();
  });

  it("ignores an unknown feature row instead of crashing the render", async () => {
    fetchPlatformOrgStatsSpy.mockResolvedValue([ORG_STAT("o1", "Acme", "acme")]);
    fetchAllOrgEntitlementsSpy.mockResolvedValue([
      { org_id: "o1", feature: "not_a_real_feature", enabled: true },
    ]);
    wrap(<OrganizationsTab />);
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    expect(screen.queryByText("not_a_real_feature")).not.toBeInTheDocument();
  });
});
