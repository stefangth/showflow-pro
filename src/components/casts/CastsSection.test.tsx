import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  casts: { data: [{ id: "c1", name: "Cast A", description: null }], error: null },
  cast_members: { data: [{ cast_id: "c1" }], error: null },
}));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ hasRole: () => true, roles: ["producer"], currentOrg: { id: "org-1" }, user: { id: "u1" } }),
}));
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));
vi.mock("@/features/editor/EditorContext", () => ({ useEditorConfig: () => ({ isEditorMode: false }) }));

import { useCan } from "@/hooks/useCapabilities";
import { CastsSection } from "./CastsSection";

describe("CastsSection", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(useCan).mockReturnValue(true); });

  it("manage_casts on: shows the create-cast control", async () => {
    renderWithProviders(<CastsSection />);
    expect(await screen.findByText("Cast A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new cast/i })).toBeInTheDocument();
  });

  it("manage_casts off: hides the create-cast control, cast list still reads", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderWithProviders(<CastsSection />);
    expect(await screen.findByText("Cast A")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new cast/i })).not.toBeInTheDocument();
  });
});
