import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "a@x.com" } }) }));
vi.mock("@/hooks/useMyProfile", () => ({
  useMyProfile: () => ({ data: { display_name: "Ada", phone: "" }, isLoading: false }),
  useUpdateMyProfile: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useNotificationPreferences", () => ({
  useNotificationPreferences: () => ({ data: {}, isLoading: false }),
  useUpdateNotificationPreferences: () => ({ mutate: vi.fn(), isPending: false }),
}));
const deleteSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/data/account", () => ({ exportMyData: vi.fn(), deleteMyAccount: () => deleteSpy() }));
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

import ProfilePage from "./ProfilePage";

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

describe("ProfilePage delete account", () => {
  it("requires typing DELETE before confirming", async () => {
    render(wrap(<ProfilePage />));
    await waitFor(() => expect(screen.getByText("Delete account")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /delete account/i }));
    const confirm = await screen.findByRole("button", { name: /permanently delete/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("DELETE"), "DELETE");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(deleteSpy).toHaveBeenCalled());
  });
});
