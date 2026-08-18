import { describe, it, expect, vi, beforeEach } from "vitest";
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
const exportSpy = vi.fn().mockResolvedValue({ schema_version: 1 });
vi.mock("@/data/account", () => ({ exportMyData: () => exportSpy(), deleteMyAccount: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import ProfilePage from "./ProfilePage";

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

describe("ProfilePage data export", () => {
  beforeEach(() => {
    exportSpy.mockClear();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  it("calls exportMyData when the download button is clicked", async () => {
    render(wrap(<ProfilePage />));
    await waitFor(() => expect(screen.getByText("Your data")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));
    await waitFor(() => expect(exportSpy).toHaveBeenCalled());
  });
});
