import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrgSwitcher } from "./OrgSwitcher";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
import { useAuth } from "@/features/auth/AuthContext";
import { partialMock } from "@/test/castHelpers";

describe("OrgSwitcher", () => {
  it("renders nothing when there is no current org", () => {
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({ orgs: [], currentOrg: null, switchOrg: vi.fn() }));
    const { container } = render(<OrgSwitcher />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the org name as a static label for a single-org user", () => {
    const org = { id: "o1", name: "Acme", slug: "acme", status: "active", is_demo: false };
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({ orgs: [org], currentOrg: org, switchOrg: vi.fn() }));
    render(<OrgSwitcher />);
    expect(screen.getByText("Acme")).toBeTruthy();
    // No interactive switcher trigger for a single org.
    expect(screen.queryByLabelText("Switch organization")).toBeNull();
  });

  it("renders a switcher trigger for a multi-org user", () => {
    const a = { id: "o1", name: "Acme", slug: "acme", status: "active", is_demo: false };
    const b = { id: "o2", name: "Globex", slug: "globex", status: "active", is_demo: false };
    vi.mocked(useAuth).mockReturnValue(partialMock<ReturnType<typeof useAuth>>({ orgs: [a, b], currentOrg: a, switchOrg: vi.fn() }));
    render(<OrgSwitcher />);
    expect(screen.getByLabelText("Switch organization")).toBeTruthy();
  });
});
