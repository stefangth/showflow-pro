import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrgSwitcher } from "./OrgSwitcher";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
import { useAuth } from "@/features/auth/AuthContext";

describe("OrgSwitcher", () => {
  it("renders nothing when there is no current org", () => {
    vi.mocked(useAuth).mockReturnValue({ orgs: [], currentOrg: null, switchOrg: vi.fn() } as any);
    const { container } = render(<OrgSwitcher />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the org name as a static label for a single-org user", () => {
    const org = { id: "o1", name: "Acme", status: "active" };
    vi.mocked(useAuth).mockReturnValue({ orgs: [org], currentOrg: org, switchOrg: vi.fn() } as any);
    render(<OrgSwitcher />);
    expect(screen.getByText("Acme")).toBeTruthy();
    // No interactive switcher trigger for a single org.
    expect(screen.queryByLabelText("Switch organization")).toBeNull();
  });

  it("renders a switcher trigger for a multi-org user", () => {
    const a = { id: "o1", name: "Acme", status: "active" };
    const b = { id: "o2", name: "Globex", status: "active" };
    vi.mocked(useAuth).mockReturnValue({ orgs: [a, b], currentOrg: a, switchOrg: vi.fn() } as any);
    render(<OrgSwitcher />);
    expect(screen.getByLabelText("Switch organization")).toBeTruthy();
  });
});
