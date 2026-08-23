import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, screen } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

Object.assign(
  client,
  createFakeSupabase({
    show_slots: {
      data: [{ id: "slot-1", name: "Lead", slot_count: 1, kind: "main", sort_order: 0 }],
      error: null,
    },
    show_slot_required_skills: { data: [], error: null },
    skills: { data: [{ id: "skill-1", name: "Singing" }], error: null },
  }),
);

import { toast } from "sonner";
import { PartsEditorSheet } from "./PartsEditorSheet";

function renderSheet(onSaved = vi.fn(), onOpenChange = vi.fn()) {
  const result = renderWithProviders(
    <PartsEditorSheet
      open
      onOpenChange={onOpenChange}
      orgId="org-1"
      showId="show-1"
      showLabel="Hamlet"
      onSaved={onSaved}
    />,
    { authOverrides: { currentOrg: { id: "org-1", name: "Org", suspended_at: null } as never } },
  );
  return { ...result, onSaved, onOpenChange };
}

describe("PartsEditorSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seeds the existing slot row and renders the production name in the title", async () => {
    renderSheet();

    // Coarse, name-free wait: the seeded row's name input has a value before we
    // do any name-scoped query.
    await waitFor(() => {
      expect(screen.getByDisplayValue("Lead")).toBeInTheDocument();
    });

    expect(screen.getByText(/Hamlet/)).toBeInTheDocument();
  });

  it("editing a row and clicking Save calls saveShowSlots with the edited rows and fires onSaved", async () => {
    const { onSaved, onOpenChange } = renderSheet();

    await waitFor(() => {
      expect(screen.getByDisplayValue("Lead")).toBeInTheDocument();
    });

    const nameInput = screen.getByDisplayValue("Lead");
    fireEvent.change(nameInput, { target: { value: "Lead Updated" } });

    const saveButton = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });

    const fake = client as unknown as ReturnType<typeof createFakeSupabase>;
    const updateCall = fake.calls.find(
      (c) => c.table === "show_slots" && c.method === "update",
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.args[0]).toMatchObject({ name: "Lead Updated", slot_count: 1, kind: "main" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(vi.mocked(toast.success)).toHaveBeenCalled();
  });
});
