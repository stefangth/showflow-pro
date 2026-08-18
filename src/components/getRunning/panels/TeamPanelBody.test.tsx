import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// Approved fake in a hoisted holder (vi.mock is hoisted above imports) — never a
// hand-rolled vi.mock chain, per src/hooks/useInvitationMutations.test.tsx and
// src/components/settings/bookingFlow/BookingFlowTab.test.tsx. TeamPanelBody calls the
// REAL useOrgMembers + useInvitationMutations hooks, which both read the shared
// supabase singleton, so the fake stands in for that singleton rather than mocking
// the hooks themselves.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

Object.assign(
  client,
  createFakeSupabase({
    "rpc:list_org_members": {
      data: [
        { user_id: "admin-1", email: "admin@example.com", display_name: "Ada Admin", roles: ["admin"], last_sign_in_at: null },
      ],
      error: null,
    },
    "fn:create-invitation": {
      data: {
        invitation: {
          id: "inv-1",
          org_id: "org-1",
          email: "lena@nordstadt.de",
          role: "producer",
          status: "pending",
          token: "tok-1",
          expires_at: "2026-12-01T00:00:00Z",
        },
      },
      error: null,
    },
  }),
);

import { TeamPanelBody } from "./TeamPanelBody";

describe("TeamPanelBody", () => {
  beforeEach(() => {
    (client.calls as unknown[]).length = 0;
  });

  it("invites a producer without leaving the panel", async () => {
    renderWithProviders(<TeamPanelBody orgId="org-1" />);

    // Current roster renders inline (no navigation needed to see who's already in).
    expect(await screen.findByText("Ada Admin")).toBeInTheDocument();

    const emailInput = screen.getByLabelText(/invite by email/i);
    fireEvent.change(emailInput, { target: { value: "lena@nordstadt.de" } });
    fireEvent.click(screen.getByRole("button", { name: /send invite/i }));

    await waitFor(() => {
      expect(client.calls as unknown[]).toContainEqual({
        table: "fn:create-invitation",
        method: "invoke",
        args: [expect.objectContaining({ role: "producer", email: "lena@nordstadt.de" })],
      });
    });

    // The invite is recorded and the email field clears, but the board does NOT
    // advance: `team.done` counts ACCEPTED members, and a send only creates a
    // pending invitation, so this panel stays open (mirrors PeoplePanelBody).
    await waitFor(() => expect(emailInput).toHaveValue(""));

    // No navigation / no link out — the whole invite happens inside this panel.
    expect(screen.queryByRole("link", { name: /people|admin/i })).not.toBeInTheDocument();
  });
});
