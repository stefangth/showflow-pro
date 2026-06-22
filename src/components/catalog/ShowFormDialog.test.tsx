import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const createShow = vi.fn(() => Promise.resolve({ id: "s-new" }));
const updateShow = vi.fn(() => Promise.resolve());
vi.mock("@/data/shows", async (orig) => ({ ...(await orig<typeof import("@/data/shows")>()), createShow: (...a: unknown[]) => createShow(...a), updateShow: (...a: unknown[]) => updateShow(...a) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: { id: "org-1" }, user: { id: "u1" }, hasRole: () => true }) }));

import { ShowFormDialog } from "./ShowFormDialog";

describe("ShowFormDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create: requires a program/sub-program label", async () => {
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/program or sub-program required/i)).toBeInTheDocument();
    expect(createShow).not.toHaveBeenCalled();
  });

  it("create: submits mapped values with computed sortOrder", async () => {
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[{ sort_order: 4 } as never]} />);
    fireEvent.change(screen.getByLabelText(/^program/i), { target: { value: "Hamlet" } });
    fireEvent.change(screen.getByLabelText(/main cast/i), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(createShow).toHaveBeenCalled());
    const arg = createShow.mock.calls[0][1] as Record<string, unknown>;
    expect(arg).toMatchObject({ program: "Hamlet", mainCastSlots: 3, sortOrder: 5, orgId: "org-1", createdBy: "u1" });
  });

  it("synced show: program is read-only, slots editable", () => {
    renderWithProviders(<ShowFormDialog open onOpenChange={() => {}} allShows={[]} show={{ id: "s1", program: "P", sub_program: null, category: null, description: null, status: "active", main_cast_slots: 2, understudy_slots: 1, airtable_program_key: "K", sort_order: 1, dateCount: 0 }} />);
    expect(screen.getByText(/synced from airtable/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^program/i)).toBeDisabled();
    expect(screen.getByLabelText(/main cast/i)).not.toBeDisabled();
  });
});
