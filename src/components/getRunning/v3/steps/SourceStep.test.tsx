import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// Approved fake in a hoisted holder (vi.mock is hoisted above imports) — never a
// hand-rolled vi.mock chain, per DatesPanelBody.test.tsx / TeamPanelBody.test.tsx.
// SourceStep calls the REAL useDatesSource -> fetchDatesSource/saveDatesSource
// (src/data/datesSource.ts), which read/write the `app_settings` table via the shared
// supabase singleton — the fake stands in for that singleton.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

// useCan drives the read-only gate. Mocked to a controllable flat boolean, same
// pattern as DatesPanelBody.test.tsx — none of this suite's assertions depend on
// per-action capability variance.
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

import { useCan } from "@/hooks/useCapabilities";
import { SourceStep } from "./SourceStep";

function seedSource(source: "airtable" | "manual" | "sheet" | null) {
  Object.assign(
    client,
    createFakeSupabase({
      app_settings: {
        data: source ? [{ org_id: "org-1", value: source }] : [],
        error: null,
      },
    }),
  );
}

function renderStep(onDone = vi.fn()) {
  const result = renderWithProviders(<SourceStep orgId="org-1" onDone={onDone} />);
  return { ...result, onDone };
}

describe("SourceStep", () => {
  beforeEach(() => {
    vi.mocked(useCan).mockReturnValue(true);
  });

  it("renders the three source cards with the Sheet card disabled", async () => {
    seedSource(null);
    renderStep();

    await waitFor(() => expect(screen.getByRole("radio", { name: /airtable/i })).toBeInTheDocument());
    expect(screen.getByRole("radio", { name: /google sheet/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /by hand/i })).toBeInTheDocument();
  });

  it("preselects the already-chosen source", async () => {
    seedSource("airtable");
    renderStep();

    await waitFor(() => expect(screen.getByRole("radio", { name: /airtable/i })).toBeChecked());
  });

  it("selecting By hand and clicking Continue saves manual and calls onDone", async () => {
    seedSource(null);
    const { onDone } = renderStep();

    const manualRadio = await screen.findByRole("radio", { name: /by hand/i });
    fireEvent.click(manualRadio);
    const continueButton = screen.getByRole("button", { name: /continue/i });
    fireEvent.click(continueButton);

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect((client as unknown as { calls: unknown[] }).calls).toContainEqual({
      table: "app_settings",
      method: "upsert",
      args: [
        { org_id: "org-1", key: "getrunning_dates_source", value: "manual" },
        { onConflict: "org_id,key" },
      ],
    });
  });

  it("read-only viewers see the choice but cannot change it", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    seedSource("airtable");
    renderStep();

    await waitFor(() => expect(screen.getByRole("radio", { name: /airtable/i })).toBeChecked());
    expect(screen.getByRole("radio", { name: /airtable/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /by hand/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /continue/i })).not.toBeInTheDocument();
    expect(screen.getByText(/ask an admin/i)).toBeInTheDocument();
  });
});
