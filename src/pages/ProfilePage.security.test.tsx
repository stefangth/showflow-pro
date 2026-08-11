import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "ada@example.com" } }) }));
vi.mock("@/hooks/useMyProfile", () => ({
  useMyProfile: () => ({ data: { display_name: "Ada", phone: "" }, isLoading: false }),
  useUpdateMyProfile: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useNotificationPreferences", () => ({
  useNotificationPreferences: () => ({ data: {}, isLoading: false }),
  useUpdateNotificationPreferences: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useEntitlements", () => ({ useFeature: () => false }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock("@/data/account", () => ({ exportMyData: vi.fn(), deleteMyAccount: vi.fn() }));

const status = {
  data: false as boolean | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock("@/hooks/usePasswordStatus", () => ({ usePasswordStatus: () => status }));

vi.mock("@/components/auth/PasswordSetupForm", () => ({
  PasswordSetupForm: ({ mode, onSuccess, onCancel }: { mode: "setup" | "change"; onSuccess: () => void; onCancel?: () => void }) => (
    <form aria-label={mode === "setup" ? "Set a password" : "Change password"}>
      <button type="button" onClick={onSuccess}>Complete password update</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </form>
  ),
}));

import ProfilePage from "./ProfilePage";

function renderProfile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ProfilePage /></QueryClientProvider>);
}

describe("ProfilePage sign-in and security", () => {
  beforeEach(() => {
    status.data = false;
    status.isLoading = false;
    status.isError = false;
    status.refetch.mockReset();
  });

  it("shows magic links as active and offers password setup when no password exists", () => {
    renderProfile();

    expect(screen.getByRole("heading", { name: "Sign-in & security" })).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add password" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("uses server status to offer password changes", () => {
    status.data = true;
    renderProfile();

    expect(screen.getByText("Set")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change password" })).toBeInTheDocument();
  });

  it.each([
    [false, "Add password", "Set a password"],
    [true, "Change password", "Change password"],
  ] as const)("expands and cancels the %s password form", async (hasPassword, action, formName) => {
    status.data = hasPassword;
    renderProfile();
    const trigger = screen.getByRole("button", { name: action });

    fireEvent.click(trigger);
    expect(screen.getByRole("form", { name: formName })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("form", { name: formName })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: action })).toHaveFocus());
  });

  it("collapses after success, refreshes status, and restores focus", async () => {
    renderProfile();
    const trigger = screen.getByRole("button", { name: "Add password" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Complete password update" }));

    expect(screen.queryByRole("form", { name: "Set a password" })).not.toBeInTheDocument();
    expect(status.refetch).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add password" })).toHaveFocus());
  });

  it("shows loading and retry states without guessing password status", () => {
    status.isLoading = true;
    const view = renderProfile();
    expect(screen.getByText("Checking…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /password/i })).not.toBeInTheDocument();

    status.isLoading = false;
    status.isError = true;
    view.rerender(<QueryClientProvider client={new QueryClient()}><ProfilePage /></QueryClientProvider>);
    expect(screen.getByText("Could not load password status")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(status.refetch).toHaveBeenCalledOnce();
  });
});
