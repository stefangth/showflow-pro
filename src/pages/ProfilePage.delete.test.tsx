import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
const signOut = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { signOut: () => signOut() } } }));

// R5.4: the deletion-disposition sentence about hire orders is gated on the
// hire_orders entitlement. Drive useFeature directly (same pattern as
// ArtistBookingsView's hireOrders/flowCopy tests) so it's deterministic.
const featureHolder = { hireOrdersEnabled: false };
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: (feature: string) => (feature === "hire_orders" ? featureHolder.hireOrdersEnabled : false),
}));

import ProfilePage from "./ProfilePage";

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

const renderProfilePage = ({ hireOrders = false }: { hireOrders?: boolean } = {}) => {
  featureHolder.hireOrdersEnabled = hireOrders;
  render(wrap(<ProfilePage />));
};

describe("ProfilePage delete account", () => {
  it("requires typing DELETE before confirming", async () => {
    renderProfilePage();
    // "Delete account" is both the card title and the trigger button — target the button by role.
    const trigger = await screen.findByRole("button", { name: /delete account/i });
    fireEvent.click(trigger);
    const confirm = await screen.findByRole("button", { name: /permanently delete/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("DELETE"), { target: { value: "DELETE" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(deleteSpy).toHaveBeenCalled());
    // on success the user is signed out and routed to login
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/login"));
  });

  it("names open offers, and hire orders when the module is on (R5.4)", () => {
    renderProfilePage({ hireOrders: true });
    expect(screen.getByText(/including any open offers, is kept but de-identified/i)).toBeInTheDocument();
    expect(screen.getByText(/signed hire orders are kept for the organization's records/i)).toBeInTheDocument();
  });

  it("omits the hire-orders sentence when the module is off (R5.4)", () => {
    renderProfilePage({ hireOrders: false });
    expect(screen.getByText(/including any open offers, is kept but de-identified/i)).toBeInTheDocument();
    expect(screen.queryByText(/signed hire orders are kept/i)).not.toBeInTheDocument();
  });
});
