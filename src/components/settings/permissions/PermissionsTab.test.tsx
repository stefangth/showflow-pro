import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useEntitlements", () => ({ useFeature: vi.fn() }));
vi.mock("./PermissionsMatrix", () => ({ PermissionsMatrix: (p: { orgId: string; mode: string }) => <div data-testid="matrix" data-org={p.orgId} data-mode={p.mode} /> }));
import { useAuth } from "@/features/auth/AuthContext";
import { useFeature } from "@/hooks/useEntitlements";
import { PermissionsTab } from "./PermissionsTab";

describe("PermissionsTab", () => {
  it("renders the matrix in org mode for the current org", () => {
    vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-9" } } as never);
    vi.mocked(useFeature).mockReturnValue(true);
    render(<PermissionsTab />);
    const m = screen.getByTestId("matrix");
    expect(m).toHaveAttribute("data-org", "org-9");
    expect(m).toHaveAttribute("data-mode", "org");
  });
  it("returns null without a current org", () => {
    vi.mocked(useAuth).mockReturnValue({ currentOrg: null } as never);
    vi.mocked(useFeature).mockReturnValue(false);
    const { container } = render(<PermissionsTab />);
    expect(container).toBeEmptyDOMElement();
  });
});
