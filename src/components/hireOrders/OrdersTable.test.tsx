import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import { OrdersTable } from "./OrdersTable";
import type { HireOrderListRow } from "@/data/hireOrders";

// Batch-issue tests below drive the real useHireOrderAction mutation, so its
// dependencies get the standard useHireOrders.test.ts-style mocks (never a
// hand-rolled supabase client chain).
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/data/hireOrders", () => ({ invokeHireOrderAction: vi.fn() }));
// The always-mounted BatchIssuePreflightDialog reads useCan (needs an AuthProvider
// otherwise) and the org's app_settings (useOrgTerms fires regardless of whether the
// dialog is open). Stub the capability and swap in the call-recording fake client.
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => true }));

import { invokeHireOrderAction } from "@/data/hireOrders";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

/** A minimal HireOrderListRow, only the fields OrdersTable reads. */
function order(overrides: Partial<HireOrderListRow> & { id: string; order_no: string }): HireOrderListRow {
  return {
    status: "draft",
    fee_amount: 1000,
    fee_currency: "EUR",
    artists: { name: "Ada Lovelace" },
    show_dates: { date: "2026-02-01", venue: "Main Hall" },
    ...overrides,
  } as HireOrderListRow;
}

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("OrdersTable keyboard access", () => {
  it("opens the row via onRowClick on Enter and Space, without needing a mouse", () => {
    const onRowClick = vi.fn();
    const orders = [order({ id: "ho-1", order_no: "HO-2026-0201-1" })];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={onRowClick} />);

    const row = screen.getByText("HO-2026-0201-1").closest("tr")!;
    expect(row).toHaveAttribute("role", "button");
    expect(row).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(row, { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledWith("ho-1");

    onRowClick.mockClear();
    fireEvent.keyDown(row, { key: " " });
    expect(onRowClick).toHaveBeenCalledWith("ho-1");
  });

  it("does not open the row when Space toggles the row's checkbox via keyboard", () => {
    const onRowClick = vi.fn();
    const orders = [order({ id: "ho-1", order_no: "HO-2026-0201-1" })];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={onRowClick} />);

    const checkbox = screen.getByRole("checkbox", { name: /select contract ho-2026-0201-1/i });
    fireEvent.keyDown(checkbox, { key: " " });
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("still opens the row on a plain mouse click (unchanged behavior)", () => {
    const onRowClick = vi.fn();
    const orders = [order({ id: "ho-1", order_no: "HO-2026-0201-1" })];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={onRowClick} />);

    fireEvent.click(screen.getByText("HO-2026-0201-1"));
    expect(onRowClick).toHaveBeenCalledWith("ho-1");
  });
});

describe("OrdersTable — past-date row tint (Plan B Task 2)", () => {
  it("tints a row whose show_date is in the past with PAST_DATE_TINT, and leaves a future row untinted", () => {
    const orders = [
      order({ id: "ho-past", order_no: "HO-PAST-1", show_dates: { date: "2020-01-01", venue: "Old Hall" } }),
      order({ id: "ho-future", order_no: "HO-FUTURE-1", show_dates: { date: "2099-01-01", venue: "New Hall" } }),
    ];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={() => {}} />);

    const pastRow = screen.getByText("HO-PAST-1").closest("tr")!;
    const futureRow = screen.getByText("HO-FUTURE-1").closest("tr")!;
    expect(pastRow.className).toMatch(/opacity-60/);
    expect(pastRow.className).not.toMatch(/pointer-events-none/);
    expect(futureRow.className).not.toMatch(/opacity-60/);
  });

  it("keeps a past-dated row clickable", () => {
    const onRowClick = vi.fn();
    const orders = [order({ id: "ho-past", order_no: "HO-PAST-1", show_dates: { date: "2020-01-01", venue: "Old Hall" } })];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={onRowClick} />);

    fireEvent.click(screen.getByText("HO-PAST-1"));
    expect(onRowClick).toHaveBeenCalledWith("ho-past");
  });

  // A manual order with no linked show_date carries its date in `data.date`
  // (a resolved snapshot field, source "manual") instead of `show_dates.date`.
  it("tints a past manual order that has no linked show_date, falling back to its own data.date", () => {
    const orders = [
      order({
        id: "ho-manual-past", order_no: "HO-MANUAL-PAST-1",
        show_dates: null,
        data: { date: { value: "2020-01-01", source: "manual" } },
      }),
      order({
        id: "ho-manual-future", order_no: "HO-MANUAL-FUTURE-1",
        show_dates: null,
        data: { date: { value: "2099-01-01", source: "manual" } },
      }),
    ];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={() => {}} />);

    const pastRow = screen.getByText("HO-MANUAL-PAST-1").closest("tr")!;
    const futureRow = screen.getByText("HO-MANUAL-FUTURE-1").closest("tr")!;
    expect(pastRow.className).toMatch(/opacity-60/);
    expect(pastRow.className).not.toMatch(/pointer-events-none/);
    expect(futureRow.className).not.toMatch(/opacity-60/);
  });

  it("keeps a past manual (no linked show_date) row clickable", () => {
    const onRowClick = vi.fn();
    const orders = [
      order({
        id: "ho-manual-past", order_no: "HO-MANUAL-PAST-1",
        show_dates: null,
        data: { date: { value: "2020-01-01", source: "manual" } },
      }),
    ];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={onRowClick} />);

    fireEvent.click(screen.getByText("HO-MANUAL-PAST-1"));
    expect(onRowClick).toHaveBeenCalledWith("ho-manual-past");
  });
});

describe("OrdersTable — Overdue indicator (Plan B fix wave)", () => {
  it("shows Overdue next to the status badge for a past-dated issued order", () => {
    const orders = [
      order({ id: "ho-1", order_no: "HO-OVERDUE-1", status: "issued", show_dates: { date: "2020-01-01", venue: "Old Hall" } }),
    ];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={() => {}} />);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("does not show Overdue for a past-dated but countersigned order", () => {
    const orders = [
      order({ id: "ho-1", order_no: "HO-DONE-1", status: "countersigned", show_dates: { date: "2020-01-01", venue: "Old Hall" } }),
    ];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={() => {}} />);
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("does not show Overdue for an upcoming issued order", () => {
    const orders = [
      order({ id: "ho-1", order_no: "HO-FUTURE-1", status: "issued", show_dates: { date: "2099-01-01", venue: "New Hall" } }),
    ];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={() => {}} />);
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("shows Overdue for a past-dated draft order (also an outstanding status)", () => {
    const orders = [
      order({ id: "ho-1", order_no: "HO-DRAFT-1", status: "draft", show_dates: { date: "2020-01-01", venue: "Old Hall" } }),
    ];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={() => {}} />);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("does not show Overdue for a past-dated void order", () => {
    const orders = [
      order({ id: "ho-1", order_no: "HO-VOID-1", status: "void", show_dates: { date: "2020-01-01", venue: "Old Hall" } }),
    ];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={() => {}} />);
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });
});

describe("OrdersTable batch issue selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Both rows below must pass the preflight check (fee, recipient email, date, plus
    // an org with a letterhead and terms configured) so the batch dialog's confirm
    // button offers to issue both -- the failure/success split under test happens at
    // the edge function, past the client-side preflight.
    seedClient({
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{ org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } }],
        },
        {
          when: { key: "hire_order_terms" },
          data: [{
            org_id: "org-1",
            value: { templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "t1" },
          }],
        },
      ],
    });
  });

  const readyData = {
    fee: { value: "1000.00", source: "manual" as const },
    recipient_email: { value: "a@e.de", source: "manual" as const },
    date: { value: "2026-02-01", source: "manual" as const },
  };

  function selectBoth() {
    fireEvent.click(screen.getByRole("checkbox", { name: /select contract ho-2026-0201-1/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select contract ho-2026-0301-1/i }));
  }

  /** Click "Issue selected" (opens the batch preflight dialog), wait for it to report
   *  both rows clean, then click its confirm button -- the dialog now sits between
   *  the selection-bar button and the actual mutation. */
  async function openDialogAndConfirm(expectedCount: number) {
    fireEvent.click(screen.getByRole("button", { name: /issue selected/i }));
    const confirmBtn = await screen.findByRole("button", { name: new RegExp(`Issue ${expectedCount} contracts?`, "i") });
    await waitFor(() => expect(confirmBtn).toBeEnabled());
    fireEvent.click(confirmBtn);
  }

  it("keeps a failed order selected and drops the succeeded one after a partial batch-issue failure", async () => {
    vi.mocked(invokeHireOrderAction).mockResolvedValue({
      issued: ["ho-1"],
      failed: [{ order_id: "ho-2", issues: ["missing_fee"] }],
    });
    const orders = [
      order({ id: "ho-1", order_no: "HO-2026-0201-1", terms_variant: "t1", data: readyData }),
      order({ id: "ho-2", order_no: "HO-2026-0301-1", terms_variant: "t1", data: readyData }),
    ];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={() => {}} />);

    selectBoth();
    await openDialogAndConfirm(2);

    // ho-2 failed to issue -- it must stay checked so the producer can fix
    // it (e.g. add the missing fee) and retry immediately, without having
    // to re-find it in the table.
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /select contract ho-2026-0301-1/i })).toBeChecked();
    });
    // ho-1 issued successfully -- it clears like the rest of a fully
    // successful batch would.
    expect(screen.getByRole("checkbox", { name: /select contract ho-2026-0201-1/i })).not.toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("clears the whole selection when every order in the batch issues successfully", async () => {
    vi.mocked(invokeHireOrderAction).mockResolvedValue({ issued: ["ho-1", "ho-2"], failed: [] });
    const orders = [
      order({ id: "ho-1", order_no: "HO-2026-0201-1", terms_variant: "t1", data: readyData }),
      order({ id: "ho-2", order_no: "HO-2026-0301-1", terms_variant: "t1", data: readyData }),
    ];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={() => {}} />);

    selectBoth();
    await openDialogAndConfirm(2);

    await waitFor(() => {
      expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();
    });
  });
});
