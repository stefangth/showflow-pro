// src/components/admin/people/InviteBar.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { OrgMember } from "@/data/members";
import type { Invitation } from "@/data/invitations";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));
const resendInvitation = vi.fn((..._a: unknown[]) => Promise.resolve());
const createInvitation = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/data/invitations", async (orig) => ({
  ...(await orig<typeof import("@/data/invitations")>()),
  resendInvitation: (...a: unknown[]) => resendInvitation(...a),
  createInvitation: (...a: unknown[]) => createInvitation(...a),
}));

import { InviteBar } from "./InviteBar";

const members: OrgMember[] = [{ user_id: "u1", email: "bob@x.com", display_name: "Bob", roles: ["producer"], last_sign_in_at: null }];
const invites: Invitation[] = [{ id: "i1", org_id: "org-1", email: "kim@x.com", role: "artist", status: "pending", token: "t", expires_at: "2026-12-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" }];

describe("InviteBar duplicate detection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables Invite and warns when the email is already a member", () => {
    renderWithProviders(<InviteBar members={members} invites={invites} onOpenBulk={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/invitee@email.com/i), { target: { value: "bob@x.com" } });
    expect(screen.getByText(/already a member/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^invite$/i })).toBeDisabled();
  });

  it("offers Resend when the email is already invited (pending)", async () => {
    renderWithProviders(<InviteBar members={members} invites={invites} onOpenBulk={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/invitee@email.com/i), { target: { value: "kim@x.com" } });
    expect(screen.getByText(/already invited/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));
    await waitFor(() => expect(resendInvitation).toHaveBeenCalled());
  });

  it("enables Invite for a fresh address", () => {
    renderWithProviders(<InviteBar members={members} invites={invites} onOpenBulk={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/invitee@email.com/i), { target: { value: "new@x.com" } });
    expect(screen.getByRole("button", { name: /^invite$/i })).not.toBeDisabled();
  });

  it("holds Invite disabled while the invites query is still loading", () => {
    renderWithProviders(<InviteBar members={members} invites={[]} invitesLoading onOpenBulk={vi.fn()} />);
    // A fresh address that would otherwise be sendable must wait until duplicate
    // detection has the pending list, so a not-yet-loaded dup can't slip through.
    fireEvent.change(screen.getByPlaceholderText(/invitee@email.com/i), { target: { value: "new@x.com" } });
    expect(screen.getByRole("button", { name: /^invite$/i })).toBeDisabled();
  });
});
