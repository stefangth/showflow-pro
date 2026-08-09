// src/components/admin/people/InviteBar.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { OrgMember } from "@/data/members";
import type { Invitation } from "@/data/invitations";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));
const createInvitation = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/data/invitations", async (orig) => ({
  ...(await orig<typeof import("@/data/invitations")>()),
  createInvitation: (...a: unknown[]) => createInvitation(...a),
}));

import { InviteBar } from "./InviteBar";

const members: OrgMember[] = [{ user_id: "u1", email: "bob@x.com", display_name: "Bob", roles: ["producer"], last_sign_in_at: null }];
const invites: Invitation[] = [{ id: "i1", org_id: "org-1", email: "kim@x.com", role: "artist", status: "pending", token: "t", expires_at: "2026-12-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" }];

describe("InviteBar duplicate detection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables Invite and warns when the email is already a member", () => {
    renderWithProviders(<InviteBar members={members} invites={invites} onOpenBulk={vi.fn()} onResend={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/invitee@email.com/i), { target: { value: "bob@x.com" } });
    expect(screen.getByText(/already a member/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^invite$/i })).toBeDisabled();
  });

  it("delegates Resend to the parent when the email is already invited (pending)", () => {
    const onResend = vi.fn();
    renderWithProviders(<InviteBar members={members} invites={invites} onOpenBulk={vi.fn()} onResend={onResend} />);
    fireEvent.change(screen.getByPlaceholderText(/invitee@email.com/i), { target: { value: "kim@x.com" } });
    expect(screen.getByText(/already invited/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));
    expect(onResend).toHaveBeenCalledWith("i1");
  });

  it("disables the Resend hint while that invite's resend is in flight", () => {
    renderWithProviders(<InviteBar members={members} invites={invites} onOpenBulk={vi.fn()} onResend={vi.fn()} resendPendingId="i1" />);
    fireEvent.change(screen.getByPlaceholderText(/invitee@email.com/i), { target: { value: "kim@x.com" } });
    expect(screen.getByRole("button", { name: /resend/i })).toBeDisabled();
  });

  it("enables Invite for a fresh address", () => {
    renderWithProviders(<InviteBar members={members} invites={invites} onOpenBulk={vi.fn()} onResend={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/invitee@email.com/i), { target: { value: "new@x.com" } });
    expect(screen.getByRole("button", { name: /^invite$/i })).not.toBeDisabled();
  });

  it("holds Invite disabled and shows the reason while duplicate detection is unready", () => {
    // dedupeHint stands in for either the members or invites query being
    // unsettled/errored; a fresh address that would otherwise be sendable must
    // wait, so a not-yet-loaded member/pending dup can't slip through empty lists,
    // and the disabled button is explained rather than silent.
    renderWithProviders(
      <InviteBar members={[]} invites={[]} dedupeHint="Checking existing people…" onOpenBulk={vi.fn()} onResend={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/invitee@email.com/i), { target: { value: "new@x.com" } });
    expect(screen.getByRole("button", { name: /^invite$/i })).toBeDisabled();
    expect(screen.getByText(/checking existing people/i)).toBeInTheDocument();
  });
});
