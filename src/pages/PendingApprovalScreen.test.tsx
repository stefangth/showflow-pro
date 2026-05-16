import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import PendingApprovalScreen from "./PendingApprovalScreen";
import RejectedScreen from "./RejectedScreen";

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

// framer-motion's `motion.div` is heavy and animation-dependent; render a plain
// div so the screens remain assertion-friendly.
vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: any) => React.createElement("div", props),
    }
  ),
}));

import { useAuth } from "@/features/auth/AuthContext";

describe("PendingApprovalScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the awaiting-approval message including the user's email", () => {
    vi.mocked(useAuth).mockReturnValue({
      signOut: vi.fn(),
      user: { email: "artist@example.com" },
    } as any);

    render(React.createElement(PendingApprovalScreen));

    expect(screen.getByText(/Awaiting approval/i)).toBeTruthy();
    expect(
      screen.getByText(/Thanks for signing up, artist@example\.com/i)
    ).toBeTruthy();
  });

  it("renders without the email suffix when user has no email", () => {
    vi.mocked(useAuth).mockReturnValue({
      signOut: vi.fn(),
      user: null,
    } as any);

    render(React.createElement(PendingApprovalScreen));

    // The description copy still renders; the email-conditional suffix is omitted.
    expect(screen.getByText(/Thanks for signing up\./i)).toBeTruthy();
  });

  it("invokes signOut when the sign-out button is clicked", () => {
    const signOut = vi.fn();
    vi.mocked(useAuth).mockReturnValue({
      signOut,
      user: { email: "a@b.com" },
    } as any);

    render(React.createElement(PendingApprovalScreen));

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe("RejectedScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the access-denied message", () => {
    vi.mocked(useAuth).mockReturnValue({
      signOut: vi.fn(),
      approvalReason: null,
    } as any);

    render(React.createElement(RejectedScreen));

    expect(screen.getByText(/Access denied/i)).toBeTruthy();
    expect(screen.getByText(/signup request was not approved/i)).toBeTruthy();
    expect(screen.queryByText(/Reason:/i)).toBeNull();
  });

  it("renders the rejection reason when provided", () => {
    vi.mocked(useAuth).mockReturnValue({
      signOut: vi.fn(),
      approvalReason: "Not a verified performer",
    } as any);

    render(React.createElement(RejectedScreen));

    expect(screen.getByText(/Reason: Not a verified performer/i)).toBeTruthy();
  });

  it("invokes signOut when the sign-out button is clicked", () => {
    const signOut = vi.fn();
    vi.mocked(useAuth).mockReturnValue({
      signOut,
      approvalReason: null,
    } as any);

    render(React.createElement(RejectedScreen));

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
