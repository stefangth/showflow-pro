// src/components/admin/people/PeopleTab.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "admin-1" } }) }));
vi.mock("@/hooks/useOrgMembers", () => ({
  useOrgMembers: () => ({ data: [
    { user_id: "admin-1", email: "me@x.com", display_name: "Me", roles: ["admin"], last_sign_in_at: "2026-06-01T10:00:00Z" },
    { user_id: "bob-2", email: "bob@x.com", display_name: "Bob", roles: ["producer"], last_sign_in_at: null },
  ], isLoading: false, isError: false, error: null }),
  useRemoveOrgMember: () => ({ mutate: vi.fn(), isPending: false }),
  useSetOrgMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/data/invitations", async (orig) => ({
  ...(await orig<typeof import("@/data/invitations")>()),
  fetchOrgInvitations: () => Promise.resolve([
    { id: "i1", org_id: "org-1", email: "kim@x.com", role: "artist", status: "pending", token: "t", expires_at: "2026-12-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
  ]),
}));

import { PeopleTab } from "./PeopleTab";

describe("PeopleTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows members and pending invites, and filters both via one search", async () => {
    renderWithProviders(<PeopleTab />);
    expect(screen.getByText("bob@x.com")).toBeInTheDocument();
    expect(await screen.findByText("kim@x.com")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/search people/i), { target: { value: "kim" } });
    expect(screen.queryByText("bob@x.com")).not.toBeInTheDocument();
    expect(screen.getByText("kim@x.com")).toBeInTheDocument();
  });
});
