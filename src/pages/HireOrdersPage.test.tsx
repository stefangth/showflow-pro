import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// Same harness as HireOrderDetailPage.test.tsx: a call-recording fake swapped
// into a hoisted holder (never a hand-rolled vi.mock chain per house rule),
// and useAuth as a vi.fn() so each test can set the current org.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import HireOrdersPage from "./HireOrdersPage";

function authAs(orgId = "org-1") {
  vi.mocked(useAuth).mockReturnValue({
    currentOrg: { id: orgId, name: "Aurora Productions", slug: "aurora" },
    hasRole: (r: string) => r === "producer",
    roles: ["producer"],
  } as never);
}

/** A hire_orders row shaped like fetchHireOrders returns it (artist + show_date joined). */
function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "ho-1",
    order_no: "HO-2026-0201-1",
    status: "draft",
    org_id: "org-1",
    booking_id: null,
    artist_id: "ar-1",
    show_date_id: "sd-1",
    fee_amount: 1000,
    fee_currency: "EUR",
    terms_variant: "standard",
    pdf_path: null,
    countersign_mode: null,
    documenso_envelope_id: null,
    import_id: null,
    created_by: null,
    issued_at: null,
    countersigned_at: null,
    created_at: "2026-01-10T09:00:00Z",
    updated_at: "2026-01-10T09:00:00Z",
    data: {
      artist_name: { value: "Ada Lovelace", source: "showflow" },
      recipient_email: { value: "ada@example.com", source: "showflow" },
      date: { value: "2026-02-01", source: "showflow" },
      venue: { value: "Main Hall", source: "showflow" },
      duration_min: { value: "90", source: "showflow" },
      fee: { value: 1000, source: "showflow" },
    },
    artists: { name: "Ada Lovelace" },
    show_dates: { date: "2026-02-01", venue: "Main Hall" },
    ...overrides,
  };
}

const ORDERS = [
  order({ id: "ho-1", order_no: "HO-2026-0201-1", status: "draft", fee_amount: 1000 }),
  order({
    id: "ho-2",
    order_no: "HO-2026-0201-2",
    status: "issued",
    issued_at: "2026-01-12T00:00:00Z",
    fee_amount: 2000,
    artists: { name: "Ben Franklin" },
    show_dates: { date: "2026-02-05", venue: "Colosseum" },
  }),
  order({
    id: "ho-3",
    order_no: "HO-2026-0201-3",
    status: "countersigned",
    issued_at: "2026-01-05T00:00:00Z",
    countersigned_at: "2026-01-08T00:00:00Z",
    fee_amount: 3000,
    artists: { name: "Cleo Nile" },
    show_dates: { date: "2026-01-20", venue: "Grand Theatre" },
  }),
];

/** Seeds `hire_orders` so the LIST query (fetchHireOrders — no `.eq('id', …)`)
 *  falls back to the full array while the SLIDE-OVER's single-row query
 *  (fetchHireOrder — `.eq('id', id).single()`) matches its own row via the
 *  array-seed `when` matcher (see src/test/supabaseFake.ts). */
function seedOrders(orders = ORDERS) {
  seedClient({
    hire_orders: [
      ...orders.map((o) => ({ when: { id: o.id as string }, data: o, error: null })),
      { data: orders, error: null },
    ],
    "fn:generate-hire-orders": { data: { issued: ["ho-1"], failed: [] }, error: null },
  });
}

describe("HireOrdersPage", () => {
  beforeEach(() => {
    authAs();
    seedOrders();
  });

  it("renders the four KPI tiles with issued/awaiting/countersigned counts and value committed excluding void orders", async () => {
    seedOrders([...ORDERS, order({ id: "ho-4", order_no: "HO-2026-0201-4", status: "void", fee_amount: 9999 })]);
    renderWithProviders(<HireOrdersPage />);

    expect(await screen.findByText("Issued")).toBeInTheDocument();
    expect(screen.getByText("Awaiting countersign")).toBeInTheDocument();
    // "Countersigned" also names a filter chip button — the KPI tile label is
    // the <p> occurrence.
    expect(screen.getAllByText("Countersigned").some((el) => el.tagName === "P")).toBe(true);
    expect(screen.getByText("Value committed")).toBeInTheDocument();

    // KPI tiles render with the query's data-or-[] fallback on the very first
    // paint (all zeros) and update once the async query resolves — wait for
    // the resolved "Value committed" figure before reading the count tiles.
    // Issued (cumulative, issued_at set) = ho-2 + ho-3 = 2.
    // Awaiting countersign (status === issued) = ho-2 = 1.
    // Countersigned (status === countersigned) = ho-3 = 1.
    // Value committed excludes the void ho-4: 1000 + 2000 + 3000 = 6000.
    await waitFor(() => expect(screen.getByText("€6,000.00")).toBeInTheDocument());
    const tiles = screen.getAllByText(/^\d+$/);
    expect(tiles.map((t) => t.textContent)).toEqual(expect.arrayContaining(["2", "1"]));
  });

  it("renders the meta line with order count and committed value", async () => {
    renderWithProviders(<HireOrdersPage />);
    expect(await screen.findByText(/3 orders · €6,000\.00 committed/)).toBeInTheDocument();
  });

  it("renders the table with mono order numbers, stacked artist/venue, mono date, right-aligned fee, and a status badge", async () => {
    renderWithProviders(<HireOrdersPage />);
    await screen.findByText("HO-2026-0201-1");
    const table = screen.getByRole("table");

    const cell = within(table).getByText("HO-2026-0201-1");
    expect(cell.closest("td")).toHaveClass("font-mono");
    expect(within(table).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(table).getByText("Main Hall")).toBeInTheDocument();
    expect(within(table).getByText("01/02/2026")).toBeInTheDocument();
    const feeCell = within(table).getByText("€1,000.00");
    expect(feeCell.closest("td")).toHaveClass("text-right");
    expect(within(table).getByText("Draft")).toBeInTheDocument();
    expect(within(table).getByText("Awaiting countersign")).toBeInTheDocument();
  });

  it("opens the slide-over on row click and shows the draft action 'Issue and send'", async () => {
    renderWithProviders(<HireOrdersPage />);
    const cell = await screen.findByText("HO-2026-0201-1");
    fireEvent.click(cell.closest("tr")!);
    expect(await screen.findByRole("button", { name: /issue and send/i })).toBeInTheDocument();
  });

  it("shows Download + Mark countersigned for an issued order in the slide-over", async () => {
    renderWithProviders(<HireOrdersPage />);
    const cell = await screen.findByText("HO-2026-0201-2");
    fireEvent.click(cell.closest("tr")!);
    expect(await screen.findByRole("button", { name: /mark countersigned/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^download$/i })).toBeInTheDocument();
  });

  it("shows only Download (no Mark countersigned) for a countersigned order", async () => {
    renderWithProviders(<HireOrdersPage />);
    const cell = await screen.findByText("HO-2026-0201-3");
    fireEvent.click(cell.closest("tr")!);
    expect(await screen.findByRole("button", { name: /^download$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark countersigned/i })).not.toBeInTheDocument();
  });

  it("voids an order from the slide-over after confirming the AlertDialog", async () => {
    renderWithProviders(<HireOrdersPage />);
    const cell = await screen.findByText("HO-2026-0201-1");
    fireEvent.click(cell.closest("tr")!);
    const voidTrigger = await screen.findByRole("button", { name: /^void$/i });
    fireEvent.click(voidTrigger);
    const confirm = await screen.findByRole("button", { name: /void order/i });
    fireEvent.click(confirm);
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const update = calls.find((c) => c.table === "hire_orders" && c.method === "update");
      expect(update).toBeDefined();
      expect((update!.args[0] as { status?: string }).status).toBe("void");
    });
  });

  it("enables the bulk bar on selection and disables Issue selected unless every selected row is draft/ready", async () => {
    renderWithProviders(<HireOrdersPage />);
    await screen.findByText("HO-2026-0201-1");

    fireEvent.click(screen.getByLabelText("Select HO-2026-0201-1")); // draft
    fireEvent.click(screen.getByLabelText("Select HO-2026-0201-2")); // issued

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /issue selected/i })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Select HO-2026-0201-2")); // deselect the issued one
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /issue selected/i })).toBeEnabled();
  });

  it("issues the selected orders via a single batch action and clears the selection", async () => {
    renderWithProviders(<HireOrdersPage />);
    await screen.findByText("HO-2026-0201-1");
    fireEvent.click(screen.getByLabelText("Select HO-2026-0201-1"));

    fireEvent.click(screen.getByRole("button", { name: /issue selected/i }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      const body = invoke?.args[0] as { action?: string; order_ids?: string[] } | undefined;
      expect(body?.action).toBe("issue");
      expect(body?.order_ids).toEqual(["ho-1"]);
    });
    await waitFor(() => expect(screen.queryByText(/selected$/)).not.toBeInTheDocument());
  });

  it("has a header checkbox that selects every visible row", async () => {
    renderWithProviders(<HireOrdersPage />);
    await screen.findByText("HO-2026-0201-1");
    fireEvent.click(screen.getByLabelText("Select all hire orders"));
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("renders Import from spreadsheet disabled (gated behind IMPORT_READY until Task 5)", async () => {
    renderWithProviders(<HireOrdersPage />);
    await screen.findByText("HO-2026-0201-1");
    expect(screen.getByRole("button", { name: /import from spreadsheet/i })).toBeDisabled();
  });

  it("shows a destructive alert when the orders query fails", async () => {
    seedClient({ hire_orders: { data: null, error: new Error("permission denied") } });
    renderWithProviders(<HireOrdersPage />);
    expect(await screen.findByText(/failed to load hire orders/i)).toBeInTheDocument();
  });
});
