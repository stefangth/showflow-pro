import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// AuthContext is a provider, not a data-access module, so it stays mocked
// directly (same as ArtistProfileSheet.capabilities.test.tsx and the
// ArtistBookingsView suites). No currentOrg here is deliberate: it leaves
// useEntitlements' query disabled, so useFeature('hire_orders') falls back to
// its registry default (off) without needing an entitlements-table seed.
// That gate is irrelevant to this note; R5.4's tests cover it separately.
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "a@x.com" }, hasRole: () => true }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
// ProfilePage now also reads the artist-only Reference sidebar's data unconditionally;
// with hasRole() => true above (isArtistOnly is false) that sidebar never renders, but the
// hooks are still called on every render, and useMyArtist/useMyBlockedDatesCount reach
// useEffectiveUserId() from the (fully replaced) AuthContext mock above, which no longer
// exports it. Stub both hooks directly so they never touch the real AuthContext exports.
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: () => ({ data: null }) }));
vi.mock("@/hooks/useMyBlockedDatesCount", () => ({ useMyBlockedDatesCount: () => ({ data: 0 }) }));

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(
  client,
  createFakeSupabase({
    // Backs the real useMyProfile / useNotificationPreferences hooks (not
    // hand-mocked here) so ProfilePage exercises its actual data-access path.
    profiles: { data: { user_id: "u1", display_name: "Ada", phone: "" }, error: null },
    notification_preferences: { data: null, error: null },
  }),
);

import ProfilePage from "./ProfilePage";

describe("ProfilePage contact-visibility note (R4.4)", () => {
  it("states who can see the contact details on the artist record", async () => {
    renderWithProviders(<ProfilePage />);
    await waitFor(() => expect(screen.getByDisplayValue("Ada")).toBeInTheDocument());
    expect(
      screen.getByText(/admins and Production Team in your organization can see the contact details on your artist record/i),
    ).toBeInTheDocument();
  });
});
