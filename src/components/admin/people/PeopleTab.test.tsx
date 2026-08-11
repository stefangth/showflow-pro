// src/components/admin/people/PeopleTab.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { OrgMember, RemovedMember } from "@/data/members";

type MembersState = {
  data: OrgMember[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
};

const h = vi.hoisted(() => {
  const members: OrgMember[] = [
    { user_id: "admin-1", email: "me@x.com", display_name: "Me", roles: ["admin"], last_sign_in_at: "2026-06-01T10:00:00Z" },
    { user_id: "bob-2", email: "bob@x.com", display_name: "Bob", roles: ["producer"], last_sign_in_at: null },
  ];
  return {
    members,
    membersState: { data: members, isLoading: false, isError: false, error: null } as MembersState,
    removeMutate: vi.fn(),
    restoreMutate: vi.fn(),
    clearMutate: vi.fn(),
    purgeMutate: vi.fn(),
    removedState: { data: [] as RemovedMember[] },
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "admin-1" } }) }));
vi.mock("@/hooks/useOrgMembers", () => ({
  useOrgMembers: () => h.membersState,
  useRemovedMembers: () => h.removedState,
  useRemoveOrgMember: () => ({ mutate: h.removeMutate, isPending: false }),
  useSetOrgMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
  useRestoreOrgMember: () => ({ mutate: h.restoreMutate, isPending: false, variables: undefined }),
  useClearRemovedMember: () => ({ mutate: h.clearMutate, isPending: false }),
  usePurgeRemovedUser: () => ({ mutate: h.purgeMutate, isPending: false }),
}));
vi.mock("@/data/invitations", async (orig) => ({
  ...(await orig<typeof import("@/data/invitations")>()),
  fetchOrgInvitations: () => Promise.resolve([
    { id: "i1", org_id: "org-1", email: "kim@x.com", role: "artist", status: "pending", token: "t", expires_at: "2026-12-01T00:00:00Z", created_at: "2026-03-01T00:00:00Z" },
    { id: "i2", org_id: "org-1", email: "dana@x.com", role: "producer", status: "accepted", token: "t2", expires_at: "2026-12-01T00:00:00Z", created_at: "2026-02-01T00:00:00Z" },
    { id: "i3", org_id: "org-1", email: "rex@x.com", role: "artist", status: "revoked", token: "t3", expires_at: "2026-12-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
  ]),
}));

import { PeopleTab } from "./PeopleTab";

describe("PeopleTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.membersState.data = h.members;
    h.membersState.isLoading = false;
    h.membersState.isError = false;
    h.membersState.error = null;
    h.removedState.data = [];
  });

  it("shows members and pending invites, and filters both via one search", async () => {
    renderWithProviders(<PeopleTab />);
    expect(screen.getByText("bob@x.com")).toBeInTheDocument();
    // kim is an invited-only person (no display name), so her email is the primary line.
    expect(await screen.findByText("kim@x.com")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/search people/i), { target: { value: "kim" } });
    expect(screen.queryByText("bob@x.com")).not.toBeInTheDocument();
    expect(screen.getByText("kim@x.com")).toBeInTheDocument();
  });

  it("shows accepted and revoked invitations under Invitation history", async () => {
    renderWithProviders(<PeopleTab />);
    expect(await screen.findByText("dana@x.com")).toBeInTheDocument();
    expect(screen.getByText("rex@x.com")).toBeInTheDocument();
    expect(screen.getByText(/invitation history/i)).toBeInTheDocument();
    expect(screen.getByText(/^accepted$/i)).toBeInTheDocument();
    expect(screen.getByText(/^revoked$/i)).toBeInTheDocument();
  });

  it("does not show the no-match empty state while the members query is still loading", () => {
    h.membersState.data = undefined;
    h.membersState.isLoading = true;
    renderWithProviders(<PeopleTab />);
    fireEvent.change(screen.getByPlaceholderText(/search people/i), { target: { value: "zzz" } });
    expect(screen.queryByText(/no people match/i)).not.toBeInTheDocument();
  });

  it("on a members load error shows the alert and NOT the empty state", () => {
    h.membersState.data = undefined;
    h.membersState.isError = true;
    h.membersState.error = new Error("could not load members");
    renderWithProviders(<PeopleTab />);
    expect(screen.getByText(/could not load members/i)).toBeInTheDocument();
    expect(screen.queryByText(/no members yet/i)).not.toBeInTheDocument();
  });

  it("removing a member opens the confirm dialog and calls the remove mutation", async () => {
    renderWithProviders(<PeopleTab />);
    // The self row (admin-1) shows "You"; only bob's row has a "Remove" trigger.
    fireEvent.click(screen.getByRole("button", { name: /remove bob/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^remove$/i }));
    expect(h.removeMutate).toHaveBeenCalledWith("bob-2", expect.anything());
  });

  it("renders the Recently removed group with an adaptive Clear vs Delete action per row", () => {
    h.removedState.data = [
      { user_id: "gone-1", email: "gone@x.com", display_name: "Gone", roles: ["artist"],
        removed_at: "2026-08-11T09:00:00Z", removed_by_name: "Me", deletable: true },
      { user_id: "kept-2", email: "kept@x.com", display_name: "Kept", roles: ["producer"],
        removed_at: "2026-08-10T09:00:00Z", removed_by_name: "Me", deletable: false },
    ];
    renderWithProviders(<PeopleTab />);
    expect(screen.getByText(/recently removed/i)).toBeInTheDocument();
    // deletable → Delete account; not deletable → Clear from list.
    expect(screen.getByRole("button", { name: /delete account of gone/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear kept from list/i })).toBeInTheDocument();
  });

  it("Clear from list calls the clear mutation for the right user", () => {
    h.removedState.data = [
      { user_id: "kept-2", email: "kept@x.com", display_name: "Kept", roles: ["producer"],
        removed_at: "2026-08-10T09:00:00Z", removed_by_name: "Me", deletable: false },
    ];
    renderWithProviders(<PeopleTab />);
    fireEvent.click(screen.getByRole("button", { name: /clear kept from list/i }));
    expect(h.clearMutate).toHaveBeenCalledWith("kept-2", expect.anything());
  });

  it("Delete account requires typing the email before the purge fires", async () => {
    h.removedState.data = [
      { user_id: "gone-1", email: "gone@x.com", display_name: "Gone", roles: ["artist"],
        removed_at: "2026-08-11T09:00:00Z", removed_by_name: "Me", deletable: true },
    ];
    renderWithProviders(<PeopleTab />);
    fireEvent.click(screen.getByRole("button", { name: /delete account of gone/i }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: /delete account/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/type the email/i), { target: { value: "gone@x.com" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    expect(h.purgeMutate).toHaveBeenCalledWith("gone-1", expect.anything());
  });
});
