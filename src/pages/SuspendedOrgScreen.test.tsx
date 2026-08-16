import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { Organization } from "@/data/orgs";

let authState: {
  currentOrg: Organization | null;
  orgs: Organization[];
  switchOrg: (id: string) => void;
  signOut: () => void;
};
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => authState,
}));

import SuspendedOrgScreen, { SupportContactLine } from "./SuspendedOrgScreen";

describe("SupportContactLine", () => {
  it("renders nothing when no address is given", () => {
    const { container } = renderWithProviders(<SupportContactLine email={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a mailto link to the configured address", () => {
    renderWithProviders(<SupportContactLine email="team@example.com" />);
    expect(screen.getByText(/your admin can reach the platform team at/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "team@example.com" });
    expect(link).toHaveAttribute("href", "mailto:team@example.com");
  });

  // Regression: the paragraph used to be a hand-written JSX literal that merely happened
  // to agree with a separate `suspendedContactLine` helper the component never actually
  // rendered from (the helper was called only for its truthiness, a duplicate of `!email`).
  // The two could drift silently. Pinning the exact sentence, split around the link exactly
  // where the address sits, catches that class of bug.
  it("renders the exact sentence around the link, with no duplicated or missing wording", () => {
    const { container } = renderWithProviders(<SupportContactLine email="team@example.com" />);
    expect(container.textContent).toBe("Your admin can reach the platform team at team@example.com.");
  });

  // Regression: the prefix/suffix are cut at a fixed `{{email}}` placeholder in the source
  // template, not by searching the composed sentence for the address's own value — so an
  // address that happens to recur inside the surrounding wording (an edge case a runtime
  // `.split(email)` could not tell apart) still produces exactly one correctly placed link.
  it("still places exactly one link correctly even when the address text could be mistaken for the surrounding wording", () => {
    const { container } = renderWithProviders(<SupportContactLine email="team@team.com" />);
    expect(container.textContent).toBe("Your admin can reach the platform team at team@team.com.");
    expect(screen.getAllByRole("link", { name: "team@team.com" })).toHaveLength(1);
  });
});

describe("SuspendedOrgScreen", () => {
  it("shows the suspended org's name with no contact line, since APP_META.SUPPORT_EMAIL ships null", () => {
    authState = {
      currentOrg: { id: "o1", name: "Acme Shows", slug: "acme", status: "suspended", is_demo: false },
      orgs: [{ id: "o1", name: "Acme Shows", slug: "acme", status: "suspended", is_demo: false }],
      switchOrg: vi.fn(),
      signOut: vi.fn(),
    };
    renderWithProviders(<SuspendedOrgScreen />);
    expect(screen.getByText("Acme Shows")).toBeInTheDocument();
    expect(screen.queryByText(/platform team/i)).not.toBeInTheDocument();
  });

  it("offers to switch to another non-suspended org", () => {
    authState = {
      currentOrg: { id: "o1", name: "Acme Shows", slug: "acme", status: "suspended", is_demo: false },
      orgs: [
        { id: "o1", name: "Acme Shows", slug: "acme", status: "suspended", is_demo: false },
        { id: "o2", name: "Other Org", slug: "other", status: "active", is_demo: false },
      ],
      switchOrg: vi.fn(),
      signOut: vi.fn(),
    };
    renderWithProviders(<SuspendedOrgScreen />);
    expect(screen.getByRole("button", { name: /switch to other org/i })).toBeInTheDocument();
  });
});
