import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// ChangeLogDialog reads the audit trail via useSettingsAudit, which pulls
// `currentOrg` from useAuth and hits the shared supabase client. Mirrors the
// mocking pattern used by BookingFlowTab.test.tsx: a vi.hoisted mutable
// client seeded with createFakeSupabase (never a hand-rolled vi.mock chain),
// and useAuth replaced with a controllable vi.fn().
const { client } = vi.hoisted(() => ({
  client: {} as Record<string, unknown>,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

Object.assign(
  client,
  createFakeSupabase({
    settings_audit_log: {
      data: [
        {
          id: "audit-1",
          key: "capability:producer_can_hard_delete_productions",
          actor: "u1",
          old_value: false,
          new_value: true,
          created_at: "2026-07-14T10:00:00Z",
        },
      ],
      error: null,
    },
    profiles: { data: [{ user_id: "u1", display_name: "Stefan S." }], error: null },
  }),
);

import { useAuth } from "@/features/auth/AuthContext";
import { ChangeLogDialog } from "./ChangeLogDialog";

describe("ChangeLogDialog", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-1" } } as never);
  });

  it("renders the dialog title", () => {
    renderWithProviders(<ChangeLogDialog open onOpenChange={() => {}} />);
    expect(screen.getByText("Change log")).toBeInTheDocument();
  });

  it("shows the actor and a human on/off transition once the audit query resolves", async () => {
    renderWithProviders(<ChangeLogDialog open onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("off -> on")).toBeInTheDocument();
    });

    expect(screen.getByText("Stefan S.")).toBeInTheDocument();
  });

  it("shows an empty state when there is no audit history", async () => {
    vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-empty" } } as never);
    Object.assign(
      client,
      createFakeSupabase({
        settings_audit_log: { data: [], error: null },
        profiles: { data: [], error: null },
      }),
    );

    renderWithProviders(<ChangeLogDialog open onOpenChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("No changes yet.")).toBeInTheDocument();
    });
  });

  it("does not render dialog content when closed", () => {
    renderWithProviders(<ChangeLogDialog open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText("Change log")).not.toBeInTheDocument();
  });
});
