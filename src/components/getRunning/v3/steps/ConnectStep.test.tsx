import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// Approved fake in a hoisted holder (vi.mock is hoisted above imports) — never a
// hand-rolled vi.mock chain, per SourceStep.test.tsx / DatesPanelBody.test.tsx. ConnectStep
// calls the REAL useDatesSource (-> fetchDatesSource, reads app_settings) and the REAL
// useAirtableConsole (-> fetchAirtableKeyStatus via rpc, fetchAirtableSettings/other queries
// via app_settings and various tables), all through the shared supabase singleton — the fake
// stands in for that singleton. Every table/rpc this suite doesn't seed falls back to the
// fake's default `{ data: [], error: null }` / `{ data: null, error: null }`, which resolves
// keyPresent/hasBaseTable to false — exactly the "not connected" state these tests exercise.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

// useCan drives the read-only gate. Mocked to a controllable flat boolean, same pattern as
// SourceStep.test.tsx — none of this suite's assertions depend on per-action capability
// variance.
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

import { useCan } from "@/hooks/useCapabilities";
import { ConnectStep } from "./ConnectStep";

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
  const result = renderWithProviders(<ConnectStep orgId="org-1" onDone={onDone} />);
  return { ...result, onDone };
}

describe("ConnectStep", () => {
  beforeEach(() => {
    vi.mocked(useCan).mockReturnValue(true);
  });

  it("renders the by-hand info body and Continue calls onDone when source is manual", async () => {
    seedSource("manual");
    const { onDone } = renderStep();

    expect(await screen.findByText(/by hand needs no connection/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("renders the Airtable token step when source is airtable and no key is saved", async () => {
    seedSource("airtable");
    renderStep();

    expect(
      await screen.findByRole("heading", { level: 3, name: "Personal access token" }),
    ).toBeInTheDocument();
    // Not yet connected (no key, no base/table) — Continue must stay disabled so the
    // wizard can't advance past an unconfigured connection.
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });
});
