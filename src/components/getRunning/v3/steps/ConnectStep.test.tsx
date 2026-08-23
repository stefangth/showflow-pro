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

// useSheetImport is mocked (not driven through the shared app_settings fake), because it
// reads/writes the SAME app_settings table (under a different `key`) as useDatesSource,
// and the fake's single-object seed form does not filter by `.eq('key', …)` — seeding both
// through the same fake would make each hook see the other's row. A controllable mock
// keeps the sheet branch's Connect-step behavior isolated from the source-seeding helper
// below, mirroring MapStep.test.tsx's data-module-mock approach for the same reason.
vi.mock("@/hooks/useSheetImport", () => ({ useSheetImport: vi.fn() }));

import { useCan } from "@/hooks/useCapabilities";
import { useSheetImport } from "@/hooks/useSheetImport";
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

type SheetImportMock = ReturnType<typeof useSheetImport>;

function seedSheetImport(overrides: Partial<SheetImportMock> = {}) {
  const base: SheetImportMock = {
    settings: { url: "", map: {} },
    isLoading: false,
    saveSettings: vi.fn(),
    saving: false,
    loadHeaders: vi.fn(() => Promise.resolve([])),
    loadSheet: vi.fn(() => Promise.resolve({ headers: [], rows: [] })),
    parsed: null,
    runImport: vi.fn(),
    importing: false,
    result: null,
    importError: null,
  };
  const value = { ...base, ...overrides };
  vi.mocked(useSheetImport).mockReturnValue(value);
  return value;
}

function renderStep(onDone = vi.fn()) {
  const result = renderWithProviders(<ConnectStep orgId="org-1" onDone={onDone} />);
  return { ...result, onDone };
}

describe("ConnectStep", () => {
  beforeEach(() => {
    vi.mocked(useCan).mockReturnValue(true);
    seedSheetImport();
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

  it("keeps Continue disabled when a valid sheet URL is only typed, not yet saved", async () => {
    seedSource("sheet");
    seedSheetImport();
    renderStep();

    expect(await screen.findByLabelText(/sheet url/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    // fireEvent wraps the change in `act()`, so the resulting re-render (and the
    // Continue button's disabled state) is already flushed by the time this call
    // returns — no need to poll for it. A name-scoped `getByRole` inside a `waitFor`
    // retry loop is the project's documented RTL flake anti-pattern (see the
    // SourceStep/MapStep/CitiesStep suites): each poll recomputes the accessible name,
    // which is slow enough to burn the whole retry budget. Poll a cheap, name-free
    // signal first if the assertion is ever not already-settled, then do the single
    // name-scoped query synchronously outside any loop.
    fireEvent.change(screen.getByLabelText(/sheet url/i), {
      target: { value: "https://docs.google.com/spreadsheets/d/x/pub?output=csv&format=csv" },
    });

    // Continue is gated on the URL being SAVED (via Load columns), not merely typed:
    // advancing on an unsaved URL would strand MapStep, which reads back an empty
    // settings.url on its fresh useSheetImport mount. The saved-URL -> enabled path is
    // covered by "preselects the org's already-saved sheet URL" below.
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("preselects the org's already-saved sheet URL", async () => {
    seedSource("sheet");
    seedSheetImport({ settings: { url: "https://docs.google.com/spreadsheets/d/x/pub?output=csv&format=csv", map: {} } });
    renderStep();

    expect(await screen.findByDisplayValue(/docs\.google\.com/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
  });

  it("Load columns saves the URL and loads headers via the sheet-import hook", async () => {
    seedSource("sheet");
    const sheet = seedSheetImport({
      loadSheet: vi.fn(() => Promise.resolve({ headers: ["Program", "Date", "City"], rows: [] })),
    });
    renderStep();

    const url = "https://docs.google.com/spreadsheets/d/x/pub?output=csv&format=csv";
    fireEvent.change(await screen.findByLabelText(/sheet url/i), { target: { value: url } });
    fireEvent.click(screen.getByRole("button", { name: /load columns/i }));

    await waitFor(() => expect(sheet.loadSheet).toHaveBeenCalledWith(url));
    expect(sheet.saveSettings).toHaveBeenCalledWith({ url, map: {} });
    expect(await screen.findByText(/loaded 3 columns/i)).toBeInTheDocument();
  });
});
