import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

/**
 * Task 3: an invited-but-not-yet-linked artist (useMyArtist returns no row)
 * used to see a bare, slightly alarming card: "No artist profile linked to
 * your account. Ask an admin to link your account." This test asserts the
 * warmer replacement copy, which uses the org name from useAuth's
 * currentOrg. Mocking pattern copied from ArtistDashboard.firstRun.test.tsx
 * so every hook ArtistDashboard calls before the `if (!artist)` early return
 * resolves without throwing.
 */

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

Object.assign(client, createFakeSupabase({} as never));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1", name: "Acme" } }),
}));
vi.mock("@/hooks/useMyArtist", () => ({
  // No linked artist -- exercises the `if (!artist)` early return.
  useMyArtist: () => ({ data: null }),
}));
vi.mock("@/hooks/useArtistEligibleDates", () => ({
  useArtistEligibleDates: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: undefined }),
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));
vi.mock("@/hooks/useEntitlements", () => {
  const useFeature = () => true;
  return { useFeature, useModuleGate: () => ({ allow: true, pending: false }) };
});

vi.mock("@/components/dashboard/firstRun/useDashboardFirstRun", () => ({
  useDashboardFirstRun: () => ({
    show: false,
    complete: false,
    dismissed: false,
    steps: [],
    rules: [],
    offFooters: [],
    sample: { stats: [], queue: [], week: [] },
    welcome: {
      eyebrow: "Welcome",
      headline: "h",
      body: "b",
      primaryLabel: "Start setup",
      secondaryLabel: "Later",
      progressLabel: "Set up · 0 of 1",
      progressFilled: 0,
      progressTotal: 1,
      progressHint: "About 2 minutes",
    },
    sectionTitle: "What this page becomes",
    sectionHint: "Sample rows.",
    railEyebrow: "Set up",
    railTitle: "Before your first booking",
    railBody: "b",
    collapsedLabel: "Set up in progress",
    collapsedHint: "1 step left",
    collapsedCta: "Resume",
    railOpen: false,
    openRail: vi.fn(),
    closeRail: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { ArtistDashboard } from "./ArtistDashboard";

describe("ArtistDashboard unlinked artist (Task 3)", () => {
  it("shows a warm, reassuring state when the artist is not yet linked", () => {
    renderWithProviders(
      <MemoryRouter>
        <ArtistDashboard />
      </MemoryRouter>,
    );
    expect(screen.getByText(/on the Acme roster|you're on the roster/i)).toBeInTheDocument();
    expect(screen.getByText(/an admin still needs to link/i)).toBeInTheDocument();
    // the old cold copy is gone:
    expect(screen.queryByText(/No artist profile linked to your account/i)).not.toBeInTheDocument();
  });
});
