import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const hasRoleMock = vi.fn((role: string) => role === "admin");
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1", name: "Berlin Ensemble" }, hasRole: (r: string) => hasRoleMock(r) }),
}));

const statsMock = vi.fn();
const membersMock = vi.fn();
const useOrgMembersSpy = vi.fn();
vi.mock("@/hooks/useTrustStats", () => ({
  useOrgDataStats: () => statsMock(),
}));
vi.mock("@/hooks/useOrgMembers", () => ({
  useOrgMembers: (orgId: string | null | undefined) => {
    useOrgMembersSpy(orgId);
    return membersMock();
  },
}));

const { OrgDataCard } = await import("./OrgDataCard");

describe("OrgDataCard", () => {
  it("renders skeletons while loading, never a number", () => {
    statsMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    membersMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    renderWithProviders(<OrgDataCard />);

    expect(screen.queryByText(/^\d/)).toBeNull();
    expect(screen.queryByTitle("Could not be read just now")).toBeNull();
    // The label renders immediately; only the value is a skeleton while loading.
    expect(screen.getByText("Records")).toBeInTheDocument();
  });

  it("renders the loaded counts once both queries resolve", () => {
    statsMock.mockReturnValue({
      data: { bookings: 1284, artists: 96, productions: 14 },
      isLoading: false,
      isError: false,
    });
    membersMock.mockReturnValue({
      data: [
        { user_id: "u1", roles: ["admin"] },
        { user_id: "u2", roles: ["producer"] },
      ],
      isLoading: false,
      isError: false,
    });

    renderWithProviders(<OrgDataCard />);

    expect(screen.getByText("1,284 bookings")).toBeInTheDocument();
    expect(screen.getByText("96 artists · 14 productions.")).toBeInTheDocument();
    expect(screen.getByText("2 people")).toBeInTheDocument();
  });

  // The note used to read "N administrators · M production team", counting
  // only those two roles. That is a breakdown of the headline that leaves out
  // every artist, so in any organisation with artists the tile appeared to be
  // concealing members: "7 people / 2 administrators · 2 production team".
  it("accounts for every member in the Members note, artists included", () => {
    statsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    membersMock.mockReturnValue({
      data: [
        { user_id: "u1", roles: ["admin"] },
        { user_id: "u2", roles: ["admin"] },
        { user_id: "u3", roles: ["producer"] },
        { user_id: "u4", roles: ["producer"] },
        { user_id: "u5", roles: ["artist"] },
        { user_id: "u6", roles: ["artist"] },
        { user_id: "u7", roles: ["artist"] },
      ],
      isLoading: false,
      isError: false,
    });

    renderWithProviders(<OrgDataCard />);

    expect(screen.getByText("7 people")).toBeInTheDocument();
    const note = screen.getByText(/administrators/);
    expect(note).toHaveTextContent("3 artists");
    // Role holders, not a partition: "list_org_members" aggregates roles, so a
    // person holding two of them would appear twice. The label must not
    // promise arithmetic it cannot keep.
    expect(note.textContent).toMatch(/^Roles held:/);
  });

  // `supabase/tests/rls/org_isolation.sql` is a single token with no natural
  // break opportunity. Measured in the running app before the fix: the tab's
  // content column is 772px while its subtree reported a 791px scrollWidth,
  // i.e. the citation ran past the tile, the Card and the settings column at
  // every desktop width, and was clipped at the viewport edge at 1024.
  // jsdom has no layout engine, so this pins the wrapping rule that closed it.
  it("lets the Outside-reach citation break rather than overflow its tile", () => {
    statsMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    membersMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    const { container } = renderWithProviders(<OrgDataCard />);

    const note = screen.getByText(/supabase\/tests\/rls\/org_isolation\.sql/);
    expect(note.className).toMatch(/\bbreak-words\b/);
    // ...and the tile grid must not go 4-up. `lg:` is a viewport query, but
    // SettingsPage caps this tab's content column at 772px however wide the
    // display is, so a 4-up row had 174px per tile at best and 107px at a
    // 1024px viewport, where "OUTSIDE REACH" wrapped its own label.
    const grid = container.querySelector('[class*="grid"][class*="grid-cols"]');
    expect(grid).not.toBeNull();
    expect(grid!.className).not.toMatch(/grid-cols-(3|4)\b/);
  });

  it("shows the dash on error, and does not blank the rest of the card", () => {
    statsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    membersMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    renderWithProviders(<OrgDataCard />);

    const dashes = screen.getAllByTitle("Could not be read just now");
    expect(dashes).toHaveLength(2);
    for (const dash of dashes) expect(dash).toHaveTextContent("—");
    // The card heading, and the two tiles that do not depend on a query, still render.
    expect(screen.getByText("This organisation's data")).toBeInTheDocument();
    expect(screen.getByText("EU · Ireland")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  // A query that never settles (offline, or the org-scoped query disabled
  // because currentOrg is briefly undefined) leaves isLoading and isError both
  // false with data undefined. That state must degrade to the same honest
  // dash rather than rendering an empty tile.
  it("shows the dash when a query is neither loading, errored, nor resolved", () => {
    statsMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    membersMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderWithProviders(<OrgDataCard />);

    const dashes = screen.getAllByTitle("Could not be read just now");
    expect(dashes).toHaveLength(2);
  });

  it("cites the isolation test in the Outside-reach note", () => {
    statsMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    membersMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    renderWithProviders(<OrgDataCard />);

    expect(screen.getByText(/supabase\/tests\/rls\/org_isolation\.sql/)).toBeInTheDocument();
  });
});

// list_org_members is admin-only server-side
// (supabase/migrations/20260622164208_list_org_members_last_sign_in.sql:8
// raises 42501 for anyone who is not an org admin). A production-team viewer
// opening this tab must not see that permanent boundary mislabelled as the
// generic "could not be read just now" transient-failure dash, and the
// component must not fire the forbidden RPC at all.
describe("OrgDataCard — producer (non-admin) viewer", () => {
  afterEach(() => {
    hasRoleMock.mockImplementation((role: string) => role === "admin");
  });

  it("shows an explicit administrators-only state for Members, not the generic error dash", () => {
    hasRoleMock.mockImplementation(() => false);
    statsMock.mockReturnValue({
      data: { bookings: 1284, artists: 96, productions: 14 },
      isLoading: false,
      isError: false,
    });
    // Simulates what a real producer session would get back if the RPC ran
    // anyway: a permanent 42501, not a transient failure. The tile must not
    // key its message off this.
    membersMock.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    renderWithProviders(<OrgDataCard />);

    expect(screen.getByText("Admin only")).toBeInTheDocument();
    expect(screen.getByText("Visible to organisation administrators.")).toBeInTheDocument();
    expect(screen.queryByTitle("Could not be read just now")).toBeNull();
  });

  it("withholds the org id from useOrgMembers so the forbidden RPC never fires", () => {
    hasRoleMock.mockImplementation(() => false);
    statsMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    membersMock.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderWithProviders(<OrgDataCard />);

    expect(useOrgMembersSpy).toHaveBeenCalledWith(undefined);
  });
});
