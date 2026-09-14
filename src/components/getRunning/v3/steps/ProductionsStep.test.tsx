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

// `useCan` differentiates by action so a test can grant one capability while withholding
// another — the whole point of the fix this covers is that `manage_productions` and
// `manage_show_dates` are independently held via per-org overrides, so a mock that returns
// the same boolean for every action could never have caught the "Add a date" gate reading
// the wrong capability. Defaults every action to true (all-editor); pass overrides to
// withhold specific ones.
const mockUseCan = (overrides: Record<string, boolean> = {}) =>
  vi.mocked(useCan).mockImplementation((action: string) => overrides[action] ?? true);

describe("ProductionsStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCan();
    showsQuery.mockReturnValue({ data: SHOWS, isLoading: false, isError: false });
  });

  it("shows the unconfigured pill for a production with no parts and keeps Continue disabled", () => {
    renderStep();

    expect(screen.getByText("Hamlet")).toBeInTheDocument();
    expect(screen.getByText(/unconfigured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("enables Continue once a production has parts configured and a date, and calls onDone on click", () => {
    showsQuery.mockReturnValue({
      // Both halves of the step's own `done` (`hasAnyDates && slotsDone`): a breakdown AND
      // at least one date.
      data: [{ ...SHOWS[0], main_cast_slots: 2, understudy_slots: 1, dateCount: 3 }],
      isLoading: false,
      isError: false,
    });
    const { onDone } = renderStep();

    const continueBtn = screen.getByRole("button", { name: /continue/i });
    expect(continueBtn).toBeEnabled();

    fireEvent.click(continueBtn);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  /**
   * The step's model `done` is `hasAnyDates && slotsDone`, but Continue asked only about
   * slots. With productions configured and zero dates, Continue was enabled, completed
   * nothing, and the wizard's advance wrapped BACKWARDS to `cities`, whose body says "Go to
   * productions": a loop with no exit. Nothing in the copy mentioned dates either.
   */
  it("keeps Continue disabled, and says why, when configured productions have no dates", () => {
    showsQuery.mockReturnValue({
      data: [{ ...SHOWS[0], main_cast_slots: 2, understudy_slots: 1, dateCount: 0 }],
      isLoading: false,
      isError: false,
    });
    renderStep();

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    expect(screen.getByText(/add at least one date to continue/i)).toBeInTheDocument();
    // The slots reason is the wrong one here and must not also render.
    expect(screen.queryByText(/set at least one parts breakdown/i)).toBeNull();
  });

  it("clicking Set parts breakdown opens the PartsEditorSheet for that production", async () => {
    renderStep();

    const setPartsBtn = screen.getByRole("button", { name: /set parts breakdown/i });
    fireEvent.click(setPartsBtn);

    // Coarse, name-free wait: the sheet has rendered before we do any name-scoped query.
    await waitFor(() => {
      expect(screen.getByDisplayValue("Lead")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /parts breakdown for hamlet/i })).toBeInTheDocument();
  });

  it("shows the empty state prompting to add the first production when there are none", () => {
    showsQuery.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderStep();

    expect(screen.getByText(/no productions yet/i)).toBeInTheDocument();
  });

  /**
   * `shows.data ?? []` is also what an ERRORED read looks like, so an org WITH productions
   * was told it had none and invited to create one, which duplicates a production. The
   * failed read must say it failed.
   */
  it("shows a read error instead of the empty state when the productions read fails", () => {
    showsQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderStep();

    expect(screen.getByText(/could not load your productions/i)).toBeInTheDocument();
    expect(screen.queryByText(/no productions yet/i)).toBeNull();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("shows no empty state while the productions read is still loading", () => {
    showsQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderStep();

    expect(screen.queryByText(/no productions yet/i)).toBeNull();
    expect(screen.queryByText(/could not load your productions/i)).toBeNull();
  });

  it("hides add/edit controls for a read only viewer", () => {
    mockUseCan({ manage_productions: false, manage_show_dates: false, edit_scheduling: false });
    renderStep();

    expect(screen.queryByRole("button", { name: /^add a new production$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^add a date$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /set parts breakdown/i })).not.toBeInTheDocument();
  });

  it("gates Add a date on manage_show_dates independently of manage_productions", () => {
    // manage_productions granted, manage_show_dates withheld: this is exactly the mixed
    // per-org override case the two capabilities can land in, and the case that would
    // have caught "Add a date" wrongly reading manage_productions.
    mockUseCan({ manage_show_dates: false });
    renderStep();

    expect(screen.getByRole("button", { name: /^add a new production$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^add a date$/i })).not.toBeInTheDocument();
  });
});

describe("ProductionsStep, the add-a-production action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCan();
    showsQuery.mockReturnValue({ data: SHOWS, isLoading: false, isError: false });
  });

  it("keeps the header action when the list read fails", () => {
    // `shows.data ?? []` is empty for an ERRORED read too, but the error branch renders an
    // Alert, not the empty state that carries the replacement action. Gating the header
    // button on the list being empty stranded a producer with no way to create anything.
    showsQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderStep();

    expect(screen.getByRole("button", { name: /add a new production/i })).toBeInTheDocument();
  });

  it("keeps the header action while the list read is still loading", () => {
    showsQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderStep();

    expect(screen.getByRole("button", { name: /add a new production/i })).toBeInTheDocument();
  });

  it("offers the action exactly once on a settled, empty list", () => {
    showsQuery.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderStep();

    expect(screen.getAllByRole("button", { name: /add a new production/i })).toHaveLength(1);
  });
});
