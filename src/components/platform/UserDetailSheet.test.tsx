import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { PlatformUser } from "@/data/platformUsers";

// Radix Select's dismissable-layer cleanup (from closing one combobox) is an
// effect that flushes on a later tick. A macrotask flush between interactions
// lets it settle first (same pattern as UsersTab.test.tsx / NewOrderWizard.test.tsx).
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Mock the DATA LAYER (not the hooks). The real usePlatformUsers/useSetMembership/
// useRemoveMembership/useLinkArtist/useManageUser hooks run for real against a real
// QueryClient (via renderWithProviders), so mutation onSuccess/onError callbacks
// actually fire and the mutation-invalidates-query refetch loop is exercised.
const fetchPlatformUsersSpy = vi.fn();
const setMembershipSpy = vi.fn();
const removeMembershipSpy = vi.fn();
const linkArtistSpy = vi.fn();
const manageUserSpy = vi.fn();

vi.mock("@/data/platformUsers", () => ({
  fetchPlatformUsers: (...args: unknown[]) => fetchPlatformUsersSpy(...args),
  setMembership: (...args: unknown[]) => setMembershipSpy(...args),
  removeMembership: (...args: unknown[]) => removeMembershipSpy(...args),
  linkArtist: (...args: unknown[]) => linkArtistSpy(...args),
  manageUser: (...args: unknown[]) => manageUserSpy(...args),
}));

const fetchAllOrgsSpy = vi.fn().mockResolvedValue([
  { id: "o1", name: "Acme", slug: "acme", status: "active" },
  { id: "o2", name: "Beta", slug: "beta", status: "active" },
]);
vi.mock("@/data/platform", () => ({
  fetchAllOrgs: (...args: unknown[]) => fetchAllOrgsSpy(...args),
}));

const fetchArtistsLiteSpy = vi.fn().mockResolvedValue([
  { id: "art1", name: "Grace Hopper", email: null },
]);
vi.mock("@/data/hireOrders", () => ({
  fetchArtistsLite: (...args: unknown[]) => fetchArtistsLiteSpy(...args),
}));

import { UserDetailSheet } from "./UserDetailSheet";
import { toast } from "sonner";

const BASE_USER: PlatformUser = {
  id: "u1",
  email: "ada@x.com",
  display_name: "Ada Lovelace",
  created_at: "2026-01-01T00:00:00.000Z",
  last_sign_in_at: "2026-07-01T00:00:00.000Z",
  suspended: false,
  memberships: [
    { org_id: "o1", org_name: "Acme", roles: ["admin"], artist: null, invitePending: false },
  ],
};

const LINKED_USER: PlatformUser = {
  ...BASE_USER,
  id: "u2",
  memberships: [
    { org_id: "o1", org_name: "Acme", roles: ["producer"], artist: { id: "art1", name: "Grace Hopper" }, invitePending: false },
  ],
};

describe("UserDetailSheet", () => {
  beforeEach(() => {
    fetchPlatformUsersSpy.mockReset().mockResolvedValue({ users: [BASE_USER], truncated: false });
    setMembershipSpy.mockReset().mockResolvedValue(undefined);
    removeMembershipSpy.mockReset().mockResolvedValue(undefined);
    linkArtistSpy.mockReset().mockResolvedValue(undefined);
    manageUserSpy.mockReset().mockResolvedValue(undefined);
    fetchAllOrgsSpy.mockClear();
    fetchArtistsLiteSpy.mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
  });

  it("renders nothing when there is no selected user", () => {
    const { container } = renderWithProviders(
      <UserDetailSheet user={null} open={false} onOpenChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the login email", () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    expect(screen.getAllByText("ada@x.com").length).toBeGreaterThan(0);
  });

  it("confirming Suspend calls useManageUser().mutate with action suspend", async () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend user" }));
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    await waitFor(() => expect(manageUserSpy).toHaveBeenCalledWith(
      expect.anything(),
      { action: "suspend", target_user_id: "u1" },
    ));
  });

  it("confirming Unsuspend on a suspended user calls useManageUser().mutate with action unsuspend", async () => {
    renderWithProviders(
      <UserDetailSheet user={{ ...BASE_USER, suspended: true }} open onOpenChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Unsuspend user" }));
    fireEvent.click(screen.getByRole("button", { name: "Unsuspend" }));
    await waitFor(() => expect(manageUserSpy).toHaveBeenCalledWith(
      expect.anything(),
      { action: "unsuspend", target_user_id: "u1" },
    ));
  });

  it("swaps the role: remove then add, exactly one success toast", async () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Role for Acme" }));
    fireEvent.click(await screen.findByRole("option", { name: "Production Team" }));
    await flush();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Role updated"));
    expect(setMembershipSpy).toHaveBeenCalledTimes(2);
    // Sequenced: the add must not fire until the remove has resolved.
    expect(setMembershipSpy.mock.calls[0][1]).toEqual(
      { orgId: "o1", userId: "u1", role: "admin", action: "remove" },
    );
    expect(setMembershipSpy.mock.calls[1][1]).toEqual(
      { orgId: "o1", userId: "u1", role: "producer", action: "add" },
    );
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("aborts the role swap when the remove is rejected: no add, one error toast, no success toast", async () => {
    setMembershipSpy.mockImplementation((_client: unknown, args: { action: string }) =>
      args.action === "remove"
        ? Promise.reject(new Error("cannot remove the last admin"))
        : Promise.resolve(undefined),
    );
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Role for Acme" }));
    fireEvent.click(await screen.findByRole("option", { name: "Production Team" }));
    await flush();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(setMembershipSpy).toHaveBeenCalledTimes(1);
    expect(setMembershipSpy).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "o1", userId: "u1", role: "admin", action: "remove" },
    );
    expect(setMembershipSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "add" }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("Unlink calls useLinkArtist().mutate with artistId null", async () => {
    renderWithProviders(<UserDetailSheet user={LINKED_USER} open onOpenChange={() => {}} />);
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(linkArtistSpy).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "o1", userId: "u2", artistId: null },
    ));
  });

  it("picking an artist from the link picker calls useLinkArtist().mutate with the artist id", async () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Link artist" }));
    await waitFor(() => expect(fetchArtistsLiteSpy).toHaveBeenCalledWith(expect.anything(), "o1"));

    fireEvent.click(await screen.findByRole("combobox", { name: "Artist for Acme" }));
    fireEvent.click(await screen.findByRole("option", { name: "Grace Hopper" }));

    await waitFor(() => expect(linkArtistSpy).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "o1", userId: "u1", artistId: "art1" },
    ));
  });

  it("reflects the newly linked artist once the cache refetches (drawer is not stale)", async () => {
    fetchPlatformUsersSpy
      .mockResolvedValueOnce({ users: [BASE_USER], truncated: false })
      .mockResolvedValue({
        users: [{
          ...BASE_USER,
          memberships: [{ ...BASE_USER.memberships[0], artist: { id: "art1", name: "Grace Hopper" } }],
        }],
        truncated: false,
      });

    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    expect(screen.getByText("None")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Link artist" }));
    await waitFor(() => expect(fetchArtistsLiteSpy).toHaveBeenCalledWith(expect.anything(), "o1"));
    fireEvent.click(await screen.findByRole("combobox", { name: "Artist for Acme" }));
    fireEvent.click(await screen.findByRole("option", { name: "Grace Hopper" }));

    await waitFor(() => expect(linkArtistSpy).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "o1", userId: "u1", artistId: "art1" },
    ));
    // The mutation invalidated ['platform','users']; the refetch above returns the
    // artist-linked row, and the drawer (reading the live cache, not the stale prop)
    // must pick it up without being closed and reopened.
    await waitFor(() => expect(screen.getByText("Grace Hopper")).toBeInTheDocument());
    expect(screen.queryByText("None")).not.toBeInTheDocument();
  });

  it("removes a user from an org via the confirm dialog", async () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove from org" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeMembershipSpy).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "o1", userId: "u1" },
    ));
  });

  it("adds the user to a new organization", async () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    await waitFor(() => expect(fetchAllOrgsSpy).toHaveBeenCalled());

    // Only "Beta" is offered. The user already belongs to "Acme" (o1).
    fireEvent.click(screen.getByRole("combobox", { name: "Organization to add" }));
    expect(screen.queryByRole("option", { name: "Acme" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("option", { name: "Beta" }));
    await flush();

    fireEvent.click(screen.getByRole("combobox", { name: "Role to add" }));
    fireEvent.click(await screen.findByRole("option", { name: "Production Team" }));
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(setMembershipSpy).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "o2", userId: "u1", role: "producer", action: "add" },
    ));
  });

  it("sends a password reset link", async () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    await waitFor(() => expect(manageUserSpy).toHaveBeenCalledWith(
      expect.anything(),
      { action: "send_password_reset", target_user_id: "u1" },
    ));
  });

  it("changes the login email through the confirm dialog", async () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    const input = screen.getByLabelText("New email");
    fireEvent.change(input, { target: { value: "new@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(manageUserSpy).toHaveBeenCalledWith(
      expect.anything(),
      { action: "change_email", target_user_id: "u1", new_email: "new@x.com" },
    ));
  });

  it("requires the login email to be typed before deleting, then closes the sheet on success", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete user" }));
    const confirm = screen.getByRole("button", { name: "Permanently delete" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("ada@x.com"), { target: { value: "ada@x.com" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(manageUserSpy).toHaveBeenCalledWith(
      expect.anything(),
      { action: "delete", target_user_id: "u1" },
    ));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
