import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, screen } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import type { ShowWithStats } from "@/hooks/useShows";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

Object.assign(
  client,
  createFakeSupabase({
    show_slots: { data: [{ id: "slot-1", name: "Lead", slot_count: 2, kind: "main", sort_order: 0 }], error: null },
    show_slot_required_skills: { data: [], error: null },
    skills: { data: [], error: null },
  }),
);

// useShows drives the whole row list; mocking it (real pattern in ProductionsPage.test.tsx)
// keeps the fixture explicit instead of round-tripping through fetchShowsWithStats.
const SHOWS: ShowWithStats[] = [
  {
    id: "s1", program: "Hamlet", sub_program: null, category: null, description: null,
    status: "active", main_cast_slots: null, understudy_slots: null,
    airtable_program_key: null, sort_order: 1, created_at: "2026-01-01", dateCount: 0,
  },
];
const showsQuery = vi.fn(() => ({ data: SHOWS, isLoading: false, isError: false }));
vi.mock("@/hooks/useShows", async (orig) => {
  const real = await orig<typeof import("@/hooks/useShows")>();
  return { ...real, useShows: () => showsQuery() };
});

vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

// Both by-hand dialogs have their own dedicated test coverage (ShowFormDialog.test.tsx,
// ShowDateFormDialog.test.tsx); ProductionsStep only orchestrates when they open, so they
// are stubbed here (same pattern as ShowsBookingsPage.test.tsx).
vi.mock("@/components/catalog/ShowFormDialog", () => ({
  ShowFormDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="show-form-dialog" /> : null),
}));
vi.mock("@/components/shows/ShowDateFormDialog", () => ({
  ShowDateFormDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="show-date-form-dialog" /> : null),
}));

import { useCan } from "@/hooks/useCapabilities";
import { ProductionsStep } from "./ProductionsStep";

function renderStep(onDone = vi.fn()) {
  const result = renderWithProviders(<ProductionsStep orgId="org-1" onDone={onDone} />, {
    authOverrides: { currentOrg: { id: "org-1", name: "Org", suspended_at: null } as never },
  });
  return { ...result, onDone };
}

describe("ProductionsStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCan).mockReturnValue(true);
    showsQuery.mockReturnValue({ data: SHOWS, isLoading: false, isError: false });
  });

  it("shows the unconfigured pill for a production with no parts and keeps Continue disabled", () => {
    renderStep();

    expect(screen.getByText("Hamlet")).toBeInTheDocument();
    expect(screen.getByText(/unconfigured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("enables Continue once a production has parts configured, and calls onDone on click", () => {
    showsQuery.mockReturnValue({
      data: [{ ...SHOWS[0], main_cast_slots: 2, understudy_slots: 1 }],
      isLoading: false,
      isError: false,
    });
    const { onDone } = renderStep();

    const continueBtn = screen.getByRole("button", { name: /continue/i });
    expect(continueBtn).toBeEnabled();

    fireEvent.click(continueBtn);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("clicking Set casting breakdown opens the PartsEditorSheet for that production", async () => {
    renderStep();

    const setPartsBtn = screen.getByRole("button", { name: /set casting breakdown/i });
    fireEvent.click(setPartsBtn);

    // Coarse, name-free wait: the sheet has rendered before we do any name-scoped query.
    await waitFor(() => {
      expect(screen.getByDisplayValue("Lead")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /casting breakdown for hamlet/i })).toBeInTheDocument();
  });

  it("shows the empty state prompting to add the first production when there are none", () => {
    showsQuery.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderStep();

    expect(screen.getByText(/no productions yet/i)).toBeInTheDocument();
  });

  it("hides add/edit controls for a read only viewer", () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderStep();

    expect(screen.queryByRole("button", { name: /^add a production$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^add a date$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /set casting breakdown/i })).not.toBeInTheDocument();
  });
});
