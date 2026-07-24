import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { OrderSlideOver } from "./OrderSlideOver";
import { useHireOrderCountersignMode } from "@/hooks/useHireOrders";
import { useCan } from "@/hooks/useCapabilities";
import type { HireOrderListRow } from "@/data/hireOrders";

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
// The panel gates Issue/Void on capabilities; mock useCan directly (no AuthProvider here).
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));

// Keep the real mutation hooks (they never auto-fire), but stub the one query
// hook so no real network read runs on mount and each test can pick the mode.
vi.mock("@/hooks/useHireOrders", async (orig) => ({
  ...(await orig<object>()),
  useHireOrderCountersignMode: vi.fn(() => ({ data: { mode: "manual" } })),
}));

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

beforeEach(() => vi.mocked(useCan).mockReturnValue(true));

describe("OrderSlideOver mount/close behavior", () => {
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

describe("OrderSlideOver countersign-mode gating on an issued order", () => {
  it("shows created and last-sent timestamps plus View and Resend for an issued order", () => {
    renderWithProviders(
      <OrderSlideOver
        order={order({
          id: "ho-1",
          status: "issued",
          created_at: "2026-07-24T08:00:00Z",
          last_sent_at: "2026-07-24T09:30:00Z",
        })}
        open
        onOpenChange={vi.fn()}
        orgId="org-1"
      />,
    );

    expect(screen.getByText(/created/i)).toBeInTheDocument();
    expect(screen.getByText(/last sent/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^view$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^resend$/i })).toBeInTheDocument();
  });

  it("keeps Mark countersigned in manual mode (alongside Download)", () => {
    vi.mocked(useHireOrderCountersignMode).mockReturnValue({ data: { mode: "manual" } } as never);
    renderWithProviders(
      <OrderSlideOver order={order({ id: "ho-1", status: "issued" })} open onOpenChange={() => {}} orgId="org-1" />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /mark countersigned/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /download/i })).toBeInTheDocument();
  });

  it("hides Mark countersigned in electronic mode but keeps Download", () => {
    // An electronic order must be completed by the artist's in-app signature, so
    // the one-click manager flip is not offered — only Download.
    vi.mocked(useHireOrderCountersignMode).mockReturnValue({ data: { mode: "electronic" } } as never);
    renderWithProviders(
      <OrderSlideOver order={order({ id: "ho-1", status: "issued" })} open onOpenChange={() => {}} orgId="org-1" />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /mark countersigned/i })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /download/i })).toBeInTheDocument();
  });

  it("hides Mark countersigned for an order ISSUED electronic even when the live org mode is manual (order-mode wins)", () => {
    // The order was issued electronic (frozen in issue_snapshot); the org's live
    // setting is now manual. The manual flip stays withheld — it would strand the order
    // against the DB gate, which keys off the same frozen issue-time mode.
    vi.mocked(useHireOrderCountersignMode).mockReturnValue({ data: { mode: "manual" } } as never);
    renderWithProviders(
      <OrderSlideOver
        order={order({ id: "ho-1", status: "issued", issue_snapshot: { countersign_mode: "electronic" } })}
        open onOpenChange={() => {}} orgId="org-1"
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /mark countersigned/i })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /download/i })).toBeInTheDocument();
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
