import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

const { showsRef, updateShow } = vi.hoisted(() => ({
  showsRef: { value: [] as unknown[] },
  updateShow: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/data/settings", () => ({ fetchShowsWithSlots: () => Promise.resolve(showsRef.value) }));
vi.mock("@/data/shows", () => ({ updateShow }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { SlotsStep } from "./SlotsStep";

beforeEach(() => {
  updateShow.mockClear();
  showsRef.value = [
    { id: "s1", program: "Winterreise", sub_program: "Ensemble", main_cast_slots: null, understudy_slots: null, status: "active" },
    { id: "s2", program: "Set", sub_program: "Done", main_cast_slots: 4, understudy_slots: 2, status: "active" },
    { id: "s3", program: "Archived", sub_program: null, main_cast_slots: null, understudy_slots: null, status: "archived" },
  ];
});

describe("SlotsStep", () => {
  it("lists only active shows missing a slot count", async () => {
    renderWithProviders(<SlotsStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText(/Winterreise/)).toBeInTheDocument();
    expect(screen.queryByText(/Set . Done|Set · Done/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Archived/)).not.toBeInTheDocument();
  });

  it("saves the entered counts and invalidates shows", async () => {
    const { queryClient } = renderWithProviders(<SlotsStep orgId="org-1" onDone={() => {}} />);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    await screen.findByText(/Winterreise/);

    // s1 is the only unset (active) show, so exactly two number inputs render: main, then u/s.
    const [mainInput, usInput] = screen.getAllByRole("spinbutton");
    fireEvent.change(mainInput, { target: { value: "4" } });
    fireEvent.change(usInput, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /save slot counts/i }));

    await waitFor(() =>
      expect(updateShow).toHaveBeenCalledWith(expect.anything(), "s1", {
        main_cast_slots: 4,
        understudy_slots: 2,
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["shows"] });
  });

  it("shows an empty state and no save button when there are no shows to set", async () => {
    showsRef.value = [];
    renderWithProviders(
      <MemoryRouter>
        <SlotsStep orgId="org-1" onDone={() => {}} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/no shows yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save slot counts/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add a show/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/productions"),
    );
  });
});
