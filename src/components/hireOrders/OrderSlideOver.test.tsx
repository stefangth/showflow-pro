import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, within, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
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

// The Issue button now opens IssuePreflightSheet (rendered as an always-mounted
// sibling), whose useOrderBlockers reads app_settings through the shared supabase
// client regardless of whether the sheet is currently open. Swap in the
// call-recording fake so that read never reaches the real client.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

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

beforeEach(() => {
  vi.mocked(useCan).mockReturnValue(true);
  seedClient({ app_settings: { data: [], error: null } });
});

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

describe("OrderSlideOver issue preflight", () => {
  // The Issue button used to fire the mutation directly and report a failure in a
  // toast after the fact. It now opens IssuePreflightSheet first, and only issuing
  // from a clean sheet actually calls the mutation.
  it("opens the preflight sheet instead of firing the mutation directly, and issues once confirmed clean", async () => {
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
    const onOpenChange = vi.fn();
    renderWithProviders(
      <OrderSlideOver
        order={order({
          id: "ho-1", status: "draft", terms_variant: "t1",
          data: { fee: { value: "1200.00", source: "manual" }, recipient_email: { value: "m@e.de", source: "manual" }, date: { value: "2026-04-12", source: "manual" } },
        })}
        open onOpenChange={onOpenChange} orgId="org-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /issue and send/i }));

    // The mutation must not have fired yet -- only the sheet opened.
    function issueInvokeCalls() {
      const calls = (client as { calls?: { table: string; method: string; args: unknown[] }[] }).calls ?? [];
      return calls.filter((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
    }
    expect(issueInvokeCalls()).toHaveLength(0);
    await waitFor(() => expect(screen.getByText(/Ready to issue/i)).toBeInTheDocument());
    expect(issueInvokeCalls()).toHaveLength(0);

    // The slide-over's own sheet is now aria-hidden behind the preflight sheet
    // (Radix hides the background dialog while a nested one is open), so exactly one
    // "Issue and send" button is reachable by role -- the preflight sheet's own.
    fireEvent.click(screen.getByRole("button", { name: "Issue and send" }));

    // Wait for the full round trip (mutation resolves, onSuccess closes both sheets)
    // rather than just the call being recorded, so no state update lands after the test.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(issueInvokeCalls()).toHaveLength(1);
  });
});

describe("OrderSlideOver void dialog copy", () => {
  it("points to the redraft path instead of reading as a dead end", () => {
    renderWithProviders(<OrderSlideOver order={order({ id: "ho-1", status: "draft" })} open onOpenChange={() => {}} orgId="org-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^void$/i }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Void this hire order?")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Voiding cancels this order for good. If the artist needs a corrected order, you can generate a fresh hire order for this date afterward.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^void order$/i })).toBeInTheDocument();
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
