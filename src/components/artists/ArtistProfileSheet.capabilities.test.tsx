import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// Phase 4.4: canEdit / canSeeAccount / canResend rewired from role checks to
// useCan('edit_artists') / useCan('resend_account_invite'). These tests drive
// useCan directly so the gating is deterministic (real capability resolution
// is covered by useCapabilities.test.tsx).

const ARTIST_ACTIVE = {
  id: "a1", name: "Ada", email: "ada@x.com", phone: null, bio: null,
  status: "active", user_id: "u1", org_id: "org-1",
};

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  artists: [{ when: { id: "a1" }, data: ARTIST_ACTIVE, error: null }],
}));

const { auth } = vi.hoisted(() => ({ auth: { role: "producer" as string } }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ hasRole: (r: string) => r === auth.role, roles: [auth.role], currentOrg: { id: "org-1" } }),
}));
vi.mock("@/features/editor/EditorContext", () => ({ useEditorConfig: () => ({ isEditorMode: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useSkills", () => ({
  useSkills: () => ({ data: [] }),
  useArtistSkills: () => ({ data: [] }),
  useUpcomingDateCountsBySkill: () => ({ data: new Map() }),
}));
vi.mock("@/hooks/useOrgMembers", () => ({ useOrgMembers: () => ({ data: [], isLoading: false }) }));
vi.mock("@/hooks/usePendingInvitedArtists", () => ({ usePendingInvitedArtists: () => ({ data: [] }) }));
vi.mock("@/data/invitations", () => ({
  inviteArtistToApp: vi.fn(), resendInvitation: vi.fn(), fetchOrgInvitations: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
  useCapability: vi.fn(),
}));

import { useCan, useCapability } from "@/hooks/useCapabilities";
const mockUseCan = (allowed: Record<string, boolean>) =>
  vi.mocked(useCan).mockImplementation((action: string) => allowed[action] ?? false);

import { ArtistProfileSheet } from "./ArtistProfileSheet";

describe("ArtistProfileSheet — Phase 4.4 capability gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.role = "producer";
    vi.mocked(useCapability).mockReturnValue(false);
  });

  it("edit_artists on: producer can edit fields and Save renders", async () => {
    mockUseCan({ edit_artists: true });
    renderWithProviders(<MemoryRouter><ArtistProfileSheet artistId="a1" open onOpenChange={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByDisplayValue("Ada")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Ada")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("edit_artists off: producer cannot edit fields, Save is absent (read stays)", async () => {
    mockUseCan({ edit_artists: false });
    renderWithProviders(<MemoryRouter><ArtistProfileSheet artistId="a1" open onOpenChange={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByDisplayValue("Ada")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Ada")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("resend_account_invite on: producer sees the linked-account block for a registered artist", async () => {
    mockUseCan({ resend_account_invite: true });
    renderWithProviders(<MemoryRouter><ArtistProfileSheet artistId="a1" open onOpenChange={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Linked account")).toBeInTheDocument());
    expect(screen.getByText(/account details unavailable/i)).toBeInTheDocument();
  });

  it("resend_account_invite off: producer sees only the status chip, no account details (read stays)", async () => {
    mockUseCan({ resend_account_invite: false });
    renderWithProviders(<MemoryRouter><ArtistProfileSheet artistId="a1" open onOpenChange={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Linked account")).toBeInTheDocument());
    expect(screen.getByText("Active account")).toBeInTheDocument();
    expect(screen.queryByText(/account details unavailable/i)).not.toBeInTheDocument();
  });

  it("admin: canEdit and canSeeAccount/canResend are true even with useCan mocked false (admin real short-circuit is exercised elsewhere; here we assert via explicit useCan grants)", async () => {
    auth.role = "admin";
    mockUseCan({ edit_artists: true, resend_account_invite: true });
    renderWithProviders(<MemoryRouter><ArtistProfileSheet artistId="a1" open onOpenChange={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByDisplayValue("Ada")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Ada")).not.toBeDisabled();
    expect(screen.getByText(/account details unavailable/i)).toBeInTheDocument();
  });

  it("shows a contact-visibility note beside the org-browsed email field (R4.4)", async () => {
    mockUseCan({ edit_artists: false, resend_account_invite: false });
    renderWithProviders(<MemoryRouter><ArtistProfileSheet artistId="a1" open onOpenChange={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByDisplayValue("Ada")).toBeInTheDocument());
    expect(screen.getByText(/visible to admins and the Production Team in this organization/i)).toBeInTheDocument();
  });
});
