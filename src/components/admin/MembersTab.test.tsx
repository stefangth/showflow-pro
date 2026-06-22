import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const setRole = vi.fn((...a: unknown[]) => Promise.resolve());
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "admin-1" } }),
}));
vi.mock("@/hooks/useOrgMembers", () => ({
  useOrgMembers: () => ({
    data: [
      { user_id: "admin-1", email: "me@x.com", display_name: "Me", roles: ["admin"], last_sign_in_at: "2026-06-01T10:00:00Z" },
      { user_id: "bob-2", email: "bob@x.com", display_name: "Bob", roles: ["producer"], last_sign_in_at: null },
    ],
    isLoading: false, isError: false, error: null,
  }),
  useRemoveOrgMember: () => ({ mutate: vi.fn() }),
  useSetOrgMemberRole: () => ({ mutate: (vars: unknown) => setRole(vars) }),
}));

import { MembersTab } from "./MembersTab";

describe("MembersTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists members with last sign-in", () => {
    renderWithProviders(<MembersTab />);
    expect(screen.getByText("bob@x.com")).toBeInTheDocument();
    expect(screen.getByText(/never signed in/i)).toBeInTheDocument();
  });

  it("toggles a role via set_org_member_role", async () => {
    renderWithProviders(<MembersTab />);
    fireEvent.click(screen.getByRole("button", { name: /edit roles for bob@x.com/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^admin$/i }));
    await waitFor(() => expect(setRole).toHaveBeenCalledWith({ userId: "bob-2", role: "admin", action: "add" }));
  });
});
