import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "a@x.com" }, hasRole: () => true }) }));
vi.mock("@/hooks/useMyProfile", () => ({
  useMyProfile: () => ({ data: { display_name: "Ada", phone: "" }, isLoading: false }),
  useUpdateMyProfile: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useNotificationPreferences", () => ({
  useNotificationPreferences: () => ({ data: {}, isLoading: false }),
  useUpdateNotificationPreferences: () => ({ mutate: vi.fn(), isPending: false }),
}));
// hasRole() => true above keeps isArtistOnly false, so the sidebar never renders — but
// useMyArtist/useMyBlockedDatesCount are still called unconditionally on every render, and
// (via useEffectiveUserId) would otherwise reach into the fully-replaced AuthContext mock
// above, which no longer exports it. Stub both hooks directly instead.
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: () => ({ data: null }) }));
vi.mock("@/hooks/useMyBlockedDatesCount", () => ({ useMyBlockedDatesCount: () => ({ data: 0 }) }));
// This file renders with a bare QueryClientProvider (no LanguageProvider) — stub useLanguage.
vi.mock("@/features/i18n/LanguageContext", () => ({ useLanguage: () => ({ lang: "en", setLang: vi.fn() }) }));
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
    // "Delete account" is the row title (a <p>); the trigger button itself is the shorter "Delete".
    const trigger = await screen.findByRole("button", { name: /^delete$/i });
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

  it("names open asks, and contracts when the module is on (R5.4)", () => {
    renderProfilePage({ hireOrders: true });
    expect(screen.getByText(/including any open asks, is kept but de-identified/i)).toBeInTheDocument();
    // anonymize_user only nulls hire_orders.created_by / hire_order_signatures.signer_user_id
    // (invisible provenance columns). It does NOT touch the frozen hire_orders.data
    // snapshot or signer_name/signer_email a producer actually sees on the order. The
    // copy must therefore make a retention-only claim and must NOT claim details are removed.
    expect(
      screen.getByText(/signed contracts you already agreed to are kept for the organization's records/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/with your details removed/i)).not.toBeInTheDocument();
  });

  it("omits the hire-orders sentence when the module is off (R5.4)", () => {
    renderProfilePage({ hireOrders: false });
    expect(screen.getByText(/including any open asks, is kept but de-identified/i)).toBeInTheDocument();
    expect(screen.queryByText(/signed contracts/i)).not.toBeInTheDocument();
  });

  it("opens with an account/profile-scoped removal claim, not an absolute one (review fix round 2)", () => {
    // "Your personal details are removed" read as absolute even though hire-order
    // snapshots (hire_orders.data, signer_name/signer_email) retain PII after
    // deletion. Tightened to scope the removal claim to the account/profile.
    renderProfilePage();
    expect(screen.getByText(/your account and profile details are removed/i)).toBeInTheDocument();
  });
});
