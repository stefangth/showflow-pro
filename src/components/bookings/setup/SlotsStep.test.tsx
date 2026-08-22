import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

type SlotArg = { id?: string; name: string; count: number; kind: string; skillIds: string[] };
const { showsRef, saveShowSlots, fetchShowSlots } = vi.hoisted(() => ({
  showsRef: { value: [] as unknown[] },
  saveShowSlots: vi.fn((_client: unknown, _args: { showId: string; orgId: string; slots: SlotArg[] }) => Promise.resolve()),
  fetchShowSlots: vi.fn((_client: unknown, _showId: string) => Promise.resolve([] as SlotArg[])),
}));
vi.mock("@/data/settings", () => ({ fetchShowsWithSlots: () => Promise.resolve(showsRef.value) }));
vi.mock("@/data/slots", () => ({ saveShowSlots, fetchShowSlots }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { SlotsStep } from "./SlotsStep";

beforeEach(() => {
  saveShowSlots.mockClear();
  fetchShowSlots.mockClear();
  fetchShowSlots.mockResolvedValue([]);
  showsRef.value = [
    { id: "s1", program: "Winterreise", sub_program: "Ensemble", main_cast_slots: null, understudy_slots: null, status: "active" },
    { id: "s2", program: "Set", sub_program: "Done", main_cast_slots: 4, understudy_slots: 2, status: "active" },
    { id: "s3", program: "Archived", sub_program: null, main_cast_slots: null, understudy_slots: null, status: "archived" },
  ];
});

describe("SlotsStep", () => {
  it("lists only active shows missing a main count", async () => {
    renderWithProviders(<SlotsStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText(/Winterreise/)).toBeInTheDocument();
    expect(screen.queryByText(/Set . Done|Set · Done/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Archived/)).not.toBeInTheDocument();
  });

  it("saves the entered counts as show_slots rows and invalidates shows", async () => {
    const { queryClient } = renderWithProviders(<SlotsStep orgId="org-1" onDone={() => {}} />);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    await screen.findByText(/Winterreise/);

    // s1 is the only unset (active) show, so exactly two number inputs render: main, then u/s.
    const [mainInput, usInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(mainInput, { target: { value: "4" } });
    fireEvent.change(usInput, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /save slot counts/i }));

    await waitFor(() =>
      expect(saveShowSlots).toHaveBeenCalledWith(expect.anything(), {
        showId: "s1",
        orgId: "org-1",
        slots: [
          expect.objectContaining({ name: "Main cast", count: 4, kind: "main", skillIds: [] }),
          expect.objectContaining({ name: "Understudy", count: 2, kind: "understudy", skillIds: [] }),
        ],
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["shows"] });
  });

  it("omits the understudy slot when the u/s count is left blank (understudy optional)", async () => {
    renderWithProviders(<SlotsStep orgId="org-1" onDone={() => {}} />);
    await screen.findByText(/Winterreise/);

    const [mainInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(mainInput, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /save slot counts/i }));

    // The single-element slots array asserts no understudy slot was created (an extra
    // element would fail the array match).
    await waitFor(() =>
      expect(saveShowSlots).toHaveBeenCalledWith(expect.anything(), {
        showId: "s1",
        orgId: "org-1",
        slots: [expect.objectContaining({ name: "Main cast", count: 3, kind: "main", skillIds: [] })],
      }),
    );
  });

  it("preserves a pre-existing understudy slot when only the main count is entered", async () => {
    // s1 reaches this rail because main_cast_slots is NULL, but it already has an
    // Understudy slot (added in ShowFormDialog, or left after the last Main slot was
    // removed) and that slot's skills. saveShowSlots deletes any current row absent from
    // the submitted array, so seeding from the existing slots (not []) is what stops the
    // rail from silently wiping the understudy slot.
    fetchShowSlots.mockResolvedValue([
      { id: "us-1", name: "Understudy", count: 2, kind: "understudy", skillIds: ["sk-1"] },
    ]);
    renderWithProviders(<SlotsStep orgId="org-1" onDone={() => {}} />);
    await screen.findByText(/Winterreise/);

    const [mainInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(mainInput, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /save slot counts/i }));

    // The submitted array keeps the existing understudy (id + skills intact) and adds the
    // Main slot -- exactly two rows, so the understudy was neither dropped nor duplicated.
    await waitFor(() =>
      expect(saveShowSlots).toHaveBeenCalledWith(expect.anything(), {
        showId: "s1",
        orgId: "org-1",
        slots: [
          { id: "us-1", name: "Understudy", count: 2, kind: "understudy", skillIds: ["sk-1"] },
          expect.objectContaining({ name: "Main cast", count: 3, kind: "main", skillIds: [] }),
        ],
      }),
    );
    expect(fetchShowSlots).toHaveBeenCalledWith(expect.anything(), "s1");
  });

  it("shows an empty state and no save button when there are no shows to set", async () => {
    showsRef.value = [];
    renderWithProviders(
      <MemoryRouter>
        <SlotsStep orgId="org-1" onDone={() => {}} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/no productions yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save slot counts/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add a production/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/productions"),
    );
  });

  it("says slots are already set when active shows exist but none need a count", async () => {
    showsRef.value = [
      { id: "s2", program: "Set", sub_program: "Done", main_cast_slots: 4, understudy_slots: 2, status: "active" },
    ];
    renderWithProviders(<MemoryRouter><SlotsStep orgId="org-1" onDone={() => {}} /></MemoryRouter>);
    expect(await screen.findByText(/already has its slot counts set/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save slot counts/i })).not.toBeInTheDocument();
  });

  it("treats a main-only show as already set (understudy optional)", async () => {
    showsRef.value = [
      { id: "s4", program: "Solo", sub_program: null, main_cast_slots: 2, understudy_slots: null, status: "active" },
    ];
    renderWithProviders(<MemoryRouter><SlotsStep orgId="org-1" onDone={() => {}} /></MemoryRouter>);
    expect(await screen.findByText(/already has its slot counts set/i)).toBeInTheDocument();
    expect(screen.queryByText(/Solo/)).not.toBeInTheDocument();
  });
});
