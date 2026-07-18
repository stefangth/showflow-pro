import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { OrdersTable } from "./OrdersTable";
import type { HireOrderListRow } from "@/data/hireOrders";

// Batch-issue tests below drive the real useHireOrderAction mutation, so its
// dependencies get the standard useHireOrders.test.ts-style mocks (never a
// hand-rolled supabase client chain).
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/data/hireOrders", () => ({ invokeHireOrderAction: vi.fn() }));

import { invokeHireOrderAction } from "@/data/hireOrders";

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

    const checkbox = screen.getByRole("checkbox", { name: /select order ho-2026-0201-1/i });
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

describe("OrdersTable batch issue selection", () => {
  beforeEach(() => vi.clearAllMocks());

  function selectBoth() {
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0201-1/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0301-1/i }));
  }

  it("keeps a failed order selected and drops the succeeded one after a partial batch-issue failure", async () => {
    vi.mocked(invokeHireOrderAction).mockResolvedValue({
      issued: ["ho-1"],
      failed: [{ order_id: "ho-2", issues: ["missing_fee"] }],
    });
    const orders = [
      order({ id: "ho-1", order_no: "HO-2026-0201-1" }),
      order({ id: "ho-2", order_no: "HO-2026-0301-1" }),
    ];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={() => {}} />);

    selectBoth();
    fireEvent.click(screen.getByRole("button", { name: /issue selected/i }));

    // ho-2 failed to issue -- it must stay checked so the producer can fix
    // it (e.g. add the missing fee) and retry immediately, without having
    // to re-find it in the table.
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /select order ho-2026-0301-1/i })).toBeChecked();
    });
    // ho-1 issued successfully -- it clears like the rest of a fully
    // successful batch would.
    expect(screen.getByRole("checkbox", { name: /select order ho-2026-0201-1/i })).not.toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("clears the whole selection when every order in the batch issues successfully", async () => {
    vi.mocked(invokeHireOrderAction).mockResolvedValue({ issued: ["ho-1", "ho-2"], failed: [] });
    const orders = [
      order({ id: "ho-1", order_no: "HO-2026-0201-1" }),
      order({ id: "ho-2", order_no: "HO-2026-0301-1" }),
    ];
    renderWithProviders(<OrdersTable orders={orders} orgId="org-1" onRowClick={() => {}} />);

    selectBoth();
    fireEvent.click(screen.getByRole("button", { name: /issue selected/i }));

    await waitFor(() => {
      expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();
    });
  });
});
