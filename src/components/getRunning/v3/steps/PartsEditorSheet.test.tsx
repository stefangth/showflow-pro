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

  // The sheet is where a producer writes a breakdown, so a missing skill must be
  // nameable here and not send them to Settings first.
  it("offers inline skill creation next to the catalog skills", async () => {
    renderSheet();
    await waitFor(() => {
      expect(screen.getByDisplayValue("Lead")).toBeInTheDocument();
    });
    expect(await screen.findByRole("button", { name: "Singing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new skill/i })).toBeInTheDocument();
  });

  /**
   * A slot row carries the skills its part REQUIRES, which is one half of the
   * `["skills", "gaps", ...]` read the board's `skills` step and the assign panel both
   * render from. Saving here without busting the skills domain left the step green and the
   * gap callout empty on a gap this very save had created.
   */
  it("invalidates the skills domain on save, so a newly required skill shows as a gap", async () => {
    const { queryClient } = renderSheet();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await waitFor(() => expect(screen.getByDisplayValue("Lead")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const keys = invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
      expect(keys).toContain(JSON.stringify(["skills"]));
    });
  });

  /**
   * An unread catalog arrives as `[]` exactly like an empty one, so every picker fell to
   * SkillPicker's empty branch and printed "No skills yet. Create the first one here." to an
   * org whose catalog is full, inviting duplicates with only the 23505 constraint behind it.
   */
  it("says the skill catalog could not be read instead of inviting a duplicate", async () => {
    Object.assign(
      client,
      createFakeSupabase({
        show_slots: {
          data: [{ id: "slot-1", name: "Lead", slot_count: 1, kind: "main", sort_order: 0 }],
          error: null,
        },
        show_slot_required_skills: { data: [], error: null },
        skills: { data: null, error: new Error("permission denied") },
      }),
    );
    renderSheet();

    expect(await screen.findByText(/could not load your skills/i)).toBeInTheDocument();
    expect(screen.queryByText(/create the first one here/i)).toBeNull();
    // And creation is withheld: a "New skill" affordance over an unread catalog is exactly
    // how a duplicate gets made.
    expect(screen.queryByRole("button", { name: /new skill/i })).toBeNull();
  });
});
