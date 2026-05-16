import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ApprovalGate } from "./ApprovalGate";

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("./AuthContext", () => ({
  useAuth: vi.fn(),
}));

// Render lightweight placeholders so we can assert routing decisions without
// pulling in the real screens (which depend on framer-motion + AuthContext).
vi.mock("@/pages/PendingApprovalScreen", () => ({
  __esModule: true,
  default: () =>
    React.createElement("div", { "data-testid": "pending-screen" }, "Pending"),
}));

vi.mock("@/pages/RejectedScreen", () => ({
  __esModule: true,
  default: () =>
    React.createElement("div", { "data-testid": "rejected-screen" }, "Rejected"),
}));

import { useAuth } from "./AuthContext";

function renderGate() {
  return render(
    React.createElement(
      ApprovalGate,
      null,
      React.createElement("div", { "data-testid": "app-content" }, "App")
    )
  );
}

describe("ApprovalGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders PendingApprovalScreen when approvalStatus is pending", () => {
    vi.mocked(useAuth).mockReturnValue({ approvalStatus: "pending" } as any);

    renderGate();

    expect(screen.getByTestId("pending-screen")).toBeTruthy();
    expect(screen.queryByTestId("app-content")).toBeNull();
    expect(screen.queryByTestId("rejected-screen")).toBeNull();
  });

  it("renders RejectedScreen when approvalStatus is rejected", () => {
    vi.mocked(useAuth).mockReturnValue({ approvalStatus: "rejected" } as any);

    renderGate();

    expect(screen.getByTestId("rejected-screen")).toBeTruthy();
    expect(screen.queryByTestId("app-content")).toBeNull();
    expect(screen.queryByTestId("pending-screen")).toBeNull();
  });

  it("renders children when approvalStatus is approved", () => {
    vi.mocked(useAuth).mockReturnValue({ approvalStatus: "approved" } as any);

    renderGate();

    expect(screen.getByTestId("app-content")).toBeTruthy();
    expect(screen.queryByTestId("pending-screen")).toBeNull();
    expect(screen.queryByTestId("rejected-screen")).toBeNull();
  });

  it("renders children when approvalStatus is unknown (legacy fallback)", () => {
    vi.mocked(useAuth).mockReturnValue({ approvalStatus: "unknown" } as any);

    renderGate();

    expect(screen.getByTestId("app-content")).toBeTruthy();
    expect(screen.queryByTestId("pending-screen")).toBeNull();
    expect(screen.queryByTestId("rejected-screen")).toBeNull();
  });
});
