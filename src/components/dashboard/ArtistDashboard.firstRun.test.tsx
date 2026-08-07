import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

/**
 * Task 11: ArtistDashboard is wrapped in the first-run layer (role "artist").
 * The existing body (offer meter + hire orders + My Casts) moves inside
 * SamplePreview; a welcome panel greets the artist above it. This test mocks
 * useDashboardFirstRun and asserts the artist welcome headline renders. The
 * data harness is copied from ArtistDashboard.hireOrders.test.tsx so the body's
 * queries/hooks resolve and the `if (!artist)` early guard passes.
 */

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

Object.assign(
  client,
  createFakeSupabase({
    bookings: [{ when: { artist_id: "artist-1" }, data: [], error: null }],
    "my-cast-memberships": { data: [], error: null },
    cast_members: { data: [], error: null },
    hire_orders: { data: [], error: null },
  } as never),
);

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1", name: "Halle Kollektiv" } }),
}));
vi.mock("@/hooks/useMyArtist", () => ({
  // Must return an artist so the `if (!artist)` early guard does not
  // short-circuit before the first-run layer.
  useMyArtist: () => ({ data: { id: "artist-1", name: "Nora" } }),
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
    show: true,
    complete: false,
    dismissed: false,
    steps: [],
    rules: [],
    offFooters: [],
    sample: { stats: [], queue: [], week: [] },
    welcome: {
      eyebrow: "Welcome",
      headline: "Halle Kollektiv added you to the roster",
      body: "b",
      primaryLabel: "Start setup",
      secondaryLabel: "Later",
      progressLabel: "Set up · 0 of 3",
      progressFilled: 0,
      progressTotal: 3,
      progressHint: "About 2 minutes",
    },
    sectionTitle: "What this page becomes",
    sectionHint: "Sample rows.",
    railEyebrow: "Set up",
    railTitle: "Before your first offer",
    railBody: "b",
    collapsedLabel: "Set up in progress",
    collapsedHint: "2 steps left",
    collapsedCta: "Resume",
    railOpen: false,
    openRail: vi.fn(),
    closeRail: vi.fn(),
    dismiss: vi.fn(),
    undismiss: vi.fn(),
  }),
}));

import { ArtistDashboard } from "./ArtistDashboard";

describe("ArtistDashboard first-run (Task 11)", () => {
  it("renders the artist welcome panel", async () => {
    renderWithProviders(
      <MemoryRouter>
        <ArtistDashboard />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/added you to the roster/)).toBeInTheDocument();
  });
});
