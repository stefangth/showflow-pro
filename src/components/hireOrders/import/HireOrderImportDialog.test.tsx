import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// Same harness as NewOrderWizard.test.tsx / ArtistImportDialog.test.tsx: a
// call-recording fake swapped into a hoisted holder (never a hand-rolled
// vi.mock chain), and react-router's useNavigate stubbed for the Done step's
// "Open hire orders" action.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { HireOrderImportDialog } from "./HireOrderImportDialog";

const ORG = "org-1";

const ANN = { id: "a1", name: "Ann Artist", email: "ann@example.com" };
const SHOW_DATE = {
  id: "sd1", date: "2026-08-01", venue: "Main Hall", duration_minutes: 90,
  session_1: null, session_2: null, session_3: null, cities: { name: "Berlin" },
};

const CSV = `Artist,Email,Date,Venue,City,Fee
Ann Artist,ann@example.com,2026-08-01,Main Hall,Berlin,500
New Person,,2026-08-01,Main Hall,Berlin,750
,,,,,`;

function seedDefault(extra: Record<string, TableSeed> = {}) {
  seedClient({
    artists: { data: [ANN], error: null },
    show_dates: { data: [SHOW_DATE], error: null },
    app_settings: { data: [], error: null },
    ...extra,
  });
}

function renderDialog(props: Partial<{ open: boolean; onOpenChange: (o: boolean) => void; orgId: string | null }> = {}) {
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const utils = renderWithProviders(
    <HireOrderImportDialog open={props.open ?? true} onOpenChange={onOpenChange} orgId={props.orgId ?? ORG} />,
  );
  return { ...utils, onOpenChange };
}

// Radix Popover's dismissable-layer cleanup races a later tick — see the same
// helper + rationale in NewOrderWizard.test.tsx.
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

function uploadCsv(csv = CSV) {
  const input = screen.getByLabelText("Upload spreadsheet") as HTMLInputElement;
  const file = new File([csv], "orders.csv", { type: "text/csv" });
  // jsdom lacks Blob.text() (real browsers have had it since ~2020) — polyfill it.
  Object.defineProperty(file, "text", { value: async () => csv });
  fireEvent.change(input, { target: { files: [file] } });
}

function rpcCalls(name: string) {
  const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
  return calls.filter((c) => c.table === `rpc:${name}` && c.method === "rpc").map((c) => c.args[0] as Record<string, unknown>);
}

describe("HireOrderImportDialog", () => {
  beforeEach(() => {
    navigate.mockClear();
  });

  it("starts on the Source step with the stepper showing all five steps", () => {
    seedDefault();
    renderDialog();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Range")).toBeInTheDocument();
    expect(screen.getByText("Map columns")).toBeInTheDocument();
    expect(screen.getByText("Resolve")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText(/Drop a \.csv/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[—–]/);
  });

  it("uploading a CSV advances to Range, and changing the header row live re-derives the column count", async () => {
    seedDefault();
    renderDialog();
    uploadCsv();

    await waitFor(() => expect(screen.getByLabelText(/header row/i)).toBeInTheDocument());
    expect(screen.getByText(/6 columns · 3 rows selected/)).toBeInTheDocument();

    // Move the header row down one — row 2 ("Ann Artist,...") becomes the header,
    // leaving 2 data rows instead of 3. Pure re-derivation via applyRange, no
    // extra network calls.
    fireEvent.change(screen.getByLabelText(/header row/i), { target: { value: "2" } });
    expect(screen.getByText(/6 columns · 2 rows selected/)).toBeInTheDocument();
  });

  it("prefills the Map step from guessOrderMapping and lets the user override a field", async () => {
    seedDefault();
    renderDialog();
    uploadCsv();
    await waitFor(() => expect(screen.getByLabelText(/header row/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    const artistSelect = await screen.findByRole("combobox", { name: /artist name column/i });
    expect(within(artistSelect).getByText("Artist")).toBeInTheDocument();
    const feeSelect = screen.getByRole("combobox", { name: /^fee column$/i });
    expect(within(feeSelect).getByText("Fee")).toBeInTheDocument();

    // Override: point "Fee" field at a different (nonsensical but valid) column.
    fireEvent.click(feeSelect);
    fireEvent.click(await screen.findByRole("option", { name: "City" }));
    expect(within(feeSelect).getByText("City")).toBeInTheDocument();
  });

  async function walkToResolve() {
    renderDialog();
    uploadCsv();
    await waitFor(() => expect(screen.getByLabelText(/header row/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i })); // -> map
    await screen.findByText(/Matched your columns/i);
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i })); // -> resolve
  }

  it("Resolve step lists only the unmatched artist row and links it to an existing artist", async () => {
    seedDefault();
    await walkToResolve();

    expect(await screen.findByText("New Person")).toBeInTheDocument();
    // The matched row (Ann Artist) never appears in the Resolve list.
    expect(screen.queryByText("Ann Artist")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: /link or create artist for new person/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Ann Artist" }));
    await flush();

    expect(await screen.findByText("Linked")).toBeInTheDocument();
  });

  it("Review step shows Ready/Attention/Skipped tiles with ready rows preselected and skipped unselectable", async () => {
    seedDefault();
    await walkToResolve();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i })); // -> review, without resolving New Person

    await screen.findByText("Needs attention");
    // Ann Artist row is ready and fully matched -> preselected.
    const annCheckbox = screen.getByRole("checkbox", { name: /select ann artist/i });
    expect(annCheckbox).toBeChecked();
    // New Person is still unknown_artist -> attention, not preselected.
    const newPersonCheckbox = screen.getByRole("checkbox", { name: /select new person/i });
    expect(newPersonCheckbox).not.toBeChecked();
    // The blank row is skipped -> its checkbox is disabled.
    const skippedCheckbox = screen.getByRole("checkbox", { name: /select row 4/i });
    expect(skippedCheckbox).toBeDisabled();
  });

  it("submits the selected rows to bulk_import_hire_orders with resolved data, then shows the Done screen", async () => {
    seedDefault({
      "rpc:bulk_import_hire_orders": {
        data: [
          { row_index: 2, status: "created", order_id: "ho-1" },
          { row_index: 3, status: "skipped_existing" },
        ],
        error: null,
      },
    });
    await walkToResolve();

    // Link New Person so both non-skipped rows are importable. Linking clears
    // its unknown_artist issue, so it resolves to "ready" and is ALREADY
    // preselected on entering Review (goToReview recomputes selection fresh).
    fireEvent.click(screen.getByRole("combobox", { name: /link or create artist for new person/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Ann Artist" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i })); // -> review

    await screen.findByText("Needs attention");
    expect(screen.getByRole("checkbox", { name: /select ann artist/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /select new person/i })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: /import 2 orders/i }));

    await waitFor(() => expect(rpcCalls("bulk_import_hire_orders").length).toBe(1));
    const body = rpcCalls("bulk_import_hire_orders")[0];
    expect(body.p_org).toBe(ORG);
    const importMeta = body.p_import as Record<string, unknown>;
    expect(importMeta.source).toBe("csv");
    expect(importMeta.row_count).toBe(2);

    const rows = body.p_rows as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    const annRow = rows.find((r) => (r.artist_id as string) === "a1" && (r.show_date_id as string) === "sd1");
    expect(annRow).toBeTruthy();
    const data = annRow!.data as { fee?: { value: unknown; source: string }; artist_name?: { value: unknown } };
    expect(data.fee?.value).toBe("500.00");
    expect(data.fee?.source).toBe("sheet");
    expect(annRow!.fee_amount).toBe(500);
    expect(annRow!.fee_currency).toBe("EUR");
    expect(annRow!.terms_variant).toBe("standard");

    expect(await screen.findByText(/Created 1 draft hire order/i)).toBeInTheDocument();
    expect(screen.getByText(/1 already existed/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open hire orders/i }));
    expect(navigate).toHaveBeenCalledWith("/hire-orders");
  });

  it("creates a new artist from the Resolve step and links it automatically", async () => {
    seedClient({
      artists: [
        { when: { org_id: ORG }, data: [ANN] },
        { data: { id: "a-new", name: "New Person", email: null } },
      ],
      show_dates: { data: [SHOW_DATE], error: null },
      app_settings: { data: [], error: null },
    });
    await walkToResolve();

    fireEvent.click(screen.getByRole("combobox", { name: /link or create artist for new person/i }));
    fireEvent.click(await screen.findByRole("option", { name: /create new artist/i }));
    await flush();

    await waitFor(() => expect(screen.getByText("Linked")).toBeInTheDocument());
    expect(screen.getByText(/→ New Person/)).toBeInTheDocument();
    expect(client.calls).toContainEqual(
      expect.objectContaining({
        table: "artists",
        method: "insert",
        args: [{ name: "New Person", email: null, org_id: ORG }],
      }),
    );
  });

  it("fetches a Google Sheets URL via fetch-remote-sheet and advances to Range", async () => {
    seedClient({
      artists: { data: [ANN], error: null },
      show_dates: { data: [SHOW_DATE], error: null },
      app_settings: { data: [], error: null },
      "fn:fetch-remote-sheet": { data: { csv: CSV }, error: null },
    });
    renderDialog();

    fireEvent.change(screen.getByPlaceholderText(/paste a public google sheets link/i), {
      target: { value: "https://docs.google.com/spreadsheets/d/abc/pub?output=csv" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^fetch$/i }));

    await waitFor(() => expect(screen.getByLabelText(/header row/i)).toBeInTheDocument());
    expect(client.calls).toContainEqual(
      expect.objectContaining({ table: "fn:fetch-remote-sheet", method: "invoke" }),
    );
  });
});
