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

const setMembershipMutate = vi.fn();
const removeMembershipMutate = vi.fn();
const linkArtistMutate = vi.fn();
const manageUserMutate = vi.fn();

vi.mock("@/hooks/usePlatformUsers", () => ({
  useSetMembership: () => ({ mutate: setMembershipMutate, isPending: false }),
  useRemoveMembership: () => ({ mutate: removeMembershipMutate, isPending: false }),
  useLinkArtist: () => ({ mutate: linkArtistMutate, isPending: false }),
  useManageUser: () => ({ mutate: manageUserMutate, isPending: false }),
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
    { org_id: "o1", org_name: "Acme", roles: ["admin"], artist: null },
  ],
};

const LINKED_USER: PlatformUser = {
  ...BASE_USER,
  id: "u2",
  memberships: [
    { org_id: "o1", org_name: "Acme", roles: ["producer"], artist: { id: "art1", name: "Grace Hopper" } },
  ],
};

describe("UserDetailSheet", () => {
  beforeEach(() => {
    setMembershipMutate.mockReset();
    removeMembershipMutate.mockReset();
    linkArtistMutate.mockReset();
    manageUserMutate.mockReset();
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

  it("confirming Suspend calls useManageUser().mutate with action suspend", () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend user" }));
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    expect(manageUserMutate).toHaveBeenCalledWith(
      { action: "suspend", target_user_id: "u1" },
      expect.anything(),
    );
  });

  it("confirming Unsuspend on a suspended user calls useManageUser().mutate with action unsuspend", () => {
    renderWithProviders(
      <UserDetailSheet user={{ ...BASE_USER, suspended: true }} open onOpenChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Unsuspend user" }));
    fireEvent.click(screen.getByRole("button", { name: "Unsuspend" }));
    expect(manageUserMutate).toHaveBeenCalledWith(
      { action: "unsuspend", target_user_id: "u1" },
      expect.anything(),
    );
  });

  it("changing a role Select calls useSetMembership().mutate to swap the role", async () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Role for Acme" }));
    fireEvent.click(await screen.findByRole("option", { name: "producer" }));
    await flush();

    expect(setMembershipMutate).toHaveBeenCalledWith(
      { orgId: "o1", userId: "u1", role: "admin", action: "remove" },
      expect.anything(),
    );
    expect(setMembershipMutate).toHaveBeenCalledWith(
      { orgId: "o1", userId: "u1", role: "producer", action: "add" },
      expect.anything(),
    );
  });

  it("Unlink calls useLinkArtist().mutate with artistId null", () => {
    renderWithProviders(<UserDetailSheet user={LINKED_USER} open onOpenChange={() => {}} />);
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(linkArtistMutate).toHaveBeenCalledWith(
      { orgId: "o1", userId: "u2", artistId: null },
      expect.anything(),
    );
  });

  it("picking an artist from the link picker calls useLinkArtist().mutate with the artist id", async () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Link artist" }));
    await waitFor(() => expect(fetchArtistsLiteSpy).toHaveBeenCalledWith(expect.anything(), "o1"));

    fireEvent.click(await screen.findByRole("combobox", { name: "Artist for Acme" }));
    fireEvent.click(await screen.findByRole("option", { name: "Grace Hopper" }));

    expect(linkArtistMutate).toHaveBeenCalledWith(
      { orgId: "o1", userId: "u1", artistId: "art1" },
      expect.anything(),
    );
  });

  it("removes a user from an org via the confirm dialog", () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove from org" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeMembershipMutate).toHaveBeenCalledWith(
      { orgId: "o1", userId: "u1" },
      expect.anything(),
    );
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
    fireEvent.click(await screen.findByRole("option", { name: "producer" }));
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(setMembershipMutate).toHaveBeenCalledWith(
      { orgId: "o2", userId: "u1", role: "producer", action: "add" },
      expect.anything(),
    );
  });

  it("sends a password reset link", () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(manageUserMutate).toHaveBeenCalledWith(
      { action: "send_password_reset", target_user_id: "u1" },
      expect.anything(),
    );
  });

  it("changes the login email through the confirm dialog", () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    const input = screen.getByLabelText("New email");
    fireEvent.change(input, { target: { value: "new@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(manageUserMutate).toHaveBeenCalledWith(
      { action: "change_email", target_user_id: "u1", new_email: "new@x.com" },
      expect.anything(),
    );
  });

  it("requires the login email to be typed before deleting", () => {
    renderWithProviders(<UserDetailSheet user={BASE_USER} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete user" }));
    const confirm = screen.getByRole("button", { name: "Permanently delete" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("ada@x.com"), { target: { value: "ada@x.com" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(manageUserMutate).toHaveBeenCalledWith(
      { action: "delete", target_user_id: "u1" },
      expect.anything(),
    );
  });
});
