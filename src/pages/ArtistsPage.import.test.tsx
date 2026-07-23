import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ hasRole: () => true, currentOrg: { id: "o1" } }),
}));
// Both "Import from sheet" and "Add Artist" are gated by the same `add_artists`
// capability (Phase 4.4 rewire) — mock useCan so gating is deterministic in tests.
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
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
  org_invitations: { data: [], error: null },
}));

import { useCan } from "@/hooks/useCapabilities";
const mockUseCan = (allowed: Record<string, boolean>) =>
  vi.mocked(useCan).mockImplementation((action: string) => allowed[action] ?? false);

import ArtistsPage from "./ArtistsPage";

describe("ArtistsPage import gating", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("add_artists on: sees both 'Import from sheet' and 'Add Artist'", () => {
    mockUseCan({ add_artists: true });
    renderWithProviders(<ArtistsPage />);
    expect(screen.getByRole("button", { name: /import from sheet/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add artist/i })).toBeInTheDocument();
  });

  it("add_artists off: sees neither import nor add", () => {
    mockUseCan({ add_artists: false });
    renderWithProviders(<ArtistsPage />);
    expect(screen.queryByRole("button", { name: /import from sheet/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add artist/i })).not.toBeInTheDocument();
  });

  it("clicking Import opens the dialog", async () => {
    mockUseCan({ add_artists: true });
    renderWithProviders(<ArtistsPage />);
    fireEvent.click(screen.getByRole("button", { name: /import from sheet/i }));
    await waitFor(() => expect(screen.getByText("IMPORT OPEN")).toBeInTheDocument());
  });
});
