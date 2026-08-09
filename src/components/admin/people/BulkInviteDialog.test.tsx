import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { OrgMember } from "@/data/members";
import type { Invitation } from "@/data/invitations";

const createInvitation = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/data/invitations", async (orig) => ({
  ...(await orig<typeof import("@/data/invitations")>()),
  createInvitation: (...a: unknown[]) => createInvitation(...a),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));

import { BulkInviteDialog } from "./BulkInviteDialog";

const bob: OrgMember = { user_id: "bob-1", email: "bob@x.com", display_name: "Bob", roles: ["artist"], last_sign_in_at: null };
const kimInvite: Invitation = {
  id: "inv-1",
  org_id: "org-1",
  email: "kim@x.com",
  role: "artist",
  status: "pending",
  token: "tok-1",
  expires_at: "2099-01-01T00:00:00Z",
};

describe("BulkInviteDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("classifies pasted addresses as member, pending, invalid, or sendable", () => {
    renderWithProviders(
      <BulkInviteDialog open onOpenChange={vi.fn()} members={[bob]} invites={[kimInvite]} />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "bob@x.com, kim@x.com, new@x.com, nope" },
    });

    expect(screen.getByText(/already a member/i)).toBeInTheDocument();
    expect(screen.getByText(/already invited/i)).toBeInTheDocument();
    expect(screen.getByText(/^invalid$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite 1" })).toBeInTheDocument();
  });

  it("invites only the sendable address and closes the dialog", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <BulkInviteDialog open onOpenChange={onOpenChange} members={[bob]} invites={[kimInvite]} />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "bob@x.com, kim@x.com, new@x.com, nope" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Invite 1" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(createInvitation).toHaveBeenCalledTimes(1);
    expect(createInvitation).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ orgId: "org-1", email: "new@x.com", role: "artist" }),
    );
  });

  it("keeps the dialog open and repopulates only the failed addresses on partial failure", async () => {
    const onOpenChange = vi.fn();
    createInvitation.mockImplementation((_client: unknown, args: unknown) => {
      const email = (args as { email: string }).email;
      return email === "boom@x.com" ? Promise.reject(new Error("edge fail")) : Promise.resolve();
    });
    renderWithProviders(
      <BulkInviteDialog open onOpenChange={onOpenChange} members={[bob]} invites={[kimInvite]} />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "new@x.com, boom@x.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Invite 2" }));

    // Both were attempted, one failed; dialog stays open with just the failed address left.
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("boom@x.com"));
    expect(createInvitation).toHaveBeenCalledTimes(2);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
