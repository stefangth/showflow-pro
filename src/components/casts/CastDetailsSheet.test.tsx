import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  cast_members: {
    data: [{ id: "m1", artist_id: "a1", artist: { id: "a1", name: "Artist One", status: "active" } }],
    error: null,
  },
  artists: {
    data: [
      { id: "a1", name: "Artist One", status: "active" },
      { id: "a2", name: "Artist Two", status: "active" },
    ],
    error: null,
  },
}));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ roles: ["producer"], currentOrg: { id: "org-1" } }),
}));
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));
vi.mock("@/features/editor/EditorContext", () => ({ useEditorConfig: () => ({ isEditorMode: false }) }));

import { useCan } from "@/hooks/useCapabilities";
import { CastDetailsSheet } from "./CastDetailsSheet";

const CAST = { id: "c1", name: "Cast A", description: null } as never;

describe("CastDetailsSheet", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(useCan).mockReturnValue(true); });

  it("manage_casts on: edit, remove, and add-member controls are enabled", async () => {
    renderWithProviders(<CastDetailsSheet cast={CAST} open onOpenChange={() => {}} />);
    expect(await screen.findByText("Artist One")).toBeInTheDocument();
    expect(screen.getByLabelText("Edit cast")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Artist One")).not.toBeDisabled();
    const candidateRow = screen.getByText("Artist Two").closest("div")!.parentElement!;
    expect(within(candidateRow).getByRole("button")).not.toBeDisabled();
  });

  it("manage_casts off: edit and add controls are disabled/absent, member list still reads", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderWithProviders(<CastDetailsSheet cast={CAST} open onOpenChange={() => {}} />);
    expect(await screen.findByText("Artist One")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit cast")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Remove Artist One")).toBeDisabled();
    const candidateRow = screen.getByText("Artist Two").closest("div")!.parentElement!;
    expect(within(candidateRow).getByRole("button")).toBeDisabled();
  });
});
