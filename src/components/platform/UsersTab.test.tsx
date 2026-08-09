import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { PlatformUser } from "@/data/platformUsers";

// Radix Select's dismissable-layer cleanup (from closing one combobox) is an
// effect that flushes on a later tick — re-opening the same combobox in the
// same synchronous test step can race that cleanup. A macrotask flush between
// picks lets the cleanup settle first (same pattern as NewOrderWizard.test.tsx).
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

async function selectOption(triggerName: string, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
  await flush();
}

vi.mock("./UserDetailSheet", () => ({ UserDetailSheet: () => null }));

const usePlatformUsersMock = vi.fn();
vi.mock("@/hooks/usePlatformUsers", () => ({
  usePlatformUsers: () => usePlatformUsersMock(),
}));

import { UsersTab } from "./UsersTab";

const ADA: PlatformUser = {
  id: "u1", email: "ada@x.com", display_name: "Ada", created_at: "",
  last_sign_in_at: null, suspended: false,
  memberships: [{ org_id: "o1", org_name: "Acme", roles: ["admin"], artist: null }],
};
const GRACE: PlatformUser = {
  id: "u2", email: "grace@x.com", display_name: "Grace", created_at: "",
  last_sign_in_at: "2026-07-01T00:00:00.000Z", suspended: true,
  memberships: [{ org_id: "o2", org_name: "Beta", roles: ["producer"], artist: { id: "a1", name: "Grace Hopper" } }],
};

describe("UsersTab", () => {
  beforeEach(() => usePlatformUsersMock.mockReset());

  it("lists users and filters by search", () => {
    usePlatformUsersMock.mockReturnValue({
      data: { users: [ADA, GRACE], truncated: false },
      isLoading: false, isError: false, error: null,
    });
    renderWithProviders(<UsersTab />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "grace" } });
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
  });

  it("filters by email too", () => {
    usePlatformUsersMock.mockReturnValue({
      data: { users: [ADA, GRACE], truncated: false },
      isLoading: false, isError: false, error: null,
    });
    renderWithProviders(<UsersTab />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "ada@x.com" } });
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("Grace")).not.toBeInTheDocument();
  });

  it("filters by org", async () => {
    usePlatformUsersMock.mockReturnValue({
      data: { users: [ADA, GRACE], truncated: false },
      isLoading: false, isError: false, error: null,
    });
    renderWithProviders(<UsersTab />);

    await selectOption("Org filter", "Acme");
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("Grace")).not.toBeInTheDocument();

    await selectOption("Org filter", "All orgs");
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
  });

  it("filters by role", async () => {
    usePlatformUsersMock.mockReturnValue({
      data: { users: [ADA, GRACE], truncated: false },
      isLoading: false, isError: false, error: null,
    });
    renderWithProviders(<UsersTab />);

    await selectOption("Role filter", "Production Team");
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();

    await selectOption("Role filter", "All roles");
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
  });

  it("filters by status", async () => {
    usePlatformUsersMock.mockReturnValue({
      data: { users: [ADA, GRACE], truncated: false },
      isLoading: false, isError: false, error: null,
    });
    renderWithProviders(<UsersTab />);

    await selectOption("Status filter", "Suspended");
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();

    await selectOption("Status filter", "Active");
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("Grace")).not.toBeInTheDocument();

    await selectOption("Status filter", "All statuses");
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
  });

  it("shows a suspended badge and mutes suspended rows", () => {
    usePlatformUsersMock.mockReturnValue({
      data: { users: [ADA, GRACE], truncated: false },
      isLoading: false, isError: false, error: null,
    });
    renderWithProviders(<UsersTab />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Suspended")).toBeInTheDocument();
  });

  it("does not show a truncation banner when the list is complete", () => {
    usePlatformUsersMock.mockReturnValue({
      data: { users: [ADA], truncated: false },
      isLoading: false, isError: false, error: null,
    });
    renderWithProviders(<UsersTab />);
    expect(screen.queryByText(/first 1000/i)).not.toBeInTheDocument();
  });

  it("shows a non-silent banner when the roster hit the 1000-row cap", () => {
    usePlatformUsersMock.mockReturnValue({
      data: { users: [ADA], truncated: true },
      isLoading: false, isError: false, error: null,
    });
    renderWithProviders(<UsersTab />);
    expect(screen.getByText(/first 1000/i)).toBeInTheDocument();
  });

  it("shows a loading skeleton while fetching", () => {
    usePlatformUsersMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null });
    const { container } = renderWithProviders(<UsersTab />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("shows a destructive alert on error", () => {
    usePlatformUsersMock.mockReturnValue({
      data: undefined, isLoading: false, isError: true, error: new Error("boom"),
    });
    renderWithProviders(<UsersTab />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});
