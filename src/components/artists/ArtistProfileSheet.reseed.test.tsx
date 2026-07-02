import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// H6 regression: the ArtistProfileSheet editable form must be seeded ONCE per artist
// identity. A `['artists']` prefix invalidation (any artists write, incl. bulk import)
// re-fetches the same row and must NOT clobber in-progress edits; opening a DIFFERENT
// artist (new id) must re-seed.

// The component reads from('artists').select().eq('id', <id>).single(). We back that with
// the approved call-recording fake (createFakeSupabase) rather than a hand-rolled chain:
// an array seed resolves per-id via the `when: { id }` match against the recorded eq() arg.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

Object.assign(
  client,
  createFakeSupabase({
    artists: [
      {
        when: { id: "a1" },
        data: { id: "a1", name: "Ada", email: "ada@x.com", phone: null, bio: null, status: "active", user_id: null, org_id: "org-1" },
        error: null,
      },
      {
        when: { id: "a2" },
        data: { id: "a2", name: "Grace", email: "grace@x.com", phone: null, bio: null, status: "active", user_id: null, org_id: "org-1" },
        error: null,
      },
    ],
  }),
);

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ hasRole: (r: string) => r === "admin", roles: ["admin"], currentOrg: { id: "org-1" } }),
}));
vi.mock("@/features/editor/EditorContext", () => ({ useEditorConfig: () => ({ isEditorMode: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useSkills", () => ({
  useSkills: () => ({ data: [] }),
  useArtistSkills: () => ({ data: [] }),
  useCreateSkill: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/useOrgMembers", () => ({ useOrgMembers: () => ({ data: [], isLoading: false }) }));
vi.mock("@/hooks/usePendingInvitedArtists", () => ({ usePendingInvitedArtists: () => ({ data: [] }) }));
vi.mock("@/data/invitations", () => ({
  inviteArtistToApp: vi.fn(), resendInvitation: vi.fn(), fetchOrgInvitations: vi.fn(() => Promise.resolve([])),
}));
vi.mock("./LinkedAccountPanel", () => ({ LinkedAccountPanel: () => null }));

import { ArtistProfileSheet } from "./ArtistProfileSheet";

describe("ArtistProfileSheet — draft reseed (H6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not clobber an in-progress edit when the same artist refetches", async () => {
    const { queryClient, rerender } = renderWithProviders(
      <ArtistProfileSheet artistId="a1" open onOpenChange={() => {}} />,
    );
    // Form seeded from the server row.
    await waitFor(() => expect(screen.getByDisplayValue("Ada")).toBeInTheDocument());

    // User edits the name in the form (not yet saved).
    fireEvent.change(screen.getByDisplayValue("Ada"), { target: { value: "Ada Edited" } });
    expect(screen.getByDisplayValue("Ada Edited")).toBeInTheDocument();

    // A `['artists']` invalidation refetches the SAME artist id.
    await queryClient.invalidateQueries({ queryKey: ["artists"] });
    rerender(<ArtistProfileSheet artistId="a1" open onOpenChange={() => {}} />);

    // The in-progress edit survives — the refetch did NOT re-seed the form.
    await waitFor(() => expect(screen.getByDisplayValue("Ada Edited")).toBeInTheDocument());
    expect(screen.queryByDisplayValue("Ada")).not.toBeInTheDocument();
  });

  it("re-seeds the form when a different artist is opened", async () => {
    const { rerender } = renderWithProviders(
      <ArtistProfileSheet artistId="a1" open onOpenChange={() => {}} />,
    );
    await waitFor(() => expect(screen.getByDisplayValue("Ada")).toBeInTheDocument());

    // Switch to a different artist id → the form must adopt the new row.
    rerender(<ArtistProfileSheet artistId="a2" open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue("Grace")).toBeInTheDocument());
    expect(screen.queryByDisplayValue("Ada")).not.toBeInTheDocument();
  });
});
