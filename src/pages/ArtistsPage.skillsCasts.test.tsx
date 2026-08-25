import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const artists = [
  { id: "a-skilled", name: "Sam Skilled", email: "sam@x.com", status: "active", user_id: "u1", org_id: "o1" },
];

// artist_skills / cast_members join rows, shaped the way fetchSkillsByArtist / fetchCastsByArtist
// read them off the (mocked) select("...skill:skills(id,name)") / select("...cast:casts(id,name)").
const artistSkills = [
  { artist_id: "a-skilled", org_id: "o1", skill: { id: "sk1", name: "Vocals" } },
  { artist_id: "a-skilled", org_id: "o1", skill: { id: "sk2", name: "Stage combat" } },
  { artist_id: "a-skilled", org_id: "o1", skill: { id: "sk3", name: "Piano" } },
  { artist_id: "a-skilled", org_id: "o1", skill: { id: "sk4", name: "Dance" } },
  { artist_id: "a-skilled", org_id: "o1", skill: { id: "sk5", name: "Improv" } },
];
const artistCasts = [
  { artist_id: "a-skilled", org_id: "o1", cast: { id: "c1", name: "Cast A" } },
  { artist_id: "a-skilled", org_id: "o1", cast: { id: "c2", name: "Cast B" } },
];

// vi.mock is hoisted above imports, so the factory reads a vi.hoisted holder that we
// populate with the fake after imports run (referencing an outer const would TDZ-throw).
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  artists: { data: artists, error: null },
  bookings: { data: [], error: null },
  artist_skills: { data: artistSkills, error: null },
  cast_members: { data: artistCasts, error: null },
  "rpc:list_pending_invited_artists": { data: [], error: null },
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

describe("ArtistsPage roster card — labelled SKILLS / CASTS rows (1j)", () => {
  it("shows the SKILLS and CASTS eyebrow labels", async () => {
    renderWithProviders(<ArtistsPage />);
    await waitFor(() => expect(screen.getByText("Sam Skilled")).toBeInTheDocument());
    expect(screen.getByText("SKILLS")).toBeInTheDocument();
    expect(screen.getByText("CASTS")).toBeInTheDocument();
  });

  it("caps skill badges at 3 with a +2 mono overflow badge for an artist with 5 skills", async () => {
    renderWithProviders(<ArtistsPage />);
    await waitFor(() => expect(screen.getByText("Sam Skilled")).toBeInTheDocument());
    const card = screen.getByText("Sam Skilled").closest(".cursor-pointer") as HTMLElement;
    expect(card).not.toBeNull();

    expect(within(card).getByText("Vocals")).toBeInTheDocument();
    expect(within(card).getByText("Stage combat")).toBeInTheDocument();
    expect(within(card).getByText("Piano")).toBeInTheDocument();
    expect(within(card).queryByText("Dance")).not.toBeInTheDocument();
    expect(within(card).queryByText("Improv")).not.toBeInTheDocument();
    expect(within(card).getByText("+2")).toBeInTheDocument();
  });

  it("renders casts as hairline-neutral badges under the CASTS row", async () => {
    renderWithProviders(<ArtistsPage />);
    await waitFor(() => expect(screen.getByText("Sam Skilled")).toBeInTheDocument());
    const card = screen.getByText("Sam Skilled").closest(".cursor-pointer") as HTMLElement;
    expect(within(card).getByText("Cast A")).toBeInTheDocument();
    expect(within(card).getByText("Cast B")).toBeInTheDocument();
  });
});
