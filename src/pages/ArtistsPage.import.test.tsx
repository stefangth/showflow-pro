import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
const { auth } = vi.hoisted(() => ({ auth: { role: "producer" as string } }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ hasRole: (r: string) => r === auth.role, currentOrg: { id: "o1" } }),
}));
vi.mock("@/components/filters/useFilterVisibility", () => ({ useFilterVisibility: () => ({ canSee: () => false }) }));
vi.mock("@/components/casts/CastsSection", () => ({ CastsSection: () => null }));
vi.mock("@/components/artists/ArtistProfileSheet", () => ({ ArtistProfileSheet: () => null }));
vi.mock("@/components/artists/ArtistImportDialog", () => ({
  ArtistImportDialog: ({ open }: { open: boolean }) => (open ? <div>IMPORT OPEN</div> : null),
}));

Object.assign(client, createFakeSupabase({
  artists: { data: [], error: null },
  bookings: { data: [], error: null },
  artist_skills: { data: [], error: null },
  cast_members: { data: [], error: null },
  "rpc:list_pending_invited_artists": { data: [], error: null },
}));

import ArtistsPage from "./ArtistsPage";

describe("ArtistsPage import gating", () => {
  beforeEach(() => { auth.role = "producer"; });

  it("producer sees 'Import from sheet' but not 'Add Artist'", () => {
    auth.role = "producer";
    renderWithProviders(<ArtistsPage />);
    expect(screen.getByRole("button", { name: /import from sheet/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add artist/i })).not.toBeInTheDocument();
  });

  it("artist sees neither import nor add", () => {
    auth.role = "artist";
    renderWithProviders(<ArtistsPage />);
    expect(screen.queryByRole("button", { name: /import from sheet/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add artist/i })).not.toBeInTheDocument();
  });

  it("clicking Import opens the dialog", async () => {
    auth.role = "producer";
    renderWithProviders(<ArtistsPage />);
    fireEvent.click(screen.getByRole("button", { name: /import from sheet/i }));
    await waitFor(() => expect(screen.getByText("IMPORT OPEN")).toBeInTheDocument());
  });
});
