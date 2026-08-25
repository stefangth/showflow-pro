import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// vi.mock is hoisted above imports, so the factory can only read a vi.hoisted holder
// (not an outer const). Populate that holder with the fake after imports run.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));

const artists = [
  { id: "a-none", name: "Ned None", email: "ned@x.com", status: "active", user_id: null, org_id: "o1" },
  { id: "a-invited", name: "Ivy Invited", email: "ivy@x.com", status: "active", user_id: null, org_id: "o1" },
];

vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ hasRole: () => true, currentOrg: { id: "o1" } }),
}));
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));
vi.mock("@/components/casts/CastsSection", () => ({ CastsSection: () => null }));
vi.mock("@/components/artists/ArtistProfileSheet", () => ({ ArtistProfileSheet: () => null }));
vi.mock("@/components/artists/ArtistImportDialog", () => ({
  ArtistImportDialog: ({ canInvite }: { canInvite: boolean }) => (
    <div data-testid="import-dialog" data-can-invite={String(canInvite)} />
  ),
}));
// This page renders FinishSetupLink (v3 is unconditional now), which calls the live
// useGetRunningV3 model hook and, when it resolves an actionable step, renders a real
// react-router <Link>. These renders are router-free (no MemoryRouter), so stub the model
// as null/not-loading here to keep FinishSetupLink's early return and avoid needing a router
// just for an affordance these tests are not about.
vi.mock("@/hooks/useGetRunningV3", () => ({ useGetRunningV3: () => ({ model: null, isLoading: false }) }));

Object.assign(client, createFakeSupabase({
  artists: { data: artists, error: null },
  bookings: { data: [], error: null },
  artist_skills: { data: [], error: null },
  cast_members: { data: [], error: null },
  "rpc:list_pending_invited_artists": { data: ["a-invited"], error: null },
  org_invitations: { data: [{ id: "inv-1", artist_id: "a-invited", email: "ivy@x.com" }], error: null },
  // Empty: these tests cover capability gates and invitations, not the finish-setup
  // affordance (already neutralized by the useGetRunningV3 stub above).
  app_settings: { data: [], error: null },
}));

import { useCan } from "@/hooks/useCapabilities";
const mockUseCan = (allowed: Record<string, boolean>) =>
  vi.mocked(useCan).mockImplementation((action: string) => allowed[action] ?? false);

import ArtistsPage from "./ArtistsPage";

describe("ArtistsPage — Part A capability gates", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("v3 disabled (explicit override): no finish-setup affordance in the action cluster", () => {
    mockUseCan({ add_artists: true });
    renderWithProviders(<ArtistsPage />);
    expect(screen.queryByRole("link", { name: /finish setup/i })).not.toBeInTheDocument();
  });

  it("add_artists on: shows both Import from sheet and Add Artist", () => {
    mockUseCan({ add_artists: true });
    renderWithProviders(<ArtistsPage />);
    expect(screen.getByRole("button", { name: /import from sheet/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add artist/i })).toBeInTheDocument();
  });

  it("add_artists off: hides both Import from sheet and Add Artist (read stays)", () => {
    mockUseCan({ add_artists: false });
    renderWithProviders(<ArtistsPage />);
    expect(screen.queryByRole("button", { name: /import from sheet/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add artist/i })).not.toBeInTheDocument();
  });

  it("invite_artists on: shows the card Invite chip for a no-account artist and forwards canInvite to the import dialog", async () => {
    mockUseCan({ invite_artists: true });
    renderWithProviders(<ArtistsPage />);
    await waitFor(() => expect(screen.getByText("Ned None")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Invite" })).toBeInTheDocument();
    expect(screen.getByTestId("import-dialog")).toHaveAttribute("data-can-invite", "true");
  });

  it("invite_artists off: hides the card Invite chip and passes canInvite=false to the import dialog (read stays)", async () => {
    mockUseCan({ invite_artists: false });
    renderWithProviders(<ArtistsPage />);
    await waitFor(() => expect(screen.getByText("Ned None")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Invite" })).not.toBeInTheDocument();
    expect(screen.getByTestId("import-dialog")).toHaveAttribute("data-can-invite", "false");
  });
});

describe("ArtistsPage — Part B pending-invite revoke/resend controls", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("shows Resend and Revoke for an artist with a pending invite when both caps are on", async () => {
    mockUseCan({ resend_account_invite: true, manage_artist_invitations: true });
    renderWithProviders(<ArtistsPage />);
    await waitFor(() => expect(screen.getByText("Ivy Invited")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Resend invite" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke invite" })).toBeInTheDocument();
  });

  it("hides Resend and Revoke when both caps are off (chip still reads)", async () => {
    mockUseCan({ resend_account_invite: false, manage_artist_invitations: false });
    renderWithProviders(<ArtistsPage />);
    await waitFor(() => expect(screen.getByText("Ivy Invited")).toBeInTheDocument());
    expect(screen.getByText("Invite pending")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resend invite" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke invite" })).not.toBeInTheDocument();
  });

  it("shows only Resend when manage_artist_invitations is off", async () => {
    mockUseCan({ resend_account_invite: true, manage_artist_invitations: false });
    renderWithProviders(<ArtistsPage />);
    await waitFor(() => expect(screen.getByText("Ivy Invited")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Resend invite" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke invite" })).not.toBeInTheDocument();
  });

  it("does not render revoke/resend for an artist with no pending invite", async () => {
    mockUseCan({ resend_account_invite: true, manage_artist_invitations: true });
    renderWithProviders(<ArtistsPage />);
    await waitFor(() => expect(screen.getByText("Ned None")).toBeInTheDocument());
    const nedCard = screen.getByText("Ned None").closest(".cursor-pointer") as HTMLElement;
    expect(nedCard).not.toBeNull();
    expect(within(nedCard).queryByRole("button", { name: "Resend invite" })).not.toBeInTheDocument();
    expect(within(nedCard).queryByRole("button", { name: "Revoke invite" })).not.toBeInTheDocument();
  });

  it("clicking Revoke calls revokeInvitation and invalidates the artists query", async () => {
    mockUseCan({ resend_account_invite: true, manage_artist_invitations: true });
    (client.calls as unknown[]).length = 0;
    renderWithProviders(<ArtistsPage />);
    await waitFor(() => expect(screen.getByText("Ivy Invited")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Revoke invite" }));
    await waitFor(() =>
      expect(client.calls).toContainEqual({ table: "rpc:revoke_invitation", method: "rpc", args: [{ p_id: "inv-1" }] }),
    );
  });

  it("clicking Resend calls resendInvitation", async () => {
    mockUseCan({ resend_account_invite: true, manage_artist_invitations: true });
    (client.calls as unknown[]).length = 0;
    renderWithProviders(<ArtistsPage />);
    await waitFor(() => expect(screen.getByText("Ivy Invited")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Resend invite" }));
    await waitFor(() =>
      expect(client.calls).toContainEqual({
        table: "fn:resend-invitation",
        method: "invoke",
        args: [{ invitation_id: "inv-1", app_origin: window.location.origin }],
      }),
    );
  });
});
