import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// Same harness as HireOrderDetailPage.test.tsx: a call-recording fake swapped
// into a hoisted holder (never a hand-rolled vi.mock chain), and useAuth as a
// vi.fn() so each test picks the org/role. The page drives its data through
// the real fetchHireOrders/fetchAwaitingCountersignCount (no data-layer
// mocking), so seeding the fake's hire_orders table exercises the real
// status/search filtering end to end.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
// The page now always mounts NewOrderWizard (Task 2), which calls useNavigate
// for its "Open order" success action; OrderSlideOver's Edit button (Task 2b)
// also navigates. A stable spy (not a fresh vi.fn() per call) lets tests
// assert on it. `Link` is mocked too (Task 7's FeatureOffBanner renders one)
// as a plain anchor so it doesn't need a Router context.
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  Link: ({ to, className, children }: { to: string; className?: string; children?: ReactNode }) => (
    <a href={to} className={className}>{children}</a>
  ),
}));
// The rail is exercised on its own in SetupRail.test.tsx; stub it here so this
// page's tests don't also have to seed its three app_settings reads.
vi.mock("@/components/hireOrders/setup/SetupRail", () => ({
  SetupRail: () => <div data-testid="setup-rail" />,
}));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import HireOrdersPage from "./HireOrdersPage";

function authAs(role: "admin" | "producer" = "producer", orgId = "org-1") {
  vi.mocked(useAuth).mockReturnValue({
    currentOrg: { id: orgId, name: "Aurora Productions", slug: "aurora" },
    hasRole: (r: string) => r === role,
    roles: [role],
  } as never);
}

/** A hire_orders row shaped like fetchHireOrders returns it (artist + show_date joined). */
function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "ho-1",
    order_no: "HO-2026-0201-1",
    status: "draft",
    org_id: "org-1",
    artist_id: "ar-1",
    show_date_id: "sd-1",
    booking_id: "bk-1",
    fee_amount: 1000,
    fee_currency: "EUR",
    terms_variant: "standard",
    pdf_path: null,
    created_at: "2026-01-10T09:00:00Z",
    issued_at: null,
    countersigned_at: null,
    data: {
      artist_name: { value: "Ada Lovelace", source: "showflow" },
      recipient_email: { value: "ada@example.com", source: "showflow" },
      duration_min: { value: "90", source: "showflow" },
    },
    artists: { name: "Ada Lovelace" },
    show_dates: { date: "2026-02-01", venue: "Main Hall" },
    ...overrides,
  };
}

const ROWS = [
  order({ id: "ho-1", order_no: "HO-2026-0201-1", status: "draft", fee_amount: 1000, created_at: "2026-01-10T09:00:00Z" }),
  order({
    id: "ho-2", order_no: "HO-2026-0301-1", status: "ready", fee_amount: 2000, created_at: "2026-01-09T09:00:00Z",
    artists: { name: "Zed Zeta" }, show_dates: { date: "2026-03-01", venue: "West Wing" },
    data: { artist_name: { value: "Zed Zeta", source: "showflow" }, recipient_email: { value: "zed@example.com", source: "showflow" } },
  }),
  order({
    id: "ho-3", order_no: "HO-2026-0401-1", status: "issued", fee_amount: 3000, created_at: "2026-01-08T09:00:00Z",
    pdf_path: "orgs/org-1/ho-3.pdf", issued_at: "2026-01-08T10:00:00Z",
    artists: { name: "Mira Voss" }, show_dates: { date: "2026-04-01", venue: "East Hall" },
    data: { artist_name: { value: "Mira Voss", source: "showflow" }, recipient_email: { value: "mira@example.com", source: "showflow" } },
  }),
  order({
    id: "ho-4", order_no: "HO-2026-0501-1", status: "countersigned", fee_amount: 4000, created_at: "2026-01-07T09:00:00Z",
    pdf_path: "orgs/org-1/ho-4.pdf", issued_at: "2026-01-07T10:00:00Z", countersigned_at: "2026-01-09T10:00:00Z",
    artists: { name: "Nico Lin" }, show_dates: { date: "2026-05-01", venue: "South Hall" },
    data: { artist_name: { value: "Nico Lin", source: "showflow" }, recipient_email: { value: "nico@example.com", source: "showflow" } },
  }),
  order({
    id: "ho-5", order_no: "HO-2026-0601-1", status: "void", fee_amount: 5000, created_at: "2026-01-06T09:00:00Z",
    artists: { name: "Old One" }, show_dates: { date: "2026-06-01", venue: "North Hall" },
    data: { artist_name: { value: "Old One", source: "showflow" } },
  }),
];

const SIGNED_URL = "https://signed.example/orders/ho-3.pdf?token=abc";

function seedFor(rows: Record<string, unknown>[], extra: Record<string, TableSeed> = {}) {
  seedClient({
    hire_orders: { data: rows, error: null },
    // One seeded response services every generate-hire-orders action this page
    // calls (issue / download-url) — the fake doesn't branch on request body.
    "fn:generate-hire-orders": { data: { issued: ["ho-1"], failed: [], url: SIGNED_URL }, error: null },
    // Default the module ON so the existing (non-Task-7) tests below keep
    // exercising the entitled path. The two Task 7 tests override this.
    org_entitlements: { data: [{ feature: "hire_orders", enabled: true }], error: null },
    ...extra,
  });
}

function renderPage() {
  return renderWithProviders(<HireOrdersPage />);
}

describe("HireOrdersPage", () => {
  beforeEach(() => {
    navigate.mockClear();
    authAs("producer");
    seedFor(ROWS);
  });

  it("renders the page head with eyebrow, title, and a meta line summarizing count and value", async () => {
    renderPage();
    expect(await screen.findByText("Hire orders")).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    // 5 total orders fetched (unfiltered); value committed excludes the void row
    // (1000+2000+3000+4000 = 10000).
    expect(await screen.findByText(/5 orders/i)).toBeInTheDocument();
    expect(screen.getByText(/€10,000\.00 committed/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[—–]/);
  });

  it("renders the four KPI tiles with counts derived from the unfiltered order set", async () => {
    renderPage();
    await screen.findByText("Hire orders");
    const kpiRegion = screen.getByTestId("orders-kpis");
    expect(within(kpiRegion).getByText("Issued")).toBeInTheDocument();
    expect(within(kpiRegion).getByText("Awaiting countersign")).toBeInTheDocument();
    expect(within(kpiRegion).getByText("Countersigned")).toBeInTheDocument();
    expect(within(kpiRegion).getByText("Value committed")).toBeInTheDocument();

    // Each tile is a label <p> followed by a value <p> in the same card body;
    // read the value next to a given label rather than matching a bare count
    // (multiple tiles can share the same count, e.g. two tiles reading "1").
    const kpiValue = (label: string) => {
      const labelEl = within(kpiRegion).getByText(label);
      return labelEl.nextElementSibling?.textContent;
    };
    // Issued (issued+countersigned) = 2, Awaiting (issued only) = 1, Countersigned = 1
    await waitFor(() => expect(kpiValue("Issued")).toBe("2"));
    expect(kpiValue("Awaiting countersign")).toBe("1");
    expect(kpiValue("Countersigned")).toBe("1");
    expect(kpiValue("Value committed")).toBe("€10,000.00");
  });

  it("renders the table with mono order number, stacked artist/venue, mono date, right-aligned fee, and a status badge", async () => {
    renderPage();
    const row = await screen.findByText("HO-2026-0201-1");
    expect(row).toHaveClass("font-mono");
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Main Hall")).toBeInTheDocument();
    const dateCell = screen.getByText("01/02/2026");
    expect(dateCell).toHaveClass("font-mono");
    const feeCell = screen.getByText("€1,000.00");
    expect(feeCell).toHaveClass("text-right");
    // "Draft" also labels a filter chip button — scope to the status badge div.
    expect(screen.getByText("Draft", { selector: "div" })).toBeInTheDocument();
  });

  it("opens the slide-over on row click and shows facts + Issue and send for a draft order", async () => {
    renderPage();
    const cell = await screen.findByText("HO-2026-0201-1");
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /issue and send/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^void$/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /download/i })).not.toBeInTheDocument();
  });

  it("shows Download and Mark countersigned for an issued order", async () => {
    renderPage();
    const cell = await screen.findByText("HO-2026-0401-1");
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /download/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /mark countersigned/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /issue and send/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("shows Edit alongside Issue and send for a draft order, and navigates to the V2 builder", async () => {
    renderPage();
    const cell = await screen.findByText("HO-2026-0201-1");
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    const editBtn = within(dialog).getByRole("button", { name: /^edit$/i });
    fireEvent.click(editBtn);
    expect(navigate).toHaveBeenCalledWith("/hire-orders/ho-1/edit");
  });

  it("downloads via the download-url action and opens the returned signed URL", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderPage();
    const cell = await screen.findByText("HO-2026-0401-1");
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /download/i }));
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      const body = invoke?.args[0] as { action?: string; order_id?: string } | undefined;
      expect(body?.action).toBe("download-url");
      expect(body?.order_id).toBe("ho-3");
    });
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(SIGNED_URL, "_blank", "noopener,noreferrer"));
    openSpy.mockRestore();
  });

  it("hides the Void action for an already-void order", async () => {
    renderPage();
    const cell = await screen.findByText("HO-2026-0601-1");
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /^void$/i })).not.toBeInTheDocument();
  });

  it("voids an order after confirming the AlertDialog", async () => {
    renderPage();
    const cell = await screen.findByText("HO-2026-0201-1");
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^void$/i }));
    const confirmBtn = await screen.findByRole("button", { name: /void order/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const update = calls.find((c) => c.table === "hire_orders" && c.method === "update");
      expect(update).toBeDefined();
      expect((update!.args[0] as { status?: string }).status).toBe("void");
    });
  });

  it("filters the table by status chip without changing the KPI totals", async () => {
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    fireEvent.click(screen.getByRole("button", { name: /^draft$/i }));
    await waitFor(() => {
      expect(screen.queryByText("HO-2026-0301-1")).not.toBeInTheDocument();
    });
    expect(screen.getByText("HO-2026-0201-1")).toBeInTheDocument();
    // KPI totals stay computed from the unfiltered set even while the table is filtered.
    expect(screen.getByText(/5 orders/i)).toBeInTheDocument();
  });

  it("searches by artist name across the whole set", async () => {
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "mira" } });
    await waitFor(() => {
      expect(screen.getByText("HO-2026-0401-1")).toBeInTheDocument();
      expect(screen.queryByText("HO-2026-0201-1")).not.toBeInTheDocument();
    });
  });

  it("debounces rapid search typing into one filtered query instead of one per keystroke, while the input itself stays responsive", async () => {
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    const selectCallCount = () =>
      ((client.calls ?? []) as { table: string; method: string }[]).filter(
        (c) => c.table === "hire_orders" && c.method === "select",
      ).length;
    const before = selectCallCount();

    const input = screen.getByPlaceholderText(/search/i);
    // Fast typing: several keystrokes fired back-to-back with no elapsed
    // time between them, same as a real user typing well under the 275ms
    // debounce window.
    fireEvent.change(input, { target: { value: "m" } });
    fireEvent.change(input, { target: { value: "mi" } });
    fireEvent.change(input, { target: { value: "mir" } });
    fireEvent.change(input, { target: { value: "mira" } });

    // The input reflects every keystroke immediately (stays controlled and
    // responsive) even though the query underneath hasn't fired yet.
    expect(input).toHaveValue("mira");
    expect(selectCallCount()).toBe(before);

    await waitFor(() => {
      expect(screen.getByText("HO-2026-0401-1")).toBeInTheDocument();
      expect(screen.queryByText("HO-2026-0201-1")).not.toBeInTheDocument();
    });

    // The whole four-keystroke burst collapsed into a single debounced
    // filter change: one query round for the search term (order_no ilike +
    // full-set fetch, per fetchHireOrders' own search fan-out) rather than
    // one round per keystroke.
    expect(selectCallCount() - before).toBeLessThanOrEqual(2);
  });

  it("enables the bulk bar on row selection and disables Issue selected unless every selected row is draft/ready", async () => {
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0201-1/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0401-1/i }));
    const issueBtn = screen.getByRole("button", { name: /issue selected/i });
    expect(issueBtn).toBeDisabled();
  });

  it("issues the selected draft/ready orders via the bulk bar", async () => {
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0201-1/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0301-1/i }));
    const issueBtn = screen.getByRole("button", { name: /issue selected/i });
    expect(issueBtn).toBeEnabled();
    fireEvent.click(issueBtn);
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      const body = invoke?.args[0] as { action?: string; order_ids?: string[] } | undefined;
      expect(body?.action).toBe("issue");
      expect(body?.order_ids?.sort()).toEqual(["ho-1", "ho-2"]);
    });
  });

  it("prunes a selected row from the bulk-issue bar once it is filtered out of view, so a hidden selection can never be issued unrevalidated", async () => {
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0201-1/i })); // ho-1, draft
    expect(screen.getByRole("button", { name: /issue selected/i })).toBeEnabled();

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "zed" } });
    await waitFor(() => expect(screen.queryByText("HO-2026-0201-1")).not.toBeInTheDocument());

    // The only selected row (ho-1) is no longer visible under the "zed"
    // search — the bulk bar must disappear entirely rather than keep a
    // stale, un-revalidated selection issuable.
    expect(screen.queryByRole("button", { name: /issue selected/i })).not.toBeInTheDocument();
  });

  it("sends only the still-visible, still-issuable ids when a filter change hides part of a prior selection", async () => {
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0201-1/i })); // ho-1, draft
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0301-1/i })); // ho-2, ready
    expect(screen.getByRole("button", { name: /issue selected/i })).toBeEnabled();

    // Narrow to the Draft chip: ho-2 (ready) drops out of view, but stays
    // in the raw selection set unless it's pruned.
    fireEvent.click(screen.getByRole("button", { name: /^draft$/i }));
    await waitFor(() => expect(screen.queryByText("HO-2026-0301-1")).not.toBeInTheDocument());
    expect(screen.getByText("HO-2026-0201-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /issue selected/i }));
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      const body = invoke?.args[0] as { action?: string; order_ids?: string[] } | undefined;
      expect(body?.action).toBe("issue");
      // ho-2 must never be sent: it was hidden by the filter and was never
      // re-validated against its current (visible) status.
      expect(body?.order_ids).toEqual(["ho-1"]);
    });
  });

  it("shows New order and Import from spreadsheet, both enabled (Task 5: import wizard shipped)", async () => {
    renderPage();
    await screen.findByText("Hire orders");
    // hire_orders defaults OFF in the entitlements registry, so useFeature
    // reports disabled for the brief instant the entitlements query is still
    // loading (Task 7) — wait for it to settle to the seeded "enabled" value
    // rather than asserting on the very first render.
    await waitFor(() => expect(screen.getByRole("button", { name: /new order/i })).toBeEnabled());
    expect(screen.getByRole("button", { name: /import from spreadsheet/i })).toBeEnabled();
  });

  it("opens the import wizard on Import from spreadsheet", async () => {
    renderPage();
    await screen.findByText("Hire orders");
    await waitFor(() => expect(screen.getByRole("button", { name: /import from spreadsheet/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /import from spreadsheet/i }));
    expect(await screen.findByText("Import hire orders from a spreadsheet")).toBeInTheDocument();
  });

  it("opens the guided wizard on New order and does not self-disable to a dead-end", async () => {
    renderPage();
    await screen.findByText("Hire orders");
    await waitFor(() => expect(screen.getByRole("button", { name: /new order/i })).toBeEnabled());
    const newOrderBtn = screen.getByRole("button", { name: /new order/i });
    fireEvent.click(newOrderBtn);
    expect(await screen.findByText("New hire order")).toBeInTheDocument();
    // Task-1 Minor resolved: the button used to disable itself to `wizardOpen`,
    // leaving no way to reopen the wizard after a first click.
    expect(newOrderBtn).toBeEnabled();
  });

  // Task 7: ProtectedRoute lets super-admins past the route-level feature gate,
  // so a super-admin viewing an org without the hire_orders module still lands
  // here. Every write on this page calls generate-hire-orders, which 403s when
  // the module is off, so the page must warn and disable writes rather than
  // let the click happen.
  it("warns and disables creation when the module is off", async () => {
    seedFor(ROWS, { org_entitlements: { data: [{ feature: "hire_orders", enabled: false }], error: null } });
    renderPage();
    expect(await screen.findByText(/Hire orders is off for this organization/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new order/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /import from spreadsheet/i })).toBeDisabled();
  });

  it("shows no banner and enabled actions when the module is on", async () => {
    renderPage();
    await screen.findByText("Hire orders");
    // Same loading-race note as above: wait for the entitlements query to
    // settle before asserting the banner is gone and actions are enabled.
    await waitFor(() => expect(screen.queryByText(/is off for this organization/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /new order/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /import from spreadsheet/i })).toBeEnabled();
  });

  it("mounts the setup rail", async () => {
    renderPage();
    await screen.findByText("Hire orders");
    expect(screen.getByTestId("setup-rail")).toBeInTheDocument();
  });

  it("points at the dates that are ready when there are no orders yet", async () => {
    // No hire_orders at all (noOrdersYet), and two fully-filled show_dates with
    // no active order covering them (fetchDatesReadyForHireOrder's real logic,
    // exercised through the real useDatesReadyForHireOrder hook against the
    // fake client, not a hook mock).
    seedFor([], {
      show_dates: { data: [{ id: "d1", status: "fully_filled" }, { id: "d2", status: "fully_filled" }], error: null },
      hire_order_dates: { data: [], error: null },
    });
    renderPage();
    expect(await screen.findByText(/2 dates are fully cast and ready/i)).toBeInTheDocument();
  });
});
