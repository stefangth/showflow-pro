import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("@/hooks/useMyProfile", () => ({
  useMyProfile: () => ({ data: { display_name: "Lena Roth", phone: null }, isLoading: false }),
  useUpdateMyProfile: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/usePasswordStatus", () => ({
  usePasswordStatus: () => ({ data: false, isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock("@/hooks/useNotificationPreferences", () => ({
  useNotificationPreferences: () => ({ data: {} }),
  useUpdateNotificationPreferences: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/useMyArtist", () => ({
  useMyArtist: () => ({ data: { id: "artist-1" } }),
}));

vi.mock("@/hooks/useMyBlockedDatesCount", () => ({
  useMyBlockedDatesCount: () => ({ data: 1 }),
}));

vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: (feature: string) => feature === "language_packages",
}));

import ProfilePage from "./ProfilePage";

function renderProfile(roles: string[]) {
  return renderWithProviders(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
    {
      authOverrides: {
        user: { id: "u1", email: "lena.roth@posteo.de" } as never,
        roles: roles as never,
        hasRole: (r: string) => roles.includes(r),
      },
    },
  );
}

describe("ProfilePage — role-aware account layout (screen 09)", () => {
  it("artist-only viewer: matrix hides producer-only categories and shows the Reference sidebar", async () => {
    renderProfile(["artist"]);

    expect(await screen.findByText("Booking offers")).toBeInTheDocument();
    expect(screen.getByText("Booking confirmations")).toBeInTheDocument();
    expect(screen.getByText("Schedule changes")).toBeInTheDocument();
    expect(screen.getByText("Hire orders")).toBeInTheDocument();
    expect(screen.queryByText("Booking activity")).not.toBeInTheDocument();
    expect(screen.queryByText("At-risk & escalations")).not.toBeInTheDocument();

    expect(screen.getByText("Reference")).toBeInTheDocument();
    expect(screen.getByText("How booking works here")).toBeInTheDocument();
    expect(screen.getByText("Your blocked dates")).toBeInTheDocument();
    expect(screen.getByText("Message your production team")).toBeInTheDocument();
    expect(screen.getByText("Language")).toBeInTheDocument();
  });

  it("producer viewer: matrix keeps all six categories and hides the Reference sidebar", async () => {
    renderProfile(["producer"]);

    expect(await screen.findByText("Booking offers")).toBeInTheDocument();
    expect(screen.getByText("Booking activity")).toBeInTheDocument();
    expect(screen.getByText("At-risk & escalations")).toBeInTheDocument();
    expect(screen.getByText("Hire orders")).toBeInTheDocument();

    expect(screen.queryByText("Reference")).not.toBeInTheDocument();
    expect(screen.queryByText("How booking works here")).not.toBeInTheDocument();
  });

  it("admin viewer: matrix keeps all six categories and hides the Reference sidebar", async () => {
    renderProfile(["admin"]);

    expect(await screen.findByText("Booking offers")).toBeInTheDocument();
    expect(screen.getByText("Booking activity")).toBeInTheDocument();
    expect(screen.getByText("At-risk & escalations")).toBeInTheDocument();

    expect(screen.queryByText("Reference")).not.toBeInTheDocument();
  });
});
