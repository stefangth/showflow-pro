import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { render, screen } from "@/test/renderWithProviders";
import { DemoModeToggle } from "@/components/demo/DemoModeToggle";

// DemoProvider (mounted by renderWithProviders) binds the real supabase singleton through
// useDemoState/useResetDemo/useUpdateDemoState. Stub those so the provider itself stays real
// (isDemoOrg / isBarHidden / hideBar / showBar all run) without a network dependency --
// same pattern as DemoBar.test.tsx.
vi.mock("@/hooks/useDemo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useDemo")>();
  return {
    ...actual,
    useResetDemo: () => ({ mutate: vi.fn(), isPending: false }),
    useCapturedSends: () => ({ data: [], isLoading: false }),
    useDemoState: () => ({ data: undefined }),
    useUpdateDemoState: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

const DEMO_ORG = { id: "o", name: "n", slug: "s", status: "active", is_demo: true } as const;

describe("DemoModeToggle", () => {
  it("shows the DEMO chip for an admin inside a demo org", () => {
    render(<DemoModeToggle />, { authOverrides: { currentOrg: DEMO_ORG } });
    expect(screen.getByText("DEMO")).toBeInTheDocument();
  });

  it("shows the chip for a super-admin even without an admin role", () => {
    render(<DemoModeToggle />, {
      authOverrides: { currentOrg: DEMO_ORG, roles: [], isSuperAdmin: true },
    });
    expect(screen.getByText("DEMO")).toBeInTheDocument();
  });

  it("renders nothing outside a demo org", () => {
    const { container } = render(<DemoModeToggle />, {
      authOverrides: { currentOrg: { id: "o", name: "n", slug: "s", status: "active", is_demo: false } },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing with no active org", () => {
    const { container } = render(<DemoModeToggle />, { authOverrides: { currentOrg: null } });
    expect(container).toBeEmptyDOMElement();
  });

  // Security gate: the chip must key off the caller's REAL role, never the viewAsRole-
  // influenced hasRole -- otherwise a non-admin could flip themselves into an admin view.
  // Mirrors DemoBar's own gate test (this chip is the always-visible topbar equivalent).
  it("renders nothing for a non-admin, even with an admin view-as role active", () => {
    const { container } = render(<DemoModeToggle />, {
      authOverrides: { currentOrg: DEMO_ORG, roles: ["producer"], viewAsRole: "admin" },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("toggles the bar hidden state (label flips) when clicked", () => {
    render(<DemoModeToggle />, { authOverrides: { currentOrg: DEMO_ORG } });
    // The bar starts visible, so the chip offers to hide it.
    fireEvent.click(screen.getByRole("button", { name: /hide demo controls/i }));
    // Now hidden -> the chip offers to show it again.
    expect(screen.getByRole("button", { name: /show demo controls/i })).toBeInTheDocument();
  });
});
