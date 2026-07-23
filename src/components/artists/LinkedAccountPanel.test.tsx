import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { LinkedAccountPanel } from "./LinkedAccountPanel";

describe("LinkedAccountPanel", () => {
  it("active + admin → shared 'Active account' vocabulary, account name, login email, digest (login-first)", () => {
    renderWithProviders(
      <LinkedAccountPanel
        state="active"
        userId="u1"
        bookingEmail="book@x.com"
        account={{ email: "login@x.com", display_name: "Ada Lovelace" }}
        canSeeAccount
        canInvite={false}
      />,
    );
    expect(screen.getByText("Active account")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getAllByText("login@x.com").length).toBeGreaterThanOrEqual(1);
  });

  it("active + admin + null account email → effective digest email falls back to booking", () => {
    renderWithProviders(
      <LinkedAccountPanel
        state="active"
        userId="u1"
        bookingEmail="book@x.com"
        account={{ email: null, display_name: "Ada" }}
        canSeeAccount
        canInvite={false}
      />,
    );
    expect(screen.getByText("book@x.com")).toBeInTheDocument();
  });

  it("active + producer (cannot see account) → status chip only, no login email", () => {
    renderWithProviders(
      <LinkedAccountPanel
        state="active"
        userId="u1"
        bookingEmail="book@x.com"
        account={{ email: "login@x.com", display_name: "Ada" }}
        canSeeAccount={false}
        canInvite={false}
      />,
    );
    expect(screen.getByText("Active account")).toBeInTheDocument();
    expect(screen.queryByText("login@x.com")).not.toBeInTheDocument();
  });

  it("none state shows an Invite to app button when canInvite", () => {
    const onInvite = vi.fn();
    renderWithProviders(
      <LinkedAccountPanel state="none" userId={null} bookingEmail="b@x.com" canSeeAccount canInvite onInvite={onInvite} />,
    );
    expect(screen.getByText("No account")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /invite to app/i }));
    expect(onInvite).toHaveBeenCalled();
  });

  it("invited state shows a Resend button when canInvite", () => {
    const onResend = vi.fn();
    renderWithProviders(
      <LinkedAccountPanel state="invited" userId={null} bookingEmail="b@x.com" canSeeAccount canInvite onResend={onResend} />,
    );
    expect(screen.getByText("Invite pending")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));
    expect(onResend).toHaveBeenCalled();
  });

  it("shows Invite (create) but hides Resend when canInvite and not canResend", () => {
    const onInvite = vi.fn();
    const { rerender } = renderWithProviders(
      <LinkedAccountPanel state="none" userId={null} bookingEmail="b@x.com" canSeeAccount={false} canInvite canResend={false} onInvite={onInvite} />,
    );
    expect(screen.getByRole("button", { name: /invite to app/i })).toBeInTheDocument();
    rerender(
      <LinkedAccountPanel state="invited" userId={null} bookingEmail="b@x.com" canSeeAccount={false} canInvite canResend={false} onResend={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /resend/i })).not.toBeInTheDocument();
  });
});
