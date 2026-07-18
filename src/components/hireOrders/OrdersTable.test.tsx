import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { OrdersTable } from "./OrdersTable";
import type { HireOrderListRow } from "@/data/hireOrders";

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
