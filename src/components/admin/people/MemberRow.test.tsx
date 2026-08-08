import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { MemberRow } from "./MemberRow";
import type { OrgMember } from "@/data/members";

const bob: OrgMember = { user_id: "bob-2", email: "bob@x.com", display_name: "Bob", roles: ["producer"], last_sign_in_at: null };

describe("MemberRow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the member, an Active pill, and 'never signed in'", () => {
    renderWithProviders(
      <MemberRow member={bob} isSelf={false} onSetRole={vi.fn()} setRolePending={false} onRequestRemove={vi.fn()} />,
    );
    expect(screen.getByText("bob@x.com")).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
    expect(screen.getByText(/never signed in/i)).toBeInTheDocument();
  });

  it("toggles a role through the popover", async () => {
    const onSetRole = vi.fn();
    renderWithProviders(
      <MemberRow member={bob} isSelf={false} onSetRole={onSetRole} setRolePending={false} onRequestRemove={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit roles for bob@x.com/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^admin$/i }));
    await waitFor(() => expect(onSetRole).toHaveBeenCalledWith({ userId: "bob-2", role: "admin", action: "add" }));
  });

  it("requests removal for another member and shows 'You' for self", () => {
    const onRequestRemove = vi.fn();
    const { rerender } = renderWithProviders(
      <MemberRow member={bob} isSelf={false} onSetRole={vi.fn()} setRolePending={false} onRequestRemove={onRequestRemove} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(onRequestRemove).toHaveBeenCalledWith({ user_id: "bob-2", email: "bob@x.com" });
    rerender(<MemberRow member={bob} isSelf={true} onSetRole={vi.fn()} setRolePending={false} onRequestRemove={onRequestRemove} />);
    expect(screen.getByText(/^you$/i)).toBeInTheDocument();
  });
});
