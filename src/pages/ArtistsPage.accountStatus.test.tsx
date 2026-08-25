import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const artists = [
  { id: "a-active", name: "Ann Active", email: "ann@x.com", status: "active", user_id: "u1", org_id: "o1" },
  { id: "a-invited", name: "Ivy Invited", email: "ivy@x.com", status: "active", user_id: null, org_id: "o1" },
  { id: "a-none", name: "Ned None", email: "ned@x.com", status: "active", user_id: null, org_id: "o1" },
];

// vi.mock is hoisted above imports, so the factory reads a vi.hoisted holder that we
// populate with the fake after imports run (referencing an outer const would TDZ-throw).
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  artists: { data: artists, error: null },
  bookings: { data: [], error: null },
  artist_skills: { data: [], error: null },
  cast_members: { data: [], error: null },
  "rpc:list_pending_invited_artists": { data: ["a-invited"], error: null },
}));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ hasRole: () => true, currentOrg: { id: "o1" } }),
}));
vi.mock("@/components/casts/CastsSection", () => ({ CastsSection: () => null }));
vi.mock("@/components/artists/ArtistProfileSheet", () => ({ ArtistProfileSheet: () => null }));
// This page renders FinishSetupLink (v3 is unconditional now), which calls the live
// useGetRunningV3 model hook and, when it resolves an actionable step, renders a real
// react-router <Link>. These renders are router-free (no MemoryRouter), so stub the model
// as null/not-loading here to keep FinishSetupLink's early return and avoid needing a router
// just for an affordance these tests are not about.
vi.mock("@/hooks/useGetRunningV3", () => ({ useGetRunningV3: () => ({ model: null, isLoading: false }) }));

import ArtistsPage from "./ArtistsPage";

describe("ArtistsPage account status chips", () => {
  it("shows Active / Invite pending / No account per artist state", async () => {
    renderWithProviders(<ArtistsPage />);
    await waitFor(() => expect(screen.getByText("Ann Active")).toBeInTheDocument());
    expect(screen.getByText("Active account")).toBeInTheDocument();
    expect(screen.getByText("Invite pending")).toBeInTheDocument();
    expect(screen.getByText("No account")).toBeInTheDocument();
  });
});
