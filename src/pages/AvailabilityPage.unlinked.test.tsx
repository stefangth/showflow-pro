import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

/**
 * Consistency finding (round-3 review): the Dashboard warmed its unlinked-artist
 * card ("You're on the {org} roster..."), but AvailabilityPage still dead-ended
 * on the old cold "No artist profile linked to your account" line for the SAME
 * account state. Both now render the shared UnlinkedArtistCard. This locks that
 * the flagged surface shows the warm copy and never the cold copy.
 */

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({} as never));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1", name: "Acme" } }),
}));
// No linked artist -- exercises the `if (!artist)` early return.
vi.mock("@/hooks/useMyArtist", () => ({
  useMyArtist: () => ({ data: null }),
}));
vi.mock("@/hooks/useArtistEligibleDates", () => ({
  useArtistEligibleDates: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: () => true,
}));
vi.mock("@/features/editor/EditorContext", () => ({
  useColumnTemplate: () => ({
    orderedColumns: [{ columnId: "show_dates.date", visible: true, order: 0 }],
    visibleCount: 1,
  }),
  useEditorConfig: () => ({ isEditorMode: false, getColumnLabel: (id: string) => id }),
}));
vi.mock("@/features/editor/useColumnHeaders", () => ({
  useColumnHeaders: () => [{ columnId: "show_dates.date", headerLabel: "Date" }],
}));
vi.mock("@/features/editor/ColumnLayoutEditor", () => ({ ColumnLayoutEditor: () => null }));

import AvailabilityPage from "./AvailabilityPage";

describe("AvailabilityPage — unlinked artist (round-3 consistency fix)", () => {
  it("shows the warm roster card and not the old cold copy", () => {
    renderWithProviders(<AvailabilityPage />);
    expect(screen.getByText("You're on the Acme roster")).toBeInTheDocument();
    expect(screen.getByText(/an admin still needs to link/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/No artist profile linked to your account/i),
    ).not.toBeInTheDocument();
  });
});
