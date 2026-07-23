import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const fetchOrgInvitationsSpy = vi.fn();
const createInvitationSpy = vi.fn();
const resendInvitationSpy = vi.fn();
const revokeInvitationSpy = vi.fn();

vi.mock("@/data/invitations", () => ({
  fetchOrgInvitations: (...args: unknown[]) => fetchOrgInvitationsSpy(...args),
  createInvitation: (...args: unknown[]) => createInvitationSpy(...args),
  resendInvitation: (...args: unknown[]) => resendInvitationSpy(...args),
  revokeInvitation: (...args: unknown[]) => revokeInvitationSpy(...args),
}));

import { OrgInvitePopover } from "./OrgInvitePopover";
import { toast } from "sonner";

describe("OrgInvitePopover", () => {
  beforeEach(() => {
    fetchOrgInvitationsSpy.mockReset().mockResolvedValue([]);
    createInvitationSpy.mockReset().mockResolvedValue({ id: "inv1" });
    resendInvitationSpy.mockReset().mockResolvedValue(undefined);
    revokeInvitationSpy.mockReset().mockResolvedValue(undefined);
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
  });

  it("submits the create-invite form with orgId, email, and the default role", async () => {
    renderWithProviders(<OrgInvitePopover orgId="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Invitations" }));

    const email = await screen.findByPlaceholderText("invitee@email.com");
    fireEvent.change(email, { target: { value: "new@artist.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => expect(createInvitationSpy).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "o1", email: "new@artist.com", role: "artist" },
    ));
  });

  it("clears the input, invalidates the invites query, and toasts on success", async () => {
    const { queryClient } = renderWithProviders(<OrgInvitePopover orgId="o1" />);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "Invitations" }));

    const email = await screen.findByPlaceholderText("invitee@email.com") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "new@artist.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(email.value).toBe("");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["platform", "org-invites", "o1"] });
  });

  it("rejects an invalid email without calling createInvitation", async () => {
    renderWithProviders(<OrgInvitePopover orgId="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Invitations" }));

    // "foo@bar" satisfies the native <input type="email"> constraint (so the
    // submit event still fires in jsdom) but fails the component's stricter
    // dotted-domain regex, exercising the custom validation branch.
    const email = await screen.findByPlaceholderText("invitee@email.com");
    fireEvent.change(email, { target: { value: "foo@bar" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(createInvitationSpy).not.toHaveBeenCalled();
  });

  it("toasts an error when createInvitation rejects", async () => {
    createInvitationSpy.mockReset().mockRejectedValue(new Error("Could not send invitation"));
    renderWithProviders(<OrgInvitePopover orgId="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Invitations" }));

    const email = await screen.findByPlaceholderText("invitee@email.com");
    fireEvent.change(email, { target: { value: "new@artist.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not send invitation"));
  });
});
