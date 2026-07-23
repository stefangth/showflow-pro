import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { OrderSlideOver } from "./OrderSlideOver";
import type { HireOrderListRow } from "@/data/hireOrders";

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
// The panel now gates Issue/Void on capabilities; no AuthContext mock exists
// elsewhere in this file, so mock useCan directly rather than a real AuthProvider.
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));

import { useCan } from "@/hooks/useCapabilities";

/** A minimal HireOrderListRow, only the fields OrderSlideOver reads. */
function order(overrides: Partial<HireOrderListRow> & { id: string } = { id: "ho-1" }): HireOrderListRow {
  return {
    id: "ho-1",
    order_no: "HO-2026-0201-1",
    status: "draft",
    fee_amount: 1000,
    fee_currency: "EUR",
    data: {},
    artists: { name: "Ada Lovelace" },
    show_dates: { date: "2026-02-01", venue: "Main Hall" },
    ...overrides,
  } as HireOrderListRow;
}

describe("OrderSlideOver mount/close behavior", () => {
  beforeEach(() => vi.mocked(useCan).mockReturnValue(true));

  it("mounts the Sheet driven by `open`, not gated on `order` being non-null", () => {
    // The old `if (!order) return null` guard made the whole component --
    // Sheet included -- disappear whenever `order` was null, regardless of
    // `open`. That is exactly what happens on every close: HireOrdersPage's
    // onOpenChange nulls the selected order in the same render that flips
    // `open` to false, so the Radix Portal unmounted before it ever got a
    // chance to run its slide-out transition.
    renderWithProviders(<OrderSlideOver order={null} open onOpenChange={() => {}} orgId="org-1" />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("still renders the full facts + actions when an order is present", () => {
    renderWithProviders(<OrderSlideOver order={order()} open onOpenChange={() => {}} orgId="org-1" />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /issue and send/i })).toBeInTheDocument();
  });

  it("keeps showing the last order's facts once `order` goes null, instead of blanking the panel mid-close", () => {
    // HireOrdersPage nulls `order` in the very same update that flips `open`
    // to false. Isolate that from Radix's own open/closed teardown (already
    // covered above) by holding `open` steady across the rerender: the panel
    // that's sliding away must still have real content to show --
    // `displayOrder` falls back to the last non-null order rather than the
    // content disappearing a tick before the Sheet itself finishes animating
    // out.
    const { rerender } = renderWithProviders(
      <OrderSlideOver order={order()} open onOpenChange={() => {}} orgId="org-1" />,
    );
    expect(within(screen.getByRole("dialog")).getByText("Ada Lovelace")).toBeInTheDocument();

    rerender(<OrderSlideOver order={null} open onOpenChange={() => {}} orgId="org-1" />);

    expect(within(screen.getByRole("dialog")).getByText("Ada Lovelace")).toBeInTheDocument();
  });
});

describe("OrderSlideOver capability gates", () => {
  it("issue_hire_orders off: Issue and send is disabled on a draft order", () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "issue_hire_orders");
    renderWithProviders(<OrderSlideOver order={order({ id: "ho-1", status: "draft" })} open onOpenChange={() => {}} orgId="org-1" />);
    expect(screen.getByRole("button", { name: /issue and send/i })).toBeDisabled();
  });

  it("void_hire_orders off: Void is disabled, everything else still reads", () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "void_hire_orders");
    renderWithProviders(<OrderSlideOver order={order({ id: "ho-1", status: "draft" })} open onOpenChange={() => {}} orgId="org-1" />);
    expect(screen.getByRole("button", { name: /^void$/i })).toBeDisabled();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });
});
