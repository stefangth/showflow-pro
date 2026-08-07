import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const { showsRef } = vi.hoisted(() => ({ showsRef: { value: [] as unknown[] } }));
vi.mock("@/data/settings", () => ({ fetchShowsWithSlots: () => Promise.resolve(showsRef.value) }));
vi.mock("@/data/shows", () => ({ updateShow: vi.fn(() => Promise.resolve()) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { SlotsStep } from "./SlotsStep";

beforeEach(() => {
  showsRef.value = [
    { id: "s1", program: "Winterreise", sub_program: "Ensemble", main_cast_slots: null, understudy_slots: null },
    { id: "s2", program: "Set", sub_program: "Done", main_cast_slots: 4, understudy_slots: 2 },
  ];
});

describe("SlotsStep", () => {
  it("lists only shows missing a slot count", async () => {
    renderWithProviders(<SlotsStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText(/Winterreise/)).toBeInTheDocument();
    expect(screen.queryByText(/Set . Done|Set · Done/)).not.toBeInTheDocument();
  });
});
