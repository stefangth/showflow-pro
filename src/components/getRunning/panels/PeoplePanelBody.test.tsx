import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// Approved fake in a hoisted holder (vi.mock is hoisted above imports) — never a
// hand-rolled vi.mock chain, per TeamPanelBody.test.tsx. PeoplePanelBody calls the REAL
// `useCreateArtistLite` (useHireOrders.ts) and reads via `fetchArtists`, both of which
// use the shared supabase singleton, so the fake stands in for that singleton.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

// `canInvite` is resolved via `useCan("invite_artists")`, mirroring exactly how
// ArtistsPage.tsx resolves the same prop for the real ArtistImportDialog. Mocked rather
// than seeded so ON/OFF is one line, same pattern as PeopleStep.test.tsx.
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

Object.assign(
  client,
  createFakeSupabase({
    artists: {
      data: [{ id: "existing-1", name: "Existing Artist", email: "existing@example.com" }],
      error: null,
    },
  }),
);

import { useCan } from "@/hooks/useCapabilities";
import { PeoplePanelBody } from "./PeoplePanelBody";

describe("PeoplePanelBody", () => {
  beforeEach(() => {
    (client.calls as unknown[]).length = 0;
    vi.mocked(useCan).mockReturnValue(true);
  });

  it("adds an artist and stays open, clearing the form for the next one", async () => {
    renderWithProviders(<PeoplePanelBody orgId="org-1" artistCount={2} />);

    const nameInput = screen.getByLabelText(/add an artist/i);
    const emailInput = screen.getByPlaceholderText(/email/i);
    fireEvent.change(nameInput, { target: { value: "Lena Nord" } });
    fireEvent.change(emailInput, { target: { value: "lena@nordstadt.de" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => {
      expect(client.calls as unknown[]).toContainEqual({
        table: "artists",
        method: "insert",
        args: [{ name: "Lena Nord", email: "lena@nordstadt.de", org_id: "org-1" }],
      });
    });

    // Panel stays mounted (no onDone-style navigation) and the form clears so an
    // admin can immediately add the next artist.
    await waitFor(() => expect(nameInput).toHaveValue(""));
    expect(emailInput).toHaveValue("");
    expect(screen.getByRole("button", { name: /^add$/i })).toBeInTheDocument();
  });

  it("reveals the import dialog instead of navigating to the artists page", () => {
    renderWithProviders(<PeoplePanelBody orgId="org-1" artistCount={2} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /import a sheet/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // No link out to the Artists page anywhere on this panel.
    expect(screen.queryByRole("link", { name: /artists/i })).not.toBeInTheDocument();
  });

  it("shows the active roster count", () => {
    renderWithProviders(<PeoplePanelBody orgId="org-1" artistCount={4} />);
    expect(screen.getByText(/4 active/)).toBeInTheDocument();
    expect(screen.getByText(/artists on the roster/i)).toBeInTheDocument();
  });

  it("says no artists yet for an empty roster", () => {
    renderWithProviders(<PeoplePanelBody orgId="org-1" artistCount={0} />);
    expect(screen.getByText(/no artists yet/i)).toBeInTheDocument();
  });
});
