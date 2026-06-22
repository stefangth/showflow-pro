import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const exportSpy = vi.fn().mockResolvedValue({ schema_version: 1 });
const deleteSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/data/platform", () => ({
  updateOrg: vi.fn().mockResolvedValue(undefined),
  exportOrgData: () => exportSpy(),
  deleteOrg: () => deleteSpy(),
}));

import { EditOrgDialog } from "./EditOrgDialog";

const org = { org_id: "o1", name: "Acme", slug: "acme", status: "active" } as never;
const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

describe("EditOrgDialog danger zone", () => {
  beforeEach(() => {
    exportSpy.mockClear(); deleteSpy.mockClear();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  it("exports org data", async () => {
    render(wrap(<EditOrgDialog org={org} onClose={() => {}} />));
    await userEvent.click(screen.getByRole("button", { name: /export org data/i }));
    await waitFor(() => expect(exportSpy).toHaveBeenCalled());
  });

  it("requires the org name before deleting", async () => {
    render(wrap(<EditOrgDialog org={org} onClose={() => {}} />));
    await userEvent.click(screen.getByRole("button", { name: /delete organization/i }));
    const confirm = await screen.findByRole("button", { name: /permanently delete/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("Acme"), "Acme");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(deleteSpy).toHaveBeenCalled());
  });
});
