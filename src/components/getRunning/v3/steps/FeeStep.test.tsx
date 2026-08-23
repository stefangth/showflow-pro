import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import type { Cast } from "@/types";
import type { ShowWithStats } from "@/hooks/useShows";
import type { CastProductionFee } from "@/hooks/useCastProductionFees";

// Approved fake in a hoisted holder (vi.mock is hoisted above imports) — never a
// hand-rolled vi.mock chain, per SourceStep.test.tsx. FeeStep mounts the real
// OrderDefaultsCard, which reads/writes `app_settings` via the shared supabase
// singleton — the fake stands in for that singleton.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

// useCan drives the read-only gate. Mocked to a controllable flat boolean, same
// pattern as SourceStep.test.tsx / SkillsStep.test.tsx.
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

// The cast list drives the whole "zero casts" gate vs. the fee-list editor. Mocking
// fetchCasts directly (same shape of fixture-control as ProductionsStep.test.tsx's
// useShows mock) keeps the fixture explicit instead of round-tripping through the fake
// supabase `casts` table.
const castsState = vi.hoisted(() => ({ casts: [] as Cast[] }));
vi.mock("@/data/casts", async (orig) => ({
  ...(await orig<typeof import("@/data/casts")>()),
  fetchCasts: vi.fn(async () => castsState.casts),
}));

// useShows drives the production picker.
const SHOWS: ShowWithStats[] = [
  {
    id: "show-1", program: "Hamlet", sub_program: null, category: null, description: null,
    status: "active", main_cast_slots: null, understudy_slots: null,
    airtable_program_key: null, sort_order: 1, created_at: "2026-01-01", dateCount: 0,
  },
];
vi.mock("@/hooks/useShows", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useShows")>()),
  useShows: () => ({ data: SHOWS, isLoading: false, isError: false }),
}));

// useCastProductionFees/useUpsertCastProductionFee: mocked so the "add a fee" flow can be
// asserted directly against the mutate call, rather than round-tripped through the fake
// supabase `cast_production_fees` table (that upsert path is covered by
// castProductionFees.test.ts / useCastProductionFees.test.ts already).
const feesState = vi.hoisted(() => ({ fees: [] as CastProductionFee[] }));
const upsertMutate = vi.hoisted(() => vi.fn());
const deleteMutate = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useCastProductionFees", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCastProductionFees")>()),
  useCastProductionFees: () => ({ data: feesState.fees, isLoading: false, isError: false }),
  useUpsertCastProductionFee: () => ({ mutate: upsertMutate, isPending: false }),
  useDeleteCastProductionFee: () => ({ mutate: deleteMutate, isPending: false }),
}));

import { useCan } from "@/hooks/useCapabilities";
import { FeeStep } from "@/components/getRunning/v3/steps/FeeStep";

function seedAppSettings() {
  Object.assign(client, createFakeSupabase({ app_settings: { data: [], error: null } }));
}

function renderStep(onDone = vi.fn()) {
  const result = renderWithProviders(<FeeStep orgId="org-1" onDone={onDone} />, { authOverrides: {} });
  return { ...result, onDone };
}

describe("FeeStep", () => {
  beforeEach(() => {
    vi.mocked(useCan).mockReturnValue(true);
    seedAppSettings();
    castsState.casts = [];
    feesState.fees = [];
    upsertMutate.mockClear();
    deleteMutate.mockClear();
  });

  it("shows the no-casts gate and no fee editor when the org has zero casts", async () => {
    renderStep();

    expect(await screen.findByText(/no casts yet/i)).toBeInTheDocument();
    // "Casts and the ladder" appears twice (the deep-link pill and inside the note's own
    // sentence) — getAllByText, not getByText, since both are the same coverage-link copy.
    expect(screen.getAllByText(/casts and the ladder/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /add a fee/i })).toBeNull();
  });

  it("advances on continue via the org-default card when capable, even with zero casts", async () => {
    const { onDone } = renderStep();

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("lists existing fee rows and lets a capable viewer add and save a new one", async () => {
    castsState.casts = [{ id: "cast-1", name: "Nord Ensemble", org_id: "org-1" } as Cast];
    feesState.fees = [
      { id: "fee-1", cast_id: "cast-1", show_id: "show-1", fee_amount: 500, currency: "EUR", fee_basis: "per_date" },
    ];
    renderStep();

    // "Add a fee" only renders once hasCasts flips true, so waiting on it (rather than
    // the list heading, whose text overlaps a substring of the no-casts note) is the
    // unambiguous signal the fee list editor has actually mounted.
    const addFeeButton = await screen.findByRole("button", { name: /add a fee/i });
    expect(screen.getByText(/Nord Ensemble/)).toBeInTheDocument();
    expect(screen.getByText(/Hamlet/)).toBeInTheDocument();

    fireEvent.click(addFeeButton);

    // Selects are named via aria-label (cast/production), distinguishing them from
    // OrderDefaultsCard's own currency/fee-basis selects mounted above.
    fireEvent.click(screen.getByRole("combobox", { name: /^cast$/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Nord Ensemble" }));

    fireEvent.click(screen.getByRole("combobox", { name: /^production$/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Hamlet" }));

    const amountInput = screen.getByRole("spinbutton", { name: /^fee$/i });
    fireEvent.change(amountInput, { target: { value: "750" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(upsertMutate).toHaveBeenCalledWith(
        {
          orgId: "org-1",
          castId: "cast-1",
          showId: "show-1",
          feeAmount: 750,
          currency: "EUR",
          feeBasis: "per_date",
        },
        expect.anything(),
      ),
    );
  });

  it("lets a capable viewer delete an existing fee row, falling back to the org default", async () => {
    castsState.casts = [{ id: "cast-1", name: "Nord Ensemble", org_id: "org-1" } as Cast];
    feesState.fees = [
      { id: "fee-1", cast_id: "cast-1", show_id: "show-1", fee_amount: 500, currency: "EUR", fee_basis: "per_date" },
    ];
    renderStep();

    await screen.findByText(/Nord Ensemble/);
    fireEvent.click(screen.getByRole("button", { name: /remove this fee/i }));

    await waitFor(() =>
      expect(deleteMutate).toHaveBeenCalledWith({ id: "fee-1", orgId: "org-1" }),
    );
  });

  it("shows no delete control for an existing fee row when the viewer cannot edit", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    castsState.casts = [{ id: "cast-1", name: "Nord Ensemble", org_id: "org-1" } as Cast];
    feesState.fees = [
      { id: "fee-1", cast_id: "cast-1", show_id: "show-1", fee_amount: 500, currency: "EUR", fee_basis: "per_date" },
    ];
    renderStep();

    await screen.findByText(/Nord Ensemble/);
    expect(screen.queryByRole("button", { name: /remove this fee/i })).toBeNull();
  });

  it("renders read-only (no continue) when the viewer cannot edit", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderStep();

    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    expect(screen.getByText(/set by an admin/i)).toBeInTheDocument();

    // The reused OrderDefaultsCard is genuinely put in read-only mode (readOnly={!canEdit}):
    // once it loads, its Save control is the only button on screen (the wizard Continue is
    // gone) and it is disabled. Without the readOnly wiring a producer could still write org
    // fee defaults. findAllByRole awaits the card's own async query settling.
    const buttons = await screen.findAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBeDisabled();
  });
});
